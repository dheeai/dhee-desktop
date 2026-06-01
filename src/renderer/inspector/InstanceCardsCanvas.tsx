/**
 * InstanceCardsCanvas — per-instance dependency graph rendered as
 * cards, grouped by stage, with content-aware edges.
 *
 * Source of truth: the project's `.dhee/events.jsonl`, folded by
 * dhee-core's `projectInstanceGraph` projection (invoked over IPC
 * via `window.dhee.resolveInstanceGraph`). No bundle re-derivation,
 * no file sniffing on the renderer.
 *
 * UX:
 *   - One card per (nodeId, itemId) instance
 *   - Cards positioned in stage columns by topo rank, stacked rows
 *     per instance within each stage
 *   - Edges drawn from upstream INSTANCE to downstream INSTANCE
 *     (e.g. `character_image:lara_croft` → `shot_image:scene_1_shot_3`),
 *     not stage-to-stage
 *   - Hover a card → highlight all transitive dependents (the regen
 *     blast-radius preview)
 *   - Stage labels drawn behind each column
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type NodeTypes,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  ResolveInstanceGraphRequest,
  InstanceGraphNode,
  InstanceGraphEdge,
} from '../../shared/dheeIpc';
import { InstanceCard } from './nodes/InstanceCard';
import { StageGroupLabel } from './nodes/StageGroupLabel';
import styles from './InspectorCanvas.module.scss';

/**
 * Hover state for the card canvas. Lives in a context so individual
 * InstanceCard components can subscribe + restyle WITHOUT touching
 * the xyflow `nodes` array — which would force every card to
 * recompute on every mouse move and cause the flicker you saw.
 */
interface HoverState {
  hoveredKey: string | null;
  highlighted: Set<string>;
}
const HoverContext = createContext<HoverState>({ hoveredKey: null, highlighted: new Set() });
export function useInstanceHoverState(): HoverState {
  return useContext(HoverContext);
}

const NODE_TYPES: NodeTypes = {
  instanceCard: InstanceCard as unknown as NodeTypes[string],
  stageGroup: StageGroupLabel as unknown as NodeTypes[string],
};

// Layout constants
const COLUMN_PITCH = 320;
const ROW_PITCH = 110;
const COLUMN_X0 = 80;
const COLUMN_Y0 = 80;
const GROUP_PAD_TOP = 40;
const GROUP_PAD_BOTTOM = 24;
const CARD_W = 240;

function keyOf(nodeId: string, itemId: string | undefined): string {
  return itemId !== undefined ? `${nodeId}:${itemId}` : nodeId;
}

/** Build topo ranks from the instance edges. Each stageId gets rank = 1 + max(rank of upstream stages). */
function computeStageRanks(instances: InstanceGraphNode[], edges: InstanceGraphEdge[]): Map<string, number> {
  const stages = new Set<string>(instances.map((i) => i.nodeId));
  const inEdges = new Map<string, Set<string>>();
  stages.forEach((s) => inEdges.set(s, new Set()));
  for (const e of edges) {
    if (stages.has(e.toNodeId) && stages.has(e.fromNodeId) && e.fromNodeId !== e.toNodeId) {
      inEdges.get(e.toNodeId)!.add(e.fromNodeId);
    }
  }
  const ranks = new Map<string, number>();
  function rankOf(s: string, visiting = new Set<string>()): number {
    const cached = ranks.get(s);
    if (cached !== undefined) return cached;
    if (visiting.has(s)) return 0; // cycle guard
    visiting.add(s);
    const ups = inEdges.get(s) ?? new Set();
    const r = ups.size === 0 ? 0 : 1 + Math.max(...[...ups].map((u) => rankOf(u, visiting)));
    visiting.delete(s);
    ranks.set(s, r);
    return r;
  }
  for (const s of stages) rankOf(s);
  return ranks;
}

