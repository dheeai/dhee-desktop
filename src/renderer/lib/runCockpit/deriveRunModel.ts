/**
 * deriveRunModel — the single pure reducer behind the run cockpit.
 *
 * Folds the live instance graph (events.jsonl projection) + bundle node
 * metadata + runner/agent status into ONE bundle-agnostic view model.
 * Every human-facing element of the cockpit (transport bar, stage rail,
 * counter, current node, deliverables strip, ETA) reads from this — so the
 * exact same chrome serves a narrative video bundle and a financial-report
 * bundle. `now` is injected for deterministic elapsed/ETA. See
 * deriveRunModel.test.ts.
 */
import type { InstanceGraphNode, InstanceGraphEdge } from '../../../shared/dheeIpc';
import { computeStageRows } from '../../inspector/instanceLayout';
import { humanizeId, phaseVerb, pluralizeNoun } from './vocab';
import { inferArtifactFormat, isPreviewable, type ArtifactFormat } from './artifactFormat';

export type RunActivity = 'idle' | 'thinking' | 'running' | 'cancelling';
export type StageStatus = 'pending' | 'active' | 'done' | 'failed';
/** Coarse output kind — drives Script-reading-room vs gallery in the Production View. */
export type StageKind = 'text' | 'visual' | 'unknown';

export interface RunStageView {
  id: string;
  label: string;
  total: number;
  done: number;
  running: number;
  failed: number;
  pending: number;
  invalidated: number;
  status: StageStatus;
  format?: string;
  previewable: boolean;
  kind: StageKind;
  /** True when the bundle declares this node a 'collection' (fan-out), not a single 'stage'. */
  collection: boolean;
  /** This stage's instances, formatted + sorted by item id, for the gallery/board. */
  items: RunDeliverable[];
}

export interface RunCurrentNode {
  nodeId: string;
  itemId?: string;
  stageLabel: string;
  itemLabel?: string;
  format?: string;
}

export interface RunDeliverable {
  key: string;
  nodeId: string;
  itemId?: string;
  outputPath?: string;
  format: ArtifactFormat;
  status: InstanceGraphNode['status'];
  label: string;
  ts?: number;
}

export interface RunModel {
  activity: RunActivity;
  phaseVerb: string;
  activeStage: RunStageView | null;
  currentNode: RunCurrentNode | null;
  stages: RunStageView[];
  overall: { done: number; total: number; pct: number };
  unitNoun: string;
  /** Instances not yet built (pending + in_progress + invalidated) — the rebuild scope. */
  cascadeCount: number;
  deliverables: RunDeliverable[];
  deliverableStageLabel: string | null;
  elapsedMs: number | null;
  etaMs: number | null;
}

export interface DeriveBundleNode {
  id: string;
  kind?: string;
  displayName?: string;
  outputs?: { format?: string };
}

export interface DeriveRunModelInput {
  instances: InstanceGraphNode[];
  edges: InstanceGraphEdge[];
  bundleNodes?: DeriveBundleNode[];
  /**
   * Per-stage expected item count, keyed by nodeId — how many items a
   * collection WILL ultimately produce, resolved from the bundle's
   * itemSource/itemKey fan-out metadata (see computeExpectedTotals). Lets a
   * stage show a stable "47 / 50" instead of a denominator that creeps up
   * as the walker lazily materializes each item (47/48 → 48/49 …). Absent
   * entries fall back to the materialized instance count.
   */
  expectedTotals?: Record<string, number>;
  runnerActive: boolean;
  cancelling: boolean;
  agentBusy: boolean;
  startedAt?: number;
  now: number;
}

function keyOf(nodeId: string, itemId: string | undefined): string {
  return itemId !== undefined ? `${nodeId}:${itemId}` : nodeId;
}

function kindOf(format: string | undefined): StageKind {
  if (format === 'image' || format === 'video' || format === 'audio') return 'visual';
  if (format === 'md' || format === 'json' || format === 'txt') return 'text';
  return 'unknown';
}

/** Narrow an arbitrary format string to the previewable ArtifactFormat union. */
function coerceFormat(format: string | undefined): ArtifactFormat {
  if (
    format === 'image' ||
    format === 'video' ||
    format === 'audio' ||
    format === 'json' ||
    format === 'md'
  ) {
    return format;
  }
  return 'unknown';
}

