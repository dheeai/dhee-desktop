/**
 * Hook for Remotion infographic rendering from the desktop UI.
 */
import { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useProject } from '../contexts/ProjectContext';
import { usePlacementFiles } from './usePlacementFiles';
import { useTimelineDataContext } from '../contexts/TimelineDataContext';
import type {
  RemotionJob,
  RemotionProgress,
  RemotionTimelineItem,
} from '../../shared/remotionTypes.js';

export function useRemotionRender() {
  const { projectDirectory } = useWorkspace();
  const { addAsset, refreshAssetManifest } = useProject();
  const { infographicPlacements } = usePlacementFiles();
  const { overlayItems } = useTimelineDataContext();

  const [activeJob, setActiveJob] = useState<RemotionJob | null>(null);
  const [progress, setProgress] = useState<RemotionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const infographicItems = overlayItems as RemotionTimelineItem[];

  const startRender = useCallback(async () => {
    if (!projectDirectory || infographicItems.length === 0) {
      setError('No project or infographic items to render');
      return null;
    }

    setError(null);
    setProgress(null);

    const result = await window.electron.remotion.renderInfographics(
      projectDirectory,
      infographicItems,
      infographicPlacements,
    );

    if (result.error) {
      setError(result.error);
      return null;
    }

    if (result.jobId) {
      const job = await window.electron.remotion.getJob(result.jobId);
      setActiveJob(job ?? null);
    }
    return result.jobId;
  }, [
    projectDirectory,
    infographicItems,
    infographicPlacements,
  ]);

  const cancelRender = useCallback(async (jobId: string) => {
    await window.electron.remotion.cancelJob(jobId);
    setActiveJob(null);
    setProgress(null);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.remotion.onProgress((p) => {
      setProgress(p);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.remotion.onJobComplete(
      async (completedJob) => {
        setActiveJob(null);
        setProgress(null);

        if (
          completedJob.status === 'completed' &&
          completedJob.outputFiles?.length &&
          projectDirectory &&
          addAsset &&
          refreshAssetManifest
        ) {
          for (let i = 0; i < completedJob.outputFiles.length; i++) {
            const manifestPath = completedJob.outputFiles[i]!;
            const basename = manifestPath.replace(/\\/g, '/').split('/').pop() ?? '';
            const placementMatch = basename.match(/^info(\d+)_/);
            const placementNumber = placementMatch?.[1]
              ? parseInt(placementMatch[1], 10)
              : i + 1;
            const artifactId = `info_${Date.now().toString(36)}_${i}`;

            try {
              await addAsset({
                id: artifactId,
                type: 'scene_infographic',
                path: manifestPath,
                version: 1,
                created_at: Date.now(),
                scene_number: placementNumber,
                metadata: { placementNumber },
              });
            } catch (err) {
              console.error('[useRemotionRender] Failed to add asset:', err);
            }
          }
          await refreshAssetManifest?.();
        }
      },
    );
    return () => {
      unsubscribe();
    };
  }, [
    projectDirectory,
    addAsset,
    refreshAssetManifest,
  ]);

  return {
    activeJob,
    progress,
    error,
    infographicItems,
    canRender: infographicItems.length > 0 && !!projectDirectory,
    startRender,
    cancelRender,
  };
}
