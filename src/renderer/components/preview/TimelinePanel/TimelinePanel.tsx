import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  Upload,
  Scissors,
  Music,
} from 'lucide-react';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useProject } from '../../../contexts/ProjectContext';
import { useAgent } from '../../../contexts/AgentContext';
import { type TimelineItem } from '../../../hooks/useTimelineData';
import { useTimelineDataContext } from '../../../contexts/TimelineDataContext';
import {
  resolveAssetPathForDisplay,
  resolveAssetPathWithRetry,
  toFileUrl,
} from '../../../utils/pathResolver';
import { imageToBase64, shouldUseBase64 } from '../../../utils/imageToBase64';
import {
  clampImageMove,
  buildUpdatedInfographicOverride,
  buildUpdatedVideoSplitOverride,
  snapToSecond,
} from '../../../utils/timelineImageEditing';
import { getThumbnailPreviewTime } from '../../../utils/videoPreview';
import type { TimelineMarker } from '../../../types/projectState';
import type {
  dheeTimelineMarker,
  dheeTimelineState,
  ImportedClip,
} from '../../../types/dhee';
import type { SceneVersions } from '../../../types/dhee/timeline';
import { PROJECT_PATHS, createAssetInfo } from '../../../types/dhee';
import {
  TrackAudioIcon,
  TrackOverlayIcon,
  TrackTextIcon,
  TrackVisualIcon,
} from '../EditorIcons';
import TimelineMarkerComponent from '../TimelineMarker/TimelineMarker';
import MarkerPromptPopover from '../TimelineMarker/MarkerPromptPopover';
import VersionSelector from '../VersionSelector';
import AudioImportModal from './AudioImportModal';
import ShotRegenerateModal from './ShotRegenerateModal';
import TimelineContextMenu from './TimelineContextMenu';
import { importAudioFromFileToProject } from './importAudio';
import {
  buildShotRegenerateMessage,
  isServerTimelineShotItem,
} from './timelineShotRegenerate';
import { getAudioBlockWidthPx } from './timelineAudioSizing';
import styles from './TimelinePanel.module.scss';

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? 'Cmd' : 'Ctrl';
const AUDIO_WAVEFORM_HEIGHT = 28;
const BASE_PIXELS_PER_SECOND = 50;
const MAJOR_MARKER_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function buildImportedAudioAssetId(fileName: string): string {
  const slug = fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `imported-audio-${slug || 'track'}-${Date.now()}`;
}

function getMajorMarkerStepSeconds(zoomLevel: number): number {
  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoomLevel;
  const targetSpacingPx = 95;

  for (const step of MAJOR_MARKER_STEPS_SECONDS) {
    if (step * pixelsPerSecond >= targetSpacingPx) {
      return step;
    }
  }

  return MAJOR_MARKER_STEPS_SECONDS[MAJOR_MARKER_STEPS_SECONDS.length - 1];
}

function downsampleWaveformPeaks(
  peaks: number[],
  targetSamples: number,
): number[] {
  if (peaks.length <= targetSamples) {
    return peaks;
  }

  const downsampled: number[] = [];
  for (let index = 0; index < targetSamples; index += 1) {
    const startIndex = Math.floor((index * peaks.length) / targetSamples);
    const endIndex = Math.max(
      startIndex + 1,
      Math.floor(((index + 1) * peaks.length) / targetSamples),
    );

    let bucketPeak = 0;
    for (
      let sampleIndex = startIndex;
      sampleIndex < endIndex;
      sampleIndex += 1
    ) {
      bucketPeak = Math.max(bucketPeak, peaks[sampleIndex] ?? 0);
    }

    downsampled.push(bucketPeak);
  }

  return downsampled;
}

