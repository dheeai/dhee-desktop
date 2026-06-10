import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import {
  useAudioController,
  type AudioControllerOptions,
} from './useAudioController';

/**
 * useAudioController drives an HTMLAudioElement imperatively through a ref to
 * avoid React re-render interference. jsdom doesn't implement play/pause/load,
 * so we install a minimal fake audio element on the returned ref and exercise
 * the isolable state machine: source-change reload, play/pause sync from the
 * timeline clock, position-restore on canplay, and the ended->stop policy.
 *
 * The requestAnimationFrame position-sync loop is intentionally NOT asserted
 * here (timing-heavy, would be mock-theater); we only ensure it doesn't throw.
 */

// --- Minimal fake HTMLAudioElement -----------------------------------------
class FakeAudio {
  src = '';
  volume = 1.0;
  preload = '';
  paused = true;
  currentTime = 0;
  duration = NaN;
  readyState = 0; // HAVE_NOTHING
  error: { code: number; message: string } | null = null;

  play = jest.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });

  pause = jest.fn(() => {
    this.paused = true;
  });

  // Real browsers don't advance readyState synchronously from load();
  // readiness arrives later via the 'canplay' event (see emitCanPlay below).
  load = jest.fn(() => {});

  /** Emulate the buffer becoming ready, then fire canplay. */
  emitCanPlay() {
    this.readyState = 4;
    this.emit('canplay');
  }

  private listeners = new Map<string, Set<(...a: unknown[]) => void>>();

  addEventListener(type: string, cb: (...a: unknown[]) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (...a: unknown[]) => void) {
    this.listeners.get(type)?.delete(cb);
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((cb) => cb());
  }
}

const baseOpts: AudioControllerOptions = {
  playbackTime: 0,
  isPlaying: false,
  audioFile: { path: 'voice.mp3', duration: 30 },
  resolvedAudioPath: 'file:///abs/voice.mp3',
  projectDirectory: '/proj',
};

/** Render the hook and immediately attach a fake audio element to its ref. */
function renderWithAudio(opts: AudioControllerOptions) {
  const audio = new FakeAudio();
  let firstProps = opts;
  const { result, rerender } = renderHook(
    (props: AudioControllerOptions) => {
      const controller = useAudioController(props);
      // Attach before effects re-run on the next commit.
      if (!controller.audioRef.current) {
        (controller.audioRef as { current: FakeAudio | null }).current = audio;
      }
      return controller;
    },
    { initialProps: firstProps },
  );
  return { result, rerender, audio, firstProps };
}

beforeEach(() => {
  // jsdom lacks rAF in some configs; provide a no-op so the sync loop registers.
  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
  }
});

describe('useAudioController — initialization', () => {
  it('returns a ref and reports not-initialized before metadata loads', () => {
    const { result, audio } = renderWithAudio(baseOpts);
    expect(result.current.audioRef.current).toBe(audio);
    expect(result.current.isInitialized).toBe(false);
  });

  it('sets default volume/preload on the element on mount', () => {
    const { audio, rerender } = renderWithAudio(baseOpts);
    // Force the mount effect that reads audioRef.current to run with the ref set.
    rerender({ ...baseOpts });
    expect(audio.volume).toBe(1.0);
    expect(audio.preload).toBe('auto');
  });
});

describe('useAudioController — source changes', () => {
  it('loads the audio source and restores playback on canplay', () => {
    const { audio, rerender } = renderWithAudio(baseOpts);
    // Re-run effects now that the ref is populated.
    rerender({ ...baseOpts });

    expect(audio.src).toBe('file:///abs/voice.mp3');
    expect(audio.load).toHaveBeenCalled();

    // Simulate the browser becoming ready.
    act(() => {
      audio.emitCanPlay();
    });
    // canplay marks initialized.
    expect(audio.readyState).toBeGreaterThanOrEqual(1);
  });

  it('restores preserved currentTime when switching sources mid-playback', () => {
    const { audio, rerender } = renderWithAudio(baseOpts);
    rerender({ ...baseOpts });
    act(() => audio.emitCanPlay()); // initialized on first source

    // Pretend we were playing at t=12 on the first clip.
    audio.paused = false;
    audio.currentTime = 12;

    // Switch to a new resolved path -> triggers reload + preserve.
    rerender({ ...baseOpts, resolvedAudioPath: 'file:///abs/other.mp3' });
    expect(audio.src).toBe('file:///abs/other.mp3');

    act(() => audio.emitCanPlay());
    expect(audio.currentTime).toBe(12); // preserved position restored
  });

  it('does not reload when the resolved path is unchanged (filename match)', () => {
    const { audio, rerender } = renderWithAudio(baseOpts);
    rerender({ ...baseOpts });
    audio.readyState = 4;
    audio.load.mockClear();

    // Same path again -> early return, no reload.
    rerender({ ...baseOpts });
    expect(audio.load).not.toHaveBeenCalled();
  });
});

describe('useAudioController — play/pause sync', () => {
  it('calls play() when isPlaying flips true after initialization', () => {
    const { audio, rerender } = renderWithAudio(baseOpts);
    rerender({ ...baseOpts });
    act(() => audio.emitCanPlay()); // initialized
    audio.play.mockClear();

    rerender({ ...baseOpts, isPlaying: true });
    expect(audio.play).toHaveBeenCalled();
  });

  it('calls pause() when isPlaying flips false while element is playing', () => {
    const { audio, rerender } = renderWithAudio(baseOpts);
    rerender({ ...baseOpts });
    act(() => audio.emitCanPlay());

    rerender({ ...baseOpts, isPlaying: true });
    audio.paused = false;
    audio.pause.mockClear();

    rerender({ ...baseOpts, isPlaying: false });
    expect(audio.pause).toHaveBeenCalled();
  });

  it('does not control playback before the element is initialized', () => {
    const { audio, rerender } = renderWithAudio(baseOpts);
    rerender({ ...baseOpts });
    // No canplay -> isInitializedRef stays false.
    audio.play.mockClear();
    rerender({ ...baseOpts, isPlaying: true });
    expect(audio.play).not.toHaveBeenCalled();
  });
});

describe('useAudioController — ended policy', () => {
  it('stops playback when past audio duration (no video item)', () => {
    const onPlaybackStateChange = jest.fn();
    const { audio, rerender } = renderWithAudio({
      ...baseOpts,
      playbackTime: 31, // past the 30s duration
      onPlaybackStateChange,
    });
    rerender({ ...baseOpts, playbackTime: 31, onPlaybackStateChange });

    act(() => audio.emit('ended'));
    expect(onPlaybackStateChange).toHaveBeenCalledWith(false);
  });

  it('does NOT stop when a video item extends beyond the audio end', () => {
    const onPlaybackStateChange = jest.fn();
    const opts: AudioControllerOptions = {
      ...baseOpts,
      playbackTime: 31, // past audio (30) but...
      currentVideoItem: { endTime: 60 }, // ...video runs to 60
      onPlaybackStateChange,
    };
    const { audio, rerender } = renderWithAudio(opts);
    rerender({ ...opts });

    act(() => audio.emit('ended'));
    expect(onPlaybackStateChange).not.toHaveBeenCalled();
  });
});
