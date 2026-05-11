/**
 * useAudioController Hook
 * Imperative audio management to prevent React re-render interference
 * Uses requestAnimationFrame for smooth position sync
 */

import { useRef, useEffect, useCallback } from 'react';
import { debugRendererLog } from '../utils/debugLogger';

export interface AudioControllerOptions {
  playbackTime: number;
  isPlaying: boolean;
  audioFile: { path: string; duration: number } | null;
  resolvedAudioPath: string | null;
  projectDirectory: string | null;
  isDragging?: boolean;
  isSeeking?: boolean | (() => boolean); // Can be boolean or function to get current state
  onPlaybackStateChange?: (playing: boolean) => void;
  currentVideoItem?: { endTime: number } | null; // Current video placement end time
}

export interface AudioController {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isInitialized: boolean;
}

/**
 * Normalize path for comparison (extract filename from URL or path)
 */
function normalizePathForComparison(path: string | null): string | null {
  if (!path) return null;

  // If it's a URL, extract the filename
  if (
    path.startsWith('file://') ||
    path.startsWith('http://') ||
    path.startsWith('https://')
  ) {
    const url = new URL(path);
    return url.pathname.split('/').pop() || null;
  }

  // If it's a relative path, extract the filename
  return path.replace(/\\/g, '/').split('/').pop() || null;
}

/**
 * Compare two paths by filename (handles URL vs relative path)
 */
function pathsMatch(path1: string | null, path2: string | null): boolean {
  if (!path1 || !path2) return false;

  const normalized1 = normalizePathForComparison(path1);
  const normalized2 = normalizePathForComparison(path2);

  return normalized1 === normalized2 && normalized1 !== null;
}

