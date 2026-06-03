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
import { computeStageRows, computeInstanceLayout, forwardDependents } from './instanceLayout';
import { CardDetailModal } from './CardDetailModal';
import { type CardAction } from './cardDetailModel';
import { useProject } from '../contexts/ProjectContext';
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

/**
 * Project directory for the cards — used by content renderers to
 * build file:// URLs for images / videos / audio and to read text /
 * JSON files. Threaded via context so per-card components don't
 * need it passed down through data.
 */
const ProjectDirContext = createContext<string | null>(null);
export function useProjectDir(): string | null {
  return useContext(ProjectDirContext);
}

const NODE_TYPES: NodeTypes = {
  instanceCard: InstanceCard as unknown as NodeTypes[string],
  stageGroup: StageGroupLabel as unknown as NodeTypes[string],
};

// Layout constants — one stage per ROW (sequential by topo order),
// instances within a stage spread horizontally. Pure functions in
// `instanceLayout.ts` do the math + are unit-tested.
const ROW_PITCH = 280;
const INSTANCE_PITCH = 360;
const CARD_H = 220;
const ROW_X0 = 100;
const ROW_Y0 = 60;
const GROUP_PAD_LEFT = 24;
const GROUP_PAD_TOP = 36;
const GROUP_PAD_BOTTOM = 20;

