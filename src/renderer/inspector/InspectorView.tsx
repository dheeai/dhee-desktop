/**
 * Tab wrapper that wires the InspectorCanvas to the desktop context.
 *
 * Bundle comes from ProjectContext (single source of truth — hoisted in
 * Phase 2). walkState is read from project.json on disk and refreshed
 * when ProjectContext signals a file-change tick (Phase 3+ will hook
 * the existing file watcher). For Phase 2 the canvas renders once at
 * mount with whatever is on disk; live updates land with the rest of
 * the interaction work.
 */
import { useEffect, useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { InspectorCanvas } from './InspectorCanvas';
import type { ProjectStateLike } from '../lib/bundleCapability';

export function InspectorView() {
  const { bundle } = useProject();
  const { projectDirectory } = useWorkspace();
  const [walkState, setWalkState] = useState<ProjectStateLike | null>(null);

  useEffect(() => {
    if (!projectDirectory) {
      setWalkState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await window.electron.project.readFile(
          `${projectDirectory}/project.json`,
        );
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as {
          walkState?: ProjectStateLike;
          executorState?: ProjectStateLike;
        };
        setWalkState(parsed.walkState ?? parsed.executorState ?? { nodes: {} });
      } catch (err) {
        if (!cancelled) {
          console.warn('[InspectorView] failed to read walkState:', err);
          setWalkState({ nodes: {} });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDirectory]);

  return <InspectorCanvas bundle={bundle} walkState={walkState} />;
}

export default InspectorView;
