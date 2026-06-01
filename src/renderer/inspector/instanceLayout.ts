/**
 * Layout helpers for the Inspector Cards canvas — pure, no React,
 * no xyflow.
 *
 * `computeStageRows` decides which ROW each bundle node lands on.
 * Same-rank stages share a row in the strict topo sense, but for
 * the Inspector we want ONE STAGE PER ROW so the visual sequence is
 * unambiguous (plot row, then story row, then story_essence row,
 * then world_style row, ...). The function:
 *
 *   1. Compute strict topo ranks (1 + max(rank of upstreams)).
 *   2. Walk all stages in (rank asc, name asc) order, assigning each
 *      a sequential row index. Stages tied in rank get adjacent rows
 *      preserving alphabetical order — stable across re-renders.
 *
 * `computeInstanceColumns` decides the X position of each instance
 * within its stage row. Instances are sorted by itemId and laid out
 * left-to-right with INSTANCE_PITCH spacing.
 */

export interface StageRowAssignment {
  /** Map from stageId → row index (0-based, sequential, no gaps). */
  rowByStage: Map<string, number>;
  /** Stage IDs in row order (rowByStage.get(id) === stagesByRow.indexOf(id)). */
  stagesByRow: string[];
}

export interface EdgeLike {
  fromNodeId: string;
  toNodeId: string;
}

/**
 * Walk forward dependents starting at one or more keys. Pure BFS;
 * extracted so the canvas + tests share the same logic.
 */
export function forwardDependents(
  edges: ReadonlyArray<{ fromNodeId: string; fromItemId?: string; toNodeId: string; toItemId?: string }>,
  startKey: string,
): Set<string> {
  const keyOf = (n: string, i?: string): string => (i !== undefined ? `${n}:${i}` : n);
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

/**
 * One row per stage. Stages are placed in (topo rank, alphabetical)
 * order so the row index is stable across re-renders + every stage
 * gets its own row (no co-located rows even for same-rank parallel
 * stages).
 */
export function computeStageRows(
  stageIds: ReadonlyArray<string>,
  edges: ReadonlyArray<EdgeLike>,
): StageRowAssignment {
  const stages = new Set(stageIds);
  // Build incoming edges per stage (only edges where both ends are
  // known stages — drops noise like edges from instances that
  // aren't in the stage set).
  const incoming = new Map<string, Set<string>>();
  for (const s of stages) incoming.set(s, new Set());
  for (const e of edges) {
    if (!stages.has(e.fromNodeId) || !stages.has(e.toNodeId)) continue;
    if (e.fromNodeId === e.toNodeId) continue; // ignore self-loops
    incoming.get(e.toNodeId)!.add(e.fromNodeId);
  }
  // Topo rank with cycle guard.
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  function rankOf(s: string): number {
    if (ranks.has(s)) return ranks.get(s)!;
    if (visiting.has(s)) return 0;
    visiting.add(s);
    const ups = incoming.get(s) ?? new Set();
    const r = ups.size === 0 ? 0 : 1 + Math.max(...[...ups].map((u) => rankOf(u)));
    visiting.delete(s);
    ranks.set(s, r);
    return r;
  }
  for (const s of stages) rankOf(s);

  // Sort stages: rank asc, then alphabetical within rank.
  const sorted = [...stages].sort((a, b) => {
    const ra = ranks.get(a)!;
    const rb = ranks.get(b)!;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  const rowByStage = new Map<string, number>();
  sorted.forEach((s, idx) => rowByStage.set(s, idx));
  return { rowByStage, stagesByRow: sorted };
}

export interface InstancePosition {
  /** Absolute x coord. */
  x: number;
  /** Absolute y coord. */
  y: number;
}

export interface InstanceLayoutInput {
  stageId: string;
  itemId: string | undefined;
}

export interface LayoutOpts {
  rowPitch?: number;        // y between rows
  instancePitch?: number;   // x between instances within a row
  rowX0?: number;
  rowY0?: number;
  groupPadLeft?: number;
  groupPadTop?: number;
  /**
   * When true (default), every row's content is centered around the
   * widest row's axis: a 1-card row sits visually under the middle of
   * a 10-card row. When false, every row is anchored to `rowX0` and
   * narrower rows hang to the left.
   */
  centerRows?: boolean;
}

const DEFAULT_OPTS: Required<LayoutOpts> = {
  rowPitch: 280,
  instancePitch: 360,
  rowX0: 100,
  rowY0: 60,
  groupPadLeft: 24,
  groupPadTop: 36,
  centerRows: true,
};

/**
 * Position every instance given a row assignment + sorted instances
 * per row. Returns the per-instance positions + the per-stage box
 * (for drawing the StageGroupLabel band behind a row).
 */
export function computeInstanceLayout(
  rowAssignment: StageRowAssignment,
  instancesByStage: Map<string, InstanceLayoutInput[]>,
  opts: LayoutOpts = {},
): {
  positions: Map<string, InstancePosition>;
  stageBoxes: Map<string, { x: number; y: number; width: number; row: number }>;
} {
  const o = { ...DEFAULT_OPTS, ...opts };
  const positions = new Map<string, InstancePosition>();
  const stageBoxes = new Map<string, { x: number; y: number; width: number; row: number }>();
  const keyOf = (n: string, i?: string): string => (i !== undefined ? `${n}:${i}` : n);

  // Pass 1 — compute per-stage sorted instances + content width.
  const sortedByStage = new Map<string, InstanceLayoutInput[]>();
  const widthByStage = new Map<string, number>();
  for (const stageId of rowAssignment.stagesByRow) {
    const insts = instancesByStage.get(stageId) ?? [];
    const sorted = [...insts].sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));
    sortedByStage.set(stageId, sorted);
    const width = o.groupPadLeft + Math.max(1, sorted.length) * o.instancePitch + o.groupPadLeft;
    widthByStage.set(stageId, width);
  }
  const maxWidth = widthByStage.size === 0 ? 0 : Math.max(...widthByStage.values());

  // Pass 2 — assign positions with optional centering offset.
  for (const stageId of rowAssignment.stagesByRow) {
    const row = rowAssignment.rowByStage.get(stageId)!;
    const sorted = sortedByStage.get(stageId) ?? [];
    const width = widthByStage.get(stageId) ?? 0;
    const offset = o.centerRows ? Math.max(0, (maxWidth - width) / 2) : 0;
    const y = o.rowY0 + row * o.rowPitch;
    const x0 = o.rowX0 + offset;
    stageBoxes.set(stageId, { x: x0, y, width, row });
    sorted.forEach((inst, idx) => {
      positions.set(keyOf(stageId, inst.itemId), {
        x: x0 + o.groupPadLeft + idx * o.instancePitch,
        y: y + o.groupPadTop,
      });
    });
  }
  return { positions, stageBoxes };
}
