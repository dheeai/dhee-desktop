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
  /**
   * True when this node's id matches the bundle's declared `goal`.
   * The Inspector card uses this to (a) paint the goal-node accent
   * border (mockup's "GOAL" flag) and (b) deep-link to the Watch tab
   * when clicked, instead of playing inline.
   */
  isGoal: boolean;
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
// Layout — simple topological columnar layout
// ---------------------------------------------------------------------------
//
// The bundle graph is tiny (≤30 nodes) so a hand-rolled topo layout
// fits perfectly and dodges the CJS/ESM interop problems we had with
// dagre under webpack. Three steps:
//
//   1. Compute each node's RANK = 1 + max(rank of upstream nodes).
//   2. Group nodes by rank (rank 0 = roots, no upstream).
//   3. Place nodes in columns: x = rank * COLUMN_PITCH, y stacked by
//      slot * ROW_PITCH (with each rank's nodes centred against the
//      tallest rank).
//
// Parallel branches naturally land on different y because two nodes
// at the same rank get different slots.

/**
 * Hint about each node's rendered size — keeps stages compact and
 * collection rails wider. The numbers affect layout pitch only;
 * actual rendered sizes come from CSS.
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

const COLUMN_PITCH = 280;
const ROW_PITCH = 200;
const COLUMN_X0 = 60;
const COLUMN_Y0 = 60;

function computeRanks(
  bundle: BundleSnapshot,
  edges: InspectorFlowEdge[],
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const n of bundle.nodes) incoming.set(n.id, []);
  for (const e of edges) {
    incoming.get(e.target)?.push(e.source);
  }
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();

  function rankOf(id: string): number {
    const cached = ranks.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard — shouldn't happen on a DAG
    visiting.add(id);
    const ups = incoming.get(id) ?? [];
    const r = ups.length === 0 ? 0 : 1 + Math.max(...ups.map(rankOf));
    visiting.delete(id);
    ranks.set(id, r);
    return r;
  }

  for (const n of bundle.nodes) rankOf(n.id);
  return ranks;
}

function layoutNodes(
  bundle: BundleSnapshot,
  edges: InspectorFlowEdge[],
): Map<string, { x: number; y: number }> {
  const ranks = computeRanks(bundle, edges);
  // Bucket by rank, preserving the bundle's declaration order within
  // each rank so siblings show up in a stable order.
  const byRank = new Map<number, BundleNode[]>();
  for (const n of bundle.nodes) {
    const r = ranks.get(n.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(n);
  }
  const tallestRank = Math.max(...Array.from(byRank.values(), (col) => col.length));
  const out = new Map<string, { x: number; y: number }>();
  for (const [rank, column] of byRank) {
    const slotOffset = (tallestRank - column.length) / 2;
    column.forEach((node, idx) => {
      out.set(node.id, {
        x: COLUMN_X0 + rank * COLUMN_PITCH,
        y: COLUMN_Y0 + (idx + slotOffset) * ROW_PITCH,
      });
    });
    // sizeFor isn't used for actual positioning here — kept for
    // potential future refinement (e.g. variable column pitch). Ref it
    // so the import + type stays alive.
    void sizeFor(column[0]!);
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
        isGoal: bundle.goal === bundleNode.id,
      },
    };
  });

  return { nodes, edges };
}
