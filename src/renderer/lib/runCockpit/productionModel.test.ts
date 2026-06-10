/**
 * productionModel — TDD coverage for the single pure shape function.
 *
 * Guards:
 *   1. every stage → a pill with its own live status (running lights up).
 *   2. shot-keyed stages merge into ONE 'sheets' section; each entity card
 *      has its artifacts PAIRED (media + the text that produced it).
 *   3. text singles → doc (breakdowns collapsed); non-shot visual → board;
 *      terminal visual → film with a hero phase.
 *   4. pairing handles absence (prompt written, media pending) without crash.
 */
import { describe, it, expect } from '@jest/globals';
import { deriveRunModel } from './deriveRunModel';
import { buildProductionDoc, type Section } from './productionModel';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

const NOW = 1_700_000_000_000;
const inst = (nodeId: string, status: InstanceGraphNode['status'], extra: Partial<InstanceGraphNode> = {}): InstanceGraphNode => ({ nodeId, status, ...extra });

const BUNDLE = [
  { id: 'story', kind: 'stage', outputs: { format: 'md' } },
  { id: 'characters_plan', kind: 'stage', outputs: { format: 'json' } },
  { id: 'character_image', kind: 'collection', outputs: { format: 'image' }, displayName: 'Cast' },
  { id: 'shot_image_prompt', kind: 'collection', outputs: { format: 'json' }, displayName: 'Shot Prompts' },
  { id: 'shot_image', kind: 'collection', outputs: { format: 'image' }, displayName: 'Shots' },
  { id: 'shot_motion_directive', kind: 'collection', outputs: { format: 'json' }, displayName: 'Motion Directives' },
  { id: 'shot_video', kind: 'collection', outputs: { format: 'video' }, displayName: 'Clips' },
  { id: 'final_video', kind: 'stage', outputs: { format: 'video' } },
];

const HEADLINES = new Map<string, string | undefined>([
  ['shot_image_prompt', 'imagePrompt'],
  ['shot_motion_directive', 'description'],
]);

const INSTANCES: InstanceGraphNode[] = [
  inst('story', 'completed', { outputPath: 'story.md' }),
  inst('characters_plan', 'completed', { outputPath: 'characters.json' }),
  inst('character_image', 'completed', { itemId: 'lyla', outputPath: 'c/lyla.png' }),
  inst('character_image', 'completed', { itemId: 'floyd', outputPath: 'c/floyd.png' }),
  inst('shot_image_prompt', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'p/s1s1.json' }),
  inst('shot_image_prompt', 'in_progress', { itemId: 'scene_1_shot_2' }),
  inst('shot_image', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'img/s1s1_first.png' }),
  inst('shot_motion_directive', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'm/s1s1.json' }),
  inst('shot_video', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'v/s1s1.mp4' }),
  inst('final_video', 'pending'),
];

