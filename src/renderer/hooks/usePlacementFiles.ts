/**
 * Hook to read and watch placement markdown files
 * Watches for changes to image-placements.md and video-placements.md
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import {
  parseImagePlacementsWithErrors,
  parseVideoPlacements,
  type ParsedImagePlacement,
  type ParsedVideoPlacement,
} from '../utils/placementParsers';

interface PlacementFilesState {
  imagePlacements: ParsedImagePlacement[];
  videoPlacements: ParsedVideoPlacement[];
  isLoading: boolean;
  error: string | null;
}

function serializePlacementList(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '__serialize_error__';
  }
}

/**
 * Hook to read and watch placement markdown files
 * Automatically reloads when files change (debounced)
 */
export function usePlacementFiles(
  refreshToken?: number,
): PlacementFilesState {
  const { projectDirectory } = useWorkspace();
  const [state, setState] = useState<PlacementFilesState>({
    imagePlacements: [],
    videoPlacements: [],
    isLoading: true,
    error: null,
  });

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPlacementFiles = useCallback(async () => {
    if (!projectDirectory) {
      setState((prev) => {
        if (
          prev.imagePlacements.length === 0 &&
          prev.videoPlacements.length === 0 &&
          prev.isLoading === false &&
          prev.error === null
        ) {
          return prev;
        }

        return {
          imagePlacements: [],
          videoPlacements: [],
          isLoading: false,
          error: null,
        };
      });
      return;
    }

    try {
      const imagePlacementsPath = `${projectDirectory}/plans/image-placements.md`;
      const videoPlacementsPath = `${projectDirectory}/plans/video-placements.md`;

      const [imageContent, videoContent] = await Promise.all([
        window.electron.project.readFile(imagePlacementsPath).catch(() => null),
        window.electron.project.readFile(videoPlacementsPath).catch(() => null),
      ]);

      let imagePlacements: ParsedImagePlacement[] = [];
      let videoPlacements: ParsedVideoPlacement[] = [];
      let parseError: string | null = null;

      if (imageContent) {
        try {
          const parseResult = parseImagePlacementsWithErrors(
            imageContent,
            false,
          );
          imagePlacements = parseResult.placements;

          // Log warnings and errors
          if (parseResult.warnings.length > 0) {
            console.warn(
              '[usePlacementFiles] Image placement parser warnings:',
              parseResult.warnings,
            );
          }
          if (parseResult.errors.length > 0) {
            console.error(
              '[usePlacementFiles] Image placement parser errors:',
              parseResult.errors,
            );
            parseError = `Found ${parseResult.errors.length} parsing error(s) in image-placements.md. Check console for details.`;
          }
        } catch (error) {
          console.error(
            '[usePlacementFiles] Failed to parse image placements:',
            error,
          );
          parseError = `Failed to parse image-placements.md: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      if (videoContent) {
        try {
          videoPlacements = parseVideoPlacements(videoContent);
        } catch (error) {
          console.error(
            '[usePlacementFiles] Failed to parse video placements:',
            error,
          );
          parseError = parseError
            ? `${parseError}; Failed to parse video-placements.md: ${error instanceof Error ? error.message : String(error)}`
            : `Failed to parse video-placements.md: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      setState((prev) => {
        const unchanged =
          prev.isLoading === false &&
          prev.error === parseError &&
          serializePlacementList(prev.imagePlacements) ===
            serializePlacementList(imagePlacements) &&
          serializePlacementList(prev.videoPlacements) ===
            serializePlacementList(videoPlacements);

        if (unchanged) {
          return prev;
        }

        return {
          imagePlacements,
          videoPlacements,
          isLoading: false,
          error: parseError,
        };
      });
    } catch (error) {
      console.error(
        '[usePlacementFiles] Failed to load placement files:',
        error,
      );
      setState((prev) => {
        const nextError =
          error instanceof Error
            ? error.message
            : 'Failed to load placement files';

        if (
          prev.imagePlacements.length === 0 &&
          prev.videoPlacements.length === 0 &&
          prev.isLoading === false &&
          prev.error === nextError
        ) {
          return prev;
        }

        return {
          imagePlacements: [],
          videoPlacements: [],
          isLoading: false,
          error: nextError,
        };
      });
    }
  }, [projectDirectory]);

  // Initial load
  useEffect(() => {
    loadPlacementFiles();
  }, [loadPlacementFiles, refreshToken]);

  // Watch for file changes
  useEffect(() => {
    if (!projectDirectory) return;

    const unsubscribe = window.electron.project.onFileChange((event) => {
      const filePath = event.path;

      // Check if placement files changed
      if (
        filePath.includes('image-placements.md') ||
        filePath.includes('video-placements.md')
      ) {
        // Clear existing timeout
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }

        // Debounce rapid file changes (300ms)
        debounceTimeoutRef.current = setTimeout(() => {
          loadPlacementFiles();
        }, 300);
      }
    });

    return () => {
      unsubscribe();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [projectDirectory, loadPlacementFiles]);

  return state;
}