/** Forward dependents from a starting instance. */
function computeDependentsForward(
  edges: InstanceGraphEdge[],
  startKey: string,
): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    const src = keyOf(e.fromNodeId, e.fromItemId);
    const dst = keyOf(e.toNodeId, e.toItemId);
    const list = outgoing.get(src) ?? [];
    list.push(dst);
    outgoing.set(src, list);
  }
  const visited = new Set<string>([startKey]);
  const queue = [startKey];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of outgoing.get(cur) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  visited.delete(startKey);
  return visited;
}

export interface InstanceCardsCanvasProps {
  projectDir: string | null | undefined;
  /** Branch to project. Default 'main'. */
  branchId?: string;
  /** Refresh interval in ms for re-polling the graph. 0 = no polling. */
  pollMs?: number;
}

export function InstanceCardsCanvas({ projectDir, branchId, pollMs }: InstanceCardsCanvasProps) {
  const [graph, setGraph] = useState<{ instances: InstanceGraphNode[]; edges: InstanceGraphEdge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // Keep the last fetched-graph signature so the 3s poll doesn't
  // shove a fresh object reference into state when nothing actually
  // changed. Without this guard every poll triggers a re-render of
  // every card.
  const lastGraphSigRef = useRef<string>('');

  // Fetch the projection from the main process.
  const refresh = useCallback(async () => {
    if (!projectDir) {
      setGraph({ instances: [], edges: [] });
      lastGraphSigRef.current = '';
      return;
    }
    try {
      const req: ResolveInstanceGraphRequest = { projectDir };
      if (branchId) req.branchId = branchId;
      const resp = await window.dhee.resolveInstanceGraph(req);
      if (!resp.ok || !resp.graph) {
        setError(resp.error ?? 'unknown error resolving instance graph');
        return;
      }
      setError(null);
      // Stable JSON signature gates the state update. Skips ~99% of
      // unchanged polls so the canvas only re-derives nodes/edges
      // when there's actual new data.
      const sig = JSON.stringify(resp.graph);
      if (sig === lastGraphSigRef.current) return;
      lastGraphSigRef.current = sig;
      setGraph(resp.graph);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectDir, branchId]);

  useEffect(() => {
    void refresh();
    if (!pollMs) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  // Compute hover-highlight set forward from the hovered card.
  const highlighted = useMemo(() => {
    if (!hoverKey || !graph) return new Set<string>();
    return computeDependentsForward(graph.edges, hoverKey);
  }, [hoverKey, graph]);

  // Build xyflow nodes — ONLY depends on the graph projection, NOT on
  // hover. Hover state flows to cards via HoverContext so the node
  // array stays referentially stable across mouseenter/leave events.
  // That keeps xyflow from invalidating every card on every move.
  const nodes = useMemo<Node[]>(() => {
    if (!graph || graph.instances.length === 0) return [];
    // Group instances by stage.
    const byStage = new Map<string, InstanceGraphNode[]>();
    for (const inst of graph.instances) {
      const list = byStage.get(inst.nodeId) ?? [];
      list.push(inst);
      byStage.set(inst.nodeId, list);
    }
    // Sort each stage's instances by itemId for stable layout.
    for (const list of byStage.values()) {
      list.sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));
    }

    const ranks = computeStageRanks(graph.instances, graph.edges);
    const stageIds = [...byStage.keys()];
    // Place stages: x by rank, y stacked per rank (multiple stages
    // sharing a rank — e.g. parallel branches — stack downward).
    const rankCursorY = new Map<number, number>();
    const stageBox = new Map<string, { x: number; y: number; height: number; rank: number }>();
    // Sort stages so that within a rank, the order is stable (alphabetical).
    stageIds.sort((a, b) => {
      const ra = ranks.get(a) ?? 0;
      const rb = ranks.get(b) ?? 0;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
    for (const stage of stageIds) {
      const r = ranks.get(stage) ?? 0;
      const x = COLUMN_X0 + r * COLUMN_PITCH;
      const y = rankCursorY.get(r) ?? COLUMN_Y0;
      const insts = byStage.get(stage) ?? [];
      const height = GROUP_PAD_TOP + insts.length * ROW_PITCH + GROUP_PAD_BOTTOM;
      stageBox.set(stage, { x, y, height, rank: r });
      rankCursorY.set(r, y + height + 40);
    }

    const xyNodes: Node[] = [];
    // Emit stage group labels (zIndex below cards).
    for (const stage of stageIds) {
      const box = stageBox.get(stage)!;
      xyNodes.push({
        id: `__group__${stage}`,
        type: 'stageGroup',
        position: { x: box.x - 20, y: box.y },
        data: {
          stageId: stage,
          width: CARD_W + 40,
          height: box.height,
        },
        draggable: false,
        selectable: false,
        style: { zIndex: 0 },
      });
    }
    // Emit instance cards. NOTE: no hover state stuffed in — that
    // arrives via HoverContext at render time so this array stays
    // referentially stable across hover events.
    for (const stage of stageIds) {
      const box = stageBox.get(stage)!;
      const insts = byStage.get(stage)!;
      insts.forEach((inst, idx) => {
        const id = keyOf(inst.nodeId, inst.itemId);
        xyNodes.push({
          id,
          type: 'instanceCard',
          position: { x: box.x, y: box.y + GROUP_PAD_TOP + idx * ROW_PITCH },
          data: { ...inst },
          draggable: false,
          style: { zIndex: 1 },
        });
      });
    }
    return xyNodes;
  }, [graph]);

  // Edges DO depend on hover state (we restyle non-relevant edges)
  // but edge updates are cheap in xyflow — only edge SVG paths are
  // diffed, not whole component subtrees. Acceptable cost.
  const edges = useMemo<Edge[]>(() => {
    if (!graph) return [];
    return graph.edges.map((e) => {
      const src = keyOf(e.fromNodeId, e.fromItemId);
      const dst = keyOf(e.toNodeId, e.toItemId);
      const isHighlighted = hoverKey !== null && (src === hoverKey || highlighted.has(src)) && (highlighted.has(dst) || dst === hoverKey);
      const isDimmed = hoverKey !== null && !isHighlighted;
      return {
        id: `${src}->${dst}#${e.role ?? ''}`,
        source: src,
        target: dst,
        animated: isHighlighted,
        style: {
          stroke: isHighlighted ? '#f2c97a' : isDimmed ? 'rgba(168, 156, 139, 0.08)' : 'rgba(168, 156, 139, 0.35)',
          strokeWidth: isHighlighted ? 2 : 1,
        },
        label: e.role,
        labelStyle: { fontSize: 9, fill: 'rgba(255,255,255,0.5)' },
        zIndex: isHighlighted ? 2 : 0,
      };
    });
  }, [graph, hoverKey, highlighted]);

  // Stable HoverContext value — only changes when hover actually changes.
  const hoverCtx = useMemo<HoverState>(() => ({ hoveredKey: hoverKey, highlighted }), [hoverKey, highlighted]);

  const onNodeEnter = useCallback((_evt: unknown, node: Node) => {
    if (node.id.startsWith('__group__')) return;
    setHoverKey(node.id);
  }, []);
  const onNodeLeave = useCallback(() => {
    setHoverKey(null);
  }, []);

  if (!projectDir) {
    return (
      <div className={styles.canvas} data-testid="instance-cards-canvas-empty">
        <div className={styles.empty}>Open a project to use Inspector Cards.</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.canvas}>
        <div className={styles.empty}>Failed to load instance graph: {error}</div>
      </div>
    );
  }
  if (graph && graph.instances.length === 0) {
    return (
      <div className={styles.canvas}>
        <div className={styles.empty}>
          No events yet — run the bundle and instances will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.canvas}>
      <HoverContext.Provider value={hoverCtx}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeMouseEnter={onNodeEnter}
          onNodeMouseLeave={onNodeLeave}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          fitView
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(168, 156, 139, 0.06)" />
          <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.35)" ariaLabel="Cards minimap" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
      </HoverContext.Provider>
    </div>
  );
}

export default InstanceCardsCanvas;
