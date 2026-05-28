/**
 * Bundle → React Flow graph transform. Pure, no React, no IO.
 *
 * The Inspector Canvas (BUG-020) renders a card per bundle node and a
 * line per `inputs[].from`. This module is the bridge between the
 * BundleSnapshot + walkState (data) and the xyflow node/edge arrays
 * (rendering).
 *
 * Layout is delegated to `dagre` — variable per-node sizes (stage
 * cards are compact, collection rails are wider), topo flow
 * left → right. Concrete pixel positions come back on each FlowNode's
 * `position`, ready for xyflow.
 */
import * as dagre from 'dagre';
import type {
  BundleSnapshot,
  BundleNode,
  ProjectStateLike,
  CapabilityInstance,
} from '../lib/bundleCapability';

/** Aggregate walker status as the Inspector surfaces it on a card. */
export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'invalidated';

/**
 * Data carried on each React Flow node. The Inspector's single custom
 * node component reads from this to dispatch to per-kind renderers in
 * Phase 3.
 */
export interface InspectorNodeData {
  /** The bundle's NodeDef projection — kind/format/headlineField/etc. */
  bundleNode: BundleNode;
  /** Aggregate status for the card's visual state. */
  status: NodeStatus;
  /**
   * Per-instance walkState entries:
   *   - stage nodes → 0 or 1 instance with itemId === undefined
   *   - collection nodes → 0..N instances, each with an itemId
   */
  instances: CapabilityInstance[];
  /** xyflow requires Node.data to satisfy Record<string, unknown>. */
  [key: string]: unknown;
}

export interface InspectorFlowNode {
  /** Bundle node id — also the React Flow node id. */
  id: string;
  /** Stable registered renderer key. Phase 2 ships a generic stub. */
  type: 'inspector';
  position: { x: number; y: number };
  data: InspectorNodeData;
}

export interface InspectorFlowEdge {
  /** Stable edge id (`source->target`). */
  id: string;
  source: string;
  target: string;
}

export interface InspectorFlowGraph {
  nodes: InspectorFlowNode[];
  edges: InspectorFlowEdge[];
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

/**
 * Walker reports per-instance statuses; the card needs one. Order of
 * precedence: failed > running > invalidated > pending > completed.
 *
 * Reasoning: a single failure must be visible from the zoom-out level
 * (red border on the card). A running shot in an otherwise-complete
 * collection should pulse so the user sees motion. Invalidated > pending
 * because invalidated means "was completed, now needs redo" — more
 * informative than vanilla pending.
 */
const PRECEDENCE: Record<NodeStatus, number> = {
  failed: 4,
  running: 3,
  invalidated: 2,
  pending: 1,
  completed: 0,
};

function classifyStatus(raw: string | undefined): NodeStatus {
  switch (raw) {
    case 'failed':
    case 'running':
    case 'invalidated':
    case 'pending':
    case 'completed':
      return raw;
    default:
      return 'pending';
  }
}

function aggregateStatus(instances: CapabilityInstance[]): NodeStatus {
  if (instances.length === 0) return 'pending';
  let best: NodeStatus = 'completed';
  for (const inst of instances) {
    const s = classifyStatus(inst.status);
    if (PRECEDENCE[s] > PRECEDENCE[best]) best = s;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Instance collection
// ---------------------------------------------------------------------------

function collectInstances(
  node: BundleNode,
  state: ProjectStateLike | null | undefined,
): CapabilityInstance[] {
  const stateNodes = state?.nodes ?? {};
  const out: CapabilityInstance[] = [];
  const prefix = `${node.id}:`;
  for (const [key, entry] of Object.entries(stateNodes)) {
    const isStageKey = key === node.id;
    const isCollectionKey = key.startsWith(prefix);
    if (!isStageKey && !isCollectionKey) continue;
    const itemId = isCollectionKey ? key.slice(prefix.length) : undefined;
    out.push({
      stateKey: key,
      ...(itemId !== undefined ? { itemId } : {}),
      status: entry.status ?? 'pending',
      ...(entry.outputPath ? { outputPath: entry.outputPath } : {}),
      ...(entry.outputPaths ? { outputPaths: entry.outputPaths } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout (dagre)
// ---------------------------------------------------------------------------

/**
 * Hint to dagre about each node's rendered size. Stage cards are
 * compact (md/json/text/image preview); collection rails are wider
 * because they show multiple tiles. Real pixel sizes will be refined
 * after the per-kind renderers ship in Phase 3.
 */
function sizeFor(node: BundleNode): { width: number; height: number } {
  if (node.kind === 'collection') {
    return { width: 360, height: 200 };
  }
  switch (node.outputs.format) {
    case 'image':
      return { width: 200, height: 220 };
    case 'video':
      return { width: 240, height: 220 };
    case 'audio':
      return { width: 320, height: 130 };
    case 'md':
    case 'text':
    case 'json':
    default:
      return { width: 220, height: 160 };
  }
}

const LAYOUT_OPTS = {
  rankdir: 'LR' as const,
  nodesep: 32,
  ranksep: 72,
  marginx: 24,
  marginy: 24,
};

function layoutNodes(
  bundle: BundleSnapshot,
  edges: InspectorFlowEdge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph(LAYOUT_OPTS);
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of bundle.nodes) {
    g.setNode(node.id, sizeFor(node));
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const node of bundle.nodes) {
    const pos = g.node(node.id);
    // dagre returns the node's CENTER position; xyflow wants top-left.
    out.set(node.id, {
      x: (pos?.x ?? 0) - (pos?.width ?? 0) / 2,
      y: (pos?.y ?? 0) - (pos?.height ?? 0) / 2,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main transform
// ---------------------------------------------------------------------------

export function bundleToFlowGraph(
  bundle: BundleSnapshot | null | undefined,
  state: ProjectStateLike | null | undefined,
): InspectorFlowGraph {
  if (!bundle || bundle.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Build the set of valid node ids first so edges can be filtered
  // against it (dropping references to non-existent upstream nodes).
  const validIds = new Set(bundle.nodes.map((n) => n.id));

  // Collect edges, deduplicating (source, target) pairs.
  const seenEdges = new Set<string>();
  const edges: InspectorFlowEdge[] = [];
  for (const node of bundle.nodes) {
    for (const input of node.inputs ?? []) {
      if (!validIds.has(input.from)) continue; // orphan edge — drop
      const id = `${input.from}->${node.id}`;
      if (seenEdges.has(id)) continue;
      seenEdges.add(id);
      edges.push({ id, source: input.from, target: node.id });
    }
  }

  // Layout with dagre.
  const positions = layoutNodes(bundle, edges);

  // Build the FlowNode list.
  const nodes: InspectorFlowNode[] = bundle.nodes.map((bundleNode) => {
    const instances = collectInstances(bundleNode, state);
    const status = aggregateStatus(instances);
    const pos = positions.get(bundleNode.id) ?? { x: 0, y: 0 };
    return {
      id: bundleNode.id,
      type: 'inspector' as const,
      position: { x: pos.x, y: pos.y },
      data: {
        bundleNode,
        status,
        instances,
      },
    };
  });

  return { nodes, edges };
}
