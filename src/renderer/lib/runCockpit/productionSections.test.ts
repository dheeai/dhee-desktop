/**
 * productionSections — TDD coverage.
 *
 * Failure modes guarded:
 *   1. EVERY stage gets its own pill carrying its own live status (the bug
 *      was one collapsed "Script" pill that never followed the run).
 *   2. shot-keyed collection stages (prompt/frame/motion/clip) all merge into
 *      ONE 'shots' section, and their pills share that section's scroll id.
 *   3. text/json single stages → 'doc' sections; non-shot-keyed visual
 *      collection → 'board'; terminal single visual → 'film'.
 *   4. a running stage surfaces as pill.status === 'active'.
 */
import { describe, it, expect } from '@jest/globals';
import { deriveRunModel } from './deriveRunModel';
import { buildProductionLayout, isShotKeyedStage, SHOTS_SECTION_ID } from './productionSections';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

const NOW = 1_700_000_000_000;
const inst = (nodeId: string, status: InstanceGraphNode['status'], extra: Partial<InstanceGraphNode> = {}): InstanceGraphNode => ({ nodeId, status, ...extra });

const BUNDLE = [
  { id: 'story', kind: 'stage', outputs: { format: 'md' } },
  { id: 'scenes_plan', kind: 'stage', outputs: { format: 'json' } },
  { id: 'character_image', kind: 'collection', outputs: { format: 'image' }, displayName: 'Cast' },
  { id: 'shot_image_prompt', kind: 'collection', outputs: { format: 'json' }, displayName: 'Shot Prompts' },
  { id: 'shot_image', kind: 'collection', outputs: { format: 'image' }, displayName: 'Shots' },
  { id: 'shot_motion_directive', kind: 'collection', outputs: { format: 'json' }, displayName: 'Motion Directives' },
  { id: 'shot_video', kind: 'collection', outputs: { format: 'video' }, displayName: 'Clips' },
  { id: 'final_video', kind: 'stage', outputs: { format: 'video' } },
];

function layout(instances: InstanceGraphNode[]) {
  const model = deriveRunModel({ instances, edges: [], bundleNodes: BUNDLE, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
  return { model, ...buildProductionLayout(model.stages) };
}

const INSTANCES: InstanceGraphNode[] = [
  inst('story', 'completed', { outputPath: 'story.md' }),
  inst('scenes_plan', 'completed', { outputPath: 'scenes.json' }),
  inst('character_image', 'completed', { itemId: 'lyla', outputPath: 'c/lyla.png' }),
  inst('character_image', 'completed', { itemId: 'floyd', outputPath: 'c/floyd.png' }),
  inst('shot_image_prompt', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'p/scene_1_shot_1.json' }),
  inst('shot_image_prompt', 'in_progress', { itemId: 'scene_1_shot_2' }),
  inst('shot_image', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'img/scene_1_shot_1_first.png' }),
  inst('shot_motion_directive', 'pending', { itemId: 'scene_1_shot_1' }),
  inst('shot_video', 'pending', { itemId: 'scene_1_shot_1' }),
  inst('final_video', 'pending'),
];

describe('isShotKeyedStage', () => {
  it('classifies shot-keyed collections from item ids, not from hardcoded names', () => {
    const { model } = layout(INSTANCES);
    const byId = Object.fromEntries(model.stages.map((s) => [s.id, s]));
    expect(isShotKeyedStage(byId.shot_image_prompt)).toBe(true);
    expect(isShotKeyedStage(byId.shot_image)).toBe(true);
    expect(isShotKeyedStage(byId.shot_motion_directive)).toBe(true);
    expect(isShotKeyedStage(byId.shot_video)).toBe(true);
    expect(isShotKeyedStage(byId.character_image)).toBe(false); // itemId 'lyla' → no scene/shot
    expect(isShotKeyedStage(byId.story)).toBe(false); // not a collection
    expect(isShotKeyedStage(byId.final_video)).toBe(false);
  });
});

describe('buildProductionLayout', () => {
  it('gives every stage its own pill with its own status', () => {
    const { pills } = layout(INSTANCES);
    expect(pills.map((p) => p.stageId)).toEqual([
      'story', 'scenes_plan', 'character_image', 'shot_image_prompt', 'shot_image', 'shot_motion_directive', 'shot_video', 'final_video',
    ]);
    const prompt = pills.find((p) => p.stageId === 'shot_image_prompt')!;
    expect(prompt.status).toBe('active'); // scene_1_shot_2 in_progress
    expect(pills.find((p) => p.stageId === 'story')!.status).toBe('done');
  });

  it('merges all shot-keyed stages into one shots section and points their pills at it', () => {
    const { sections, pills } = layout(INSTANCES);
    const shots = sections.find((s) => s.id === SHOTS_SECTION_ID)!;
    expect(shots.kind).toBe('shots');
    expect(shots.stageIds).toEqual(['shot_image_prompt', 'shot_image', 'shot_motion_directive', 'shot_video']);
    for (const id of shots.stageIds) {
      expect(pills.find((p) => p.stageId === id)!.sectionId).toBe(SHOTS_SECTION_ID);
    }
  });

  it('renders text stages as docs, non-shot visual as board, terminal visual as film', () => {
    const { sections } = layout(INSTANCES);
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    expect(byId.story.kind).toBe('doc');
    expect(byId.scenes_plan.kind).toBe('doc');
    expect(byId.character_image.kind).toBe('board');
    // terminal single visual → 'film' section (keyed 'film', spanning final_video)
    expect(byId.film.kind).toBe('film');
    expect(byId.film.stageIds).toEqual(['final_video']);
    // and its pill scrolls to the film section
    const { pills } = layout(INSTANCES);
    expect(pills.find((p) => p.stageId === 'final_video')!.sectionId).toBe('film');
  });

  it('places exactly one shots section even with many shot stages', () => {
    const { sections } = layout(INSTANCES);
    expect(sections.filter((s) => s.kind === 'shots')).toHaveLength(1);
  });
});
