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
 * Minimap node color → walker status. Goal node uses the terracotta
 * accent so the deliverable is visible at a glance even at minimap
 * scale.
 */
function minimapNodeColor(node: Node): string {
  const data = node.data as { status?: string; isGoal?: boolean } | undefined;
  if (data?.isGoal) return '#c97c45';
  switch (data?.status) {
    case 'completed': return '#7e9c71';
    case 'running':   return '#d4a657';
    case 'failed':    return '#c25450';
    case 'invalidated': return '#a89c8b';
    case 'pending':
    default:          return '#4a4239';
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
              nodeStrokeWidth={2}
              maskColor="rgba(15, 12, 9, 0.6)"
              style={{
                backgroundColor: 'rgba(15, 12, 9, 0.85)',
                border: '1px solid #3d3429',
                borderRadius: 8,
              }}
            />
            <Controls
              showInteractive={false}
              style={{
                background: 'rgba(15, 12, 9, 0.92)',
                border: '1px solid #3d3429',
                borderRadius: 7,
              }}
            />
          </ReactFlow>
        </ReactFlowProvider>
      </InspectorActionContext.Provider>
    </div>
  );
}

export default InspectorCanvas;
