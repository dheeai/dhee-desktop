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
    expect(byId.character_image.kind).toBe('board');
    expect(byId.shots.kind).toBe('sheets');
    expect(byId.film.kind).toBe('film');
    expect(byKind(sections, 'sheets')).toHaveLength(1);
  });

  it('pairs each entity’s media with the text that produced it', () => {
    const shots = doc().sections.find((s) => s.id === 'shots') as Extract<Section, { kind: 'sheets' }>;
    const s1 = shots.entities.find((e) => e.key === 'scene_1_shot_1')!;
    expect(s1.label).toBe('Scene 1 · Shot 1');
    expect(s1.pairs.map((p) => [p.text?.nodeId, p.media?.nodeId])).toEqual([
      ['shot_image_prompt', 'shot_image'],
      ['shot_motion_directive', 'shot_video'],
    ]);
    expect(s1.pairs[0].mediaTag).toBe('first frame');
    expect(s1.pairs[1].mediaTag).toBe('clip');
    expect(s1.thumb?.nodeId).toBe('shot_image');
    expect(s1.pairs[0].text?.headlineField).toBe('imagePrompt');
  });

  it('handles a shot with a written prompt but no media yet (running, text-only pair)', () => {
    const shots = doc().sections.find((s) => s.id === 'shots') as Extract<Section, { kind: 'sheets' }>;
    const s2 = shots.entities.find((e) => e.key === 'scene_1_shot_2')!;
    expect(s2.status).toBe('running');
    expect(s2.pairs).toHaveLength(1);
    expect(s2.pairs[0].text?.nodeId).toBe('shot_image_prompt');
    expect(s2.pairs[0].media).toBeUndefined();
  });
});
