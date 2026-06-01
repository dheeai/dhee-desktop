/**
 * Layout helpers — TDD coverage.
 *
 * Failure modes:
 *
 *   computeStageRows:
 *     1. Empty stages → empty assignment
 *     2. Single stage, no edges → row 0
 *     3. Linear chain (a→b→c) → rows 0,1,2 in topo order
 *     4. Diamond (a→b, a→c, b→d, c→d) → a,b,c,d each on own row
 *        (one stage per row even when b/c are same rank)
 *     5. Same-rank stages get rows in alphabetical order (stable)
 *     6. Cycle → terminates without infinite loop (cycle guard)
 *     7. Edges with unknown stage ids on either side are ignored
 *     8. Self-loop edges are ignored
 *
 *   forwardDependents:
 *     9. No edges → empty set
 *    10. Start key with no outgoing edges → empty set
 *    11. Linear chain a→b→c, from a → {b, c}
 *    12. ItemId-scoped keys are preserved in output
 *    13. Cycle doesn't loop forever
 *    14. Start key itself is NOT in the result
 *
 *   computeInstanceLayout:
 *    15. Each instance gets a position; y depends on row, x on
 *        instance index within stage
 *    16. Instances sorted alphabetically by itemId for stable layout
 *    17. Stage box width grows with instance count
 *    18. Default opts work; overrides apply
 */
import { describe, it, expect } from '@jest/globals';
import {
  computeStageRows,
  forwardDependents,
  computeInstanceLayout,
} from './instanceLayout';

