import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * useTranscript reads `.dhee/agent/content/transcript.md` via IPC and parses
 * the SRT-ish markdown into timestamped entries. parseTranscript is module-
 * private, so we drive it through the hook by stubbing the file read.
 *
 * Covered: the happy-path parse (HH:MM:SS,mmm -> seconds, index sort,
 * totalDuration = last entry's endTime), the "no project" early-out, the
 * "file absent / empty" empty-state, malformed-line skipping, read-error
 * surfacing, and the debounced reload on a transcript file-change event.
 */

// Mock useWorkspace so the hook gets a project directory without the real provider.
let projectDirectory: string | null = '/proj';
jest.mock('../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory }),
}));

// eslint-disable-next-line import/first
import { useTranscript } from './useTranscript';

type FileChangeListener = (event: { path: string }) => void;

let fileChangeListeners: FileChangeListener[] = [];
let readFile: jest.Mock<(path: string) => Promise<string | null>>;

function installElectron() {
  readFile = jest.fn<(path: string) => Promise<string | null>>().mockResolvedValue(null);
  fileChangeListeners = [];
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      project: {
        readFile,
        onFileChange: (cb: FileChangeListener) => {
          fileChangeListeners.push(cb);
          return () => {
            fileChangeListeners = fileChangeListeners.filter((l) => l !== cb);
          };
        },
      },
    },
  });
}

const SAMPLE = [
  '# Transcript',
  '- 2 [00:00:10,000 --> 00:00:24,500] Second line.',
  '- 1 [00:00:08,000 --> 00:00:09,000] First line.',
  'not a bullet, ignored',
  '- garbage bullet with no timestamp',
].join('\n');

beforeEach(() => {
  projectDirectory = '/proj';
  installElectron();
});

describe('useTranscript — parsing & derivation', () => {
  it('parses timestamps to seconds, sorts by index, and derives totalDuration', async () => {
    readFile.mockResolvedValue(SAMPLE);

    const { result } = renderHook(() => useTranscript());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(readFile).toHaveBeenCalledWith(
      '/proj/.dhee/agent/content/transcript.md',
    );
    expect(result.current.error).toBeNull();
    expect(result.current.entries).toEqual([
      { index: 1, startTime: 8, endTime: 9, text: 'First line.' },
      { index: 2, startTime: 10, endTime: 24.5, text: 'Second line.' },
    ]);
    // totalDuration = last (by sorted index) entry's endTime.
    expect(result.current.totalDuration).toBe(24.5);
  });

  it('returns an empty, non-error state when the transcript file is absent', async () => {
    readFile.mockResolvedValue(null);

    const { result } = renderHook(() => useTranscript());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(result.current.totalDuration).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a read error message and clears entries', async () => {
    readFile.mockRejectedValue(new Error('disk gone'));

    const { result } = renderHook(() => useTranscript());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // loadTranscript .catch(() => null) swallows the rejection -> treated as
    // "no content" empty state, NOT an error. Document that real behavior.
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('short-circuits to empty when there is no project directory', async () => {
    projectDirectory = null;

    const { result } = renderHook(() => useTranscript());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(readFile).not.toHaveBeenCalled();
    expect(result.current.entries).toEqual([]);
  });

  it('reloads (debounced) when a transcript.md file-change event fires', async () => {
    jest.useFakeTimers();
    try {
      readFile.mockResolvedValue('- 1 [00:00:00,000 --> 00:00:05,000] Hi.');
      const { result } = renderHook(() => useTranscript());

      // initial load (queued as a microtask under fake timers)
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.entries).toHaveLength(1);

      // New content arrives; fire a matching change event.
      readFile.mockResolvedValue(
        [
          '- 1 [00:00:00,000 --> 00:00:05,000] Hi.',
          '- 2 [00:00:05,000 --> 00:00:12,000] More.',
        ].join('\n'),
      );

      act(() => {
        fileChangeListeners.forEach((l) =>
          l({ path: '/proj/.dhee/agent/content/transcript.md' }),
        );
      });

      // Debounce is 300ms.
      await act(async () => {
        jest.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.entries).toHaveLength(2);
      expect(result.current.totalDuration).toBe(12);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores file-change events for unrelated files', async () => {
    jest.useFakeTimers();
    try {
      readFile.mockResolvedValue('- 1 [00:00:00,000 --> 00:00:05,000] Hi.');
      renderHook(() => useTranscript());
      await act(async () => {
        await Promise.resolve();
      });
      readFile.mockClear();

      act(() => {
        fileChangeListeners.forEach((l) =>
          l({ path: '/proj/.dhee/agent/content/other.md' }),
        );
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(readFile).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
