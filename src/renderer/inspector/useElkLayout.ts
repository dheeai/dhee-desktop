/**
 * useElkLayout — runs ELK's `layered` algorithm async and returns
 * nodes with computed positions.
 *
 * Why ELK and not dagre: dagre v0.8 + @dagrejs/dagre v1 + v3 all
 * failed under webpack's CJS/ESM interop in the renderer bundle (see
 * the dagre-import-attempts saga in feat/dag-bundles). elkjs ships
 * proper ESM, uses Sugiyama-family layered layout with crossing
 * minimization, and is the algorithm xyflow's own docs recommend.
 *
 * elk's async API isn't a problem in practice: the initial render
 * uses the hand-rolled topo-columnar fallback already computed by
 * bundleToFlowGraph (so the canvas is never empty); elk's positions
 * arrive on the next paint and replace the fallback.
 */
import { useEffect, useState, useMemo } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { InspectorFlowNode, InspectorFlowEdge } from './bundleToFlowGraph';

const elk = new ELK();

interface ElkChild {
  id: string;
  width: number;
  height: number;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

/** Size hint per node — MUST match the CSS dimensions in
 *  InspectorCanvas.module.scss .node selectors. elk packs the layout
 *  using these numbers; if they're smaller than the rendered card,
 *  siblings will overlap. */
function sizeForNode(node: InspectorFlowNode): { width: number; height: number } {
  const { bundleNode } = node.data;
  if (bundleNode.kind === 'collection') {
    return { width: 360, height: 240 };
  }
  switch (bundleNode.outputs.format) {
    case 'image':
      return { width: 220, height: 280 };
    case 'video':
      return { width: 260, height: 280 };
    case 'audio':
      return { width: 320, height: 160 };
    case 'md':
    case 'text':
    case 'json':
    default:
      return { width: 220, height: 280 };
  }
}

const ELK_OPTS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '40',
  // Reduce crossings — the qwen-chain bundle has many sibling rails.
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
};

export function useElkLayout(
  nodes: InspectorFlowNode[],
  edges: InspectorFlowEdge[],
): InspectorFlowNode[] {
  // Stable input identity — only recompute when topology actually changes.
  const inputKey = useMemo(
    () => `${nodes.map((n) => n.id).join(',')}|${edges.map((e) => e.id).join(',')}`,
    [nodes, edges],
  );

  const [layouted, setLayouted] = useState<InspectorFlowNode[]>(nodes);

  useEffect(() => {
    if (nodes.length === 0) {
      setLayouted([]);
      return;
    }
    let cancelled = false;

    const elkChildren: ElkChild[] = nodes.map((n) => ({
      id: n.id,
      ...sizeForNode(n),
    }));
    const elkEdges: ElkEdge[] = edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    }));

    elk
      .layout({
        id: 'root',
        layoutOptions: ELK_OPTS,
        children: elkChildren,
        edges: elkEdges,
      })
      .then((result) => {
        if (cancelled) return;
        const byId = new Map<string, { x: number; y: number }>();
        for (const child of result.children ?? []) {
          if (child.id && child.x !== undefined && child.y !== undefined) {
            byId.set(child.id, { x: child.x, y: child.y });
          }
        }
        setLayouted(
          nodes.map((n) => {
            const pos = byId.get(n.id);
            return pos ? { ...n, position: pos } : n;
          }),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          // Layout failure isn't fatal — bundleToFlowGraph's topo
          // fallback positions stay visible.
          console.warn('[Inspector] elk layout failed:', err);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  // When the input changes (different bundle / project), reset to the
  // fallback positions before elk re-computes.
  useEffect(() => {
    setLayouted(nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  return layouted;
}