export function useAudioController(
  options: AudioControllerOptions,
): AudioController {
  const {
    playbackTime,
    isPlaying,
    audioFile,
    resolvedAudioPath,
    isDragging = false,
    isSeeking = false,
    onPlaybackStateChange,
    currentVideoItem,
  } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioPathRef = useRef<string | null>(null);
  const syncAnimationFrameRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);
  const lastPlaybackTimeRef = useRef(0);
  const isTransitioningRef = useRef(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const preservedTimeRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const playbackTimeRef = useRef(playbackTime);

  // Initialize audio element once
  useEffect(() => {
    if (!audioRef.current) return;

    const audioElement = audioRef.current;

    // Set initial properties
    audioElement.volume = 1.0;
    audioElement.preload = 'auto';

    // Error handler
    const handleError = () => {
      const { error } = audioElement;
      if (error) {
        console.error('[useAudioController] Audio error:', {
          code: error.code,
          message: error.message,
          src: audioElement.src,
        });
      }
    };

    // Mark as initialized when metadata loads
    const handleLoadedMetadata = () => {
      debugRendererLog('[useAudioController] Audio metadata loaded');
      isInitializedRef.current = true;
    };

    audioElement.addEventListener('error', handleError);
    audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audioElement.removeEventListener('error', handleError);
      audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, []); // Run once on mount

  // Keep playbackTimeRef updated (for use in animation loop without re-creating it)
  useEffect(() => {
    playbackTimeRef.current = playbackTime;
  }, [playbackTime]);

  // Handle audio source changes (imperative, not reactive)
  useEffect(() => {
    if (!audioRef.current || !resolvedAudioPath) {
      if (!resolvedAudioPath) {
        isInitializedRef.current = false;
        currentAudioPathRef.current = null;
      }
      return;
    }

    if (isDragging) return; // Don't update during drag

    const audioElement = audioRef.current;

    // Check if source actually changed (compare normalized paths)
    const currentSrc = audioElement.src || '';
    if (
      currentAudioPathRef.current === resolvedAudioPath &&
      pathsMatch(currentSrc, resolvedAudioPath)
    ) {
      // Same file, no reload needed
      if (!isInitializedRef.current && audioElement.readyState >= 1) {
        isInitializedRef.current = true;
      }
      return;
    }

    debugRendererLog('[useAudioController] Audio source changing:', {
      from: currentAudioPathRef.current,
      to: resolvedAudioPath,
      currentSrc: currentSrc.substring(0, 100),
    });

    // Preserve playback state before reload
    wasPlayingRef.current = !audioElement.paused;
    preservedTimeRef.current = isInitializedRef.current
      ? audioElement.currentTime
      : 0;

    // Mark as transitioning to prevent sync during reload
    isTransitioningRef.current = true;
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    currentAudioPathRef.current = resolvedAudioPath;
    audioElement.pause();
    audioElement.src = resolvedAudioPath;
    audioElement.volume = 1.0;
    isInitializedRef.current = false;

    // Restore playback state after load completes
    const handleCanPlay = () => {
      debugRendererLog(
        '[useAudioController] Audio can play, restoring position:',
        preservedTimeRef.current,
      );

      // Restore position if we had a previous position
      if (preservedTimeRef.current > 0) {
        audioElement.currentTime = preservedTimeRef.current;
      }

      isInitializedRef.current = true;

      // Resume playback if it was playing
      if (wasPlayingRef.current && isPlaying) {
        audioElement.play().catch((error) => {
          console.warn(
            '[useAudioController] Audio play error after load:',
            error,
          );
        });
      }

      // Clear transition flag after a short delay
      transitionTimeoutRef.current = setTimeout(() => {
        isTransitioningRef.current = false;
        transitionTimeoutRef.current = null;
      }, 100);

      audioElement.removeEventListener('canplay', handleCanPlay);
    };

    audioElement.addEventListener('canplay', handleCanPlay);
    audioElement.load();

    return () => {
      audioElement.removeEventListener('canplay', handleCanPlay);
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, [resolvedAudioPath, isPlaying, isDragging]);

  // Handle play/pause commands (imperative)
  useEffect(() => {
    if (!audioRef.current || !audioFile || !resolvedAudioPath || isDragging)
      return;
    if (!isInitializedRef.current) return; // Don't control until initialized

    const audioElement = audioRef.current;

    // Ensure volume is set
    if (audioElement.volume !== 1.0) {
      audioElement.volume = 1.0;
    }

    // Sync play/pause state from timeline clock
    if (isPlaying && audioElement.paused) {
      audioElement.play().catch((error) => {
        console.warn(
          '[useAudioController] Audio play error during sync:',
          error,
        );
      });
    } else if (!isPlaying && !audioElement.paused) {
      audioElement.pause();
    }
  }, [isPlaying, audioFile, resolvedAudioPath, isDragging]);

  // Position sync via requestAnimationFrame (smooth, 60fps)
  useEffect(() => {
    if (!audioRef.current || !audioFile || !resolvedAudioPath) {
      // Stop sync loop if audio not available
      if (syncAnimationFrameRef.current) {
        cancelAnimationFrame(syncAnimationFrameRef.current);
        syncAnimationFrameRef.current = null;
      }
      return;
    }

    const audioElement = audioRef.current;

    // Sync function that runs in animation frame loop
    const syncPosition = () => {
      // Get current seeking state (handle both boolean and function)
      const currentIsSeeking =
        typeof isSeeking === 'function' ? isSeeking() : isSeeking;

      // Skip sync during transitions, seeking, dragging, or if not initialized
      if (
        isTransitioningRef.current ||
        currentIsSeeking ||
        isDragging ||
        !isInitializedRef.current ||
        audioElement.readyState < 2 // HAVE_CURRENT_DATA
      ) {
        syncAnimationFrameRef.current = requestAnimationFrame(syncPosition);
        return;
      }

      // Verify audio element src matches (normalized comparison)
      const currentSrc = audioElement.src || '';
      if (!pathsMatch(currentSrc, resolvedAudioPath)) {
        syncAnimationFrameRef.current = requestAnimationFrame(syncPosition);
        return;
      }

      // Direct timeline-to-audio mapping
      // Read from ref instead of prop to prevent loop recreation on every change
      const expectedAudioTime = playbackTimeRef.current;
      const currentAudioTime = audioElement.currentTime;
      const difference = Math.abs(currentAudioTime - expectedAudioTime);

      // Only sync if difference exceeds threshold (prevent jitter)
      // Don't reset to 0 if audio is playing
      if (difference > 0.2 && expectedAudioTime > 0) {
        // Use the HTML element's native duration as fallback when metadata duration is 0
        const effectiveDuration =
          audioFile.duration ||
          (Number.isFinite(audioElement.duration) ? audioElement.duration : 0);
        const clampedTime =
          effectiveDuration > 0
            ? Math.max(0, Math.min(expectedAudioTime, effectiveDuration))
            : expectedAudioTime;

        // Only update if clamped time is different from current
        if (Math.abs(audioElement.currentTime - clampedTime) > 0.1) {
          debugRendererLog('[useAudioController] Syncing audio position:', {
            current: currentAudioTime.toFixed(2),
            expected: expectedAudioTime.toFixed(2),
            clamped: clampedTime.toFixed(2),
            difference: difference.toFixed(2),
          });
          audioElement.currentTime = clampedTime;
        }
      }

      lastPlaybackTimeRef.current = playbackTimeRef.current;
      syncAnimationFrameRef.current = requestAnimationFrame(syncPosition);
    };

    // Start sync loop
    syncAnimationFrameRef.current = requestAnimationFrame(syncPosition);

    // Cleanup: stop sync loop on unmount or when dependencies change
    return () => {
      if (syncAnimationFrameRef.current) {
        cancelAnimationFrame(syncAnimationFrameRef.current);
        syncAnimationFrameRef.current = null;
      }
    };
  }, [audioFile, resolvedAudioPath, isDragging, isSeeking]); // Removed playbackTime from dependencies

  // Handle audio end event
  useEffect(() => {
    if (!audioRef.current || !audioFile) return;

    const audioElement = audioRef.current;

    const handleEnded = () => {
      const currentPlaybackTime = playbackTimeRef.current;
      const nativeDur = audioElement.duration;
      const effectiveDuration =
        audioFile.duration || (Number.isFinite(nativeDur) ? nativeDur : 0);

      const videoEndTime = currentVideoItem?.endTime;
      const shouldStop = videoEndTime
        ? currentPlaybackTime >= Math.max(effectiveDuration, videoEndTime)
        : effectiveDuration > 0 && currentPlaybackTime >= effectiveDuration;

      // Only pause playback if we're past both audio duration AND video end time (if video exists)
      if (shouldStop && onPlaybackStateChange) {
        onPlaybackStateChange(false);
      }
    };

    audioElement.addEventListener('ended', handleEnded);

    return () => {
      audioElement.removeEventListener('ended', handleEnded);
    };
  }, [audioFile, playbackTime, onPlaybackStateChange, currentVideoItem]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncAnimationFrameRef.current) {
        cancelAnimationFrame(syncAnimationFrameRef.current);
        syncAnimationFrameRef.current = null;
      }
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    audioRef,
    isInitialized: isInitializedRef.current,
  };
}
