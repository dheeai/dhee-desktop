/**
 * productionLayers — TDD coverage.
 *
 * Failure modes:
 *   1. text stages collapse into one Script layer
 *   2. terminal single visual stage becomes the Film layer
 *   3. scene-encoded visual stage → gallery; reference stage → board
 *   4. order = Film, Script, galleries, boards
 *   5. default layer = Script while writing (no visual output), Film once
 *      visual artifacts land
 *   6. a non-narrative (no final video, no scenes) bundle still yields sane
 *      layers (board, Script) and a default
 */
import { describe, it, expect } from '@jest/globals';
import { deriveRunModel } from './deriveRunModel';
import { buildProductionLayers, pickDefaultLayer } from './productionLayers';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

const NOW = 1_000_000_000_000;
const inst = (nodeId: string, status: InstanceGraphNode['status'], extra: Partial<InstanceGraphNode> = {}): InstanceGraphNode => ({ nodeId, status, ...extra });

const NARRATIVE = [
  { id: 'story', kind: 'stage', outputs: { format: 'md', pattern: 'story.md' } },
  { id: 'scenes_plan', kind: 'stage', outputs: { format: 'json', pattern: 's.json' } },
  { id: 'character_image', kind: 'collection', outputs: { format: 'image', pattern: 'c/{id}.png' } },
  { id: 'shot_image', kind: 'collection', outputs: { format: 'image', pattern: 's/{id}.png' } },
  { id: 'scene_clip', kind: 'collection', outputs: { format: 'video', pattern: 'v/{id}.mp4' } },
  { id: 'final_video', kind: 'stage', outputs: { format: 'video', pattern: 'final.mp4' } },
];

function narrativeStages(opts: { shotsDone: number }) {
  const instances: InstanceGraphNode[] = [
    inst('story', 'completed', { outputPath: 'story.md' }),
    inst('scenes_plan', 'completed', { outputPath: 's.json' }),
    inst('character_image', 'completed', { itemId: 'lyla', outputPath: 'c/lyla.png' }),
    inst('character_image', 'completed', { itemId: 'floyd', outputPath: 'c/floyd.png' }),
    inst('scene_clip', 'pending', { itemId: 'scene_1' }),
    inst('final_video', 'pending'),
  ];
  for (let i = 1; i <= 5; i += 1) {
    const done = i <= opts.shotsDone;
    instances.push(inst('shot_image', done ? 'completed' : 'pending', { itemId: `scene_1_shot_${i}`, ...(done ? { outputPath: `s/${i}.png` } : {}) }));
  }
  return deriveRunModel({ instances, edges: [], bundleNodes: NARRATIVE, runnerActive: true, cancelling: false, agentBusy: false, now: NOW }).stages;
}

describe('buildProductionLayers — narrative', () => {
  const layers = buildProductionLayers(narrativeStages({ shotsDone: 3 }));

  it('produces Film, Script, galleries, then boards in that order', () => {
    expect(layers.map((l) => l.id)).toEqual(['film', 'script', 'shot_image', 'scene_clip', 'character_image']);
  });
  it('collapses text stages into Script', () => {
    const script = layers.find((l) => l.id === 'script')!;
    expect(script.kind).toBe('script');
    expect(script.stageIds).toEqual(['story', 'scenes_plan']);
  });
  it('makes the terminal single video the Film layer', () => {
    expect(layers[0]).toMatchObject({ id: 'film', kind: 'film', stageIds: ['final_video'], count: 1 });
  });
  it('classifies scene-encoded stages as galleries and references as boards', () => {
    const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
    expect(byId.shot_image.kind).toBe('gallery');
    expect(byId.scene_clip.kind).toBe('gallery');
    expect(byId.character_image.kind).toBe('board');
    expect(byId.shot_image.count).toBe(5);
  });
});

describe('pickDefaultLayer', () => {
  it('is Script while writing (no visual output yet)', () => {
    const stages = narrativeStages({ shotsDone: 0 });
    // character images are done in the fixture, so force the "writing" case:
    const writing = stages.map((s) => (s.kind === 'visual' ? { ...s, done: 0 } : s));
    const layers = buildProductionLayers(writing);
    expect(pickDefaultLayer(writing, layers)).toBe('script');
  });
  it('is Film once visual artifacts have landed', () => {
    const stages = narrativeStages({ shotsDone: 3 });
    const layers = buildProductionLayers(stages);
    expect(pickDefaultLayer(stages, layers)).toBe('film');
  });
});

describe('buildProductionLayers — non-narrative (financial) stays sane', () => {
  const FIN = [
    { id: 'ingest', kind: 'stage', outputs: { format: 'json', pattern: 'raw.json' } },
    { id: 'metrics', kind: 'collection', outputs: { format: 'json', pattern: 'm/{id}.json' } },
    { id: 'charts', kind: 'collection', outputs: { format: 'image', pattern: 'ch/{id}.png' } },
  ];
  it('yields Script + a charts board, default Script before any chart lands', () => {
    const instances = [
      inst('ingest', 'completed', { outputPath: 'raw.json' }),
      inst('metrics', 'completed', { itemId: 'q3_rev', outputPath: 'm/q3.json' }),
      inst('charts', 'pending', { itemId: 'c0' }),
    ];
    const stages = deriveRunModel({ instances, edges: [], bundleNodes: FIN, runnerActive: true, cancelling: false, agentBusy: false, now: NOW }).stages;
    const layers = buildProductionLayers(stages);
    expect(layers.find((l) => l.id === 'script')).toBeTruthy();
    expect(layers.find((l) => l.id === 'charts')?.kind).toBe('board');
    expect(layers.find((l) => l.kind === 'film')).toBeUndefined(); // no terminal single video
    expect(pickDefaultLayer(stages, layers)).toBe('script');
  });
});
