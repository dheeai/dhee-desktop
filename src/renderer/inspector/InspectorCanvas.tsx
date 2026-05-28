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
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { bundleToFlowGraph } from './bundleToFlowGraph';
import { InspectorNode } from './nodes/InspectorNode';
import type {
  BundleSnapshot,
  ProjectStateLike,
} from '../lib/bundleCapability';
import styles from './InspectorCanvas.module.scss';

export interface InspectorCanvasProps {
  bundle: BundleSnapshot | null | undefined;
  walkState: ProjectStateLike | null | undefined;
}

// Registered node types — Phase 2 has one entry; Phase 3 will expand to
// one per kind and dispatch in the renderer.
const NODE_TYPES: NodeTypes = {
  inspector: InspectorNode as unknown as NodeTypes[string],
};

export function InspectorCanvas({ bundle, walkState }: InspectorCanvasProps) {
  const graph = useMemo(
    () => bundleToFlowGraph(bundle ?? null, walkState ?? null),
    [bundle, walkState],
  );

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
      <ReactFlowProvider>
        <ReactFlow
          nodes={graph.nodes}
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
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

export default InspectorCanvas;