describe('computeStageRows', () => {
  it('1. empty stages → empty assignment', () => {
    const r = computeStageRows([], []);
    expect(r.stagesByRow).toEqual([]);
    expect(r.rowByStage.size).toBe(0);
  });

  it('2. single stage → row 0', () => {
    const r = computeStageRows(['plot'], []);
    expect(r.rowByStage.get('plot')).toBe(0);
    expect(r.stagesByRow).toEqual(['plot']);
  });

  it('3. linear chain a→b→c → rows 0,1,2', () => {
    const r = computeStageRows(
      ['a', 'b', 'c'],
      [
        { fromNodeId: 'a', toNodeId: 'b' },
        { fromNodeId: 'b', toNodeId: 'c' },
      ],
    );
    expect(r.rowByStage.get('a')).toBe(0);
    expect(r.rowByStage.get('b')).toBe(1);
    expect(r.rowByStage.get('c')).toBe(2);
  });

  it('4. diamond → each stage on its own row (no shared rows)', () => {
    const r = computeStageRows(
      ['a', 'b', 'c', 'd'],
      [
        { fromNodeId: 'a', toNodeId: 'b' },
        { fromNodeId: 'a', toNodeId: 'c' },
        { fromNodeId: 'b', toNodeId: 'd' },
        { fromNodeId: 'c', toNodeId: 'd' },
      ],
    );
    // Each stage should occupy a unique row.
    const rows = ['a', 'b', 'c', 'd'].map((s) => r.rowByStage.get(s));
    expect(new Set(rows).size).toBe(4);
    // a < b, c (a is upstream) ; d > b, c (d is downstream)
    expect(r.rowByStage.get('a')!).toBeLessThan(r.rowByStage.get('b')!);
    expect(r.rowByStage.get('a')!).toBeLessThan(r.rowByStage.get('c')!);
    expect(r.rowByStage.get('d')!).toBeGreaterThan(r.rowByStage.get('b')!);
    expect(r.rowByStage.get('d')!).toBeGreaterThan(r.rowByStage.get('c')!);
  });

  it('5. same-rank stages ordered alphabetically', () => {
    const r = computeStageRows(
      ['a', 'foo', 'bar'],
      [
        { fromNodeId: 'a', toNodeId: 'foo' },
        { fromNodeId: 'a', toNodeId: 'bar' },
      ],
    );
    // a first, then bar then foo (alphabetical at rank 1).
    expect(r.stagesByRow).toEqual(['a', 'bar', 'foo']);
  });

  it('6. cycle terminates (cycle guard)', () => {
    const r = computeStageRows(
      ['a', 'b'],
      [
        { fromNodeId: 'a', toNodeId: 'b' },
        { fromNodeId: 'b', toNodeId: 'a' },
      ],
    );
    expect(r.rowByStage.size).toBe(2);
    // Both stages assigned without infinite loop.
    expect(r.stagesByRow.sort()).toEqual(['a', 'b']);
  });

  it('7. edges with unknown stage IDs are ignored', () => {
    const r = computeStageRows(
      ['a', 'b'],
      [
        { fromNodeId: 'a', toNodeId: 'b' },
        { fromNodeId: 'phantom', toNodeId: 'a' },
        { fromNodeId: 'b', toNodeId: 'also_phantom' },
      ],
    );
    expect(r.rowByStage.get('a')).toBe(0);
    expect(r.rowByStage.get('b')).toBe(1);
  });

  it('8. self-loop edges are ignored', () => {
    const r = computeStageRows(
      ['a'],
      [{ fromNodeId: 'a', toNodeId: 'a' }],
    );
    expect(r.rowByStage.get('a')).toBe(0);
  });

  it('narrative_shot_by_shot-like topology → rows in expected sequence', () => {
    const stages = [
      'plot', 'story', 'story_essence', 'world_style',
      'characters_plan', 'character_image_prompt', 'character_image',
      'settings_plan', 'setting_image_prompt', 'setting_image',
      'scenes_plan', 'shot_image_prompt', 'shot_image',
      'shot_image_last_frame_prompt', 'shot_image_last_frame',
      'shot_motion_directive', 'shot_video', 'final_video',
    ];
    const edges = [
      { fromNodeId: 'plot', toNodeId: 'story' },
      { fromNodeId: 'story', toNodeId: 'story_essence' },
      { fromNodeId: 'story_essence', toNodeId: 'world_style' },
      { fromNodeId: 'world_style', toNodeId: 'characters_plan' },
      { fromNodeId: 'characters_plan', toNodeId: 'character_image_prompt' },
      { fromNodeId: 'character_image_prompt', toNodeId: 'character_image' },
      { fromNodeId: 'world_style', toNodeId: 'settings_plan' },
      { fromNodeId: 'settings_plan', toNodeId: 'setting_image_prompt' },
      { fromNodeId: 'setting_image_prompt', toNodeId: 'setting_image' },
      { fromNodeId: 'characters_plan', toNodeId: 'scenes_plan' },
      { fromNodeId: 'scenes_plan', toNodeId: 'shot_image_prompt' },
      { fromNodeId: 'shot_image_prompt', toNodeId: 'shot_image' },
      { fromNodeId: 'character_image', toNodeId: 'shot_image' },
      { fromNodeId: 'setting_image', toNodeId: 'shot_image' },
      { fromNodeId: 'shot_image', toNodeId: 'shot_image_last_frame_prompt' },
      { fromNodeId: 'shot_image_last_frame_prompt', toNodeId: 'shot_image_last_frame' },
      { fromNodeId: 'shot_image', toNodeId: 'shot_motion_directive' },
      { fromNodeId: 'shot_image', toNodeId: 'shot_video' },
      { fromNodeId: 'shot_image_last_frame', toNodeId: 'shot_video' },
      { fromNodeId: 'shot_motion_directive', toNodeId: 'shot_video' },
      { fromNodeId: 'shot_video', toNodeId: 'final_video' },
    ];
    const r = computeStageRows(stages, edges);
    // Every stage on its own row.
    expect(r.stagesByRow).toHaveLength(stages.length);
    // Plot at top, final_video at bottom.
    expect(r.stagesByRow[0]).toBe('plot');
    expect(r.stagesByRow[r.stagesByRow.length - 1]).toBe('final_video');
    // story comes right after plot.
    expect(r.rowByStage.get('story')).toBe(r.rowByStage.get('plot')! + 1);
    // character_image is on a row strictly between characters_plan and shot_image.
    expect(r.rowByStage.get('character_image')!).toBeGreaterThan(r.rowByStage.get('characters_plan')!);
    expect(r.rowByStage.get('character_image')!).toBeLessThan(r.rowByStage.get('shot_image')!);
  });
});