function doc() {
  const model = deriveRunModel({ instances: INSTANCES, edges: [], bundleNodes: BUNDLE, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
  return buildProductionDoc(model, HEADLINES);
}
const byKind = (sections: Section[], kind: Section['kind']) => sections.filter((s) => s.kind === kind);

describe('buildProductionDoc', () => {
  it('emits a pill per stage with live status', () => {
    const { pills } = doc();
    expect(pills.map((p) => p.stageId)).toEqual([
      'story', 'characters_plan', 'character_image', 'shot_image_prompt', 'shot_image', 'shot_motion_directive', 'shot_video', 'final_video',
    ]);
    expect(pills.find((p) => p.stageId === 'shot_image_prompt')!.status).toBe('active');
    expect(pills.find((p) => p.stageId === 'story')!.status).toBe('done');
  });

  it('classifies sections: doc / board / sheets / film', () => {
    const { sections } = doc();
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    expect(byId.story.kind).toBe('doc');
    expect((byId.story as Extract<Section, { kind: 'doc' }>).collapsed).toBe(false);
    expect(byId.characters_plan.kind).toBe('doc');
    expect((byId.characters_plan as Extract<Section, { kind: 'doc' }>).collapsed).toBe(true);
    expect(byId.character.kind).toBe('board'); // character_image alone (media-only) → board
    expect(byId.shot.kind).toBe('sheets'); // shot_* prompt+media → sheets, keyed by entity prefix
    expect(byId.film.kind).toBe('film');
    expect(byKind(sections, 'sheets')).toHaveLength(1);
  });

  it('pairs each entity’s media with the text that produced it', () => {
    const shots = doc().sections.find((s) => s.id === 'shot') as Extract<Section, { kind: 'sheets' }>;
    const s1 = shots.entities.find((e) => e.key === 'scene_1_shot_1')!;
    expect(s1.label).toBe('Scene 1 · Shot 1');
    expect(s1.pairs.map((p) => [p.text?.nodeId, p.media?.nodeId])).toEqual([
      ['shot_image_prompt', 'shot_image'],
      ['shot_motion_directive', 'shot_video'],
    ]);
    // single-frame shot (no last frame) → media tag is the stage label, not "first frame"
    expect(s1.pairs[0].mediaTag).toBe('Shots');
    expect(s1.pairs[1].mediaTag).toBe('clip');
    expect(s1.thumb?.nodeId).toBe('shot_image');
    expect(s1.pairs[0].text?.headlineField).toBe('imagePrompt');
  });

  it('prompt-relay: surfaces the per-scene clip on every shot of that scene', () => {
    // narrative_prompt_relay: shots have a motion directive but NO shot_video;
    // the clip is per-scene (item id `scene_1`, no shot number).
    const RELAY = [
      { id: 'shot_image_prompt', kind: 'node', outputs: { format: 'json' }, displayName: 'Shot Prompts' },
      { id: 'shot_image', kind: 'node', outputs: { format: 'image' }, displayName: 'Shots' },
      { id: 'shot_motion_directive', kind: 'node', outputs: { format: 'json' }, displayName: 'Motion Directives' },
      { id: 'scene_clip', kind: 'node', outputs: { format: 'video' }, displayName: 'Clips' },
    ];
    const insts: InstanceGraphNode[] = [
      inst('shot_image_prompt', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'p/a.json' }),
      inst('shot_image', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'i/a.png' }),
      inst('shot_motion_directive', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'm/a.json' }),
      inst('shot_image_prompt', 'completed', { itemId: 'scene_1_shot_2', outputPath: 'p/b.json' }),
      inst('shot_image', 'completed', { itemId: 'scene_1_shot_2', outputPath: 'i/b.png' }),
      inst('shot_motion_directive', 'completed', { itemId: 'scene_1_shot_2', outputPath: 'm/b.json' }),
      inst('scene_clip', 'completed', { itemId: 'scene_1', outputPath: 'v/scene_1.mp4' }),
    ];
    const model = deriveRunModel({ instances: insts, edges: [], bundleNodes: RELAY, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
    const shots = buildProductionDoc(model).sections.find((s) => s.id === 'shot') as Extract<Section, { kind: 'sheets' }>;
    // both shots of scene 1 show the SAME scene clip (its motion-directive pair)
    for (const key of ['scene_1_shot_1', 'scene_1_shot_2']) {
      const e = shots.entities.find((x) => x.key === key)!;
      const clipPair = e.pairs.find((p) => p.media?.format === 'video');
      expect(clipPair?.media?.outputPath).toBe('v/scene_1.mp4');
      expect(clipPair?.mediaTag).toBe('scene clip');
    }
  });

  it('groups a scene’s clip prompt + ALL its clips (chunks) into one sheet', () => {
    const RELAY = [
      { id: 'scene_video_prompt', kind: 'node', outputs: { format: 'json' }, displayName: 'Clip Prompts' },
      { id: 'scene_clip', kind: 'node', outputs: { format: 'video' }, displayName: 'Clips' },
    ];
    const insts: InstanceGraphNode[] = [
      inst('scene_video_prompt', 'completed', { itemId: 'scene_1', outputPath: 'p/s1.json' }),
      inst('scene_clip', 'completed', { itemId: 'scene_1_chunk_1', outputPath: 'v/s1c1.mp4' }),
      inst('scene_clip', 'completed', { itemId: 'scene_1_chunk_2', outputPath: 'v/s1c2.mp4' }),
      inst('scene_video_prompt', 'completed', { itemId: 'scene_2', outputPath: 'p/s2.json' }),
      inst('scene_clip', 'completed', { itemId: 'scene_2_chunk_1', outputPath: 'v/s2c1.mp4' }),
    ];
    const model = deriveRunModel({ instances: insts, edges: [], bundleNodes: RELAY, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
    const scenes = buildProductionDoc(model).sections.find((s) => s.id === 'scene') as Extract<Section, { kind: 'sheets' }>;
    expect(scenes.entities.map((e) => e.key)).toEqual(['scene_1', 'scene_2']); // chunks collapse by scene
    const s1 = scenes.entities.find((e) => e.key === 'scene_1')!;
    // BOTH chunk clips shown, plus the scene clip prompt
    expect(s1.pairs.map((p) => p.media?.outputPath).filter(Boolean)).toEqual(['v/s1c1.mp4', 'v/s1c2.mp4']);
    expect(s1.pairs.some((p) => p.text?.nodeId === 'scene_video_prompt')).toBe(true);
  });

  it('handles a shot with a written prompt but no media yet (running, text-only pair)', () => {
    const shots = doc().sections.find((s) => s.id === 'shot') as Extract<Section, { kind: 'sheets' }>;
    const s2 = shots.entities.find((e) => e.key === 'scene_1_shot_2')!;
    expect(s2.status).toBe('running');
    expect(s2.pairs).toHaveLength(1);
    expect(s2.pairs[0].text?.nodeId).toBe('shot_image_prompt');
    expect(s2.pairs[0].media).toBeUndefined();
  });
});
