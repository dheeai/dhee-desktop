/**
 * deriveRunModel — TDD coverage.
 *
 * The single pure reducer behind the whole run cockpit. It folds the live
 * instance graph + bundle node metadata + runner/agent status into one
 * bundle-agnostic view model. Everything the chrome shows (phase verb,
 * stage rail, N/M counter, current node, deliverables, ETA) comes from
 * here, so it carries the heavy behavioral coverage.
 *
 * Determinism: `now` is injected (never Date.now()) so ETA/elapsed are
 * testable.
 *
 * Failure modes guarded:
 *   1. idle (no run, no agent) → activity 'idle', empty model, no NaN
 *   2. agent busy but no walk → activity 'thinking'
 *   3. cancelling beats running
 *   4. mid-run: stage rail counts, active stage, current node, overall %
 *   5. unit noun + phase verb are derived from the ACTIVE stage
 *   6. cascadeCount = not-yet-built instances (the rebuild scope)
 *   7. deliverables come from the active stage when it is previewable
 *   8. NON-video bundle (financial): different verb/noun, and the strip
 *      gracefully empties when no previewable artifact has landed yet
 *   9. stage ordering falls back to topo (edges) when no bundle given,
 *      and format is inferred from instance outputPath in that case
 *  10. ETA derived from completed timestamps; null when <2 samples
 *  11. elapsedMs from startedAt; null when absent
 */
import { describe, it, expect } from '@jest/globals';
import { deriveRunModel } from './deriveRunModel';
import type { InstanceGraphNode, InstanceGraphEdge } from '../../../shared/dheeIpc';

type BNode = {
  id: string;
  kind: 'stage' | 'collection';
  outputs: { format: string; pattern: string };
  inputs?: Array<{ from: string }>;
};

const NOW = 1_000_000_000_000;

function inst(
  nodeId: string,
  status: InstanceGraphNode['status'],
  extra: Partial<InstanceGraphNode> = {},
): InstanceGraphNode {
  return { nodeId, status, ...extra };
}

// A narrative video bundle (topo order).
const NARRATIVE: BNode[] = [
  { id: 'story', kind: 'stage', outputs: { format: 'md', pattern: 'story.md' } },
  { id: 'scenes_plan', kind: 'stage', outputs: { format: 'json', pattern: 'scenes.json' }, inputs: [{ from: 'story' }] },
  { id: 'character_image', kind: 'collection', outputs: { format: 'image', pattern: 'c/{id}.png' }, inputs: [{ from: 'scenes_plan' }] },
  { id: 'shot_image', kind: 'collection', outputs: { format: 'image', pattern: 's/{id}.png' }, inputs: [{ from: 'scenes_plan' }] },
  { id: 'shot_video', kind: 'collection', outputs: { format: 'video', pattern: 'v/{id}.mp4' }, inputs: [{ from: 'shot_image' }] },
  { id: 'final_video', kind: 'stage', outputs: { format: 'video', pattern: 'final.mp4' }, inputs: [{ from: 'shot_video' }] },
];

describe('deriveRunModel — activity', () => {
  it('is idle with no run and no agent, and never produces NaN', () => {
    const m = deriveRunModel({ instances: [], edges: [], runnerActive: false, cancelling: false, agentBusy: false, now: NOW });
    expect(m.activity).toBe('idle');
    expect(m.stages).toEqual([]);
    expect(m.overall).toEqual({ done: 0, total: 0, pct: 0 });
    expect(m.currentNode).toBeNull();
    expect(m.activeStage).toBeNull();
    expect(m.deliverables).toEqual([]);
    expect(m.elapsedMs).toBeNull();
    expect(m.etaMs).toBeNull();
  });

  it('is thinking when the agent is busy but no walk is running', () => {
    const m = deriveRunModel({ instances: [], edges: [], runnerActive: false, cancelling: false, agentBusy: true, now: NOW });
    expect(m.activity).toBe('thinking');
  });

  it('cancelling takes precedence over running', () => {
    const m = deriveRunModel({ instances: [inst('story', 'in_progress')], edges: [], runnerActive: true, cancelling: true, agentBusy: false, now: NOW });
    expect(m.activity).toBe('cancelling');
  });
});

