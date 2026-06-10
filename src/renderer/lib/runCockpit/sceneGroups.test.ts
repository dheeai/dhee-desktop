/**
 * sceneGroups — TDD coverage.
 *
 * Failure modes:
 *   1. parseSceneNo pulls the scene index from item ids (snake/kebab/Caps)
 *   2. parseSceneNo is null for reference-style ids (no scene encoded)
 *   3. groupByScene orders scenes ascending, shots numerically within
 *   4. shot_10 sorts after shot_2 (numeric, not lexical)
 *   5. ids without scenes collapse to one trailing 'ungrouped' group
 *   6. all-reference input → a single flat group (→ board), hasScenes false
 */
import { describe, it, expect } from '@jest/globals';
import { parseSceneNo, parseShotNo, groupByScene, hasScenes } from './sceneGroups';

describe('parseSceneNo / parseShotNo', () => {
  it('extracts scene + shot numbers from narrative ids', () => {
    expect(parseSceneNo('scene_1_shot_3')).toBe(1);
    expect(parseSceneNo('scene_12_shot_2')).toBe(12);
    expect(parseSceneNo('Scene-3')).toBe(3);
    expect(parseShotNo('scene_1_shot_3')).toBe(3);
  });
  it('is null for reference ids and missing input', () => {
    expect(parseSceneNo('lara_croft')).toBeNull();
    expect(parseSceneNo(undefined)).toBeNull();
    expect(parseShotNo('main_street')).toBeNull();
  });
});

describe('groupByScene', () => {
  it('orders scenes ascending and shots numerically within a scene', () => {
    const items = [
      { itemId: 'scene_2_shot_1' },
      { itemId: 'scene_1_shot_10' },
      { itemId: 'scene_1_shot_2' },
    ];
    const groups = groupByScene(items);
    expect(groups.map((g) => g.sceneNo)).toEqual([1, 2]);
    expect(groups[0].label).toBe('Scene 1');
    // shot_2 before shot_10 (numeric, not lexical)
    expect(groups[0].items.map((i) => i.itemId)).toEqual(['scene_1_shot_2', 'scene_1_shot_10']);
    expect(hasScenes(groups)).toBe(true);
  });

  it('collapses reference items (no scene) into one trailing board group', () => {
    const items = [
      { itemId: 'scene_1_shot_1' },
      { itemId: 'lara_croft' },
    ];
    const groups = groupByScene(items);
    expect(groups.map((g) => g.key)).toEqual(['scene-1', 'ungrouped']);
    expect(groups[1].sceneNo).toBeNull();
  });

  it('returns a single flat group when nothing encodes a scene', () => {
    const groups = groupByScene([{ itemId: 'lara_croft' }, { itemId: 'floyd' }, { itemId: 'leeann' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sceneNo).toBeNull();
    expect(groups[0].items).toHaveLength(3);
    expect(hasScenes(groups)).toBe(false);
  });
});
