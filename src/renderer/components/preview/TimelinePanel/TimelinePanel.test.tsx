import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ComponentProps } from 'react';
import type { TimelineItem } from '../../../hooks/useTimelineData';
import TimelinePanel from './TimelinePanel';

const mockUpdateImageTimingOverrides = jest.fn();
const mockUpdateSegmentTimingOverrides = jest.fn();
const mockUpdateInfographicTimingOverrides = jest.fn();
const mockUpdateVideoSplitOverrides = jest.fn();
const mockUpdateMarkers = jest.fn();
const mockUpdateImportedClips = jest.fn();
const mockUpdatePlayhead = jest.fn();
const mockUpdateZoom = jest.fn();
const mockSetActiveVersion = jest.fn();
const mockSaveTimelineState = jest.fn();
const mockAddAsset = jest.fn();
const mockRemoveAsset = jest.fn();
const mockRefreshAssetManifest = jest.fn();
const mockTimelineState = {
  schema_version: '1',
  playhead_seconds: 0,
  zoom_level: 1,
  active_versions: {},
  markers: [],
  imported_clips: [],
  image_timing_overrides: {},
  infographic_timing_overrides: {},
  video_split_overrides: {},
  segment_timing_overrides: {},
};

let mockTimelineItems: TimelineItem[] = [];

jest.mock('../../../utils/pathResolver', () => ({
  resolveAssetPathForDisplay: async (assetPath: string) =>
    `file:///tmp/dhee-test-project/${assetPath}`,
  resolveAssetPathWithRetry: async (assetPath: string) =>
    `file:///tmp/dhee-test-project/${assetPath}`,
  toFileUrl: (path: string) => `file://${path}`,
}));

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    projectDirectory: '/tmp/dhee-test-project',
  }),
}));

jest.mock('../../../contexts/AgentContext', () => ({
  useAgent: () => null,
}));

jest.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({
    isLoaded: true,
    isLoading: false,
    scenes: [],
    timelineState: mockTimelineState,
    saveTimelineState: mockSaveTimelineState,
    updatePlayhead: mockUpdatePlayhead,
    updateZoom: mockUpdateZoom,
    setActiveVersion: mockSetActiveVersion,
    updateMarkers: mockUpdateMarkers,
    updateImportedClips: mockUpdateImportedClips,
    updateImageTimingOverrides: mockUpdateImageTimingOverrides,
    updateInfographicTimingOverrides: mockUpdateInfographicTimingOverrides,
    updateVideoSplitOverrides: mockUpdateVideoSplitOverrides,
    updateSegmentTimingOverrides: mockUpdateSegmentTimingOverrides,
    addAsset: mockAddAsset,
    removeAsset: mockRemoveAsset,
    refreshAssetManifest: mockRefreshAssetManifest,
  }),
}));

const mockRefreshTimeline = jest.fn();
const mockRefreshAudioFiles = jest.fn();

jest.mock('../../../contexts/TimelineDataContext', () => ({
  useTimelineDataContext: () => ({
    timelineItems: mockTimelineItems,
    overlayItems: [],
    textOverlayItems: [],
    textOverlayCues: [],
    totalDuration: 10,
    refreshTimeline: mockRefreshTimeline,
    refreshAudioFiles: mockRefreshAudioFiles,
    timelineSource: 'server_timeline',
    error: null,
    isTimelineLoading: false,
    isAudioLoading: false,
    validationIssues: [],
    normalizationSummary: { repairedCount: 0, droppedCount: 0 },
    isNormalizedFromCorruption: false,
  }),
}));

const imageTimelineItem: TimelineItem = {
  id: 'segment-1-image',
  type: 'image',
  sourceType: 'server_timeline',
  segmentId: 'segment-1',
  placementNumber: 1,
  startTime: 0,
  endTime: 4,
  duration: 4,
  sourceStartTime: 0,
  sourceEndTime: 4,
  label: 'Opening frame',
  prompt: 'Keep still',
  imagePath: 'assets/images/opening-frame.png',
};