describe('forwardDependents', () => {
  it('9. no edges → empty set', () => {
    expect(forwardDependents([], 'a').size).toBe(0);
  });

  it('10. start key with no outgoing → empty', () => {
    expect(
      forwardDependents([{ fromNodeId: 'a', toNodeId: 'b' }], 'b').size,
    ).toBe(0);
  });

  it('11. linear chain', () => {
    const result = forwardDependents(
      [
        { fromNodeId: 'a', toNodeId: 'b' },
        { fromNodeId: 'b', toNodeId: 'c' },
      ],
      'a',
    );
    expect([...result].sort()).toEqual(['b', 'c']);
  });

  it('12. itemId-scoped keys preserved', () => {
    const result = forwardDependents(
      [
        { fromNodeId: 'char', fromItemId: 'lara', toNodeId: 'shot', toItemId: 's3' },
        { fromNodeId: 'shot', fromItemId: 's3', toNodeId: 'final' },
      ],
      'char:lara',
    );
    expect([...result].sort()).toEqual(['final', 'shot:s3']);
  });

  it('13. cycle does not loop forever', () => {
    const result = forwardDependents(
      [
        { fromNodeId: 'a', toNodeId: 'b' },
        { fromNodeId: 'b', toNodeId: 'a' },
      ],
      'a',
    );
    expect([...result].sort()).toEqual(['b']);
  });

  it('14. start key itself not in result', () => {
    const result = forwardDependents(
      [{ fromNodeId: 'a', toNodeId: 'b' }],
      'a',
    );
    expect(result.has('a')).toBe(false);
  });
});

describe('computeInstanceLayout', () => {
  it('15. positions per instance based on row + index', () => {
    const rows = computeStageRows(['a', 'b'], [{ fromNodeId: 'a', toNodeId: 'b' }]);
    const m = new Map();
    m.set('a', [{ stageId: 'a', itemId: undefined }]);
    m.set('b', [
      { stageId: 'b', itemId: 'x' },
      { stageId: 'b', itemId: 'y' },
    ]);
    const { positions } = computeInstanceLayout(rows, m, { rowPitch: 100, instancePitch: 50, rowX0: 0, rowY0: 0, groupPadLeft: 10, groupPadTop: 10 });
    expect(positions.get('a')).toEqual({ x: 10, y: 10 });          // row 0
    expect(positions.get('b:x')).toEqual({ x: 10, y: 110 });        // row 1
    expect(positions.get('b:y')).toEqual({ x: 60, y: 110 });        // row 1 idx 1
  });

  it('16. instances sorted alphabetically by itemId', () => {
    const rows = computeStageRows(['s'], []);
    const m = new Map();
    m.set('s', [
      { stageId: 's', itemId: 'z' },
      { stageId: 's', itemId: 'a' },
      { stageId: 's', itemId: 'm' },
    ]);
    const { positions } = computeInstanceLayout(rows, m, { rowPitch: 100, instancePitch: 50, rowX0: 0, rowY0: 0, groupPadLeft: 10, groupPadTop: 10 });
    expect(positions.get('s:a')?.x).toBe(10);
    expect(positions.get('s:m')?.x).toBe(60);
    expect(positions.get('s:z')?.x).toBe(110);
  });

  it('17. stage box width grows with instance count', () => {
    const rows = computeStageRows(['a'], []);
    const m = new Map();
    m.set('a', [
      { stageId: 'a', itemId: 'x' },
      { stageId: 'a', itemId: 'y' },
      { stageId: 'a', itemId: 'z' },
    ]);
    const { stageBoxes } = computeInstanceLayout(rows, m, { instancePitch: 100, groupPadLeft: 20 });
    expect(stageBoxes.get('a')?.width).toBe(20 + 3 * 100 + 20);
  });

  it('18. default opts work; overrides apply', () => {
    const rows = computeStageRows(['a'], []);
    const m = new Map();
    m.set('a', [{ stageId: 'a', itemId: undefined }]);
    const def = computeInstanceLayout(rows, m);
    expect(def.positions.get('a')).toEqual({ x: 124, y: 96 });
    const override = computeInstanceLayout(rows, m, { rowX0: 0, rowY0: 0, groupPadLeft: 0, groupPadTop: 0 });
    expect(override.positions.get('a')).toEqual({ x: 0, y: 0 });
  });
});
