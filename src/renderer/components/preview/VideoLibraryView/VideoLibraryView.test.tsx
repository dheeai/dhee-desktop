import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { TimelineItem } from '../../../hooks/useTimelineData';
import VideoLibraryView from './VideoLibraryView';

let mockTimelineItems: TimelineItem[] = [];
let mockTotalDuration = 3;
let mockAudioRef: { current: HTMLAudioElement | null };
const mockAssetManifest = { schema_version: '1' as const, assets: [] };

jest.mock('../../../utils/pathResolver', () => ({
  resolveAssetPathForDisplay: async (assetPath: string) =>
    `file:///tmp/dhee-test-project/${assetPath}`,
  resolveAssetPathWithRetry: async (assetPath: string) =>
    `file:///tmp/dhee-test-project/${assetPath}`,
}));

jest.mock('../../../utils/debugLogger', () => ({
  debugRendererDebug: jest.fn(),
  debugRendererLog: jest.fn(),
  debugRendererWarn: jest.fn(),
}));

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    projectDirectory: '/tmp/dhee-test-project',
  }),
}));

jest.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({
    isLoading: false,
    assetManifest: mockAssetManifest,
    agentState: null,
  }),
}));

jest.mock('../../../contexts/TimelineDataContext', () => ({
  useTimelineDataContext: () => ({
    timelineItems: mockTimelineItems,
    overlayItems: [],
    textOverlayCues: [],
    totalDuration: mockTotalDuration,
    timelineSource: 'server_timeline',
    error: null,
    isTimelineLoading: false,
  }),
}));

jest.mock('../../../hooks/useAudioController', () => ({
  useAudioController: () => ({
    audioRef: mockAudioRef,
  }),
}));

const videoTimelineItem: TimelineItem = {
  id: 'segment-1-video',
  type: 'video',
  sourceType: 'server_timeline',
  segmentId: 'segment-1',
  placementNumber: 1,
  startTime: 0,
  endTime: 3,
  duration: 3,
  sourceStartTime: 0,
  sourceEndTime: 3,
  label: 'Opening clip',
  videoPath: 'assets/videos/opening-clip.mp4',
};

function renderVideoLibrary({
  playbackTime = 0,
  isPlaying = false,
  onPlaybackTimeChange = jest.fn(),
  onPlaybackStateChange = jest.fn(),
}: {
  playbackTime?: number;
  isPlaying?: boolean;
  onPlaybackTimeChange?: (time: number) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
} = {}) {
  return render(
    <VideoLibraryView
      playbackTime={playbackTime}
      isPlaying={isPlaying}
      onPlaybackTimeChange={onPlaybackTimeChange}
      onPlaybackStateChange={onPlaybackStateChange}
    />,
  );
}

beforeEach(() => {
  mockTimelineItems = [videoTimelineItem];
  mockTotalDuration = 3;
  mockAudioRef = { current: null };
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(jest.fn());
  Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn(function play(this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'));
      return { catch: jest.fn() } as unknown as Promise<void>;
    }),
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: jest.fn(function pause(this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'));
    }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('VideoLibraryView playback state', () => {
  it('does not treat internal video pause during source changes as a shared pause', async () => {
    const onPlaybackStateChange = jest.fn();

    renderVideoLibrary({
      isPlaying: true,
      onPlaybackStateChange,
    });

    await waitFor(() => {
      expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    });

    expect(onPlaybackStateChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps the explicit play/pause button as the shared playback toggle', async () => {
    const onPlaybackStateChange = jest.fn();
    const { rerender } = renderVideoLibrary({
      isPlaying: false,
      onPlaybackStateChange,
    });

    await waitFor(() => {
      expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalled();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Play timeline preview' }),
    );
    expect(onPlaybackStateChange).toHaveBeenLastCalledWith(true);

    rerender(
      <VideoLibraryView
        playbackTime={0}
        isPlaying
        onPlaybackTimeChange={jest.fn()}
        onPlaybackStateChange={onPlaybackStateChange}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Pause timeline preview' }),
      ).not.toBeNull();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Pause timeline preview' }),
    );
    expect(onPlaybackStateChange).toHaveBeenLastCalledWith(false);
  });

  it('still pauses shared playback at the end of the timeline', async () => {
    const onPlaybackStateChange = jest.fn();

    renderVideoLibrary({
      playbackTime: 3,
      isPlaying: true,
      onPlaybackStateChange,
    });

    await waitFor(() => {
      expect(onPlaybackStateChange).toHaveBeenCalledWith(false);
    });
  });
});