const videoTimelineItem: TimelineItem = {
  id: 'segment-2-video',
  type: 'video',
  sourceType: 'server_timeline',
  segmentId: 'segment-2',
  placementNumber: 2,
  startTime: 4,
  endTime: 8,
  duration: 4,
  sourceStartTime: 4,
  sourceEndTime: 8,
  label: 'Opening clip',
  videoPath: 'assets/videos/opening-clip.mp4',
};

function renderTimelinePanel({
  onSeek,
}: Pick<Partial<ComponentProps<typeof TimelinePanel>>, 'onSeek'> = {}) {
  return render(
    <TimelinePanel
      isOpen
      onToggle={jest.fn()}
      onResize={jest.fn()}
      onSeek={onSeek}
    />,
  );
}

beforeEach(() => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: jest.fn(),
  });
  jest.clearAllMocks();
});

describe('TimelinePanel image timeline items', () => {
  beforeEach(() => {
    mockTimelineItems = [imageTimelineItem];
  });

  it('renders image items without the timeline resize handle', async () => {
    const { container } = renderTimelinePanel();

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Opening frame/).querySelector('img'),
      ).not.toBeNull();
    });
    expect(container.querySelector('.imageResizeHandle')).toBeNull();
  });

  it('does not write image or segment timing overrides when an image item is dragged', async () => {
    renderTimelinePanel();

    const imageBlock = await waitFor(() => {
      const block = screen.getByLabelText(/Opening frame/);
      expect(block.querySelector('img')).not.toBeNull();
      return block;
    });
    fireEvent.mouseDown(imageBlock, { button: 0, clientX: 20 });
    fireEvent.mouseMove(document, { clientX: 220 });
    fireEvent.mouseUp(document, { clientX: 220 });

    expect(mockUpdateImageTimingOverrides).not.toHaveBeenCalled();
    expect(mockUpdateSegmentTimingOverrides).not.toHaveBeenCalled();
  });

  it('keeps click seeking and context menu behavior for image items', async () => {
    const onSeek = jest.fn();
    renderTimelinePanel({ onSeek });

    const imageBlock = await waitFor(() => {
      const block = screen.getByLabelText(/Opening frame/);
      expect(block.querySelector('img')).not.toBeNull();
      return block;
    });
    fireEvent.click(imageBlock);
    expect(onSeek).toHaveBeenCalledWith(0);

    fireEvent.contextMenu(imageBlock, { clientX: 40, clientY: 60 });
    expect(
      screen.getByRole('menu', { name: 'Timeline context menu' }),
    ).not.toBeNull();
  });
});

describe('TimelinePanel video timeline items', () => {
  beforeEach(() => {
    mockTimelineItems = [videoTimelineItem];
  });

  it('renders video items without the timeline resize handle', async () => {
    const { container } = renderTimelinePanel();

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Opening clip/).querySelector('video'),
      ).not.toBeNull();
    });
    expect(container.querySelector('.imageResizeHandle')).toBeNull();
  });

  it('does not write segment timing overrides when a video item is dragged', async () => {
    renderTimelinePanel();

    const videoBlock = await waitFor(() => {
      const block = screen.getByLabelText(/Opening clip/);
      expect(block.querySelector('video')).not.toBeNull();
      return block;
    });
    fireEvent.mouseDown(videoBlock, { button: 0, clientX: 20 });
    fireEvent.mouseMove(document, { clientX: 220 });
    fireEvent.mouseUp(document, { clientX: 220 });

    expect(mockUpdateSegmentTimingOverrides).not.toHaveBeenCalled();
  });

  it('keeps click seeking and context menu behavior for video items', async () => {
    const onSeek = jest.fn();
    renderTimelinePanel({ onSeek });

    const videoBlock = await waitFor(() => {
      const block = screen.getByLabelText(/Opening clip/);
      expect(block.querySelector('video')).not.toBeNull();
      return block;
    });
    fireEvent.click(videoBlock);
    expect(onSeek).toHaveBeenCalledWith(4);

    fireEvent.contextMenu(videoBlock, { clientX: 40, clientY: 60 });
    expect(
      screen.getByRole('menu', { name: 'Timeline context menu' }),
    ).not.toBeNull();
  });
});