function keyOf(nodeId: string, itemId: string | undefined): string {
  return itemId !== undefined ? `${nodeId}:${itemId}` : nodeId;
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
  // The OPEN modal is tracked by instance KEY, not a snapshot. The live
  // instance is re-derived from the graph each refresh — so selecting a
  // version (which swaps the instance's outputPath) reflects in the
  // modal without re-opening it.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { bundle } = useProject();
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
    return forwardDependents(graph.edges, hoverKey);
  }, [hoverKey, graph]);

  // Live instance behind the open modal — re-derived from the latest
  // graph so a version select / edit refresh updates the modal content.
  const openInstance = useMemo<InstanceGraphNode | null>(() => {
    if (!openKey || !graph) return null;
    return graph.instances.find((i) => keyOf(i.nodeId, i.itemId) === openKey) ?? null;
  }, [openKey, graph]);

  // The bundle's headlineField for the open node — lets the modal's
  // editor surface the meaningful text field (e.g. imagePrompt) instead
  // of raw JSON.
  const openHeadlineField = useMemo<string | undefined>(() => {
    if (!openInstance || !bundle) return undefined;
    return bundle.nodes.find((n) => n.id === openInstance.nodeId)?.headlineField;
  }, [openInstance, bundle]);

  // Build xyflow nodes — ONLY depends on the graph projection, NOT on
  // hover. Hover state flows to cards via HoverContext so the node
  // array stays referentially stable across mouseenter/leave events.
  // That keeps xyflow from invalidating every card on every move.
  const nodes = useMemo<Node[]>(() => {
    if (!graph || graph.instances.length === 0) return [];
    // Group instances by stage for layout.
    const byStage = new Map<string, InstanceGraphNode[]>();
    for (const inst of graph.instances) {
      const list = byStage.get(inst.nodeId) ?? [];
      list.push(inst);
      byStage.set(inst.nodeId, list);
    }
    const stageIds = [...byStage.keys()];

    // ONE STAGE PER ROW — sequential topo, alphabetical within tie.
    const rowAssignment = computeStageRows(stageIds, graph.edges);
    // Convert to the layout helper's input shape.
    const stageInstances = new Map<string, Array<{ stageId: string; itemId: string | undefined }>>();
    for (const [stage, insts] of byStage.entries()) {
      stageInstances.set(stage, insts.map((i) => ({ stageId: stage, itemId: i.itemId })));
    }
    const { positions, stageBoxes } = computeInstanceLayout(rowAssignment, stageInstances, {
      rowPitch: ROW_PITCH,
      instancePitch: INSTANCE_PITCH,
      rowX0: ROW_X0,
      rowY0: ROW_Y0,
      groupPadLeft: GROUP_PAD_LEFT,
      groupPadTop: GROUP_PAD_TOP,
    });

    const xyNodes: Node[] = [];
    // Emit stage group labels (zIndex below cards).
    for (const stage of rowAssignment.stagesByRow) {
      const box = stageBoxes.get(stage)!;
      const insts = byStage.get(stage)!;
      xyNodes.push({
        id: `__group__${stage}`,
        type: 'stageGroup',
        position: { x: box.x, y: box.y },
        data: {
          stageId: stage,
          width: box.width,
          height: GROUP_PAD_TOP + CARD_H + GROUP_PAD_BOTTOM,
          instanceCount: insts.length,
          row: box.row,
        },
        draggable: false,
        selectable: false,
        style: { zIndex: 0 },
      });
    }
    // Emit instance cards using positions from the pure layout helper.
    for (const stage of rowAssignment.stagesByRow) {
      const insts = byStage.get(stage)!;
      // Match the helper's alphabetical sort so positions line up.
      const sorted = [...insts].sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));
      for (const inst of sorted) {
        const id = keyOf(inst.nodeId, inst.itemId);
        const pos = positions.get(id);
        if (!pos) continue;
        xyNodes.push({
          id,
          type: 'instanceCard',
          position: pos,
          data: { ...inst },
          draggable: false,
          style: { zIndex: 1 },
        });
      }
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
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'smoothstep',
        animated: isHighlighted,
        style: {
          stroke: isHighlighted ? '#ff9248' : isDimmed ? 'rgba(168, 156, 139, 0.05)' : 'rgba(168, 156, 139, 0.25)',
          strokeWidth: isHighlighted ? 2.5 : 1,
        },
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
  const onNodeClick = useCallback(
    (_evt: unknown, node: Node) => {
      if (node.id.startsWith('__group__')) return;
      setOpenKey(node.id);
    },
    [],
  );
  const onModalClose = useCallback(() => setOpenKey(null), []);
  const onModalAction = useCallback(
    async (action: CardAction, inst: InstanceGraphNode) => {
      if (!projectDir) return;
      const key = keyOf(inst.nodeId, inst.itemId);

      if (action === 'open-file') {
        if (inst.outputPath) {
          // webSecurity is disabled in dev → file:// opens directly.
          window.open(`file://${projectDir}/${inst.outputPath}`, '_blank');
        }
        return;
      }

      if (action === 'invalidate') {
        // Mark stale → invalidate this instance AND cascade downstream.
        // Core emits node.invalidated for the whole cascade; an
        // immediate refresh re-reads the projection so the downstream
        // cards flip to 'invalidated' (blank) right away instead of
        // waiting for the 3s poll.
        try {
          await window.dhee.invalidateNodes({
            projectDir,
            nodeIds: [key],
            source: 'inspector_mark_stale',
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[Inspector] invalidate failed', e);
        }
        setOpenKey(null);
        await refresh();
        return;
      }

      if (action === 'regenerate') {
        // Invalidate + re-run this node (and its cascade) via the
        // established redoNode path.
        try {
          await window.dhee.redoNode({
            projectDir,
            nodeId: inst.nodeId,
            ...(inst.itemId ? { itemId: inst.itemId } : {}),
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[Inspector] regenerate failed', e);
        }
        setOpenKey(null);
        await refresh();
        return;
      }

      // 'show-versions' / 'edit' are handled inside the modal itself
      // (they only need this instance's identity, not the graph). The
      // modal never dispatches them up here.
    },
    [projectDir, refresh],
  );

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
      <ProjectDirContext.Provider value={projectDir ?? null}>
      <HoverContext.Provider value={hoverCtx}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeMouseEnter={onNodeEnter}
          onNodeMouseLeave={onNodeLeave}
          onNodeClick={onNodeClick}
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
      </ProjectDirContext.Provider>
      <CardDetailModal
        instance={openInstance}
        projectDir={projectDir ?? null}
        headlineField={openHeadlineField}
        onClose={onModalClose}
        onAction={onModalAction}
        onChanged={refresh}
      />
    </div>
  );
}

export default InstanceCardsCanvas;