describe('deriveRunModel — mid-run narrative', () => {
  // story✓ scenes✓ chars 4/4✓ shot_image 6✓+1●+16○ shot_video 23○ final 1○
  const tsBase = NOW - 60_000;
  const completedShots = Array.from({ length: 6 }, (_, i) =>
    inst('shot_image', 'completed', { itemId: `s${i + 1}`, outputPath: `s/s${i + 1}.png`, ts: tsBase + i * 10_000 }),
  ); // 6 samples, 10s apart → perItem 10s
  const instances: InstanceGraphNode[] = [
    inst('story', 'completed', { outputPath: 'story.md' }),
    inst('scenes_plan', 'completed', { outputPath: 'scenes.json' }),
    ...Array.from({ length: 4 }, (_, i) => inst('character_image', 'completed', { itemId: `c${i + 1}`, outputPath: `c/c${i + 1}.png` })),
    ...completedShots,
    inst('shot_image', 'in_progress', { itemId: 's7' }),
    ...Array.from({ length: 16 }, (_, i) => inst('shot_image', 'pending', { itemId: `s${i + 8}` })),
    ...Array.from({ length: 23 }, (_, i) => inst('shot_video', 'pending', { itemId: `v${i + 1}` })),
    inst('final_video', 'pending'),
  ];

  const model = deriveRunModel({
    instances,
    edges: [],
    bundleNodes: NARRATIVE,
    runnerActive: true,
    cancelling: false,
    agentBusy: false,
    startedAt: NOW - 134_000,
    now: NOW,
  });

  it('reports running with the active stage and current node', () => {
    expect(model.activity).toBe('running');
    expect(model.activeStage?.id).toBe('shot_image');
    expect(model.activeStage?.done).toBe(6);
    expect(model.activeStage?.running).toBe(1);
    expect(model.activeStage?.total).toBe(23);
    expect(model.activeStage?.status).toBe('active');
    expect(model.currentNode?.nodeId).toBe('shot_image');
    expect(model.currentNode?.itemId).toBe('s7');
    expect(model.currentNode?.stageLabel).toBe('Shot Image');
  });

  it('orders the stage rail by the bundle and stamps per-stage status', () => {
    expect(model.stages.map((s) => s.id)).toEqual([
      'story', 'scenes_plan', 'character_image', 'shot_image', 'shot_video', 'final_video',
    ]);
    const byId = Object.fromEntries(model.stages.map((s) => [s.id, s]));
    expect(byId.story.status).toBe('done');
    expect(byId.character_image.status).toBe('done');
    expect(byId.shot_image.status).toBe('active');
    expect(byId.shot_video.status).toBe('pending');
  });

  it('computes overall progress over instances', () => {
    // done: 1+1+4+6 = 12 ; total: 1+1+4+23+23+1 = 53
    expect(model.overall.done).toBe(12);
    expect(model.overall.total).toBe(53);
    expect(model.overall.pct).toBe(23); // round(12/53*100)
  });

  it('derives the unit noun + phase verb from the active stage', () => {
    expect(model.phaseVerb).toBe('Rendering'); // shot_image format=image
    expect(model.unitNoun).toBe('shot images'); // humanize+pluralize, lowercased
  });

  it('reports the rebuild scope (not-yet-built instances)', () => {
    // shot_image: 1 in_progress + 16 pending = 17 ; shot_video 23 ; final 1 → 41
    expect(model.cascadeCount).toBe(41);
  });

  it('feeds the deliverables strip from the active previewable stage', () => {
    expect(model.deliverableStageLabel).toBe('Shot Image');
    expect(model.deliverables).toHaveLength(23);
    const done = model.deliverables.filter((d) => d.status === 'completed');
    expect(done).toHaveLength(6);
    expect(done[0].format).toBe('image');
    expect(done[0].outputPath).toMatch(/\.png$/);
    // strip stays ordered by item id
    expect(model.deliverables[0].itemId).toBe('s1');
  });

  it('exposes each stage’s formatted items and a text/visual kind', () => {
    const byId = Object.fromEntries(model.stages.map((s) => [s.id, s]));
    expect(byId.shot_image.kind).toBe('visual');
    expect(byId.scenes_plan.kind).toBe('text');
    expect(byId.shot_image.items).toHaveLength(23);
    expect(byId.shot_image.items[0].itemId).toBe('s1');
    expect(byId.shot_image.items[0].format).toBe('image');
    // deliverables = the active previewable stage's own items
    expect(model.deliverables).toBe(byId.shot_image.items);
  });

  it('derives elapsed + an approximate ETA from completion timestamps', () => {
    expect(model.elapsedMs).toBe(134_000);
    // perItem = (5*10000)/5 = 10000ms ; remaining = 53-12 = 41 → 410000ms
    expect(model.etaMs).toBe(410_000);
  });
});

