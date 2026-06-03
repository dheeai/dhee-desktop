import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { Film, Play, Calendar, Pause, Download } from 'lucide-react';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useProject } from '../../../contexts/ProjectContext';
import { useTimelineDataContext } from '../../../contexts/TimelineDataContext';
import { useAudioController } from '../../../hooks/useAudioController';
import { usePlaybackController } from '../../../hooks/usePlaybackController';
import {
  resolveAssetPathForDisplay,
  resolveAssetPathWithRetry,
} from '../../../utils/pathResolver';
import {
  debugRendererDebug,
  debugRendererLog,
  debugRendererWarn,
} from '../../../utils/debugLogger';
import {
  normalizePathForExport,
  stripFileProtocol,
} from '../../../utils/pathNormalizer';
import {
  buildPromptOverlayCues,
  buildTimelineExportItem,
  sanitizePromptOverlayText,
} from '../../../utils/promptOverlayExport';
import {
  buildProjectAbsolutePath,
  getFinalVideoStateWarning,
  getManifestFinalVideoAsset,
} from '../../../services/project/finalVideoValidation';
import {
  getThumbnailPreviewTime,
  getVisibleVideoTime,
} from '../../../utils/videoPreview';
import {
  buildFinalVideoVersions,
  summarizeChanges,
  type FinalVideoVersion,
} from './buildFinalVideoVersions';
import type { Artifact } from '../../../types/projectState';
import type { SceneRef } from '../../../types/dhee/entities';
import type { SceneVersions } from '../../../types/dhee/timeline';
import type { PromptOverlayCue } from '../../../types/captions';
import styles from './VideoLibraryView.module.scss';

const PREVIEW_WATERMARK_TEXT = 'dhee';
type ExportAspectRatio = '16:9' | '9:16';
type ExportQuality = 'standard' | 'high';

interface ExportRenderOptions {
  aspectRatio: ExportAspectRatio;
  quality: ExportQuality;
}

function normalizeVideoSourcePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('file://')) {
    return decodeURIComponent(stripFileProtocol(trimmed)).replace(/\\/g, '/');
  }

  return trimmed.replace(/\\/g, '/');
}

function doesVideoSourceMatch(
  currentSrc: string,
  expectedSrc: string,
): boolean {
  if (!currentSrc || !expectedSrc) return false;
  if (currentSrc === expectedSrc) return true;

  const normalizedCurrent = normalizeVideoSourcePath(currentSrc);
  const normalizedExpected = normalizeVideoSourcePath(expectedSrc);
  if (!normalizedCurrent || !normalizedExpected) return false;

  return normalizedCurrent === normalizedExpected;
}

// Video Card Component
interface VideoCardProps {
  artifact: Artifact;
  formatDate: (dateString: string) => string;
  projectDirectory: string | null;
}