function AudioWaveform({ peaks, width }: { peaks?: number[]; width: number }) {
  const waveformBars = useMemo(() => {
    if (!peaks?.length) {
      return [];
    }

    const svgWidth = Math.max(1, Math.round(width));
    const barWidth = 2;
    const barGap = 1;
    const centerY = AUDIO_WAVEFORM_HEIGHT / 2;
    const usableHeight = AUDIO_WAVEFORM_HEIGHT * 0.42;
    const maxColumns = Math.max(10, Math.floor(svgWidth / (barWidth + barGap)));
    const columns = downsampleWaveformPeaks(
      peaks,
      Math.max(1, Math.min(peaks.length, maxColumns)),
    );
    const totalBarsWidth =
      columns.length * barWidth + Math.max(0, columns.length - 1) * barGap;
    const startX = (svgWidth - totalBarsWidth) / 2;

    return columns.map((peak, index) => {
      const amplitude = Math.max(0.08, Math.min(1, peak));
      const barHeight = Math.max(2, amplitude * usableHeight * 2);
      const x = startX + index * (barWidth + barGap);
      const y = centerY - barHeight / 2;
      const dotRadius = 1.4;
      const dotY = Math.max(dotRadius + 0.5, y - dotRadius - 0.8);

      return {
        x,
        y,
        barHeight,
        dotRadius,
        dotY,
        showPeakDot: amplitude > 0.72,
      };
    });
  }, [peaks, width]);

  if (!waveformBars.length) {
    return <div className={styles.audioWaveformPlaceholder} />;
  }

  return (
    <svg
      className={styles.audioWaveformSvg}
      viewBox={`0 0 ${Math.max(1, Math.round(width))} ${AUDIO_WAVEFORM_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {waveformBars.map(
        ({ x, y, barHeight, dotRadius, dotY, showPeakDot }, index) => (
          <g key={`waveform-bar-${index}`}>
            <rect
              className={styles.audioWaveformBar}
              x={x}
              y={y}
              width={2}
              height={barHeight}
              rx={0.75}
            />
            {showPeakDot ? (
              <circle
                className={styles.audioWaveformPeakDot}
                cx={x + 1}
                cy={dotY}
                r={dotRadius}
              />
            ) : null}
          </g>
        ),
      )}
    </svg>
  );
}

// Timeline Item Component for proper hook usage
interface TimelineItemComponentProps {
  item: TimelineItem;
  left: number;
  width: number;
  projectDirectory: string | null;
  isSelected: boolean;
  onItemClick?: (
    e: React.MouseEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => void;
  onInfographicDragMouseDown?: (
    e: React.MouseEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => void;
  onItemContextMenu?: (
    e: React.MouseEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => void;
  isEditing?: boolean;
}

function TimelineItemComponent({
  item,
  left,
  width,
  projectDirectory,
  isSelected,
  onItemClick,
  onInfographicDragMouseDown,
  onItemContextMenu,
  isEditing = false,
}: TimelineItemComponentProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [hasVideoPreviewFrame, setHasVideoPreviewFrame] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState<boolean>(false);
  const imageRetryCountRef = React.useRef<number>(0);
  const imageResolveAbortRef = React.useRef<AbortController | null>(null);
  const footerLabel = item.sceneLabel || item.label;
  const clipBadgeLabel = item.sceneLabel ? item.label : null;
  const accessibleLabel = item.prompt
    ? `${footerLabel}. ${item.prompt}`
    : footerLabel;

  // Resolve video path from item (video and infographic both use videoPath for mp4)
  useEffect(() => {
    if (
      (item.type === 'video' || item.type === 'infographic') &&
      item.videoPath
    ) {
      setHasVideoPreviewFrame(false);
      resolveAssetPathForDisplay(item.videoPath, projectDirectory).then(
        (resolved) => {
          setVideoPath(resolved);
        },
      );
    } else {
      setVideoPath(null);
      setHasVideoPreviewFrame(false);
    }
  }, [item.type, item.videoPath, projectDirectory]);

  useEffect(() => {
    const video = videoRef.current;
    if (!videoPath || !video) {
      return undefined;
    }

    setHasVideoPreviewFrame(false);

    const primePreviewFrame = () => {
      const previewTime = getThumbnailPreviewTime(video.duration);
      if (!Number.isFinite(previewTime) || previewTime <= 0) {
        setHasVideoPreviewFrame(true);
        return;
      }

      if (Math.abs((video.currentTime || 0) - previewTime) < 0.04) {
        setHasVideoPreviewFrame(true);
        return;
      }

      try {
        video.currentTime = previewTime;
      } catch {
        setHasVideoPreviewFrame(true);
      }
    };

    const handleLoadedMetadata = () => {
      primePreviewFrame();
    };
    const handleLoadedData = () => {
      setHasVideoPreviewFrame(true);
    };
    const handleSeeked = () => {
      setHasVideoPreviewFrame(true);
      video.pause();
    };
    const handleError = () => {
      setHasVideoPreviewFrame(false);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);
    video.load();

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
  }, [videoPath]);

  // Resolve image path from timeline item only (projection-backed in v2).
  useEffect(() => {
    if (item.type !== 'image') {
      setImagePath(null);
      setImageLoading(false);
      imageRetryCountRef.current = 0;
      return;
    }

    // Abort previous resolution if still pending
    if (imageResolveAbortRef.current) {
      imageResolveAbortRef.current.abort();
    }
    imageResolveAbortRef.current = new AbortController();
    const abortController = imageResolveAbortRef.current;

    setImageLoading(true);

    const pathToResolve = item.imagePath;

    if (pathToResolve) {
      console.log(
        `[TimelineItemComponent] Resolving image path for ${item.label}:`,
        {
          itemImagePath: item.imagePath,
          resolvedPath: pathToResolve,
          projectDirectory,
          placementNumber: item.placementNumber,
        },
      );

      // Use retry logic for path resolution
      resolveAssetPathWithRetry(pathToResolve, projectDirectory, {
        maxRetries: 3,
        retryDelayBase: 500,
        timeout: 5000,
        verifyExists: true,
      })
        .then(async (resolved) => {
          if (abortController.signal.aborted) return;

          console.log(
            `[TimelineItemComponent] Resolved path for ${item.label}:`,
            resolved,
          );
          setImageLoading(false);
          imageRetryCountRef.current = 0;

          // For test images, try to convert to base64
          if (shouldUseBase64(resolved)) {
            try {
              const base64 = await imageToBase64(resolved);
              if (base64 && !abortController.signal.aborted) {
                console.log(
                  `[TimelineItemComponent] Using base64 for ${item.label}`,
                );
                setImagePath(base64);
                return;
              }
            } catch (error) {
              console.warn(
                `[TimelineItemComponent] Failed to convert to base64:`,
                error,
              );
            }
          }
          // Fallback to file:// path
          if (!abortController.signal.aborted) {
            setImagePath(resolved);
          }
        })
        .catch((error) => {
          if (abortController.signal.aborted) return;

          console.error(
            `[TimelineItemComponent] Failed to resolve image path for ${item.label}:`,
            error,
          );
          setImageLoading(false);

          // No retry loop; show placeholder on failure
          setImagePath(null);
        });
    } else {
      if (item.type === 'image') {
        console.warn(
          `[TimelineItemComponent] No imagePath for ${item.label}:`,
          {
            itemImagePath: item.imagePath,
            placementNumber: item.placementNumber,
          },
        );
      }
      setImageLoading(false);
      setImagePath(null);
    }

    // Cleanup function
    return () => {
      if (imageResolveAbortRef.current) {
        imageResolveAbortRef.current.abort();
        imageResolveAbortRef.current = null;
      }
    };
  }, [
    item.type,
    item.imagePath,
    item.label,
    item.placementNumber,
    projectDirectory,
  ]);

  // Handle placeholder type
  if (item.type === 'placeholder') {
    return (
      <div
        className={`${styles.sceneBlock} ${styles.placeholderBlock} ${isSelected ? styles.selected : ''}`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
        }}
        onClick={(e) => {
          if (onItemClick) {
            onItemClick(e, item);
          }
        }}
        onContextMenu={(e) => {
          if (onItemContextMenu) {
            onItemContextMenu(e, item);
          }
        }}
        aria-label={accessibleLabel}
      >
        <div className={styles.scenePlaceholder} />
        {clipBadgeLabel && (
          <div className={styles.clipBadge}>{clipBadgeLabel}</div>
        )}
        <div className={styles.sceneId}>{footerLabel}</div>
      </div>
    );
  }

  // Handle audio type
  if (item.type === 'audio' && item.audioPath) {
    return (
      <div
        className={`${styles.audioBlock} ${isSelected ? styles.selected : ''}`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
        }}
        onClick={(e) => {
          if (onItemClick) {
            onItemClick(e, item);
          }
        }}
        onContextMenu={(e) => {
          if (onItemContextMenu) {
            onItemContextMenu(e, item);
          }
        }}
        aria-label={accessibleLabel}
      >
        <div className={styles.audioMetaRow}>
          <span className={styles.audioClipIcon}>
            <Music size={12} />
          </span>
          <div className={styles.audioLabel}>{footerLabel}</div>
        </div>
        <div className={styles.audioWaveform}>
          <AudioWaveform peaks={item.waveformPeaks} width={width} />
        </div>
      </div>
    );
  }

  // Handle video type
  if (item.type === 'video' && videoPath) {
    return (
      <div
        className={`${styles.videoBlock} ${isSelected ? styles.selected : ''}`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
        }}
        onClick={(e) => {
          if (onItemClick) {
            onItemClick(e, item);
          }
        }}
        onContextMenu={(e) => {
          if (onItemContextMenu) {
            onItemContextMenu(e, item);
          }
        }}
        aria-label={accessibleLabel}
      >
        {!hasVideoPreviewFrame && (
          <div className={styles.scenePlaceholder}>Video</div>
        )}
        <video
          ref={videoRef}
          src={videoPath}
          className={styles.videoThumbnail}
          preload="metadata"
          muted
          playsInline
          style={{ visibility: hasVideoPreviewFrame ? 'visible' : 'hidden' }}
        />
        {clipBadgeLabel && (
          <div className={styles.clipBadge}>{clipBadgeLabel}</div>
        )}
        <div className={styles.videoLabel}>{footerLabel}</div>
      </div>
    );
  }

  // Handle infographic type (mp4 from Remotion, same as video block)
  if (item.type === 'infographic' && videoPath) {
    return (
      <div
        className={`${styles.videoBlock} ${styles.editableInfographicBlock} ${isSelected ? styles.selected : ''} ${isEditing ? styles.editing : ''}`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
        }}
        onMouseDown={(e) => {
          if (onInfographicDragMouseDown) {
            onInfographicDragMouseDown(e, item);
          }
        }}
        onClick={(e) => {
          if (onItemClick) {
            onItemClick(e, item);
          }
        }}
        onContextMenu={(e) => {
          if (onItemContextMenu) {
            onItemContextMenu(e, item);
          }
        }}
        aria-label={accessibleLabel}
      >
        {!hasVideoPreviewFrame && (
          <div className={styles.scenePlaceholder}>Info</div>
        )}
        <video
          ref={videoRef}
          src={videoPath}
          className={styles.videoThumbnail}
          preload="metadata"
          muted
          playsInline
          style={{ visibility: hasVideoPreviewFrame ? 'visible' : 'hidden' }}
        />
        {clipBadgeLabel && (
          <div className={styles.clipBadge}>{clipBadgeLabel}</div>
        )}
        <div className={styles.videoLabel}>{footerLabel}</div>
      </div>
    );
  }

  if (item.type === 'infographic' && !videoPath) {
    return (
      <div
        className={`${styles.videoBlock} ${styles.editableInfographicBlock} ${isSelected ? styles.selected : ''} ${isEditing ? styles.editing : ''}`}
        style={{ left: `${left}px`, width: `${width}px` }}
        onMouseDown={(e) =>
          onInfographicDragMouseDown && onInfographicDragMouseDown(e, item)
        }
        onClick={(e) => onItemClick && onItemClick(e, item)}
        onContextMenu={(e) => onItemContextMenu && onItemContextMenu(e, item)}
        aria-label={accessibleLabel}
      >
        <div className={styles.scenePlaceholder}>Info</div>
        {clipBadgeLabel && (
          <div className={styles.clipBadge}>{clipBadgeLabel}</div>
        )}
        <div className={styles.videoLabel}>{footerLabel}</div>
      </div>
    );
  }

  if (item.type === 'text_overlay') {
    return (
      <div
        className={`${styles.textOverlayBlock} ${isSelected ? styles.selected : ''}`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
        }}
        onClick={(e) => {
          if (onItemClick) {
            onItemClick(e, item);
          }
        }}
        onContextMenu={(e) => {
          if (onItemContextMenu) {
            onItemContextMenu(e, item);
          }
        }}
        aria-label={accessibleLabel}
      >
        <div className={styles.textOverlayLabel}>{footerLabel}</div>
      </div>
    );
  }

  // Handle image type
  let thumbnailElement: React.ReactNode;
  if (imagePath) {
    thumbnailElement = (
      <img
        src={imagePath}
        alt={item.label}
        className={styles.sceneThumbnail}
        onError={() => {
          console.error(
            `[TimelineItemComponent] Image load error for ${item.label}`,
          );
          setImagePath(null);
          setImageLoading(false);
        }}
      />
    );
  } else if (imageLoading) {
    thumbnailElement = (
      <div className={styles.scenePlaceholder}>
        <div style={{ fontSize: '10px', opacity: 0.5 }}>Loading...</div>
      </div>
    );
  } else {
    thumbnailElement = <div className={styles.scenePlaceholder} />;
  }

  return (
    <div
      className={`${styles.sceneBlock} ${isSelected ? styles.selected : ''}`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
      }}
      onClick={(e) => {
        if (onItemClick) {
          onItemClick(e, item);
        }
      }}
      onContextMenu={(e) => {
        if (onItemContextMenu) {
          onItemContextMenu(e, item);
        }
      }}
      aria-label={accessibleLabel}
    >
      {thumbnailElement}
      {clipBadgeLabel && (
        <div className={styles.clipBadge}>{clipBadgeLabel}</div>
      )}
      <div className={styles.sceneId}>{footerLabel}</div>
      {item.prompt && (
        <div className={styles.sceneDescription} title={item.prompt}>
          {item.prompt.length > 50
            ? `${item.prompt.substring(0, 50)}...`
            : item.prompt}
        </div>
      )}
    </div>
  );
}

// Format time as HH:MM:SS:FF (hours:minutes:seconds:frames)
const formatTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * 30); // Assuming 30 fps
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
};

// Convert seconds to pixels based on zoom level
const secondsToPixels = (seconds: number, zoomLevel: number): number => {
  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoomLevel;
  return seconds * pixelsPerSecond;
};

// Convert pixels to seconds based on zoom level
const pixelsToSeconds = (pixels: number, zoomLevel: number): number => {
  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoomLevel;
  return pixels / pixelsPerSecond;
};

/** Seconds of empty space after last scene so the timeline can be scrolled past content. Playhead stays within content only. */
const TAIL_PADDING_SECONDS = 5;

interface TimelinePanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onResize: (e: React.MouseEvent) => void;
  // eslint-disable-next-line react/require-default-props
  playbackTime?: number;
  // eslint-disable-next-line react/require-default-props
  isPlaying?: boolean;
  // eslint-disable-next-line react/require-default-props
  onSeek?: (time: number) => void;
  // eslint-disable-next-line react/require-default-props
  onPlayPause?: (playing: boolean) => void;
  // eslint-disable-next-line react/require-default-props
  onDragStateChange?: (dragging: boolean) => void;
  // eslint-disable-next-line react/require-default-props
  activeVersions?: Record<number, SceneVersions>;
  // eslint-disable-next-line react/require-default-props
  onActiveVersionsChange?: (versions: Record<number, SceneVersions>) => void;
}

interface TimelineContextMenuState {
  x: number;
  y: number;
  positionSeconds: number;
  item: TimelineItem | null;
}

interface TimelineEditSnapshot {
  markers: TimelineMarker[];
  image_timing_overrides: dheeTimelineState['image_timing_overrides'];
  infographic_timing_overrides: dheeTimelineState['infographic_timing_overrides'];
  video_split_overrides: dheeTimelineState['video_split_overrides'];
  segment_timing_overrides: dheeTimelineState['segment_timing_overrides'];
}

const MemoTimelineItemComponent = React.memo(
  TimelineItemComponent,
  (prev, next) =>
    prev.item === next.item &&
    prev.left === next.left &&
    prev.width === next.width &&
    prev.projectDirectory === next.projectDirectory &&
    prev.isSelected === next.isSelected &&
    prev.isEditing === next.isEditing,
);

const MAX_TIMELINE_UNDO_STEPS = 100;

function cloneMarkers(markers: TimelineMarker[]): TimelineMarker[] {
  return markers.map((marker) => ({ ...marker }));
}

function cloneImageTimingOverrides(
  overrides: dheeTimelineState['image_timing_overrides'],
): dheeTimelineState['image_timing_overrides'] {
  const next: dheeTimelineState['image_timing_overrides'] = {};
  Object.entries(overrides).forEach(([key, value]) => {
    next[key] = {
      start_time_seconds: value.start_time_seconds,
      end_time_seconds: value.end_time_seconds,
    };
  });
  return next;
}

function cloneInfographicTimingOverrides(
  overrides: dheeTimelineState['infographic_timing_overrides'],
): dheeTimelineState['infographic_timing_overrides'] {
  const next: dheeTimelineState['infographic_timing_overrides'] = {};
  Object.entries(overrides).forEach(([key, value]) => {
    next[key] = {
      start_time_seconds: value.start_time_seconds,
      end_time_seconds: value.end_time_seconds,
    };
  });
  return next;
}

function cloneVideoSplitOverrides(
  overrides: dheeTimelineState['video_split_overrides'],
): dheeTimelineState['video_split_overrides'] {
  const next: dheeTimelineState['video_split_overrides'] = {};
  Object.entries(overrides).forEach(([key, value]) => {
    next[key] = {
      split_offsets_seconds: [...value.split_offsets_seconds],
    };
  });
  return next;
}

function cloneSegmentTimingOverrides(
  overrides: dheeTimelineState['segment_timing_overrides'],
): dheeTimelineState['segment_timing_overrides'] {
  const next: dheeTimelineState['segment_timing_overrides'] = {};
  Object.entries(overrides).forEach(([key, value]) => {
    next[key] = {
      start_time_seconds: value.start_time_seconds,
      end_time_seconds: value.end_time_seconds,
    };
  });
  return next;
}

export default function TimelinePanel({
  isOpen,
  onToggle,
  onResize,
  playbackTime: externalPlaybackTime,
  isPlaying: externalIsPlaying,
  onSeek,
  onPlayPause,
  onDragStateChange,
  activeVersions: externalActiveVersions,
  onActiveVersionsChange,
}: TimelinePanelProps) {
  const { projectDirectory } = useWorkspace();
  const agentContext = useAgent();
  const {
    isLoaded,
    isLoading,
    scenes: projectScenes,
    timelineState,
    saveTimelineState,
    updatePlayhead,
    updateZoom,
    setActiveVersion,
    updateMarkers,
    updateImportedClips,
    updateImageTimingOverrides,
    updateInfographicTimingOverrides,
    updateVideoSplitOverrides,
    updateSegmentTimingOverrides,
    addAsset,
    removeAsset,
    refreshAssetManifest,
  } = useProject();

  // Use unified timeline data from context (single source of truth for TimelinePanel + VideoLibraryView)
  const {
    timelineItems,
    overlayItems,
    textOverlayItems,
    totalDuration: timelineTotalDuration,
    refreshAudioFiles,
    timelineSource,
    error: timelineError,
    isTimelineLoading,
    normalizationSummary,
    isNormalizedFromCorruption,
  } = useTimelineDataContext();

  // Initialize zoom level from timeline state
  const [zoomLevel, setZoomLevel] = useState(timelineState.zoom_level);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  // Sync zoom level to timeline state
  useEffect(() => {
    updateZoom(zoomLevel);
  }, [zoomLevel, updateZoom]);

  // Use external playback state if provided, otherwise use internal state
  // Initialize from timeline state if available
  const [internalPlaybackTime, setInternalPlaybackTime] = useState(
    timelineState.playhead_seconds,
  );
  const [internalIsPlaying, setInternalIsPlaying] = useState(false);

  // Calculate total duration from timeline (placement-based)
  const totalDuration = useMemo(() => {
    if (timelineTotalDuration > 0) return timelineTotalDuration;
    if (timelineItems.length === 0) return 10;
    const lastItem = timelineItems[timelineItems.length - 1];
    return Math.max(lastItem.endTime, 10);
  }, [timelineTotalDuration, timelineItems]);

  const audioTimelineItems = useMemo(
    () =>
      timelineItems.filter((item) => item.type === 'audio' && !!item.audioPath),
    [timelineItems],
  );
  const mainTimelineItems = useMemo(
    () => timelineItems.filter((item) => item.type !== 'audio'),
    [timelineItems],
  );

  // Clamp playback position to totalDuration to prevent playhead from going beyond content
  const rawCurrentPosition = externalPlaybackTime ?? internalPlaybackTime;
  const currentPosition = Math.max(
    0,
    Math.min(rawCurrentPosition, totalDuration),
  );
  const isPlaying = externalIsPlaying ?? internalIsPlaying;

  // If position was clamped, update internal state
  useEffect(() => {
    // Only clamp if using internal state and position exceeds duration
    if (
      externalPlaybackTime === undefined &&
      internalPlaybackTime > totalDuration
    ) {
      setInternalPlaybackTime(totalDuration);
    }
  }, [
    internalPlaybackTime,
    totalDuration,
    externalPlaybackTime,
    setInternalPlaybackTime,
  ]);

  // Sync playhead position to timeline state (debounced)
  useEffect(() => {
    if (externalPlaybackTime === undefined) {
      // Only sync if using internal state
      const timeoutId = setTimeout(() => {
        updatePlayhead(currentPosition);
      }, 100); // Debounce 100ms for playhead updates
      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [currentPosition, externalPlaybackTime, updatePlayhead]);

  const setCurrentPosition = useCallback(
    (value: number | ((prev: number) => number)) => {
      const newValue =
        typeof value === 'function' ? value(currentPosition) : value;
      const clamped = Math.max(0, Math.min(totalDuration, newValue));
      if (onSeek) {
        onSeek(clamped);
      } else {
        setInternalPlaybackTime(clamped);
      }
    },
    [onSeek, currentPosition, totalDuration],
  );

  const setIsPlaying = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      if (onPlayPause) {
        const newValue = typeof value === 'function' ? value(isPlaying) : value;
        onPlayPause(newValue);
      } else {
        setInternalIsPlaying(value);
      }
    },
    [onPlayPause, isPlaying],
  );
  // Helper functions to convert between marker formats
  const convertdheeMarkerToLocal = useCallback(
    (marker: dheeTimelineMarker): TimelineMarker => ({
      id: marker.id,
      position: marker.position_seconds,
      prompt: marker.prompt,
      status: marker.status,
      generatedArtifactId: marker.generated_artifact_id,
      createdAt: marker.created_at,
    }),
    [],
  );

  const convertLocalMarkerTodhee = useCallback(
    (marker: TimelineMarker): dheeTimelineMarker => ({
      id: marker.id,
      position_seconds: marker.position,
      prompt: marker.prompt,
      status: marker.status,
      generated_artifact_id: marker.generatedArtifactId,
      created_at: marker.createdAt,
    }),
    [],
  );

  // Load markers and imported clips from timeline state on mount
  const [markers, setMarkers] = useState<TimelineMarker[]>(() => {
    return timelineState.markers.map(convertdheeMarkerToLocal);
  });

  // Sync markers to timeline state when they change
  useEffect(() => {
    const dheeMarkers = markers.map(convertLocalMarkerTodhee);
    updateMarkers(dheeMarkers);
  }, [markers, convertLocalMarkerTodhee, updateMarkers]);

  // Imported videos state - kept for local video import functionality
  const [importedVideos, setImportedVideos] = useState<
    Array<{ path: string; duration: number; startTime: number }>
  >(() => {
    // Initialize from timeline state
    return timelineState.imported_clips.map((clip) => ({
      path: clip.path,
      duration: clip.duration_seconds,
      startTime: clip.start_time_seconds,
    }));
  });

  // Use a ref to track if we're updating from external source to prevent loops
  const isUpdatingFromExternalRef = useRef(false);

  // Load imported clips from timeline state when it changes externally
  // Only update if the data actually changed to prevent infinite loops
  useEffect(() => {
    const importedClips = timelineState.imported_clips.map((clip) => ({
      path: clip.path,
      duration: clip.duration_seconds,
      startTime: clip.start_time_seconds,
    }));

    // Compare with current state to avoid unnecessary updates
    setImportedVideos((current) => {
      const currentVideosStr = JSON.stringify(current);
      const newVideosStr = JSON.stringify(importedClips);

      if (currentVideosStr !== newVideosStr) {
        isUpdatingFromExternalRef.current = true;
        return importedClips;
      }
      return current;
    });
  }, [timelineState.imported_clips]);

  // Sync imported videos to timeline state when they change locally

  useEffect(() => {
    // Skip if this update came from external source
    if (isUpdatingFromExternalRef.current) {
      isUpdatingFromExternalRef.current = false;
      return;
    }

    const dheeClips: ImportedClip[] = importedVideos.map((video, index) => ({
      id: video.path || `imported-${index}`,
      path: video.path,
      duration_seconds: video.duration,
      start_time_seconds: video.startTime,
    }));

    // Compare with current timeline state to avoid unnecessary updates
    const currentClipsStr = JSON.stringify(
      timelineState.imported_clips.map((c) => ({
        path: c.path,
        duration: c.duration_seconds,
        startTime: c.start_time_seconds,
      })),
    );
    const newClipsStr = JSON.stringify(
      dheeClips.map((c) => ({
        path: c.path,
        duration: c.duration_seconds,
        startTime: c.start_time_seconds,
      })),
    );

    if (currentClipsStr !== newClipsStr) {
      updateImportedClips(dheeClips);
    }
  }, [importedVideos, updateImportedClips, timelineState.imported_clips]);

  const [markerPromptOpen, setMarkerPromptOpen] = useState(false);
  const [markerPromptPosition, setMarkerPromptPosition] = useState<
    number | null
  >(null);
  const [isAudioModalOpen, setIsAudioModalOpen] = useState(false);
  const [regenerateShotItem, setRegenerateShotItem] =
    useState<TimelineItem | null>(null);
  const [isSubmittingShotRegenerate, setIsSubmittingShotRegenerate] =
    useState(false);
  const [contextMenuState, setContextMenuState] =
    useState<TimelineContextMenuState | null>(null);
  const [isGeneratingWordCaptions, setIsGeneratingWordCaptions] =
    useState(false);
  const [captionGenerationMessage, setCaptionGenerationMessage] = useState<
    string | null
  >(null);
  const [canUndo, setCanUndo] = useState(false);
  const undoStackRef = useRef<TimelineEditSnapshot[]>([]);

  useEffect(() => {
    if (!captionGenerationMessage) return undefined;
    const timeout = setTimeout(() => {
      setCaptionGenerationMessage(null);
    }, 4000);
    return () => clearTimeout(timeout);
  }, [captionGenerationMessage]);

  // Load active versions from timeline state or use external prop (with migration)
  const [internalActiveVersions, setInternalActiveVersions] = useState<
    Record<number, SceneVersions>
  >(() => {
    const versions: Record<number, SceneVersions> = {};
    Object.entries(timelineState.active_versions).forEach(
      ([folder, versionData]) => {
        // Extract scene number from folder name (e.g., "scene-001" -> 1)
        const match = folder.match(/scene-(\d+)/);
        if (match) {
          const sceneNumber = parseInt(match[1], 10);

          // Handle migration from old format (number) to new format (SceneVersions)
          if (typeof versionData === 'number') {
            versions[sceneNumber] = { video: versionData };
          } else if (versionData && typeof versionData === 'object') {
            versions[sceneNumber] = versionData;
          }
        }
      },
    );
    return versions;
  });

  // Use external activeVersions if provided, otherwise use internal state
  const activeVersions = externalActiveVersions ?? internalActiveVersions;
  const setActiveVersions = onActiveVersionsChange ?? setInternalActiveVersions;

  // Sync active versions to timeline state when they change
  // For placement-based timeline, we use placementNumber as key
  // Note: Timeline state still uses sceneFolder format, so we map placementNumber to a folder-like key
  const prevActiveVersionsRef = useRef<string>('');

  useEffect(() => {
    if (!projectDirectory) return;

    // Serialize current activeVersions for comparison
    const serializedActiveVersions = JSON.stringify(activeVersions);

    // Only update if activeVersions actually changed
    if (serializedActiveVersions === prevActiveVersionsRef.current) {
      return;
    }

    prevActiveVersionsRef.current = serializedActiveVersions;

    // Update timeline state active_versions
    // Map placementNumber to a folder-like key for timeline state compatibility
    Object.entries(activeVersions).forEach(
      ([placementNumberStr, sceneVersions]) => {
        const placementNumber = parseInt(placementNumberStr, 10);
        // Use placement-{number} as the key to distinguish from scene folders
        const folderKey = `placement-${String(placementNumber).padStart(3, '0')}`;

        if (sceneVersions) {
          if (sceneVersions.image !== undefined) {
            setActiveVersion(folderKey, 'image', sceneVersions.image);
          }
          if (sceneVersions.video !== undefined) {
            setActiveVersion(folderKey, 'video', sceneVersions.video);
          }
        }
      },
    );
  }, [activeVersions, projectDirectory, setActiveVersion]);
  // Scene selection and drag/drop removed for placement-based timeline
  // Placements are timestamp-based and cannot be reordered

  const timelineRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const playheadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Drag state management
  const [isDragging, setIsDragging] = useState(false);
  const wasPlayingBeforeDragRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartPositionRef = useRef(0);
  const isClickRef = useRef(true);
  const scrollPositionBeforeEditRef = useRef<number | null>(null);
  const [activeEditingItemId, setActiveEditingItemId] = useState<string | null>(
    null,
  );
  const markersRef = useRef(markers);
  const imageTimingOverridesRef = useRef(
    timelineState.image_timing_overrides || {},
  );
  const infographicTimingOverridesRef = useRef(
    timelineState.infographic_timing_overrides || {},
  );
  const videoSplitOverridesRef = useRef(
    timelineState.video_split_overrides || {},
  );
  const segmentTimingOverridesRef = useRef(
    timelineState.segment_timing_overrides || {},
  );

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    imageTimingOverridesRef.current =
      timelineState.image_timing_overrides || {};
  }, [timelineState.image_timing_overrides]);

  useEffect(() => {
    infographicTimingOverridesRef.current =
      timelineState.infographic_timing_overrides || {};
  }, [timelineState.infographic_timing_overrides]);

  useEffect(() => {
    videoSplitOverridesRef.current = timelineState.video_split_overrides || {};
  }, [timelineState.video_split_overrides]);

  useEffect(() => {
    segmentTimingOverridesRef.current =
      timelineState.segment_timing_overrides || {};
  }, [timelineState.segment_timing_overrides]);

  const captureSnapshot = useCallback((): TimelineEditSnapshot => {
    return {
      markers: cloneMarkers(markersRef.current),
      image_timing_overrides: cloneImageTimingOverrides(
        imageTimingOverridesRef.current,
      ),
      infographic_timing_overrides: cloneInfographicTimingOverrides(
        infographicTimingOverridesRef.current,
      ),
      video_split_overrides: cloneVideoSplitOverrides(
        videoSplitOverridesRef.current,
      ),
      segment_timing_overrides: cloneSegmentTimingOverrides(
        segmentTimingOverridesRef.current,
      ),
    };
  }, []);

  const pushUndoSnapshot = useCallback(
    (snapshot?: TimelineEditSnapshot): boolean => {
      const nextSnapshot = snapshot ?? captureSnapshot();
      const stack = undoStackRef.current;
      const previous = stack[stack.length - 1];

      if (
        previous &&
        JSON.stringify(previous) === JSON.stringify(nextSnapshot)
      ) {
        return false;
      }

      stack.push(nextSnapshot);
      if (stack.length > MAX_TIMELINE_UNDO_STEPS) {
        stack.shift();
      }
      setCanUndo(stack.length > 0);
      return true;
    },
    [captureSnapshot],
  );

  const clearUndoHistory = useCallback(() => {
    undoStackRef.current = [];
    setCanUndo(false);
  }, []);

  const undoLastTimelineEdit = useCallback(() => {
    const stack = undoStackRef.current;
    const previous = stack.pop();
    if (!previous) {
      setCanUndo(false);
      return;
    }

    setMarkers(cloneMarkers(previous.markers));
    updateImageTimingOverrides(
      cloneImageTimingOverrides(previous.image_timing_overrides),
    );
    updateInfographicTimingOverrides(
      cloneInfographicTimingOverrides(previous.infographic_timing_overrides),
    );
    updateVideoSplitOverrides(
      cloneVideoSplitOverrides(previous.video_split_overrides),
    );
    updateSegmentTimingOverrides(
      cloneSegmentTimingOverrides(previous.segment_timing_overrides),
    );
    setContextMenuState(null);
    setCanUndo(stack.length > 0);
  }, [
    updateImageTimingOverrides,
    updateInfographicTimingOverrides,
    updateVideoSplitOverrides,
    updateSegmentTimingOverrides,
  ]);

  useEffect(() => {
    if (!isLoaded || !projectDirectory) {
      clearUndoHistory();
    }
  }, [isLoaded, projectDirectory, clearUndoHistory]);

  useEffect(() => {
    return () => {
      clearUndoHistory();
    };
  }, [clearUndoHistory]);

  const commitInfographicTimingOverride = useCallback(
    (
      placementNumber: number,
      sourceStartTime: number,
      sourceEndTime: number,
      editedStartTime: number,
      editedEndTime: number,
    ) => {
      const currentOverrides = infographicTimingOverridesRef.current;
      const nextOverrides = buildUpdatedInfographicOverride(
        currentOverrides,
        placementNumber,
        sourceStartTime,
        sourceEndTime,
        editedStartTime,
        editedEndTime,
      );

      if (nextOverrides !== currentOverrides) {
        updateInfographicTimingOverrides(nextOverrides);
      }
    },
    [updateInfographicTimingOverrides],
  );

  const commitVideoSplitAtTime = useCallback(
    (item: TimelineItem, splitTimelineSeconds: number): boolean => {
      if (item.type !== 'video' || item.placementNumber === undefined) {
        return false;
      }

      const sourceOffset = item.sourceOffsetSeconds ?? 0;
      const sourceDuration =
        item.sourcePlacementDurationSeconds ??
        Math.max(
          1,
          (item.sourceEndTime ?? item.endTime) -
            (item.sourceStartTime ?? item.startTime),
        );
      const splitOffset = snapToSecond(
        sourceOffset + (splitTimelineSeconds - item.startTime),
      );

      const nextOverrides = buildUpdatedVideoSplitOverride(
        videoSplitOverridesRef.current,
        item.placementNumber,
        sourceDuration,
        splitOffset,
      );

      if (nextOverrides === videoSplitOverridesRef.current) {
        return false;
      }

      updateVideoSplitOverrides(nextOverrides);
      return true;
    },
    [updateVideoSplitOverrides],
  );

  // Timeline marker WebSocket removed with the legacy backend.
  // Markers can be added to the timeline locally but no longer trigger
  // backend artifact generation.

  // Scene-based functionality removed for placement-based timeline

  // Load imported videos from asset manifest (for local video import feature)
  // Note: Imported videos are handled separately and appended after timeline items
  useEffect(() => {
    // Imported videos logic can be added here if needed
    // For now, they're handled in the timeline items rendering
  }, []);

  // Timeline click handler removed - no longer opens marker prompt
  // Marker functionality can be accessed via keyboard shortcut or toolbar button

  // Handle marker creation
  const handleCreateMarker = useCallback(
    async (position: number, prompt: string) => {
      pushUndoSnapshot();

      const newMarker: TimelineMarker = {
        id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        position,
        prompt,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      setMarkers((prev) => [...prev, newMarker]);
      setMarkerPromptOpen(false);
      setMarkerPromptPosition(null);

      // Update marker status to processing
      setMarkers((prev) =>
        prev.map((m) =>
          m.id === newMarker.id ? { ...m, status: 'processing' } : m,
        ),
      );

      // Marker artifact generation went through the removed legacy
      // backend; mark the new marker as error until embedded
      // generation lands.
      setMarkers((prev) =>
        prev.map((m) =>
          m.id === newMarker.id ? { ...m, status: 'error' } : m,
        ),
      );
    },
    [pushUndoSnapshot],
  );

  // Open marker popover at current playhead position (keyboard shortcut)
  const handleOpenMarkerPopover = useCallback(() => {
    if (currentPosition >= 0 && currentPosition <= totalDuration) {
      setMarkerPromptPosition(currentPosition);
      setMarkerPromptOpen(true);
    }
  }, [currentPosition, totalDuration]);

  // Play/pause functionality - only update playhead if using internal state
  // If external state is provided, let VideoLibraryView handle playback
  useEffect(() => {
    if (externalPlaybackTime !== undefined || externalIsPlaying !== undefined) {
      // External state is being used, don't manage playback here
      if (playheadIntervalRef.current) {
        clearInterval(playheadIntervalRef.current);
        playheadIntervalRef.current = null;
      }
      return;
    }

    // Internal state management (fallback if no external state provided)
    if (isPlaying) {
      playheadIntervalRef.current = setInterval(() => {
        const next = currentPosition + 0.1; // Update every 100ms
        if (next >= totalDuration) {
          setIsPlaying(false);
          setCurrentPosition(totalDuration);
        } else {
          setCurrentPosition(next);
        }
      }, 100);
    } else if (playheadIntervalRef.current) {
      clearInterval(playheadIntervalRef.current);
      playheadIntervalRef.current = null;
    }

    // eslint-disable-next-line consistent-return
    return (): void => {
      if (playheadIntervalRef.current) {
        clearInterval(playheadIntervalRef.current);
      }
    };
  }, [
    isPlaying,
    totalDuration,
    externalPlaybackTime,
    externalIsPlaying,
    setCurrentPosition,
    setIsPlaying,
    currentPosition,
  ]);

  // Offset for the timeline content margin
  const TIMELINE_OFFSET = 10;

  // Helper function to clear text selection
  const clearSelection = useCallback(() => {
    if (window.getSelection) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
    }
  }, []);

  // Calculate position from mouse event
  const calculatePositionFromMouse = useCallback(
    (clientX: number): number => {
      if (!tracksRef.current) return currentPosition;
      const rect = tracksRef.current.getBoundingClientRect();
      const x = clientX - rect.left + scrollLeft - TIMELINE_OFFSET;
      const seconds = pixelsToSeconds(x, zoomLevel);
      return Math.max(0, Math.min(totalDuration, seconds));
    },
    [scrollLeft, zoomLevel, totalDuration, currentPosition],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenuState(null);
  }, []);

  const openContextMenuAtPointer = useCallback(
    (
      event: React.MouseEvent<HTMLDivElement>,
      item: TimelineItem | null = null,
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const positionSeconds = calculatePositionFromMouse(event.clientX);
      setContextMenuState({
        x: event.clientX,
        y: event.clientY,
        positionSeconds,
        item,
      });
    },
    [calculatePositionFromMouse],
  );

  const handleTimelineContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;

      // Item-level handlers own their own context menu to preserve target info.
      if (
        target.closest(`.${styles.sceneBlock}`) ||
        target.closest(`.${styles.videoBlock}`) ||
        target.closest(`.${styles.audioBlock}`) ||
        target.closest(`.${styles.textOverlayBlock}`)
      ) {
        return;
      }

      openContextMenuAtPointer(event, null);
    },
    [openContextMenuAtPointer],
  );

  const handleTimelineItemContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, item: TimelineItem) => {
      openContextMenuAtPointer(event, item);
    },
    [openContextMenuAtPointer],
  );

  const handleRegenerateShotFromContextMenu = useCallback(() => {
    const contextItem = contextMenuState?.item;
    if (!isServerTimelineShotItem(contextItem)) {
      return;
    }

    setRegenerateShotItem(contextItem);
    setContextMenuState(null);
  }, [contextMenuState]);

  const handleCloseRegenerateShotModal = useCallback(() => {
    if (isSubmittingShotRegenerate) {
      return;
    }

    setRegenerateShotItem(null);
  }, [isSubmittingShotRegenerate]);

  const handleSubmitRegenerateShot = useCallback(
    async (prompt: string) => {
      if (!regenerateShotItem || !agentContext?.sendTask) {
        return;
      }

      setIsSubmittingShotRegenerate(true);

      try {
        await agentContext.sendTask(
          buildShotRegenerateMessage(regenerateShotItem, prompt),
        );
        setRegenerateShotItem(null);
      } finally {
        setIsSubmittingShotRegenerate(false);
      }
    },
    [agentContext, regenerateShotItem],
  );

  const handleUndoFromContextMenu = useCallback(() => {
    undoLastTimelineEdit();
  }, [undoLastTimelineEdit]);

  const handleGenerateWordCaptions = useCallback(async () => {
    if (!projectDirectory || isGeneratingWordCaptions) return;

    const contextualAudioPath =
      contextMenuState?.item?.type === 'audio'
        ? contextMenuState.item.audioPath
        : undefined;
    const fallbackAudioPath =
      audioTimelineItems.length > 0
        ? [...audioTimelineItems].sort((a, b) => b.duration - a.duration)[0]
            ?.audioPath
        : undefined;
    const selectedAudioPath = contextualAudioPath || fallbackAudioPath;

    if (!selectedAudioPath) {
      setCaptionGenerationMessage('No audio track available for captions.');
      return;
    }

    setIsGeneratingWordCaptions(true);
    setCaptionGenerationMessage(
      'Generating captions... they will appear in the timeline when ready.',
    );

    try {
      const result = await window.electron.project.generateWordCaptions(
        projectDirectory,
        selectedAudioPath,
      );

      if (!result.success) {
        setCaptionGenerationMessage(
          result.error || 'Failed to generate word captions.',
        );
        return;
      }

      const wordCount = result.words?.length ?? 0;
      setCaptionGenerationMessage(
        `Generated word captions (${wordCount} words).`,
      );
    } catch (error) {
      setCaptionGenerationMessage(
        error instanceof Error
          ? error.message
          : 'Failed to generate word captions.',
      );
    } finally {
      setIsGeneratingWordCaptions(false);
    }
  }, [
    projectDirectory,
    isGeneratingWordCaptions,
    contextMenuState,
    audioTimelineItems,
  ]);

  const handleDeleteAudioFromContextMenu = useCallback(async () => {
    if (!projectDirectory || contextMenuState?.item?.type !== 'audio') {
      return;
    }

    const audioItem = contextMenuState.item;
    if (!audioItem.audioPath) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${audioItem.label}" from this project? This will remove the audio file.`,
    );
    if (!shouldDelete) {
      return;
    }

    try {
      await window.electron.project.delete(
        `${projectDirectory}/${audioItem.audioPath}`,
      );

      if (audioItem.assetId) {
        await removeAsset(audioItem.assetId);
      }

      await Promise.all([refreshAssetManifest(), refreshAudioFiles()]);
      setCaptionGenerationMessage(`Deleted audio track "${audioItem.label}".`);
    } catch (error) {
      console.error('[TimelinePanel] Failed to delete audio:', error);
      setCaptionGenerationMessage('Failed to delete audio track.');
    } finally {
      setContextMenuState(null);
    }
  }, [
    contextMenuState,
    projectDirectory,
    removeAsset,
    refreshAssetManifest,
    refreshAudioFiles,
  ]);

  const canGenerateWordCaptions = audioTimelineItems.length > 0;

  // Handle playhead drag start
  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();

      if (!tracksRef.current) return;

      setIsDragging(true);
      if (onDragStateChange) {
        onDragStateChange(true);
      }
      wasPlayingBeforeDragRef.current = isPlaying;
      dragStartXRef.current = e.clientX;
      dragStartPositionRef.current = currentPosition;
      isClickRef.current = true;

      // Pause video playback
      if (isPlaying) {
        setIsPlaying(false);
      }

      // Calculate initial position
      const newPosition = calculatePositionFromMouse(e.clientX);
      setCurrentPosition(newPosition);

      // Global mouse move handler
      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Check if moved enough to be considered a drag
        const moveDistance = Math.abs(
          moveEvent.clientX - dragStartXRef.current,
        );
        if (moveDistance > 5) {
          isClickRef.current = false;
        }

        const position = calculatePositionFromMouse(moveEvent.clientX);
        setCurrentPosition(position);
      };

      // Global mouse up handler
      const handleMouseUpGlobal = (mouseUpEvent: MouseEvent) => {
        const wasClick = isClickRef.current;
        setIsDragging(false);
        if (onDragStateChange) {
          onDragStateChange(false);
        }
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUpGlobal);

        // If it was a click (not drag), just seek to position
        if (wasClick) {
          const position = calculatePositionFromMouse(mouseUpEvent.clientX);
          setCurrentPosition(position);
        } else if (wasPlayingBeforeDragRef.current) {
          // Resume playback if it was playing before drag
          setIsPlaying(true);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUpGlobal);
    },
    [
      isPlaying,
      currentPosition,
      calculatePositionFromMouse,
      setIsPlaying,
      setCurrentPosition,
      onDragStateChange,
      closeContextMenu,
    ],
  );

  const handleInfographicDragMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, item: TimelineItem) => {
      if (item.type !== 'infographic' || item.placementNumber === undefined) {
        return;
      }
      if (e.button !== 0) return;

      e.stopPropagation();
      e.preventDefault();
      scrollPositionBeforeEditRef.current =
        tracksRef.current?.scrollLeft ?? null;

      const sourceStartTime = item.sourceStartTime ?? item.startTime;
      const sourceEndTime = item.sourceEndTime ?? item.endTime;
      const initialStartTime = item.startTime;
      const initialDuration = Math.max(1, item.duration);

      let lastStartTime = initialStartTime;
      let hasRecordedUndoSnapshot = false;
      const interactionSnapshot = captureSnapshot();

      setActiveEditingItemId(item.id);
      setIsDragging(true);
      if (onDragStateChange) {
        onDragStateChange(true);
      }
      wasPlayingBeforeDragRef.current = isPlaying;
      dragStartXRef.current = e.clientX;
      dragStartPositionRef.current = currentPosition;

      if (isPlaying) {
        setIsPlaying(false);
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - dragStartXRef.current;
        if (Math.abs(deltaX) <= 5) {
          return;
        }

        const deltaSeconds = pixelsToSeconds(deltaX, zoomLevel);
        const nextRange = clampImageMove({
          desiredStart: initialStartTime + deltaSeconds,
          duration: initialDuration,
          minStart: 0,
          maxEnd: totalDuration,
        });

        if (nextRange.startTime !== lastStartTime) {
          if (!hasRecordedUndoSnapshot) {
            pushUndoSnapshot(interactionSnapshot);
            hasRecordedUndoSnapshot = true;
          }

          lastStartTime = nextRange.startTime;
          commitInfographicTimingOverride(
            item.placementNumber!,
            sourceStartTime,
            sourceEndTime,
            nextRange.startTime,
            nextRange.endTime,
          );
        }
      };

      const handleMouseUpGlobal = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUpGlobal);
        setIsDragging(false);
        if (onDragStateChange) {
          onDragStateChange(false);
        }
        setActiveEditingItemId(null);

        if (wasPlayingBeforeDragRef.current) {
          setIsPlaying(true);
        }
      };

      document.addEventListener('mousemove', handleMouseMove, {
        passive: true,
      });
      document.addEventListener('mouseup', handleMouseUpGlobal);
    },
    [
      isPlaying,
      currentPosition,
      onDragStateChange,
      zoomLevel,
      totalDuration,
      captureSnapshot,
      pushUndoSnapshot,
      commitInfographicTimingOverride,
      setIsPlaying,
    ],
  );

  // Handle timeline item click (placement-based)
  const handleItemClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, item: TimelineItem) => {
      e.stopPropagation();
      e.preventDefault();

      // Seek to item's start position
      setCurrentPosition(item.startTime);
    },
    [setCurrentPosition],
  );

  // Handle timeline area scrubbing (click and drag)
  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) {
        return;
      }

      closeContextMenu();

      // Don't start scrubbing if clicking on playhead (it has its own handler)
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.playhead}`)) {
        return;
      }

      // Don't start scrubbing if clicking on a scene block (it has its own handler)
      if (target.closest(`.${styles.sceneBlock}`)) {
        return;
      }

      // Don't start scrubbing if clicking on a video block (it has its own handler)
      if (target.closest(`.${styles.videoBlock}`)) {
        return;
      }

      if (!tracksRef.current) return;

      setIsDragging(true);
      if (onDragStateChange) {
        onDragStateChange(true);
      }
      wasPlayingBeforeDragRef.current = isPlaying;
      dragStartXRef.current = e.clientX;
      dragStartPositionRef.current = currentPosition;
      isClickRef.current = true;

      // Pause video playback
      if (isPlaying) {
        setIsPlaying(false);
      }

      // Seek to clicked position immediately
      const newPosition = calculatePositionFromMouse(e.clientX);
      setCurrentPosition(newPosition);

      // Global mouse move handler
      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Check if moved enough to be considered a drag
        const moveDistance = Math.abs(
          moveEvent.clientX - dragStartXRef.current,
        );
        if (moveDistance > 5) {
          isClickRef.current = false;
        }

        const position = calculatePositionFromMouse(moveEvent.clientX);
        setCurrentPosition(position);
      };

      // Global mouse up handler
      const handleMouseUpGlobal = (mouseUpEvent: MouseEvent) => {
        const wasClick = isClickRef.current;
        setIsDragging(false);
        if (onDragStateChange) {
          onDragStateChange(false);
        }
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUpGlobal);

        // If it was a click (not drag), clear selection and seek
        if (wasClick) {
          clearSelection();
          const position = calculatePositionFromMouse(mouseUpEvent.clientX);
          setCurrentPosition(position);
        } else if (wasPlayingBeforeDragRef.current) {
          // Resume playback if it was playing before drag
          setIsPlaying(true);
        }
      };

      document.addEventListener('mousemove', handleMouseMove, {
        passive: true,
      });
      document.addEventListener('mouseup', handleMouseUpGlobal);
    },
    [
      isPlaying,
      currentPosition,
      calculatePositionFromMouse,
      setIsPlaying,
      setCurrentPosition,
      onDragStateChange,
      clearSelection,
      closeContextMenu,
    ],
  );

  // Handle zoom
  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => Math.min(prev * 1.5, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.max(prev / 1.5, 0.1));
  }, []);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Handle mouse wheel zoom (native non-passive listener).
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) {
      return;
    }

    if (e.cancelable) {
      e.preventDefault();
    }
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoomLevel((prev) => Math.max(0.1, Math.min(5, prev * delta)));
  }, []);

  // Fallback for environments where touchpad pinch events are routed
  // through React's synthetic wheel path instead of the native listener.
  const handleReactWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) {
        return;
      }

      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoomLevel((prev) => Math.max(0.1, Math.min(5, prev * delta)));
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const tracksElement = tracksRef.current;
    if (!tracksElement) {
      return undefined;
    }

    tracksElement.addEventListener('wheel', handleWheel, { passive: false });
    return (): void => {
      tracksElement.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, isOpen]);

  // Handle video import - copy to videos/imported folder
  const handleImportVideo = useCallback(async () => {
    if (!projectDirectory) return;

    try {
      const videoPath = await window.electron.project.selectVideoFile();
      if (!videoPath) return;

      // Create videos/imported folder structure if it doesn't exist
      // Similar to ProjectService.createProjectStructure - create nested folders
      const parts = PROJECT_PATHS.VIDEOS_IMPORTED.split('/');
      let basePath = projectDirectory;
      for (const part of parts) {
        if (part) {
          await window.electron.project.createFolder(basePath, part);
          basePath = `${basePath}/${part}`;
        }
      }
      const videosFolder = basePath;

      // Copy video to videos/imported folder
      const videoFileName =
        videoPath.replace(/\\/g, '/').split('/').pop() ||
        `video-${Date.now()}.mp4`;
      const destPath = await window.electron.project.copy(
        videoPath,
        videosFolder,
      );
      const relativePath = `${PROJECT_PATHS.VIDEOS_IMPORTED}/${videoFileName}`;

      // Get video duration
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = toFileUrl(destPath);

      // eslint-disable-next-line compat/compat
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = async () => {
          const { duration } = video;

          // Generate unique asset ID
          const assetId = `imported-video-${Date.now()}-${videoFileName.replace(/[^a-zA-Z0-9]/g, '-')}`;

          // Create asset info for the manifest
          const assetInfo = createAssetInfo(
            assetId,
            'final_video',
            relativePath,
            1,
            {
              metadata: {
                imported: true,
                duration,
                title: videoFileName,
              },
            },
          );

          // Save to asset manifest
          const saved = await addAsset(assetInfo);
          if (!saved) {
            console.error('Failed to save imported video to asset manifest');
          }

          // Update local state and timeline state
          setImportedVideos((prev) => [
            ...prev,
            {
              path: relativePath,
              duration,
              startTime: totalDuration,
            },
          ]);

          console.log(
            'Imported video:',
            relativePath,
            duration,
            'saved to manifest:',
            saved,
          );

          resolve();
        };
        video.onerror = reject;
      });
    } catch {
      // Failed to import video
    }
  }, [projectDirectory, totalDuration, addAsset]);

  // Handle audio import from file
  const handleImportAudioFromFile = useCallback(async () => {
    const importedAudio = await importAudioFromFileToProject({
      projectDirectory,
      projectBridge: window.electron.project,
    });

    if (!importedAudio) {
      return;
    }

    const assetInfo = createAssetInfo(
      buildImportedAudioAssetId(importedAudio.fileName),
      'final_audio',
      importedAudio.relativePath,
      1,
      {
        metadata: {
          imported: true,
          original_file_name: importedAudio.fileName,
          source_path: importedAudio.sourcePath,
        },
      },
    );

    const saved = await addAsset(assetInfo);
    if (!saved) {
      console.error('Failed to save imported audio to asset manifest');
    }

    await Promise.all([refreshAssetManifest(), refreshAudioFiles()]);
  }, [projectDirectory, addAsset, refreshAssetManifest, refreshAudioFiles]);

  // YouTube audio import removed - can be re-added later if needed
  const handleImportAudioFromYouTube = useCallback(
    async (_youtubeUrl: string) => {
      // YouTube extraction functionality removed
      alert('YouTube audio extraction is currently disabled');
    },
    [],
  );

  // Drag handlers removed - not used in unified timeline

  // Handle scene split at playhead (disabled for placement-based timeline)
  const handleSplitScene = useCallback(() => {
    // Placements are timestamp-based and cannot be split
    // This functionality is not applicable to placement-based timeline
    console.log('Split scene not supported for placement-based timeline');
  }, []);

  const isPlacementVideoContextTarget = useMemo(() => {
    if (!contextMenuState?.item) return false;
    return (
      contextMenuState.item.type === 'video' &&
      contextMenuState.item.placementNumber !== undefined
    );
  }, [contextMenuState]);

  const isServerTimelineShotContextTarget = useMemo(
    () => isServerTimelineShotItem(contextMenuState?.item),
    [contextMenuState],
  );

  const canSplitContextTarget = useMemo(() => {
    if (!contextMenuState?.item || !isPlacementVideoContextTarget) return false;

    const item = contextMenuState.item;
    const sourceOffset = item.sourceOffsetSeconds ?? 0;
    const sourceDuration =
      item.sourcePlacementDurationSeconds ??
      Math.max(
        1,
        (item.sourceEndTime ?? item.endTime) -
          (item.sourceStartTime ?? item.startTime),
      );
    const splitOffset = snapToSecond(
      sourceOffset + (currentPosition - item.startTime),
    );
    return splitOffset > 0 && splitOffset < sourceDuration;
  }, [contextMenuState, isPlacementVideoContextTarget, currentPosition]);

  const handleContextSplitClip = useCallback(() => {
    if (!contextMenuState?.item) {
      setContextMenuState(null);
      return;
    }

    const shouldResumePlayback = isPlaying;
    if (shouldResumePlayback) {
      setIsPlaying(false);
    }

    const snapshot = captureSnapshot();
    const didSplit = commitVideoSplitAtTime(
      contextMenuState.item,
      currentPosition,
    );
    if (didSplit) {
      pushUndoSnapshot(snapshot);
    }
    setContextMenuState(null);
    if (shouldResumePlayback) {
      setIsPlaying(true);
    }
  }, [
    contextMenuState,
    isPlaying,
    commitVideoSplitAtTime,
    setIsPlaying,
    currentPosition,
    captureSnapshot,
    pushUndoSnapshot,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable element
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Ctrl/Cmd+Z: Undo timeline edits (only when not typing)
      if (
        e.code === 'KeyZ' &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !isTyping
      ) {
        e.preventDefault();
        undoLastTimelineEdit();
      }

      // Space: Play/Pause
      else if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
      // Arrow Left: Step back (only when not typing)
      else if (e.code === 'ArrowLeft' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        setCurrentPosition((prev) => Math.max(0, prev - 0.1));
      }
      // Arrow Right: Step forward (only when not typing)
      else if (e.code === 'ArrowRight' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        setCurrentPosition((prev) => Math.min(totalDuration, prev + 0.1));
      }
      // Shift+Arrow Left: Jump back 1 second (only when not typing)
      else if (e.code === 'ArrowLeft' && e.shiftKey && !isTyping) {
        e.preventDefault();
        setCurrentPosition((prev) => Math.max(0, prev - 1));
      }
      // Shift+Arrow Right: Jump forward 1 second (only when not typing)
      else if (e.code === 'ArrowRight' && e.shiftKey && !isTyping) {
        e.preventDefault();
        setCurrentPosition((prev) => Math.min(totalDuration, prev + 1));
      }
      // Plus/Equal: Zoom in
      else if (
        (e.code === 'Equal' || e.code === 'NumpadAdd') &&
        (e.ctrlKey || e.metaKey)
      ) {
        e.preventDefault();
        handleZoomIn();
      }
      // Minus: Zoom out
      else if (
        (e.code === 'Minus' || e.code === 'NumpadSubtract') &&
        (e.ctrlKey || e.metaKey)
      ) {
        e.preventDefault();
        handleZoomOut();
      }
      // S: Split scene at playhead (only when not typing)
      else if (
        e.code === 'KeyS' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !isTyping
      ) {
        e.preventDefault();
        handleSplitScene();
      }
      // M: Add marker at current playhead position (only when not typing)
      else if (
        e.code === 'KeyM' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !isTyping
      ) {
        e.preventDefault();
        handleOpenMarkerPopover();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line consistent-return
    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isOpen,
    totalDuration,
    handleZoomIn,
    handleZoomOut,
    handleSplitScene,
    handleOpenMarkerPopover,
    undoLastTimelineEdit,
    setCurrentPosition,
    setIsPlaying,
  ]);

  // Show empty state if no project
  if (!projectDirectory) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <p>Open a project to view the timeline</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading timeline...</div>
      </div>
    );
  }

  // Timeline extends past content by TAIL_PADDING_SECONDS so user can scroll into empty space. Playhead stays in [0, totalDuration].
  const displayDuration =
    totalDuration > 0 ? totalDuration + TAIL_PADDING_SECONDS : 10;
  const timelineWidth = secondsToPixels(displayDuration, zoomLevel);
  const markerStepSeconds = getMajorMarkerStepSeconds(zoomLevel);
  const maxMarkerTime =
    Math.ceil(displayDuration / markerStepSeconds) * markerStepSeconds;

  const timeMarkers: number[] = [];
  for (let i = 0; i <= maxMarkerTime; i += markerStepSeconds) {
    timeMarkers.push(i);
  }

  const visibleTracks = [
    mainTimelineItems.length > 0
      ? {
          key: 'main',
          label: 'Visuals',
          meta: 'Primary clips',
          icon: TrackVisualIcon,
          rowClassName: styles.visualTrackLabel,
          toneClassName: styles.visualTone,
        }
      : null,
    overlayItems.length > 0
      ? {
          key: 'overlay',
          label: 'Overlays',
          meta: 'Infographics',
          icon: TrackOverlayIcon,
          rowClassName: styles.overlayTrackLabel,
          toneClassName: styles.overlayTone,
        }
      : null,
    textOverlayItems.length > 0
      ? {
          key: 'text',
          label: 'Captions',
          meta: 'Text sync',
          icon: TrackTextIcon,
          rowClassName: styles.textTrackLabel,
          toneClassName: styles.textTone,
        }
      : null,
    audioTimelineItems.length > 0
      ? {
          key: 'audio',
          label: 'Audio',
          meta: 'Music and VO',
          icon: TrackAudioIcon,
          rowClassName: styles.audioTrackLabel,
          toneClassName: styles.audioTone,
        }
      : null,
  ].filter(
    (
      track,
    ): track is {
      key: string;
      label: string;
      meta: string;
      icon: typeof TrackVisualIcon;
      rowClassName: string;
      toneClassName: string;
    } => track !== null,
  );

  const normalizationMessage =
    normalizationSummary.droppedCount > 0
      ? `Some timeline segments were unavailable (${normalizationSummary.droppedCount} dropped)`
      : isNormalizedFromCorruption
        ? `Recovered timeline from stale restore data (${normalizationSummary.repairedCount} repaired)`
        : null;

  const timelineStateMessage = timelineError
    ? timelineError
    : isTimelineLoading
      ? 'Loading local timeline'
      : normalizationMessage || captionGenerationMessage || 'Timeline ready';

  const timelineStateClass = timelineError
    ? styles.stateError
    : isTimelineLoading
      ? styles.stateLoading
      : normalizationMessage || captionGenerationMessage
        ? styles.stateInfo
        : styles.stateReady;

  // Playhead stays within content only; currentPosition is already clamped to [0, totalDuration]
  const playheadPosition = Math.min(
    secondsToPixels(currentPosition, zoomLevel),
    secondsToPixels(totalDuration, zoomLevel),
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerControl}>
          <span className={styles.headerTitle}>Timeline</span>
          <span className={styles.headerMeta}>
            {visibleTracks.length > 0
              ? `${visibleTracks.length} lanes`
              : 'Ready for media'}
          </span>
          <button
            type="button"
            className={styles.toggleButton}
            onClick={onToggle}
            title={isOpen ? 'Hide Timeline' : 'Show Timeline'}
          >
            {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        {isOpen && (
          <button
            type="button"
            className={styles.resizeHandle}
            onMouseDown={onResize}
            aria-label="Resize timeline"
          />
        )}
      </div>
      {isOpen && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.toolbarGroup}>
              <div className={styles.transportGroup}>
                <button
                  type="button"
                  className={styles.playButton}
                  onClick={() => setIsPlaying(!isPlaying)}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <div className={styles.timeDisplayGroup}>
                  <span className={styles.timeDisplay}>
                    {formatTime(currentPosition)}
                  </span>
                  <span className={styles.timeDisplayMeta}>
                    / {formatTime(totalDuration)}
                  </span>
                </div>
              </div>
            </div>
            <div className={styles.toolbarGroup}>
              <span
                className={`${styles.timelineStatePill} ${timelineStateClass}`}
              >
                {timelineStateMessage}
              </span>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={handleImportVideo}
                title={`Import Video (${modKey}+I)`}
              >
                <Upload size={14} />
                <span>Import</span>
              </button>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={() => setIsAudioModalOpen(true)}
                title="Import Audio"
              >
                <Music size={14} />
                <span>Audio</span>
              </button>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={handleSplitScene}
                title="Split Scene at Playhead (S)"
              >
                <Scissors size={14} />
                <span>Split</span>
              </button>
              <div className={styles.toolbarDivider} />
              <button
                type="button"
                className={styles.zoomButton}
                onClick={handleZoomOut}
                title={`Zoom Out (${modKey}+-)`}
              >
                <ZoomOut size={14} />
              </button>
              <span className={styles.zoomLevel}>
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                type="button"
                className={styles.zoomButton}
                onClick={handleZoomIn}
                title={`Zoom In (${modKey}++)`}
              >
                <ZoomIn size={14} />
              </button>
            </div>
          </div>

          <div className={styles.timelineContainer} ref={timelineRef}>
            {timelineSource !== 'server_timeline' && (
              <VersionSelector
                timelineItems={timelineItems}
                activeVersions={activeVersions}
                onVersionSelect={(placementNumber, assetType, version) => {
                  const newVersions: Record<number, SceneVersions> = {
                    ...activeVersions,
                    [placementNumber]: {
                      ...activeVersions[placementNumber],
                      [assetType]: version,
                    },
                  };
                  setActiveVersions(newVersions);
                }}
              />
            )}
            {visibleTracks.length > 0 && (
              <div className={styles.trackLabelsDock}>
                <div className={styles.trackLabelsSpacer}>Lanes</div>
                <div
                  className={styles.trackLabelsInner}
                  style={{ transform: `translateY(-${scrollTop}px)` }}
                >
                  {visibleTracks.map((track) => {
                    const Icon = track.icon;

                    return (
                      <div
                        key={track.key}
                        className={`${styles.trackLabelRow} ${track.rowClassName}`}
                      >
                        <span
                          className={`${styles.trackLabelIcon} ${track.toneClassName}`}
                        >
                          <Icon size={14} />
                        </span>
                        <div className={styles.trackLabelText}>
                          <span className={styles.trackLabelName}>
                            {track.label}
                          </span>
                          <span className={styles.trackLabelMeta}>
                            {track.meta}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
            <div
              className={styles.tracksArea}
              ref={tracksRef}
              onScroll={handleScroll}
              onMouseDown={handleTimelineMouseDown}
              onContextMenu={handleTimelineContextMenu}
              onWheel={handleReactWheel}
              role="application"
              aria-label="Timeline tracks"
              tabIndex={0}
            >
              <div
                className={styles.timelineContent}
                style={{ width: `${timelineWidth}px` }}
              >
                {/* Time Ruler */}
                <div className={styles.timeRuler}>
                  {timeMarkers.map((time) => (
                    <div
                      key={time}
                      className={styles.timeMarker}
                      style={{ left: `${secondsToPixels(time, zoomLevel)}px` }}
                    >
                      <div className={styles.timeMarkerLine} />
                      <span className={styles.timeMarkerLabel}>
                        {formatTime(time).substring(0, 8)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Playhead */}
                <div
                  className={`${styles.playhead} ${isDragging ? styles.dragging : ''}`}
                  style={{ left: `${playheadPosition}px` }}
                  onMouseDown={handlePlayheadMouseDown}
                  role="slider"
                  tabIndex={0}
                  aria-label="Timeline playhead"
                  aria-valuenow={currentPosition}
                  aria-valuemin={0}
                  aria-valuemax={totalDuration}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      setCurrentPosition((prev) => Math.max(0, prev - 0.1));
                    } else if (e.key === 'ArrowRight') {
                      setCurrentPosition((prev) =>
                        Math.min(totalDuration, prev + 0.1),
                      );
                    }
                  }}
                />

                {visibleTracks.length === 0 && (
                  <div className={styles.emptyTimelineState}>
                    <div className={styles.emptyTimelineTitle}>
                      Timeline is ready for edits
                    </div>
                    <div className={styles.emptyTimelineCopy}>
                      Import media or generate scenes to start arranging the
                      cut.
                    </div>
                  </div>
                )}

                {/* Main Track */}
                {mainTimelineItems.length > 0 && (
                  <div className={`${styles.track} ${styles.visualTrack}`}>
                    <div className={styles.trackContent}>
                      {mainTimelineItems.map((item) => {
                        const left = secondsToPixels(item.startTime, zoomLevel);
                        const width = secondsToPixels(item.duration, zoomLevel);

                        return (
                          <MemoTimelineItemComponent
                            key={item.id}
                            item={item}
                            left={left}
                            width={width}
                            projectDirectory={projectDirectory || null}
                            isSelected={activeEditingItemId === item.id}
                            onItemClick={handleItemClick}
                            onInfographicDragMouseDown={
                              handleInfographicDragMouseDown
                            }
                            onItemContextMenu={handleTimelineItemContextMenu}
                            isEditing={activeEditingItemId === item.id}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Overlay Track (Infographics) */}
                {overlayItems.length > 0 && (
                  <div className={`${styles.track} ${styles.overlayTrack}`}>
                    <div className={styles.trackContent}>
                      {overlayItems.map((item) => {
                        const left = secondsToPixels(item.startTime, zoomLevel);
                        const width = secondsToPixels(item.duration, zoomLevel);

                        return (
                          <MemoTimelineItemComponent
                            key={item.id}
                            item={item}
                            left={left}
                            width={width}
                            projectDirectory={projectDirectory || null}
                            isSelected={activeEditingItemId === item.id}
                            onItemClick={handleItemClick}
                            onInfographicDragMouseDown={
                              handleInfographicDragMouseDown
                            }
                            onItemContextMenu={handleTimelineItemContextMenu}
                            isEditing={activeEditingItemId === item.id}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Text Overlay Track (Word Sync Captions) */}
                {textOverlayItems.length > 0 && (
                  <div className={`${styles.track} ${styles.textOverlayTrack}`}>
                    <div className={styles.trackContent}>
                      {textOverlayItems.map((item) => {
                        const left = secondsToPixels(item.startTime, zoomLevel);
                        const width = secondsToPixels(item.duration, zoomLevel);

                        return (
                          <MemoTimelineItemComponent
                            key={item.id}
                            item={item}
                            left={left}
                            width={width}
                            projectDirectory={projectDirectory || null}
                            isSelected={false}
                            onItemClick={handleItemClick}
                            onItemContextMenu={handleTimelineItemContextMenu}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Audio Track */}
                {audioTimelineItems.length > 0 && (
                  <div className={`${styles.track} ${styles.audioTrack}`}>
                    <div className={styles.trackContent}>
                      {audioTimelineItems.map((item) => {
                        const left = secondsToPixels(item.startTime, zoomLevel);
                        const width = getAudioBlockWidthPx({
                          duration: item.duration,
                          zoomLevel,
                        });

                        return (
                          <MemoTimelineItemComponent
                            key={item.id}
                            item={item}
                            left={left}
                            width={width}
                            projectDirectory={projectDirectory || null}
                            isSelected={false}
                            onItemClick={handleItemClick}
                            onItemContextMenu={handleTimelineItemContextMenu}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Markers */}
                {markers.map((marker) => (
                  <TimelineMarkerComponent
                    key={marker.id}
                    marker={marker}
                    position={secondsToPixels(marker.position, zoomLevel)}
                  />
                ))}
              </div>
            </div>
            {/* eslint-enable jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          </div>

          {contextMenuState && (
            <TimelineContextMenu
              x={contextMenuState.x}
              y={contextMenuState.y}
              canUndo={canUndo}
              canGenerateWordCaptions={canGenerateWordCaptions}
              isGeneratingWordCaptions={isGeneratingWordCaptions}
              showRegenerateShotAction={isServerTimelineShotContextTarget}
              showVideoEditActions={isPlacementVideoContextTarget}
              showDeleteAudioAction={contextMenuState.item?.type === 'audio'}
              onUndo={handleUndoFromContextMenu}
              onRegenerateShot={handleRegenerateShotFromContextMenu}
              onGenerateWordCaptions={handleGenerateWordCaptions}
              onSplitClip={
                isPlacementVideoContextTarget && canSplitContextTarget
                  ? handleContextSplitClip
                  : undefined
              }
              onTrimLeftToPlayhead={undefined}
              onDeleteAudio={handleDeleteAudioFromContextMenu}
              onClose={closeContextMenu}
            />
          )}

          {markerPromptOpen && markerPromptPosition !== null && (
            <MarkerPromptPopover
              position={markerPromptPosition}
              onClose={() => {
                setMarkerPromptOpen(false);
                setMarkerPromptPosition(null);
              }}
              onSubmit={(prompt) => {
                if (markerPromptPosition !== null) {
                  handleCreateMarker(markerPromptPosition, prompt);
                }
              }}
            />
          )}

          <ShotRegenerateModal
            item={regenerateShotItem}
            isOpen={regenerateShotItem !== null}
            isSubmitting={isSubmittingShotRegenerate}
            onClose={handleCloseRegenerateShotModal}
            onSubmit={handleSubmitRegenerateShot}
          />

          <AudioImportModal
            isOpen={isAudioModalOpen}
            onClose={() => setIsAudioModalOpen(false)}
            onImportFromFile={handleImportAudioFromFile}
            onImportFromYouTube={handleImportAudioFromYouTube}
          />
        </>
      )}
    </div>
  );
}
