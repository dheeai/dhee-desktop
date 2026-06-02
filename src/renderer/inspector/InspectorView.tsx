/**
 * Tab wrapper that wires the canvas to the desktop context.
 *
 * Two modes:
 *   - 'cards' (default): per-instance dependency graph, sourced from
 *     `.dhee/events.jsonl` via the `projectInstanceGraph` projection
 *     in dhee-core. Cards grouped by stage, edges are instance-to-
 *     instance, hover highlights the regen blast radius.
 *   - 'stages' (legacy): one card per bundle node, sourced from
 *     walkState + the bundle definition.
 *
 * Toggle persists in localStorage so the user's preferred view sticks.
 */
import { useEffect, useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { InspectorCanvas } from './InspectorCanvas';
import { InstanceCardsCanvas } from './InstanceCardsCanvas';
import type { ProjectStateLike } from '../lib/bundleCapability';

type InspectorMode = 'cards' | 'stages';

const MODE_STORAGE_KEY = 'dhee.inspector.mode';

function loadMode(): InspectorMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    return v === 'stages' ? 'stages' : 'cards';
  } catch {
    return 'cards';
  }
}
function saveMode(m: InspectorMode): void {
  try { localStorage.setItem(MODE_STORAGE_KEY, m); } catch { /* ignore */ }
}

export interface InspectorViewProps {
  /** Fired when the goal node is clicked (PreviewPanel switches tabs). */
  onGoalClick?: (nodeId: string) => void;
}

export function InspectorView({ onGoalClick }: InspectorViewProps = {}) {
  const { bundle } = useProject();
  const { projectDirectory } = useWorkspace();
  const [walkState, setWalkState] = useState<ProjectStateLike | null>(null);
  const [mode, setMode] = useState<InspectorMode>(loadMode);

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

  const setModePersistent = (m: InspectorMode): void => {
    setMode(m);
    saveMode(m);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
          background: 'rgba(22, 24, 33, 0.85)',
          border: '1px solid rgba(168, 156, 139, 0.18)',
          borderRadius: 6,
          padding: 3,
          display: 'flex',
          gap: 2,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 11,
        }}
      >
        <button
          onClick={() => setModePersistent('cards')}
          style={{
            padding: '4px 10px',
            background: mode === 'cards' ? '#5f88b2' : 'transparent',
            color: mode === 'cards' ? '#161821' : '#a9b0ba',
            border: 'none',
            borderRadius: 4,
            fontWeight: mode === 'cards' ? 600 : 400,
            cursor: 'pointer',
          }}
          data-testid="inspector-mode-cards"
        >
          Cards
        </button>
        <button
          onClick={() => setModePersistent('stages')}
          style={{
            padding: '4px 10px',
            background: mode === 'stages' ? '#5f88b2' : 'transparent',
            color: mode === 'stages' ? '#161821' : '#a9b0ba',
            border: 'none',
            borderRadius: 4,
            fontWeight: mode === 'stages' ? 600 : 400,
            cursor: 'pointer',
          }}
          data-testid="inspector-mode-stages"
        >
          Stages
        </button>
      </div>
      {mode === 'cards' ? (
        <InstanceCardsCanvas projectDir={projectDirectory ?? null} pollMs={3000} />
      ) : (
        <InspectorCanvas
          bundle={bundle}
          walkState={walkState}
          {...(onGoalClick ? { onGoalClick } : {})}
        />
      )}
    </div>
  );
}

export default InspectorView;