export function deriveRunModel(input: DeriveRunModelInput): RunModel {
  const {
    instances,
    edges,
    bundleNodes,
    expectedTotals,
    runnerActive,
    cancelling,
    agentBusy,
    startedAt,
    now,
  } = input;

  const activity: RunActivity = cancelling
    ? 'cancelling'
    : runnerActive
      ? 'running'
      : agentBusy
        ? 'thinking'
        : 'idle';

  // Group instances by stage (nodeId).
  const byStage = new Map<string, InstanceGraphNode[]>();
  for (const i of instances) {
    const list = byStage.get(i.nodeId) ?? [];
    list.push(i);
    byStage.set(i.nodeId, list);
  }

  // Stage order: prefer the bundle's declared node order (topo); else fall
  // back to a topo sort of the instance edges; else insertion order.
  let order: string[];
  if (bundleNodes && bundleNodes.length) {
    order = bundleNodes.map((n) => n.id).filter((id) => byStage.has(id));
    for (const id of byStage.keys()) if (!order.includes(id)) order.push(id);
  } else {
    const stageIds = [...byStage.keys()];
    try {
      order = computeStageRows(stageIds, edges).stagesByRow;
    } catch {
      order = stageIds;
    }
    for (const id of stageIds) if (!order.includes(id)) order.push(id);
  }

  const bundleFormat = new Map<string, string | undefined>();
  const bundleKind = new Map<string, string | undefined>();
  const bundleDisplayName = new Map<string, string | undefined>();
  if (bundleNodes) {
    for (const n of bundleNodes) {
      bundleFormat.set(n.id, n.outputs?.format);
      bundleKind.set(n.id, n.kind);
      bundleDisplayName.set(n.id, n.displayName);
    }
  }

  function stageFormat(id: string, insts: InstanceGraphNode[]): string | undefined {
    const bf = bundleFormat.get(id);
    if (bf) return bf;
    const withPath = insts.find((i) => i.outputPath);
    if (withPath) {
      const f = inferArtifactFormat(withPath.outputPath);
      if (f !== 'unknown') return f;
    }
    return undefined;
  }

  const stages: RunStageView[] = order.map((id) => {
    const insts = byStage.get(id) ?? [];
    let done = 0;
    let running = 0;
    let failed = 0;
    let pending = 0;
    let invalidated = 0;
    for (const i of insts) {
      if (i.status === 'completed') done += 1;
      else if (i.status === 'in_progress') running += 1;
      else if (i.status === 'failed') failed += 1;
      else if (i.status === 'invalidated') invalidated += 1;
      else pending += 1;
    }
    // Total = the bundle-declared expected fan-out count when known and
    // larger than what's materialized so far (the denominator stays stable
    // as items stream in); else the materialized count. `pending` absorbs
    // the not-yet-materialized remainder so done+running+failed+pending+
    // invalidated === total.
    const materialized = insts.length;
    const expected = expectedTotals?.[id];
    const total =
      typeof expected === 'number' && expected > materialized ? expected : materialized;
    pending = total - done - running - failed - invalidated;
    let status: StageStatus;
    if (running > 0) status = 'active';
    else if (failed > 0) status = 'failed';
    else if (total > 0 && done === total) status = 'done';
    else status = 'pending';
    const fmt = stageFormat(id, insts);
    const items: RunDeliverable[] = [...insts]
      .sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''))
      .map((i) => {
        const inferred = i.outputPath ? inferArtifactFormat(i.outputPath) : 'unknown';
        const format: ArtifactFormat = inferred !== 'unknown' ? inferred : coerceFormat(fmt);
        return {
          key: keyOf(i.nodeId, i.itemId),
          nodeId: i.nodeId,
          itemId: i.itemId,
          outputPath: i.outputPath,
          format,
          status: i.status,
          label: humanizeId(i.itemId ?? i.nodeId),
          ts: i.ts,
        };
      });
    return {
      id,
      label: bundleDisplayName.get(id) ?? humanizeId(id),
      total,
      done,
      running,
      failed,
      pending,
      invalidated,
      status,
      format: fmt,
      previewable: fmt ? isPreviewable(fmt) : false,
      kind: kindOf(fmt),
      collection: bundleKind.get(id) === 'collection',
      items,
    };
  });

  // Active stage: the one with work in flight; else the first not-done
  // stage while a run/agent is active.
  let activeStage: RunStageView | null = null;
  if (activity !== 'idle') {
    activeStage =
      stages.find((s) => s.status === 'active') ??
      stages.find((s) => s.status !== 'done') ??
      null;
  }

  // Current node = the first in-flight instance.
  let currentNode: RunCurrentNode | null = null;
  const runningInst = instances.find((i) => i.status === 'in_progress');
  if (runningInst) {
    const fmt =
      bundleFormat.get(runningInst.nodeId) ??
      (runningInst.outputPath ? inferArtifactFormat(runningInst.outputPath) : undefined);
    currentNode = {
      nodeId: runningInst.nodeId,
      itemId: runningInst.itemId,
      stageLabel: humanizeId(runningInst.nodeId),
      itemLabel: runningInst.itemId ? humanizeId(runningInst.itemId) : undefined,
      format: fmt ?? undefined,
    };
  }

  // Overall progress over instances.
  let oDone = 0;
  let oTotal = 0;
  for (const s of stages) {
    oDone += s.done;
    oTotal += s.total;
  }
  const overall = {
    done: oDone,
    total: oTotal,
    pct: oTotal > 0 ? Math.round((oDone / oTotal) * 100) : 0,
  };

  // Vocabulary, derived from the active stage.
  const verb = activeStage ? phaseVerb(activeStage.format) : 'Working';
  const unitNoun = activeStage
    ? pluralizeNoun(humanizeId(activeStage.id).toLowerCase(), activeStage.total)
    : 'nodes';

  // Rebuild scope: everything not yet successfully built across the whole
  // run. Derived from the (expected-aware) stage totals so it counts items
  // the walker hasn't materialized yet — not just live instances. Excludes
  // `failed` (errored, not pending-to-build); with no expected data this
  // equals the old in_progress+pending+invalidated instance count.
  let cascadeCount = 0;
  for (const s of stages) {
    cascadeCount += Math.max(0, s.total - s.done - s.failed);
  }

  // Deliverables strip: the active stage if it is previewable, else the
  // furthest-downstream previewable stage that has any landed/in-flight
  // artifact. Empty (strip hides) when nothing previewable has arrived —
  // this is how a pure-data bundle degrades gracefully.
  let deliverableStage: RunStageView | null = null;
  if (activeStage && activeStage.previewable) {
    deliverableStage = activeStage;
  } else {
    for (let k = stages.length - 1; k >= 0; k -= 1) {
      const s = stages[k];
      if (s.previewable && (s.done > 0 || s.running > 0)) {
        deliverableStage = s;
        break;
      }
    }
  }

  // The deliverables strip / Film storyboard reuses the chosen stage's
  // already-formatted items.
  const deliverables: RunDeliverable[] = deliverableStage ? deliverableStage.items : [];
  const deliverableStageLabel: string | null = deliverableStage ? deliverableStage.label : null;

  // Elapsed + approximate ETA (per-item rate of the active stage applied to
  // the remaining instance count). Honest: null unless we have ≥2 samples.
  const elapsedMs = typeof startedAt === 'number' ? Math.max(0, now - startedAt) : null;
  let etaMs: number | null = null;
  if (activeStage) {
    const ts = (byStage.get(activeStage.id) ?? [])
      .filter((i) => i.status === 'completed' && typeof i.ts === 'number')
      .map((i) => i.ts as number)
      .sort((a, b) => a - b);
    if (ts.length >= 2) {
      const perItem = (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
      const remaining = oTotal - oDone;
      if (perItem > 0 && remaining > 0) etaMs = Math.round(perItem * remaining);
    }
  }

  return {
    activity,
    phaseVerb: verb,
    activeStage,
    currentNode,
    stages,
    overall,
    unitNoun,
    cascadeCount,
    deliverables,
    deliverableStageLabel,
    elapsedMs,
    etaMs,
  };
}