describe('deriveRunModel — ETA guards', () => {
  it('is null when fewer than 2 completed timestamps exist in the active stage', () => {
    const instances = [
      inst('shot_image', 'completed', { itemId: 's1', outputPath: 's/s1.png', ts: NOW - 10_000 }),
      inst('shot_image', 'in_progress', { itemId: 's2' }),
      inst('shot_image', 'pending', { itemId: 's3' }),
    ];
    const m = deriveRunModel({ instances, edges: [], bundleNodes: NARRATIVE, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
    expect(m.etaMs).toBeNull();
  });
});

describe('deriveRunModel — no bundle (topo fallback + path-inferred format)', () => {
  it('orders stages topologically from edges and infers format from outputPath', () => {
    const instances = [
      inst('story', 'completed', { outputPath: 'story.md' }),
      inst('scenes_plan', 'completed', { outputPath: 'scenes.json' }),
      inst('shot_image', 'in_progress', { itemId: 's1', outputPath: 's/s1.png' }),
      inst('shot_image', 'completed', { itemId: 's0', outputPath: 's/s0.png', ts: NOW - 5_000 }),
    ];
    const edges: InstanceGraphEdge[] = [
      { fromNodeId: 'story', toNodeId: 'scenes_plan' },
      { fromNodeId: 'scenes_plan', toNodeId: 'shot_image' },
    ];
    const m = deriveRunModel({ instances, edges, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
    expect(m.stages.map((s) => s.id)).toEqual(['story', 'scenes_plan', 'shot_image']);
    expect(m.activeStage?.id).toBe('shot_image');
    // format inferred from .png even with no bundle metadata
    expect(m.phaseVerb).toBe('Rendering');
    expect(m.deliverableStageLabel).toBe('Shot Image');
  });
});

describe('deriveRunModel — non-video bundle stays agnostic', () => {
  const FINANCIAL: BNode[] = [
    { id: 'ingest', kind: 'stage', outputs: { format: 'json', pattern: 'raw.json' } },
    { id: 'metrics', kind: 'collection', outputs: { format: 'json', pattern: 'm/{id}.json' }, inputs: [{ from: 'ingest' }] },
    { id: 'charts', kind: 'collection', outputs: { format: 'image', pattern: 'ch/{id}.png' }, inputs: [{ from: 'metrics' }] },
    { id: 'report', kind: 'stage', outputs: { format: 'pdf', pattern: 'report.pdf' }, inputs: [{ from: 'charts' }] },
  ];
  it('uses computed-data vocabulary and hides deliverables until something previewable lands', () => {
    const instances = [
      inst('ingest', 'completed', { outputPath: 'raw.json' }),
      inst('metrics', 'in_progress', { itemId: 'q3_revenue' }),
      ...Array.from({ length: 17 }, (_, i) => inst('metrics', 'pending', { itemId: `m${i}` })),
      inst('charts', 'pending', { itemId: 'c0' }),
      inst('report', 'pending'),
    ];
    const m = deriveRunModel({ instances, edges: [], bundleNodes: FINANCIAL, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
    expect(m.activeStage?.id).toBe('metrics');
    expect(m.phaseVerb).toBe('Writing'); // json → not "Rendering"
    expect(m.unitNoun).toBe('metrics'); // already-plural noun untouched
    // charts (previewable) has nothing completed yet → strip empties, no crash
    expect(m.deliverableStageLabel).toBeNull();
    expect(m.deliverables).toEqual([]);
  });
});