function VideoCard({ artifact, formatDate, projectDirectory }: VideoCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoadThumbnail, setShouldLoadThumbnail] = useState(false);
  const [videoPath, setVideoPath] = useState<string>('');
  const [hasPreviewFrame, setHasPreviewFrame] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    if (shouldLoadThumbnail) {
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoadThumbnail(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadThumbnail(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [shouldLoadThumbnail]);

  useEffect(() => {
    setVideoPath('');
    setHasPreviewFrame(false);
    setThumbnailFailed(false);
  }, [artifact.artifact_id, artifact.file_path]);

  useEffect(() => {
    if (!shouldLoadThumbnail) {
      return undefined;
    }

    let isCancelled = false;
    setHasPreviewFrame(false);
    setThumbnailFailed(false);

    resolveAssetPathWithRetry(artifact.file_path, projectDirectory, {
      maxRetries: 3,
      retryDelayBase: 350,
      timeout: 5000,
      verifyExists: true,
    })
      .then((resolved) => {
        if (isCancelled) return;
        setVideoPath(resolved);
      })
      .catch((error) => {
        if (isCancelled) return;
        console.warn(
          `[VideoLibraryView] Failed to resolve thumbnail path for ${artifact.artifact_id}:`,
          error,
        );
        setVideoPath('');
        setThumbnailFailed(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [
    artifact.artifact_id,
    artifact.file_path,
    projectDirectory,
    shouldLoadThumbnail,
  ]);

  const primePreviewFrame = useCallback((video: HTMLVideoElement) => {
    const previewTime = getThumbnailPreviewTime(video.duration);
    if (!Number.isFinite(previewTime) || previewTime <= 0) {
      setHasPreviewFrame(true);
      return;
    }

    if (Math.abs((video.currentTime || 0) - previewTime) < 0.04) {
      setHasPreviewFrame(true);
      return;
    }

    try {
      video.currentTime = previewTime;
    } catch {
      setHasPreviewFrame(true);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoPath) return undefined;

    const handleLoadedMetadata = () => {
      primePreviewFrame(video);
    };
    const handleLoadedData = () => {
      setHasPreviewFrame(true);
    };
    const handleSeeked = () => {
      setHasPreviewFrame(true);
      video.pause();
    };
    const handleError = () => {
      setThumbnailFailed(true);
      setHasPreviewFrame(false);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
  }, [primePreviewFrame, videoPath]);

  useEffect(() => {
    if (!videoPath) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    video.load();
    return undefined;
  }, [videoPath]);

  return (
    <div
      ref={cardRef}
      className={styles.videoCard}
      onMouseEnter={() => setShouldLoadThumbnail(true)}
    >
      <div className={styles.videoThumbnail}>
        {(!videoPath || thumbnailFailed || !hasPreviewFrame) && (
          <div className={styles.videoThumbnailPlaceholder}>
            <Film size={24} className={styles.videoThumbnailPlaceholderIcon} />
            <span className={styles.videoThumbnailPlaceholderLabel}>
              {thumbnailFailed ? 'Preview unavailable' : 'Video preview'}
            </span>
          </div>
        )}
        {videoPath && !thumbnailFailed ? (
          <video
            ref={videoRef}
            src={videoPath}
            className={styles.video}
            preload="metadata"
            muted
            playsInline
            style={{ visibility: hasPreviewFrame ? 'visible' : 'hidden' }}
          />
        ) : null}
        {artifact.scene_number && (
          <div className={styles.sceneBadge}>Scene {artifact.scene_number}</div>
        )}
      </div>
      <div className={styles.videoInfo}>
        <div className={styles.videoTitle}>
          {(artifact.metadata?.title as string) ||
            `Video ${artifact.artifact_id.slice(-8)}`}
        </div>
        <div className={styles.videoMeta}>
          <div className={styles.metaItem}>
            <Calendar size={12} />
            <span>{formatDate(artifact.created_at)}</span>
          </div>
        </div>
        {artifact.metadata?.summary ? (
          <div className={styles.videoSummary}>
            {artifact.metadata.summary as string}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface VideoLibraryViewProps {
  playbackTime: number;
  isPlaying: boolean;
  isDragging?: boolean;
  onPlaybackTimeChange: (time: number) => void;
  onPlaybackStateChange: (playing: boolean) => void;
  onTotalDurationChange?: (duration: number) => void;
  activeVersions?: Record<number, SceneVersions>; // sceneNumber -> { image?: number, video?: number }
  projectScenes?: SceneRef[];
}

export default function VideoLibraryView({
  playbackTime,
  isPlaying,
  isDragging = false,
  onPlaybackTimeChange,
  onPlaybackStateChange,
  onTotalDurationChange,
  activeVersions = {},
  projectScenes = [],
}: VideoLibraryViewProps) {
  const { projectDirectory } = useWorkspace();
  const { isLoading, assetManifest, agentState } = useProject();
  const [validFinalVideoIds, setValidFinalVideoIds] = useState<Set<string> | null>(
    null,
  );
  const manifestFinalVideoAsset = useMemo(
    () => getManifestFinalVideoAsset(agentState, assetManifest),
    [agentState, assetManifest],
  );
  const finalVideoWarning = useMemo(
    () =>
      getFinalVideoStateWarning(
        agentState,
        assetManifest,
        projectDirectory,
        manifestFinalVideoAsset && validFinalVideoIds
          ? validFinalVideoIds.has(manifestFinalVideoAsset.id)
          : undefined,
      ),
    [agentState, assetManifest, projectDirectory, manifestFinalVideoAsset, validFinalVideoIds],
  );

  useEffect(() => {
    let cancelled = false;

    const verifyFinalVideos = async () => {
      if (!projectDirectory || !assetManifest?.assets?.length) {
        if (!cancelled) {
          setValidFinalVideoIds(new Set());
        }
        return;
      }

      const assets = assetManifest.assets.filter(
        (asset) => asset.type === 'final_video',
      );
      const validIds = new Set<string>();

      await Promise.all(
        assets.map(async (asset) => {
          const absolutePath = buildProjectAbsolutePath(
            projectDirectory,
            asset.path,
          );
          if (
            !(await window.electron.project.checkFileExists(absolutePath))
          ) {
            return;
          }
          validIds.add(asset.id);
        }),
      );

      if (!cancelled) {
        setValidFinalVideoIds(validIds);
      }
    };

    void verifyFinalVideos();
    return () => {
      cancelled = true;
    };
  }, [assetManifest, projectDirectory]);

  // Create scene folder map
  const sceneFoldersByNumber = useMemo(() => {
    const map: Record<number, string> = {};
    projectScenes.forEach((scene) => {
      map[scene.scene_number] = scene.folder;
    });
    return map;
  }, [projectScenes]);

  // Use unified timeline data from context (single source of truth for TimelinePanel + VideoLibraryView)
  const {
    timelineItems,
    overlayItems,
    totalDuration,
    timelineSource,
    error: timelineError,
    isTimelineLoading,
  } = useTimelineDataContext();

  const isTimelinePending =
    !isTimelineLoading &&
    timelineSource !== 'server_timeline' &&
    !timelineError;

  // Notify parent when totalDuration changes (for playback bounds checking)
  useEffect(() => {
    if (onTotalDurationChange) {
      onTotalDurationChange(totalDuration);
    }
  }, [totalDuration, onTotalDurationChange]);

  // Watch tab — version list. Only `final_video` assets surface here,
  // sorted oldest-first and labelled V1, V2, V3, …. Per-shot
  // `scene_video` artifacts are intentionally excluded: they're
  // already shown next to their prompts in the Prompts tab, so
  // listing them here was duplicative. The earlier `videoArtifacts`
  // derivation that mixed both types is preserved in git history if
  // we ever need it back.
  const finalVideoVersions = useMemo<FinalVideoVersion[]>(() => {
    if (!assetManifest?.assets) return [];
    const versions = buildFinalVideoVersions(assetManifest.assets);
    // Validity gate (e.g. "the file no longer exists on disk") is
    // tracked separately by `validFinalVideoIds`; honour it so
    // already-deleted finals don't appear as ghost cards.
    if (!validFinalVideoIds) return versions;
    return versions.filter((v) => validFinalVideoIds.has(v.assetId));
  }, [assetManifest, validFinalVideoIds]);

  const videoArtifacts = useMemo(
    () =>
      finalVideoVersions.map((v) => ({
        artifact_id: v.assetId,
        artifact_type: 'video' as const,
        file_path: v.path,
        created_at: v.createdAtMs ? new Date(v.createdAtMs).toISOString() : new Date().toISOString(),
        scene_number: undefined as number | undefined,
        metadata: {
          title: v.versionLabel,
          duration: v.durationSeconds,
          summary: summarizeChanges(v.changes),
          imported: undefined,
        },
      })),
    [finalVideoVersions],
  );

  // Refs must be declared before usePlaybackController hook
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentVideoPathRef = useRef<string | null>(null);
  const appliedClipIdentityRef = useRef<string | null>(null);
  const videoPathRequestIdRef = useRef(0);
  const sceneImageRequestIdRef = useRef(0);
  const isSeekingRef = useRef(false);
  const isVideoLoadingRef = useRef(false);
  const intendedPlaybackRef = useRef(isPlaying);
  const playbackAnimationFrameRef = useRef<number | null>(null);
  const playbackClockRef = useRef<{
    lastTimestamp: number | null;
    fallbackTimelineTime: number;
  }>({
    lastTimestamp: null,
    fallbackTimelineTime: playbackTime,
  });
  const clipTransitionTimeRef = useRef<number | null>(null);
  const nextVideoPreloadRef = useRef<HTMLVideoElement | null>(null);
  const nextPreloadedClipIdentityRef = useRef<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportAspectRatio, setExportAspectRatio] =
    useState<ExportAspectRatio | null>(null);
  const [exportQuality, setExportQuality] = useState<ExportQuality | null>(
    null,
  );
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const lastPlaybackTimeRef = useRef(0);

  useEffect(() => {
    intendedPlaybackRef.current = isPlaying;
  }, [isPlaying]);

  // Use production-grade playback controller instead of manual state management
  const { currentItem, currentItemIndex, timeIndex } = usePlaybackController(
    timelineItems,
    playbackTime,
    isPlaying,
    isDragging,
    () => isSeekingRef.current, // Pass function to get current seeking state
  );

  // Format date
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  // Format time display
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Wrapper to prevent backward jumps during normal playback
  // Backward jumps are only allowed during explicit seeks or when dragging
  const safeSetPlaybackTime = useCallback(
    (newTime: number, isSeeking = false) => {
      const lastTime = lastPlaybackTimeRef.current;
      const boundedTime =
        totalDuration > 0
          ? Math.max(0, Math.min(newTime, totalDuration))
          : Math.max(0, newTime);

      // Allow backward jumps if:
      // - Explicitly seeking
      // - Small correction (< 0.5s)
      // - Moving forward (newTime >= lastTime)
      // - Starting from 0
      if (isSeeking || boundedTime >= lastTime - 0.5 || lastTime === 0) {
        onPlaybackTimeChange(boundedTime);
        lastPlaybackTimeRef.current = boundedTime;
      } else {
        debugRendererWarn(
          '[VideoLibraryView] Prevented backward jump during playback:',
          {
            from: lastTime,
            to: boundedTime,
          },
        );
      }
    },
    [onPlaybackTimeChange, totalDuration],
  );

  const transitionPlaybackToTime = useCallback(
    (targetTime: number) => {
      const boundedTarget =
        totalDuration > 0
          ? Math.max(0, Math.min(targetTime, totalDuration))
          : Math.max(0, targetTime);

      clipTransitionTimeRef.current = boundedTarget;
      safeSetPlaybackTime(boundedTarget, false);

      if (totalDuration > 0 && boundedTarget >= totalDuration - 0.001) {
        intendedPlaybackRef.current = false;
        onPlaybackStateChange(false);
      }
    },
    [onPlaybackStateChange, safeSetPlaybackTime, totalDuration],
  );

  // Get current video and image from playback controller
  // currentItem is already provided by usePlaybackController
  const currentVideo = currentItem?.type === 'video' ? currentItem : null;
  const currentImage = currentItem?.type === 'image' ? currentItem : null;
  const sceneClipIdentity = useMemo(() => {
    if (!currentItem) return null;
    if (
      currentItem.type === 'video' ||
      currentItem.type === 'audio' ||
      currentItem.type === 'text_overlay'
    ) {
      return null;
    }

    const idPart = currentItem.id || currentItem.label;
    return `${idPart}:${currentItem.startTime}:${currentItem.endTime}:${currentItem.imagePath ?? ''}`;
  }, [currentItem]);
  const clipIdentity = useMemo(() => {
    if (!currentVideo) return null;

    const idPart = currentVideo.id || currentVideo.label;
    return `${idPart}:${currentVideo.startTime}:${currentVideo.endTime}:${currentVideo.sourceOffsetSeconds ?? 0}`;
  }, [currentVideo]);

  const currentOverlay = useMemo(() => {
    if (overlayItems.length === 0) return null;
    return (
      overlayItems.find(
        (item) => playbackTime >= item.startTime && playbackTime < item.endTime,
      ) || null
    );
  }, [overlayItems, playbackTime]);

  const activeOverlay = currentItem?.type === 'image' ? currentOverlay : null;

  const nextTimelineItem = useMemo(() => {
    if (!currentItem) return null;
    return timeIndex.getNextItemAfterTime(currentItem.endTime);
  }, [currentItem, timeIndex]);

  const nextVideoItem = useMemo(() => {
    if (!nextTimelineItem || nextTimelineItem.type !== 'video') {
      return null;
    }

    return nextTimelineItem;
  }, [nextTimelineItem]);

  // Log when currentVideo changes
  useEffect(() => {
    debugRendererLog('[VideoLibraryView] currentVideo changed:', {
      currentItemIndex,
      currentItemType: currentItem?.type,
      currentVideoLabel: currentVideo?.label,
      currentVideoPlacementNumber: currentVideo?.placementNumber,
      currentVideoPath: currentVideo?.videoPath,
      currentVideoStartTime: currentVideo?.startTime?.toFixed(2),
      currentVideoEndTime: currentVideo?.endTime?.toFixed(2),
      hasVideoRef: !!videoRef.current,
      currentVideoElementSrc: videoRef.current?.src,
    });
  }, [currentVideo, currentItemIndex, currentItem]);

  useEffect(() => {
    playbackClockRef.current.fallbackTimelineTime = playbackTime;
  }, [playbackTime]);

  // Extract audio file metadata from timeline data (stable - only changes when audio file changes)
  const audioFile = useMemo(() => {
    const audioItems = timelineItems.filter((item) => item.type === 'audio');
    if (audioItems.length === 0) return null;

    const firstAudio = audioItems[0];
    if (!firstAudio.audioPath) return null;

    return {
      path: firstAudio.audioPath,
      duration: firstAudio.duration,
    };
  }, [timelineItems]); // ✅ Stable - only changes when audio file actually changes

  // Resolve audio path
  const [resolvedAudioPath, setResolvedAudioPath] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!audioFile?.path || !projectDirectory) {
      setResolvedAudioPath(null);
      return;
    }

    // Use retry logic similar to image placements to handle file copy timing issues
    resolveAssetPathWithRetry(audioFile.path, projectDirectory, {
      maxRetries: 3,
      retryDelayBase: 500,
      timeout: 5000,
      verifyExists: true,
    })
      .then((resolved) => {
        setResolvedAudioPath(resolved);
      })
      .catch((error) => {
        console.error(
          '[VideoLibraryView] Failed to resolve audio path:',
          error,
        );
        setResolvedAudioPath(null);
      });
  }, [audioFile?.path, projectDirectory]);

  // Use audio controller hook (imperative audio management)
  const { audioRef } = useAudioController({
    playbackTime,
    isPlaying,
    audioFile,
    resolvedAudioPath,
    projectDirectory,
    isDragging,
    isSeeking: () => isSeekingRef.current, // Pass function to get current seeking state
    onPlaybackStateChange,
    currentVideoItem: currentVideo ? { endTime: currentVideo.endTime } : null,
  });

  // Resolve image path from current timeline item (placement-based)
  const sceneImagePath = useMemo(() => {
    if (!currentImage) {
      debugRendererDebug('[VideoLibraryView] No current image item');
      return null;
    }

    return currentImage.imagePath || null;
  }, [currentImage]);

  // Resolve and store the display-ready image path
  const [resolvedSceneImagePath, setResolvedSceneImagePath] = useState<
    string | null
  >(null);
  const [isResolvingSceneImagePath, setIsResolvingSceneImagePath] =
    useState(false);

  const [resolvedOverlayPath, setResolvedOverlayPath] = useState<string | null>(
    null,
  );

  useEffect(() => {
    sceneImageRequestIdRef.current += 1;
    const requestId = sceneImageRequestIdRef.current;
    // Clear stale image immediately so previous clip art does not linger.
    setResolvedSceneImagePath(null);

    if (!sceneImagePath || !projectDirectory) {
      setResolvedSceneImagePath(null);
      setIsResolvingSceneImagePath(false);
      return;
    }

    setIsResolvingSceneImagePath(true);
    resolveAssetPathWithRetry(sceneImagePath, projectDirectory, {
      maxRetries: 3,
      retryDelayBase: 350,
      timeout: 5000,
      verifyExists: true,
    })
      .then((resolved) => {
        if (requestId !== sceneImageRequestIdRef.current) {
          return;
        }
        setResolvedSceneImagePath(resolved);
        setIsResolvingSceneImagePath(false);
      })
      .catch(() => {
        if (requestId !== sceneImageRequestIdRef.current) {
          return;
        }
        setResolvedSceneImagePath(null);
        setIsResolvingSceneImagePath(false);
      });
  }, [sceneImagePath, sceneClipIdentity, projectDirectory]);

  useEffect(() => {
    if (!activeOverlay?.videoPath || !projectDirectory) {
      setResolvedOverlayPath(null);
      return;
    }

    resolveAssetPathForDisplay(activeOverlay.videoPath, projectDirectory)
      .then((resolved) => {
        setResolvedOverlayPath(resolved);
      })
      .catch(() => {
        setResolvedOverlayPath(null);
      });
  }, [activeOverlay?.videoPath, activeOverlay?.id, projectDirectory]);

  // Handle video play/pause
  const handlePlayPause = useCallback(() => {
    const newPlayingState = !isPlaying;
    intendedPlaybackRef.current = newPlayingState;
    onPlaybackStateChange(newPlayingState);

    // Audio play/pause is handled by audio controller
  }, [isPlaying, onPlaybackStateChange]);

  // Keep a sparse event-based sync as a fallback; continuous playback uses rAF.
  const handleTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (!currentVideo || isSeekingRef.current || isDragging || isPlaying) {
        return;
      }
      const sourceOffset = currentVideo.sourceOffsetSeconds ?? 0;
      const videoTime = e.currentTarget.currentTime;
      const timelineTime = currentVideo.startTime + (videoTime - sourceOffset);
      safeSetPlaybackTime(timelineTime, true);
    },
    [currentVideo, isDragging, isPlaying, safeSetPlaybackTime],
  );

  // Native ended is used as a final safety net only; boundary transitions happen
  // from the timeline clock before the element fully ends.
  const handleVideoEnd = useCallback(() => {
    if (isDragging) return; // Don't auto-advance during dragging

    if (currentVideo) {
      transitionPlaybackToTime(currentVideo.endTime);
      return;
    }

    if (totalDuration > 0) {
      transitionPlaybackToTime(totalDuration);
    }
  }, [currentVideo, isDragging, totalDuration, transitionPlaybackToTime]);

  // Handle seek - find which item and position
  const handleSeek = useCallback(
    (seekTime: number) => {
      isSeekingRef.current = true;

      // During dragging, only update playback time, don't switch items
      // Item switching will happen when drag ends
      if (isDragging) {
        safeSetPlaybackTime(seekTime, true);
        // Still seek within current video if possible
        if (videoRef.current && currentVideo) {
          const sourceOffset = currentVideo.sourceOffsetSeconds ?? 0;
          const videoTime = sourceOffset + (seekTime - currentVideo.startTime);
          if (
            videoTime >= sourceOffset &&
            videoTime <= sourceOffset + currentVideo.duration
          ) {
            videoRef.current.currentTime = videoTime;
          }
        }
        // Audio position is managed by timeline-driven sync, not scene logic
        setTimeout(() => {
          isSeekingRef.current = false;
        }, 50);
        return;
      }

      // Normal seek (not dragging) - playback controller will handle item switching automatically
      // Just update playbackTime and let the controller determine which item should be active
      safeSetPlaybackTime(seekTime, true);

      // If seeking within the same video item, update video element directly
      if (currentVideo && videoRef.current) {
        const sourceOffset = currentVideo.sourceOffsetSeconds ?? 0;
        const videoTime = sourceOffset + (seekTime - currentVideo.startTime);
        if (
          videoTime >= sourceOffset &&
          videoTime <= sourceOffset + currentVideo.duration
        ) {
          videoRef.current.currentTime = videoTime;
        }
      }

      // Audio position is managed by timeline-driven sync, not scene logic

      // Clear seeking flag after a short delay
      setTimeout(() => {
        isSeekingRef.current = false;
      }, 50);
    },
    [
      timelineItems,
      currentItemIndex,
      totalDuration,
      safeSetPlaybackTime,
      isDragging,
      currentVideo,
    ],
  );

  // Handle seek bar input (for the range slider)
  const handleSeekBarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const seekTime = parseFloat(e.target.value);
      handleSeek(seekTime);
    },
    [handleSeek],
  );

  // Resolved video path state
  const [currentVideoPath, setCurrentVideoPath] = useState<string>('');
  const [isResolvingVideoPath, setIsResolvingVideoPath] = useState(false);
  const shouldShowVideo = Boolean(currentVideo && currentVideoPath);
  const shouldShowLoadingVideo = Boolean(
    currentVideo && !currentVideoPath && isResolvingVideoPath,
  );

  const activePromptText = useMemo(() => {
    if (!currentItem) return '';
    return sanitizePromptOverlayText(
      currentItem.expandedPrompt ?? currentItem.prompt ?? '',
    );
  }, [currentItem]);
  const shouldShowExpandedPrompt = useMemo(() => {
    if (!currentItem || !activePromptText) return false;

    if (currentItem.type === 'image') {
      return !resolvedSceneImagePath && !isResolvingSceneImagePath;
    }

    if (currentItem.type === 'video') {
      return !shouldShowVideo && !shouldShowLoadingVideo;
    }

    return true;
  }, [
    currentItem,
    activePromptText,
    resolvedSceneImagePath,
    isResolvingSceneImagePath,
    shouldShowVideo,
    shouldShowLoadingVideo,
  ]);

  // Construct version-specific path if active version is set (placement-based)
  const versionPath = useMemo(() => {
    if (!currentVideo) {
      debugRendererLog('[VideoLibraryView] No currentVideo for versionPath');
      return null;
    }

    debugRendererLog('[VideoLibraryView] Calculating versionPath:', {
      currentVideo: {
        label: currentVideo.label,
        placementNumber: currentVideo.placementNumber,
        videoPath: currentVideo.videoPath,
        startTime: currentVideo.startTime,
        endTime: currentVideo.endTime,
      },
    });

    const selectedPath = currentVideo.videoPath || null;
    if (!selectedPath) {
      debugRendererWarn(
        `[VideoLibraryView] No videoPath found for ${currentVideo.label}`,
      );
    }
    return selectedPath;
  }, [currentVideo]);

  // If versionPath is null but videoPath exists, use videoPath directly as fallback
  const effectiveVersionPath = useMemo(() => {
    if (versionPath) return versionPath;

    // Fallback: if versionPath is null but videoPath exists, use videoPath directly
    const fallbackPath = currentVideo?.videoPath;
    if (!versionPath && fallbackPath) {
      debugRendererWarn(
        '[VideoLibraryView] versionPath is null, using fallback videoPath:',
        fallbackPath,
      );
      return fallbackPath;
    }

    return versionPath;
  }, [versionPath, currentVideo]);

  useEffect(() => {
    setCurrentVideoPath('');
    setIsResolvingVideoPath(false);
    currentVideoPathRef.current = null;
    appliedClipIdentityRef.current = null;
    isVideoLoadingRef.current = false;
  }, [clipIdentity]);

  useEffect(() => {
    const preloadElement = nextVideoPreloadRef.current;
    if (
      !preloadElement ||
      !nextVideoItem ||
      !nextVideoItem.videoPath ||
      !projectDirectory
    ) {
      nextPreloadedClipIdentityRef.current = null;
      return;
    }

    if (
      !currentVideo ||
      !isPlaying ||
      isDragging ||
      currentVideo.endTime - playbackTime > 0.35
    ) {
      return;
    }

    const nextClipIdentity = `${nextVideoItem.id}:${nextVideoItem.startTime}:${nextVideoItem.endTime}:${nextVideoItem.sourceOffsetSeconds ?? 0}`;
    if (nextPreloadedClipIdentityRef.current === nextClipIdentity) {
      return;
    }

    resolveAssetPathForDisplay(nextVideoItem.videoPath, projectDirectory)
      .then((resolved) => {
        if (!resolved || !nextVideoPreloadRef.current) {
          return;
        }

        nextPreloadedClipIdentityRef.current = nextClipIdentity;
        nextVideoPreloadRef.current.src = resolved;
        nextVideoPreloadRef.current.preload = 'auto';
        nextVideoPreloadRef.current.load();
      })
      .catch(() => {
        nextPreloadedClipIdentityRef.current = null;
      });
  }, [
    nextVideoItem,
    projectDirectory,
    currentVideo,
    isPlaying,
    isDragging,
    playbackTime,
  ]);

  // Resolve video path when current video or version changes
  useEffect(() => {
    videoPathRequestIdRef.current += 1;
    const requestId = videoPathRequestIdRef.current;
    debugRendererLog('[VideoLibraryView] Resolving video path:', {
      effectiveVersionPath,
      versionPath,
      hasProjectDirectory: !!projectDirectory,
      requestId,
    });

    if (!effectiveVersionPath) {
      debugRendererLog(
        '[VideoLibraryView] No effectiveVersionPath, clearing currentVideoPath',
      );
      if (requestId === videoPathRequestIdRef.current) {
        setCurrentVideoPath('');
        setIsResolvingVideoPath(false);
      }
      return undefined;
    }

    setIsResolvingVideoPath(true);
    resolveAssetPathForDisplay(effectiveVersionPath, projectDirectory || null)
      .then((resolved) => {
        if (requestId !== videoPathRequestIdRef.current) {
          return undefined;
        }
        debugRendererLog('[VideoLibraryView] Video path resolved:', {
          effectiveVersionPath,
          resolved,
        });
        if (resolved && resolved.trim()) {
          setCurrentVideoPath(resolved);
        } else {
          debugRendererWarn(
            `[VideoLibraryView] Empty resolved path for: ${effectiveVersionPath}`,
          );
          setCurrentVideoPath('');
        }
        setIsResolvingVideoPath(false);
      })
      .catch((error) => {
        if (requestId !== videoPathRequestIdRef.current) {
          return undefined;
        }
        console.error(
          `[VideoLibraryView] Failed to resolve video path: ${effectiveVersionPath}`,
          error,
        );
        setCurrentVideoPath('');
        setIsResolvingVideoPath(false);
      });
  }, [effectiveVersionPath, projectDirectory]);

  // Update video source when current video changes
  // Don't switch videos during dragging - wait until drag ends
  useEffect(() => {
    debugRendererLog('[VideoLibraryView] Video source update effect:', {
      hasCurrentVideo: !!currentVideo,
      currentVideoLabel: currentVideo?.label,
      currentVideoPath,
      isDragging,
      hasVideoRef: !!videoRef.current,
    });

    if (!videoRef.current || isDragging) {
      debugRendererLog('[VideoLibraryView] Skipping video source update:', {
        hasCurrentVideo: !!currentVideo,
        hasVideoRef: !!videoRef.current,
        isDragging,
      });
      return undefined;
    }

    const videoElement = videoRef.current;
    const clearVideoSource = () => {
      videoElement.pause();
      videoElement.removeAttribute('src');
      videoElement.load();
      currentVideoPathRef.current = null;
      appliedClipIdentityRef.current = null;
      isVideoLoadingRef.current = false;
    };

    if (!currentVideo) {
      if (videoElement.src) {
        clearVideoSource();
      } else {
        currentVideoPathRef.current = null;
        appliedClipIdentityRef.current = null;
        isVideoLoadingRef.current = false;
      }
      return undefined;
    }

    // If path is empty, check if we need to clear existing video
    if (!currentVideoPath || !currentVideoPath.trim()) {
      if (videoElement.src) {
        clearVideoSource();
      } else {
        currentVideoPathRef.current = null;
        appliedClipIdentityRef.current = null;
        isVideoLoadingRef.current = false;
      }
      debugRendererLog(
        '[VideoLibraryView] Waiting for video path resolution:',
        {
          currentVideoLabel: currentVideo.label,
          currentVideoPath,
          hasExistingSrc: !!videoElement.src,
        },
      );
      return undefined;
    }

    const clipChanged = appliedClipIdentityRef.current !== clipIdentity;
    const pathChanged = currentVideoPathRef.current !== currentVideoPath;
    const srcMismatch = !doesVideoSourceMatch(
      videoElement.src,
      currentVideoPath,
    );
    const shouldApplySource = clipChanged || pathChanged || srcMismatch;
    if (!shouldApplySource) {
      return undefined;
    }

    debugRendererLog('[VideoLibraryView] Video source changing:', {
      from: currentVideoPathRef.current,
      to: currentVideoPath,
      currentVideoLabel: currentVideo.label,
      clipChanged,
      pathChanged,
      srcMismatch,
    });

    // Pause current video before changing source
    videoElement.pause();

    const handleError = () => {
      isVideoLoadingRef.current = false;
      const { error } = videoElement;
      if (error) {
        console.error(
          `[VideoLibraryView] Video error for ${currentVideo.label}:`,
          {
            code: error.code,
            message: error.message,
            path: currentVideoPath,
            effectiveVersionPath,
            videoPath: currentVideo.videoPath,
          },
        );

        // Try fallback: use videoPath directly if versionPath failed
        if (
          currentVideo.videoPath &&
          currentVideoPath !== currentVideo.videoPath
        ) {
          debugRendererLog(
            '[VideoLibraryView] Video load error, trying fallback path:',
            currentVideo.videoPath,
          );
          resolveAssetPathForDisplay(
            currentVideo.videoPath,
            projectDirectory || null,
          )
            .then((resolved) => {
              if (
                resolved &&
                resolved.trim() &&
                resolved !== currentVideoPath &&
                videoRef.current
              ) {
                debugRendererLog(
                  '[VideoLibraryView] Fallback path resolved successfully:',
                  resolved,
                );
                currentVideoPathRef.current = resolved;
                appliedClipIdentityRef.current = clipIdentity;
                isVideoLoadingRef.current = true;
                videoRef.current.src = resolved;
                videoRef.current.load();
              }
            })
            .catch((fallbackError) => {
              console.error(
                '[VideoLibraryView] Fallback path resolution also failed:',
                fallbackError,
              );
            });
        }
      }
    };

    const handleCanPlay = () => {
      isVideoLoadingRef.current = false;
      debugRendererLog(
        `[VideoLibraryView] Video can play: ${currentVideo.label}`,
      );
      // Seek to the correct position based on playbackTime
      const sourceOffset = currentVideo.sourceOffsetSeconds ?? 0;
      const timelinePlaybackTime =
        clipTransitionTimeRef.current ?? lastPlaybackTimeRef.current;
      const rawVideoTime =
        sourceOffset + (timelinePlaybackTime - currentVideo.startTime);
      const videoTime = getVisibleVideoTime({
        desiredTime: rawVideoTime,
        sourceOffset,
        clipDuration: currentVideo.duration,
      });
      if (
        videoTime >= sourceOffset &&
        videoTime < sourceOffset + currentVideo.duration
      ) {
        videoElement.currentTime = Math.max(0, videoTime);
      }
      clipTransitionTimeRef.current = null;
      // Resume only if shared playback state still intends to play.
      if (intendedPlaybackRef.current) {
        videoElement.play().catch((playError) => {
          console.warn(
            `[VideoLibraryView] Play error for ${currentVideo.label}:`,
            playError,
          );
        });
      }
      videoElement.removeEventListener('canplay', handleCanPlay);
    };

    const handleLoadedData = () => {
      isVideoLoadingRef.current = false;
      debugRendererLog(
        `[VideoLibraryView] Video loaded: ${currentVideo.label}`,
      );
      // Video is loaded, seek to correct position
      const sourceOffset = currentVideo.sourceOffsetSeconds ?? 0;
      const timelinePlaybackTime =
        clipTransitionTimeRef.current ?? lastPlaybackTimeRef.current;
      const rawVideoTime =
        sourceOffset + (timelinePlaybackTime - currentVideo.startTime);
      const videoTime = getVisibleVideoTime({
        desiredTime: rawVideoTime,
        sourceOffset,
        clipDuration: currentVideo.duration,
      });
      if (
        videoTime >= sourceOffset &&
        videoTime < sourceOffset + currentVideo.duration
      ) {
        videoElement.currentTime = Math.max(0, videoTime);
      }
      clipTransitionTimeRef.current = null;
      // Resume only if shared playback state still intends to play.
      if (intendedPlaybackRef.current) {
        videoElement.play().catch((playError) => {
          console.warn(
            `[VideoLibraryView] Play error for ${currentVideo.label}:`,
            playError,
          );
        });
      }
      videoElement.removeEventListener('loadeddata', handleLoadedData);
    };

    const handleLoadStart = () => {
      debugRendererLog(
        `[VideoLibraryView] Loading video: ${currentVideo.label} from ${currentVideoPath}`,
      );
      isVideoLoadingRef.current = true;
    };

    videoElement.addEventListener('error', handleError);
    videoElement.addEventListener('canplay', handleCanPlay);
    videoElement.addEventListener('loadeddata', handleLoadedData);
    videoElement.addEventListener('loadstart', handleLoadStart);

    debugRendererLog('[VideoLibraryView] Setting video element src:', {
      newSrc: currentVideoPath,
      oldSrc: videoElement.src,
      currentVideoLabel: currentVideo.label,
      intendsPlayback: intendedPlaybackRef.current,
    });
    currentVideoPathRef.current = currentVideoPath;
    appliedClipIdentityRef.current = clipIdentity;
    isVideoLoadingRef.current = true;
    videoElement.src = currentVideoPath;
    videoElement.muted = false;
    // Don't reset currentTime to 0 - let it be set by the loaded event handlers based on playbackTime
    videoElement.load();
    debugRendererLog(
      '[VideoLibraryView] Video element src set and load() called:',
      {
        src: videoElement.src,
        readyState: videoElement.readyState,
        networkState: videoElement.networkState,
      },
    );

    return () => {
      videoElement.removeEventListener('error', handleError);
      videoElement.removeEventListener('canplay', handleCanPlay);
      videoElement.removeEventListener('loadeddata', handleLoadedData);
      videoElement.removeEventListener('loadstart', handleLoadStart);
    };
  }, [
    currentVideo,
    currentVideoPath,
    clipIdentity,
    isDragging,
    effectiveVersionPath,
    projectDirectory,
  ]);

  // Item index is now managed by usePlaybackController
  // No boundary checking logic needed - TimeIndex handles all lookups
  // Log when currentItem changes for debugging
  useEffect(() => {
    if (currentItem) {
      debugRendererLog(
        '[VideoLibraryView] Current item from playback controller:',
        {
          itemIndex: currentItemIndex,
          itemType: currentItem.type,
          itemLabel: currentItem.label,
          playbackTime: playbackTime.toFixed(2),
          itemStartTime: currentItem.startTime.toFixed(2),
          itemEndTime: currentItem.endTime.toFixed(2),
        },
      );
    }
  }, [currentItem, currentItemIndex, playbackTime]);

  // Initialization is handled by playback controller
  // No manual initialization needed - controller determines currentItemIndex from playbackTime

  // Sync video playback with shared state
  useEffect(() => {
    if (!videoRef.current || !currentVideo || isDragging) return;

    const videoElement = videoRef.current;

    // Keep main preview video audio enabled.
    if (videoElement.muted) {
      videoElement.muted = false;
    }

    // Sync play/pause state
    if (isPlaying && videoElement.paused) {
      videoElement.play().catch(() => {
        // Ignore play errors
      });
    } else if (!isPlaying && !videoElement.paused) {
      videoElement.pause();
    }
  }, [isPlaying, currentVideo, isDragging]);

  // Continuous playback clock: prefer the active video element, then audio,
  // and finally a monotonic rAF fallback for still-only timelines.
  useEffect(() => {
    if (playbackAnimationFrameRef.current) {
      cancelAnimationFrame(playbackAnimationFrameRef.current);
      playbackAnimationFrameRef.current = null;
    }

    if (!isPlaying || isDragging) {
      playbackClockRef.current.lastTimestamp = null;
      return undefined;
    }

    const syncPlaybackClock = (timestamp: number) => {
      const videoElement = videoRef.current;
      const audioElement = audioRef.current;
      const hasReadyVideo =
        Boolean(currentVideo) &&
        Boolean(videoElement) &&
        !isVideoLoadingRef.current &&
        (videoElement?.readyState ?? 0) >= 2;

      if (hasReadyVideo && currentVideo && videoElement) {
        const sourceOffset = currentVideo.sourceOffsetSeconds ?? 0;
        const timelineTime =
          currentVideo.startTime + (videoElement.currentTime - sourceOffset);
        const boundedTime = Math.max(
          currentVideo.startTime,
          Math.min(timelineTime, currentVideo.endTime),
        );

        safeSetPlaybackTime(boundedTime, false);

        if (boundedTime >= currentVideo.endTime - 0.05) {
          transitionPlaybackToTime(currentVideo.endTime);
        }
      } else if (
        !currentVideo &&
        audioElement &&
        resolvedAudioPath &&
        audioElement.readyState >= 2
      ) {
        safeSetPlaybackTime(audioElement.currentTime, false);
      } else {
        const previousTimestamp = playbackClockRef.current.lastTimestamp;
        const deltaSeconds = previousTimestamp
          ? Math.max(0, (timestamp - previousTimestamp) / 1000)
          : 0;
        const nextTime =
          playbackClockRef.current.fallbackTimelineTime + deltaSeconds;
        playbackClockRef.current.fallbackTimelineTime = nextTime;
        safeSetPlaybackTime(nextTime, false);
      }

      playbackClockRef.current.lastTimestamp = timestamp;
      playbackAnimationFrameRef.current =
        requestAnimationFrame(syncPlaybackClock);
    };

    playbackAnimationFrameRef.current =
      requestAnimationFrame(syncPlaybackClock);

    return () => {
      if (playbackAnimationFrameRef.current) {
        cancelAnimationFrame(playbackAnimationFrameRef.current);
        playbackAnimationFrameRef.current = null;
      }
      playbackClockRef.current.lastTimestamp = null;
    };
  }, [
    isPlaying,
    isDragging,
    currentVideo,
    resolvedAudioPath,
    audioRef,
    safeSetPlaybackTime,
    transitionPlaybackToTime,
  ]);

  // Sync video position with playbackTime during seeks / drags / source changes.
  useEffect(() => {
    if (
      !videoRef.current ||
      !currentVideo ||
      isSeekingRef.current ||
      isDragging ||
      isVideoLoadingRef.current ||
      clipTransitionTimeRef.current !== null
    ) {
      return;
    }

    const videoElement = videoRef.current;

    // Don't sync if video is not ready (still loading)
    if (videoElement.readyState < 2) {
      return;
    }

    const sourceOffset = currentVideo.sourceOffsetSeconds ?? 0;
    const expectedVideoTime =
      sourceOffset + (playbackTime - currentVideo.startTime);

    // Only update if there's a significant difference to avoid jitter
    // Also ensure we're within valid bounds
    if (
      expectedVideoTime >= sourceOffset &&
      expectedVideoTime <= sourceOffset + currentVideo.duration &&
      Math.abs(videoElement.currentTime - expectedVideoTime) > 0.2
    ) {
      videoElement.currentTime = Math.max(0, expectedVideoTime);
    }
  }, [playbackTime, currentVideo, isDragging]);

  // Load overlay video source when available
  useEffect(() => {
    const overlayElement = overlayVideoRef.current;
    if (!overlayElement) return;

    if (!resolvedOverlayPath || !activeOverlay) {
      overlayElement.removeAttribute('src');
      overlayElement.load();
      return;
    }

    overlayElement.src = resolvedOverlayPath;
    overlayElement.muted = true;
    overlayElement.load();
  }, [resolvedOverlayPath, activeOverlay?.id]);

  // Sync overlay play/pause state
  useEffect(() => {
    const overlayElement = overlayVideoRef.current;
    if (!overlayElement || !activeOverlay || isDragging) return;

    if (isPlaying && overlayElement.paused) {
      overlayElement.play().catch(() => {
        // Ignore play errors
      });
    } else if (!isPlaying && !overlayElement.paused) {
      overlayElement.pause();
    }
  }, [isPlaying, activeOverlay, isDragging]);

  // Sync overlay position with playbackTime
  useEffect(() => {
    const overlayElement = overlayVideoRef.current;
    if (!overlayElement || !activeOverlay || isDragging) return;

    if (overlayElement.readyState < 2) {
      return;
    }

    const expectedOverlayTime = playbackTime - activeOverlay.startTime;
    if (
      expectedOverlayTime >= 0 &&
      expectedOverlayTime <= activeOverlay.duration &&
      Math.abs(overlayElement.currentTime - expectedOverlayTime) > 0.2
    ) {
      overlayElement.currentTime = Math.max(0, expectedOverlayTime);
    }
  }, [playbackTime, activeOverlay, isDragging]);

  // Audio management is now handled by useAudioController hook

  // Keep lastPlaybackTimeRef updated when playbackTime changes from external source
  useEffect(() => {
    // Update the ref to track the current playback time
    // This ensures the ref is always in sync with the prop
    lastPlaybackTimeRef.current = playbackTime;
  }, [playbackTime]);

  useEffect(() => {
    if (!isPlaying || isDragging || isSeekingRef.current) {
      return;
    }

    if (totalDuration > 0 && playbackTime >= totalDuration - 0.001) {
      transitionPlaybackToTime(totalDuration);
      return;
    }

    if (!currentItem) {
      return;
    }

    const epsilon = currentVideo ? 0.05 : 0.01;
    if (playbackTime >= currentItem.endTime - epsilon) {
      transitionPlaybackToTime(currentItem.endTime);
    }
  }, [
    currentItem,
    currentVideo,
    isDragging,
    isPlaying,
    playbackTime,
    totalDuration,
    transitionPlaybackToTime,
  ]);

  // Auto-advance is handled by playback controller
  // When playbackTime advances, controller automatically determines which item should be active
  // No manual auto-advance logic needed

  // Helper: resolve timeline items + overlays for export (shared by all export handlers)
  const resolveExportData = useCallback(async () => {
    if (!projectDirectory || timelineItems.length === 0) return null;

    const audioItems = timelineItems.filter((item) => item.type === 'audio');
    let resolvedAudioPath: string | null = null;
    if (audioItems.length > 0 && audioItems[0]?.audioPath) {
      try {
        const displayPath = await resolveAssetPathForDisplay(
          audioItems[0].audioPath,
          projectDirectory,
        );
        resolvedAudioPath = normalizePathForExport(displayPath);
      } catch (error) {
        console.warn('[Export] Failed to resolve audio path:', error);
      }
    }

    const exportItemResults = await Promise.all(
      timelineItems
        .filter((item) => item.type !== 'audio' && item.type !== 'text_overlay')
        .map(async (item) => {
          let resolvedPath = '';
          try {
            if (
              (item.type === 'video' || item.type === 'infographic') &&
              item.videoPath
            ) {
              resolvedPath = await resolveAssetPathForDisplay(
                item.videoPath,
                projectDirectory,
              );
            } else if (item.type === 'image' && item.imagePath) {
              resolvedPath = await resolveAssetPathForDisplay(
                item.imagePath,
                projectDirectory,
              );
            }
          } catch (error) {
            console.warn(
              `[Export] Failed to resolve media path for ${item.label}:`,
              error,
            );
          }

          const fallbackPath = item.videoPath || item.imagePath || '';
          const exportItem = buildTimelineExportItem(
            item,
            resolvedPath,
            fallbackPath,
          );

          if (exportItem.usedPlaceholderForMissingMedia) {
            console.warn(
              `[Export] Missing media for ${item.label}; using placeholder segment for ${item.startTime.toFixed(2)}-${item.endTime.toFixed(2)}s`,
            );
          }

          return {
            item,
            exportItem,
          };
        }),
    );
    const itemsData = exportItemResults.map(({ exportItem }) => ({
      type: exportItem.type,
      path: exportItem.path,
      duration: exportItem.duration,
      startTime: exportItem.startTime,
      endTime: exportItem.endTime,
      sourceOffsetSeconds: exportItem.sourceOffsetSeconds,
      label: exportItem.label,
    }));

    const overlayItemsWithPaths = await Promise.all(
      overlayItems.map(async (item) => {
        let resolvedPath = '';
        try {
          if (item.videoPath) {
            resolvedPath = await resolveAssetPathForDisplay(
              item.videoPath,
              projectDirectory,
            );
          }
        } catch (error) {
          console.warn(
            `[Export] Failed to resolve overlay path for ${item.label}:`,
            error,
          );
        }
        return {
          path: (resolvedPath || item.videoPath || '').trim(),
          duration: item.duration,
          startTime: item.startTime,
          endTime: item.endTime,
          label: item.label,
        };
      }),
    );
    const overlayItemsData = overlayItemsWithPaths.filter(
      (item) => item.path.length > 0,
    );

    const promptOverlayCues = buildPromptOverlayCues(
      exportItemResults
        .filter(({ item }) => item.type === 'image' || item.type === 'video')
        .map(({ item, exportItem }) => ({
          id: item.id,
          type: item.type,
          startTime: item.startTime,
          endTime: item.endTime,
          expandedPrompt: item.expandedPrompt,
          prompt: item.prompt,
          hasRenderableMedia: !exportItem.usedPlaceholderForMissingMedia,
        })),
    );

    return {
      itemsData,
      resolvedAudioPath,
      overlayItemsData,
      promptOverlayCues,
    };
  }, [projectDirectory, timelineItems, overlayItems]);

  const handleOpenExportChooser = useCallback(() => {
    if (
      !projectDirectory ||
      timelineItems.length === 0 ||
      isDownloading ||
      isExporting
    ) {
      return;
    }

    setExportAspectRatio(null);
    setExportQuality(null);
    setShowExportMenu(true);
  }, [isDownloading, isExporting, projectDirectory, timelineItems.length]);

  // Handle video download
  const handleDownloadVideo = useCallback(
    async (options: ExportRenderOptions) => {
      if (!projectDirectory || timelineItems.length === 0 || isDownloading) {
        return;
      }

      setIsDownloading(true);
      setShowExportMenu(false);

      try {
        console.log('[VideoDownload] Starting video download process...');
        const data = await resolveExportData();
        if (!data || data.itemsData.length === 0) {
          alert('No valid timeline items found for export.');
          return;
        }

        const composeVideo = window.electron.project.composeTimelineVideo as (
          timelineItems: Array<{
            type: 'image' | 'video' | 'placeholder';
            path: string;
            duration: number;
            startTime: number;
            endTime: number;
            sourceOffsetSeconds?: number;
            label?: string;
          }>,
          projectDirectory: string,
          audioPath?: string,
          overlayItems?: Array<{
            path: string;
            duration: number;
            startTime: number;
            endTime: number;
          }>,
          promptOverlayCues?: PromptOverlayCue[],
          exportOptions?: ExportRenderOptions,
        ) => Promise<{ success: boolean; outputPath?: string; error?: string }>;

        const result = await composeVideo(
          data.itemsData,
          projectDirectory,
          data.resolvedAudioPath || undefined,
          data.overlayItemsData,
          data.promptOverlayCues,
          options,
        );

        if (!result.success) {
          alert(`Failed to compose video: ${result.error || 'Unknown error'}`);
          return;
        }
        if (!result.outputPath) {
          alert('Video composition completed but no output path was returned');
          return;
        }

        const savePath = await window.electron.project.saveVideoFile();
        if (!savePath) {
          return;
        }

        const normalizedSavePath = savePath.replace(/\\/g, '/');
        const lastSlash = normalizedSavePath.lastIndexOf('/');
        const saveDir =
          lastSlash >= 0 ? normalizedSavePath.substring(0, lastSlash) : '';
        const saveFileName =
          lastSlash >= 0
            ? normalizedSavePath.substring(lastSlash + 1)
            : normalizedSavePath;

        const copiedPath = await window.electron.project.copy(
          result.outputPath,
          saveDir,
        );

        const normalizedCopiedPath = copiedPath.replace(/\\/g, '/');
        const copiedFileName = normalizedCopiedPath.substring(
          normalizedCopiedPath.lastIndexOf('/') + 1,
        );

        if (copiedFileName !== saveFileName) {
          await window.electron.project.rename(copiedPath, saveFileName);
        }

        alert('Video downloaded successfully!');
      } catch (error) {
        console.error('Error downloading video:', error);
        alert(
          `Failed to download video: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      } finally {
        setIsDownloading(false);
      }
    },
    [projectDirectory, timelineItems, isDownloading, resolveExportData],
  );

  // Close export menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(event.target as Node)
      ) {
        setShowExportMenu(false);
      }
    }
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  // Handle CapCut export
  const handleExportCapcut = useCallback(async () => {
    if (!projectDirectory || timelineItems.length === 0 || isExporting) return;
    setIsExporting(true);
    setShowExportMenu(false);
    try {
      console.log('[Export:CapCut] Starting CapCut export...');
      const data = await resolveExportData();
      if (!data || data.itemsData.length === 0) {
        alert('No valid timeline items found for export.');
        return;
      }

      const exportFn = window.electron.project.exportCapcut as (
        timelineItems: Array<{
          type: 'image' | 'video' | 'placeholder';
          path: string;
          duration: number;
          startTime: number;
          endTime: number;
          sourceOffsetSeconds?: number;
          label?: string;
        }>,
        projectDirectory: string,
        audioPath?: string,
        overlayItems?: Array<{
          path: string;
          duration: number;
          startTime: number;
          endTime: number;
          label?: string;
        }>,
        promptOverlayCues?: PromptOverlayCue[],
      ) => Promise<{ success: boolean; outputPath?: string; error?: string }>;

      const result = await exportFn(
        data.itemsData,
        projectDirectory,
        data.resolvedAudioPath || undefined,
        data.overlayItemsData,
        data.promptOverlayCues || undefined,
      );

      if (result.error === 'cancelled') return;
      if (!result.success) {
        alert(
          `Failed to export CapCut project: ${result.error || 'Unknown error'}`,
        );
        return;
      }
      alert(
        'CapCut project exported successfully! You can now open it in CapCut.',
      );
    } catch (error) {
      console.error('[Export:CapCut] Error:', error);
      alert(
        `Failed to export CapCut project: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    } finally {
      setIsExporting(false);
    }
  }, [projectDirectory, timelineItems, isExporting, resolveExportData]);

  const handleConfirmMp4Export = useCallback(() => {
    if (!exportAspectRatio || !exportQuality) {
      return;
    }

    void handleDownloadVideo({
      aspectRatio: exportAspectRatio,
      quality: exportQuality,
    });
  }, [exportAspectRatio, exportQuality, handleDownloadVideo]);

  // Show empty state if no project
  if (!projectDirectory) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <Film size={48} className={styles.emptyIcon} />
          <h3>No Project Open</h3>
          <p>Open a project to view the video library</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading video library...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Film size={16} />
          <h3>Video Library</h3>
          <span className={styles.count}>{videoArtifacts.length}</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.exportDropdownWrapper} ref={exportMenuRef}>
            <button
              type="button"
              className={styles.downloadButton}
              onClick={handleOpenExportChooser}
              disabled={
                isDownloading || isExporting || timelineItems.length === 0
              }
              title="Choose export settings and download MP4"
            >
              <Download size={16} />
              {isDownloading
                ? 'Composing...'
                : isExporting
                  ? 'Exporting...'
                  : 'Download'}
            </button>
            {showExportMenu && (
              <div className={styles.exportDropdownMenu}>
                <div className={styles.exportSection}>
                  <div className={styles.exportSectionTitle}>Export MP4</div>
                  <div className={styles.exportOptionGroup}>
                    <span className={styles.exportOptionLabel}>
                      Aspect ratio
                    </span>
                    <div className={styles.exportOptionRow}>
                      <button
                        type="button"
                        className={`${styles.choiceChip} ${exportAspectRatio === '16:9' ? styles.choiceChipActive : ''}`}
                        onClick={() => setExportAspectRatio('16:9')}
                        disabled={isDownloading || isExporting}
                      >
                        16:9
                      </button>
                      <button
                        type="button"
                        className={`${styles.choiceChip} ${exportAspectRatio === '9:16' ? styles.choiceChipActive : ''}`}
                        onClick={() => setExportAspectRatio('9:16')}
                        disabled={isDownloading || isExporting}
                      >
                        9:16
                      </button>
                    </div>
                  </div>
                  <div className={styles.exportOptionGroup}>
                    <span className={styles.exportOptionLabel}>Quality</span>
                    <div className={styles.exportOptionRow}>
                      <button
                        type="button"
                        className={`${styles.choiceChip} ${exportQuality === 'standard' ? styles.choiceChipActive : ''}`}
                        onClick={() => setExportQuality('standard')}
                        disabled={isDownloading || isExporting}
                      >
                        Standard
                      </button>
                      <button
                        type="button"
                        className={`${styles.choiceChip} ${exportQuality === 'high' ? styles.choiceChipActive : ''}`}
                        onClick={() => setExportQuality('high')}
                        disabled={isDownloading || isExporting}
                      >
                        High
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.exportConfirmButton}
                    onClick={handleConfirmMp4Export}
                    disabled={
                      isDownloading ||
                      isExporting ||
                      exportAspectRatio === null ||
                      exportQuality === null
                    }
                  >
                    <Download size={14} />
                    Export MP4
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.exportDropdownItem}
                  onClick={handleExportCapcut}
                  disabled={isDownloading || isExporting}
                >
                  <Download size={14} />
                  Export as CapCut Project
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* Left Sidebar - Video Grid */}
        <div className={styles.sidebar}>
          {finalVideoWarning ? (
            <div className={styles.warningBanner}>{finalVideoWarning}</div>
          ) : null}
          {videoArtifacts.length === 0 ? (
            <div className={styles.emptyState}>
              <Film size={32} className={styles.emptyIcon} />
              <p>No videos available</p>
              <p className={styles.emptySubtext}>
                Videos will appear here once they are generated or imported
              </p>
            </div>
          ) : (
            <div className={styles.videoGrid}>
              {videoArtifacts.map((artifact) => (
                <VideoCard
                  key={artifact.artifact_id}
                  artifact={artifact}
                  formatDate={formatDate}
                  projectDirectory={projectDirectory || null}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right Side - Timeline Preview */}
        <div className={styles.playerSection}>
          {timelineItems.length > 0 ? (
            <div className={styles.videoPlayer}>
              <video
                ref={videoRef}
                className={`${styles.playerVideo} ${
                  shouldShowVideo ? '' : styles.videoHidden
                }`}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleVideoEnd}
                onError={(e) => {
                  if (!currentVideo) return;
                  const video = e.currentTarget;
                  const { error } = video;
                  if (error) {
                    console.error(`[VideoLibraryView] Video element error:`, {
                      code: error.code,
                      message: error.message,
                      path: currentVideoPath,
                      label: currentVideo.label,
                    });
                    // Try fallback: use videoPath directly if versionPath failed
                    if (
                      currentVideo.videoPath &&
                      currentVideoPath !== currentVideo.videoPath
                    ) {
                      console.log(
                        '[VideoLibraryView] Video load error, will try fallback path:',
                        currentVideo.videoPath,
                      );
                    }
                  }
                }}
                preload="auto"
                playsInline
              />

              {!shouldShowVideo && shouldShowLoadingVideo && (
                <div className={styles.videoPlaceholder}>
                  <Film size={48} className={styles.videoPlaceholderIcon} />
                  <p>Loading video...</p>
                  <p className={styles.videoPlaceholderSubtext}>
                    {currentVideo?.label}
                  </p>
                </div>
              )}

              {!shouldShowVideo && !shouldShowLoadingVideo && (
                <>
                  {currentVideo ? (
                    <div className={styles.videoUnavailablePlaceholder}>
                      <Film size={48} className={styles.videoPlaceholderIcon} />
                      <p>Video unavailable</p>
                      <p className={styles.videoPlaceholderSubtext}>
                        Missing media for {currentVideo.label}
                      </p>
                    </div>
                  ) : (
                    <div className={styles.scenePlaceholder}>
                      {resolvedSceneImagePath && (
                        <img
                          src={resolvedSceneImagePath}
                          alt={currentItem?.label || 'Scene preview'}
                          className={styles.playerImage}
                        />
                      )}
                      {currentItem &&
                        (currentItem.type === 'image' ||
                          currentItem.type === 'placeholder') &&
                        !resolvedSceneImagePath && (
                          <div className={styles.scenePlaceholderContent}>
                            <Film
                              size={64}
                              className={styles.scenePlaceholderIcon}
                            />
                            <h3>{currentItem.label}</h3>
                          </div>
                        )}
                    </div>
                  )}
                </>
              )}

              {!shouldShowVideo && activeOverlay && resolvedOverlayPath && (
                <video
                  ref={overlayVideoRef}
                  className={styles.overlayVideo}
                  preload="auto"
                  playsInline
                  muted
                  aria-hidden
                />
              )}

              {currentVideo && (
                <div className={styles.currentVideoLabel}>
                  {currentVideo.label}
                </div>
              )}
              {shouldShowExpandedPrompt && (
                <div className={styles.expandedPromptOverlay}>
                  <div className={styles.expandedPromptHeader}>
                    {currentItem?.label || 'Prompt'}
                  </div>
                  <div className={styles.expandedPromptText}>
                    {activePromptText}
                  </div>
                </div>
              )}
              <div className={styles.watermarkOverlay} aria-hidden>
                {PREVIEW_WATERMARK_TEXT}
              </div>
              <div className={styles.playerControls}>
                <button
                  type="button"
                  className={styles.playPauseButton}
                  onClick={handlePlayPause}
                  aria-label={
                    isPlaying
                      ? 'Pause timeline preview'
                      : 'Play timeline preview'
                  }
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <div className={styles.timeDisplay}>
                  {formatTime(playbackTime)} / {formatTime(totalDuration)}
                </div>
                <input
                  type="range"
                  min="0"
                  max={totalDuration || 0}
                  value={playbackTime}
                  onChange={handleSeekBarChange}
                  className={styles.seekBar}
                />
              </div>
            </div>
          ) : null}

          {/* Placement info panel - show when currentItem exists and NOT playing video */}
          {currentItem && (!currentVideo || currentItem.type !== 'video') ? (
            <div className={styles.sceneInfoPanelCompact}>
              {currentItem.type === 'placeholder' ? (
                <div className={styles.sceneMetadataCompact}>
                  <span className={styles.sceneTitleCompact}>
                    {currentItem.label}
                  </span>
                  <span className={styles.sceneMetaCompact}>
                    {currentItem.startTime.toFixed(1)}s -{' '}
                    {currentItem.endTime.toFixed(1)}s
                  </span>
                </div>
              ) : (
                <div className={styles.sceneMetadataCompact}>
                  <span className={styles.sceneTitleCompact}>
                    {currentItem.label}
                    {currentItem.placementNumber && (
                      <span className={styles.sceneName}>
                        {' '}
                        (Placement {currentItem.placementNumber})
                      </span>
                    )}
                  </span>
                  <span className={styles.sceneMetaCompact}>
                    {currentItem.startTime.toFixed(1)}s -{' '}
                    {currentItem.endTime.toFixed(1)}s
                  </span>
                </div>
              )}
            </div>
          ) : timelineItems.length === 0 ? (
            /* Empty state - only show if no scene and no items in timeline */
            <div className={styles.emptyPlayer}>
              <Film size={48} className={styles.emptyPlayerIcon} />
              <p>
                {isTimelineLoading
                  ? 'Loading local timeline...'
                  : isTimelinePending
                    ? 'Timeline is being prepared'
                    : timelineError || 'No items in timeline'}
              </p>
              <p className={styles.emptySubtext}>
                {isTimelineLoading
                  ? 'Preview will appear here as soon as the local timeline is ready.'
                  : isTimelinePending
                    ? 'Preview will appear here once timeline generation completes'
                    : timelineError ||
                      'Add videos or scenes to the timeline to preview them here'}
              </p>
            </div>
          ) : null}

          {/* Hidden audio element for playback - managed by useAudioController */}
          {/* Always render with stable key to prevent React from recreating it */}
          <audio
            ref={audioRef}
            key="timeline-audio"
            preload="auto"
            style={{ display: 'none' }}
          />
          <video
            ref={nextVideoPreloadRef}
            preload="auto"
            muted
            playsInline
            style={{ display: 'none' }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
