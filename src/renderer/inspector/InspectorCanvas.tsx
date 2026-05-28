/**
 * Inspector Canvas — Phase 2 scaffold.
 *
 * Mounts xyflow's ReactFlow with one custom node type ("inspector").
 * Cards are currently rendered by `StubNode`; per-kind renderers
 * (ImageNode, JsonNode, VideoNode, AudioNode, etc.) replace it in
 * Phase 3 via the same `nodeTypes` registry.
 *
 * The graph (nodes + edges + dagre layout) comes from the pure
 * `bundleToFlowGraph` transform — this component is the React shell
 * around it.
 */
import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type NodeTypes,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { bundleToFlowGraph } from './bundleToFlowGraph';
import { useElkLayout } from './useElkLayout';
import { InspectorNode } from './nodes/InspectorNode';
import { InspectorActionContext } from './InspectorActionContext';
import type {
  BundleSnapshot,
  ProjectStateLike,
} from '../lib/bundleCapability';
import styles from './InspectorCanvas.module.scss';

export interface InspectorCanvasProps {
  bundle: BundleSnapshot | null | undefined;
  walkState: ProjectStateLike | null | undefined;
  /**
   * Fired when the user clicks the bundle's declared goal node body
   * (PreviewPanel wires this to switch to the Watch tab — final
   * video preview). Optional; bundles whose goal isn't video can
   * leave it unwired and clicking falls through to inline play.
   */
  onGoalClick?: (nodeId: string) => void;
}

// Registered node types — Phase 2 has one entry; Phase 3 will expand to
// one per kind and dispatch in the renderer.
const NODE_TYPES: NodeTypes = {
  inspector: InspectorNode as unknown as NodeTypes[string],
};

/**
 * Minimap node color → walker status. Pulls from the live theme CSS
 * variables so the minimap recolors when the user switches themes.
 * Goal node uses the accent so the deliverable is visible at a
 * glance even at minimap scale.
 */
function minimapNodeColor(node: Node): string {
  const data = node.data as { status?: string; isGoal?: boolean } | undefined;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  if (data?.isGoal) return v('--color-accent-primary', '#5f88b2');
  switch (data?.status) {
    case 'completed':   return v('--color-success', '#6d8f7a');
    case 'running':     return v('--color-warning', '#907b58');
    case 'failed':      return v('--color-error', '#a56d6f');
    case 'invalidated': return v('--color-text-secondary', '#a9b0ba');
    case 'pending':
    default:            return v('--color-text-muted', '#7d848e');
  }
}

export function InspectorCanvas({ bundle, walkState, onGoalClick }: InspectorCanvasProps) {
  const graph = useMemo(
    () => bundleToFlowGraph(bundle ?? null, walkState ?? null),
    [bundle, walkState],
  );
  const actions = useMemo(
    () => (onGoalClick ? { onGoalClick } : {}),
    [onGoalClick],
  );
  // elk runs async — graph.nodes carry the topo-columnar fallback
  // positions while elk computes; once it returns, the layouted
  // positions replace them. Hook must be called unconditionally
  // (React rules-of-hooks).
  const nodes = useElkLayout(graph.nodes, graph.edges);

  if (!bundle || graph.nodes.length === 0) {
    return (
      <div className={styles.canvas} data-testid="inspector-canvas-empty">
        <div className={styles.empty}>
          {bundle
            ? 'Bundle loaded but has no nodes yet.'
            : 'Open a bundle-era project to use the Inspector.'}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.canvas}>
      <InspectorActionContext.Provider value={actions}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={graph.edges}
            nodeTypes={NODE_TYPES}
            // Phase 2 is read-only: no drag, no connect, no fitView delay.
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            fitView
            minZoom={0.25}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="rgba(168, 156, 139, 0.06)"
            />
            <MiniMap
              pannable
              zoomable
              nodeColor={minimapNodeColor}
              nodeStrokeColor={minimapNodeColor}
              nodeStrokeWidth={3}
              maskColor="rgba(0, 0, 0, 0.35)"
              ariaLabel="Inspector minimap"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </InspectorActionContext.Provider>
    </div>
  );
}

export default InspectorCanvas;
