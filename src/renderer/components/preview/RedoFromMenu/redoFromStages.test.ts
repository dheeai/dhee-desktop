/**
 * GIVEN the ordered list of "Redo from..." stages
 * THEN no internal typeId leaks to the user-facing label / description
 *      and the downstream cascade is correctly computed.
 *
 * GIVEN a project.json executorState
 * WHEN resolveNodeIdsForTypeIds picks node ids matching the stage's typeIds
 * THEN it returns every per-item node id of those typeIds (the existing
 *      cascade-invalidation handles their downstream).
 */
import { describe, expect, it } from '@jest/globals';
import {
  REDO_FROM_STAGES,
  downstreamStages,
  resolveNodeIdsForTypeIds,
} from './redoFromStages';

describe('REDO_FROM_STAGES — user-facing surface', () => {
  it('exposes labels that are plain English, not internal typeIds', () => {
    for (const stage of REDO_FROM_STAGES) {
      // No underscores / colon-namespaced ids should sneak into
      // the dropdown label.
      expect(stage.label).not.toMatch(/_/);
      expect(stage.label).not.toMatch(/:/);
      // First character is uppercase — these are titles, not slugs.
      expect(stage.label.charAt(0)).toBe(stage.label.charAt(0).toUpperCase());
    }
  });

  it('exposes a one-line description for each stage (for the confirmation modal)', () => {
    for (const stage of REDO_FROM_STAGES) {
      expect(typeof stage.description).toBe('string');
      expect(stage.description.length).toBeGreaterThan(10);
    }
  });

  it('lists every stage of the writing → rendering pipeline in order (top redoes most)', () => {
    const labels = REDO_FROM_STAGES.map(s => s.label);
    // Top of the list is the earliest stage — story idea.
    expect(labels[0]).toBe('Story idea');
    // Bottom of the list is the latest — final video.
    expect(labels[labels.length - 1]).toBe('Final video');
  });

  it('does NOT expose internal stages the user shouldn\'t see (story_essence, single-type aliases)', () => {
    const keys = new Set(REDO_FROM_STAGES.map(s => s.key));
    // story_essence is a small internal artifact (genre/tone) — user
    // shouldn't need to know about it; resetting story covers it.
    expect(keys.has('story_essence')).toBe(false);
  });
});

describe('downstreamStages', () => {
  it('returns the target stage plus everything below it in order', () => {
    const target = REDO_FROM_STAGES.find(s => s.key === 'scene_breakdowns')!;
    const downstream = downstreamStages(target);
    expect(downstream[0]!.label).toBe('Scene breakdowns');
    expect(downstream[downstream.length - 1]!.label).toBe('Final video');
    expect(downstream.length).toBeGreaterThan(1);
  });

  it('top-of-list target → returns the full list', () => {
    const target = REDO_FROM_STAGES.find(s => s.key === 'plot')!;
    expect(downstreamStages(target)).toEqual(REDO_FROM_STAGES);
  });

  it('bottom-of-list target → just itself', () => {
    const target = REDO_FROM_STAGES.find(s => s.key === 'final_video')!;
    const downstream = downstreamStages(target);
    expect(downstream).toEqual([target]);
  });
});

describe('resolveNodeIdsForTypeIds', () => {
  const projectJson = JSON.stringify({
    executorState: {
      nodes: {
        plot: { typeId: 'plot', status: 'completed' },
        story: { typeId: 'story', status: 'completed' },
        'character:alice': { typeId: 'character', status: 'completed' },
        'character:bob': { typeId: 'character', status: 'completed' },
        'setting:diner': { typeId: 'setting', status: 'completed' },
        'scene:scene_1': { typeId: 'scene', status: 'completed' },
        'scene_video_prompt:scene_1': { typeId: 'scene_video_prompt', status: 'completed' },
        'shot_image_prompt:scene_1_shot_1': { typeId: 'shot_image_prompt', status: 'completed' },
        'shot_image_prompt:scene_1_shot_2': { typeId: 'shot_image_prompt', status: 'completed' },
        final_video: { typeId: 'final_video', status: 'pending' },
      },
    },
  });

  it('returns every per-item node id matching the given typeIds', () => {
    const ids = resolveNodeIdsForTypeIds(projectJson, ['character', 'setting']);
    expect(ids).toEqual(
      expect.arrayContaining(['character:alice', 'character:bob', 'setting:diner']),
    );
    expect(ids).toHaveLength(3);
  });

  it('returns type-level node ids when those are what\'s in the graph', () => {
    const ids = resolveNodeIdsForTypeIds(projectJson, ['plot', 'story', 'final_video']);
    expect(ids).toEqual(
      expect.arrayContaining(['plot', 'story', 'final_video']),
    );
  });

  it('returns [] for typeIds not present in the graph', () => {
    expect(resolveNodeIdsForTypeIds(projectJson, ['object'])).toEqual([]);
  });

  it('returns [] for an unparseable project.json (defensive)', () => {
    expect(resolveNodeIdsForTypeIds('{not json', ['plot'])).toEqual([]);
  });

  it('returns [] when executorState is missing (fresh project)', () => {
    const empty = JSON.stringify({ title: 'something', goal: {} });
    expect(resolveNodeIdsForTypeIds(empty, ['plot'])).toEqual([]);
  });

  it('handles the scene_breakdowns stage (three typeIds across many per-items)', () => {
    const projectWithBreakdowns = JSON.stringify({
      executorState: {
        nodes: {
          'scene_shot_plan:scene_1': { typeId: 'scene_shot_plan' },
          'shot_breakdown:scene_1_shot_1': { typeId: 'shot_breakdown' },
          'shot_breakdown:scene_1_shot_2': { typeId: 'shot_breakdown' },
          'scene_video_prompt:scene_1': { typeId: 'scene_video_prompt' },
          'shot_image_prompt:scene_1_shot_1': { typeId: 'shot_image_prompt' },
        },
      },
    });
    const stage = REDO_FROM_STAGES.find(s => s.key === 'scene_breakdowns')!;
    const ids = resolveNodeIdsForTypeIds(projectWithBreakdowns, stage.typeIds);
    expect(ids).toEqual(
      expect.arrayContaining([
        'scene_shot_plan:scene_1',
        'shot_breakdown:scene_1_shot_1',
        'shot_breakdown:scene_1_shot_2',
        'scene_video_prompt:scene_1',
      ]),
    );
    // shot_image_prompt is NOT in the scene_breakdowns stage —
    // cascade-invalidation will reach it via dependents.
    expect(ids).not.toContain('shot_image_prompt:scene_1_shot_1');
  });
});
