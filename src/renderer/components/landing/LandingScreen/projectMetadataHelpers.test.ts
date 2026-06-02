import { describe, expect, it } from '@jest/globals';
import {
  collectMeetCharacterShots,
  extractSceneImages,
  parseSceneShotFromPath,
  selectSmartThumbnail,
  sumScenesAndShots,
} from './projectMetadataHelpers';

describe('extractSceneImages', () => {
  it('returns [] for null / missing / malformed manifest', () => {
    expect(extractSceneImages(null)).toEqual([]);
    expect(extractSceneImages(undefined)).toEqual([]);
    expect(extractSceneImages({})).toEqual([]);
    expect(extractSceneImages({ assets: null as never })).toEqual([]);
  });

  it('extracts well-formed scene_image entries with scene/shot/path', () => {
    const out = extractSceneImages({
      assets: [
        {
          type: 'scene_image',
          path: 'assets/images/s1shot1.png',
          scene_number: 1,
          metadata: { shot_number: 1 },
        },
        {
          type: 'scene_image',
          path: 'assets/images/s2shot3.png',
          scene_number: 2,
          metadata: { shot_number: 3 },
        },
      ],
    });
    expect(out).toEqual([
      { scene: 1, shot: 1, path: 'assets/images/s1shot1.png' },
      { scene: 2, shot: 3, path: 'assets/images/s2shot3.png' },
    ]);
  });

  it('skips non-scene_image entries (character_image, scene_video, etc.)', () => {
    const out = extractSceneImages({
      assets: [
        { type: 'scene_video', scene_number: 1, path: 'a.mp4', metadata: { shot_number: 1 } },
        { type: 'character_image', scene_number: 1, path: 'b.png' },
        { type: 'scene_image', scene_number: 1, path: 'c.png', metadata: { shot_number: 1 } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe('c.png');
  });

  it('drops entries with bad shape / unrecoverable identity', () => {
    const out = extractSceneImages({
      assets: [
        // missing path entirely → unrecoverable
        { type: 'scene_image', scene_number: 1 },
        // empty path
        { type: 'scene_image', scene_number: 1, path: '' },
        // bad scene_number type AND no s<N>shot<M> in path → unrecoverable
        { type: 'scene_image', scene_number: 'one', path: 'no-pattern.png' },
        // good — recovered via metadata
        { type: 'scene_image', scene_number: 1, path: 'ok.png', metadata: { shot_number: 2 } },
        null,
        'string',
      ] as unknown[],
    });
    expect(out).toEqual([{ scene: 1, shot: 2, path: 'ok.png' }]);
  });

  it('recovers (scene, shot) from the file path when manifest metadata is null — the Better Image regression', () => {
    // Better Image's manifest had entries with scene_number: null and
    // metadata.shot_number: null. The path encodes the real values.
    const out = extractSceneImages({
      assets: [
        {
          type: 'scene_image',
          path: 'assets/images/s1shot4_last_frame_klein_WuZS6N.png',
          scene_number: null,
          metadata: { shot_number: null },
        },
        {
          type: 'scene_image',
          path: 'assets/images/s1shot1_last_frame_klein_2aj9TZ.png',
        },
      ] as unknown[],
    });
    expect(out).toEqual([
      { scene: 1, shot: 4, path: 'assets/images/s1shot4_last_frame_klein_WuZS6N.png' },
      { scene: 1, shot: 1, path: 'assets/images/s1shot1_last_frame_klein_2aj9TZ.png' },
    ]);
  });

  it('prefers explicit manifest fields over path parsing when both exist', () => {
    // A manifest entry's explicit (scene, shot) wins over what the
    // path suggests — useful when assets get renamed but the entry
    // still tracks the original.
    const out = extractSceneImages({
      assets: [
        {
          type: 'scene_image',
          scene_number: 2,
          path: 'assets/images/s1shot1_ff.png', // path says (1,1)
          metadata: { shot_number: 5 }, // metadata says (2,5) — win
        },
      ],
    });
    expect(out).toEqual([{ scene: 2, shot: 5, path: 'assets/images/s1shot1_ff.png' }]);
  });
});

describe('parseSceneShotFromPath', () => {
  it('extracts (scene, shot) from canonical scene_image filenames', () => {
    expect(
      parseSceneShotFromPath('assets/images/s1shot1_first_frame_klein_abc.png'),
    ).toEqual({ scene: 1, shot: 1 });
    expect(
      parseSceneShotFromPath('assets/images/s4shot11_last_frame_klein_xyz.png'),
    ).toEqual({ scene: 4, shot: 11 });
  });

  it('returns null on paths without the s<N>shot<M>_ pattern', () => {
    expect(parseSceneShotFromPath('assets/images/thumbnail.png')).toBeNull();
    expect(parseSceneShotFromPath('s1shot1')).toBeNull(); // no trailing underscore
    expect(parseSceneShotFromPath('')).toBeNull();
  });

  it('matches at the start of path or after a directory boundary', () => {
    expect(parseSceneShotFromPath('s2shot3_ff.png')).toEqual({
      scene: 2,
      shot: 3,
    });
  });
});

describe('sumScenesAndShots', () => {
  it('returns zeros for empty input', () => {
    expect(sumScenesAndShots({})).toEqual({ scenes: 0, shots: 0 });
  });

  it('sums scenes (one per non-null SVP) and shots (sum of shots[] lengths)', () => {
    expect(
      sumScenesAndShots({
        1: { shots: [{}, {}, {}] }, // 3 shots
        2: { shots: [{}, {}, {}, {}, {}] }, // 5 shots
        3: { shots: [] }, // 0 shots
      }),
    ).toEqual({ scenes: 3, shots: 8 });
  });

  it('skips null / undefined entries (missing scene_<N>.json files)', () => {
    expect(
      sumScenesAndShots({
        1: { shots: [{}, {}] },
        2: null,
        3: undefined,
        4: { shots: [{}] },
      }),
    ).toEqual({ scenes: 2, shots: 3 });
  });

  it('tolerates SVPs without a shots array (counts the scene, 0 shots)', () => {
    expect(sumScenesAndShots({ 1: {} })).toEqual({ scenes: 1, shots: 0 });
    expect(sumScenesAndShots({ 1: { shots: null as never } })).toEqual({
      scenes: 1,
      shots: 0,
    });
  });

  it('Better Image regression — 15-shot scene reads as 1 scene · 15 shots', () => {
    // The bug we shipped to fix: manifest-based counting saw 11 versions
    // of scene 1 shot 1 and produced (1, 1). Planner-based counting
    // reads the 15-shot plan and produces (1, 15).
    const plan15 = { shots: Array.from({ length: 15 }, (_, i) => ({ shotNumber: i + 1 })) };
    expect(sumScenesAndShots({ 1: plan15 })).toEqual({ scenes: 1, shots: 15 });
  });
});

describe('collectMeetCharacterShots', () => {
  it('returns empty set when no SVPs provided', () => {
    expect(collectMeetCharacterShots({}).size).toBe(0);
  });

  it('collects (scene, shot) pairs whose purpose is meet_character', () => {
    const out = collectMeetCharacterShots({
      1: {
        shots: [
          { shotNumber: 1, purpose: 'meet_character' },
          { shotNumber: 2, purpose: 'show_dialogue' },
          { shotNumber: 3, purpose: 'meet_character' },
        ],
      },
      2: {
        shots: [{ shotNumber: 1, purpose: 'meet_character' }],
      },
    });
    expect([...out].sort()).toEqual(['1_1', '1_3', '2_1']);
  });

  it('ignores null / malformed SVPs without throwing', () => {
    const out = collectMeetCharacterShots({
      1: null,
      2: undefined,
      3: {},
      4: { shots: null as never },
      5: { shots: [null, undefined, { purpose: 'meet_character' /* no shotNumber */ } as never] },
    });
    expect(out.size).toBe(0);
  });

  it('skips other purposes', () => {
    const out = collectMeetCharacterShots({
      1: {
        shots: [
          { shotNumber: 1, purpose: 'show_dialogue' },
          { shotNumber: 2, purpose: 'show_action' },
          { shotNumber: 3, purpose: 'set_the_world' },
        ],
      },
    });
    expect(out.size).toBe(0);
  });
});

describe('selectSmartThumbnail', () => {
  const images = [
    { scene: 1, shot: 1, path: 's1s1.png' },
    { scene: 1, shot: 2, path: 's1s2.png' },
    { scene: 1, shot: 3, path: 's1s3.png' },
    { scene: 2, shot: 1, path: 's2s1.png' },
  ];

  it('returns null on empty input', () => {
    expect(selectSmartThumbnail([], new Set(), () => 0.5)).toBeNull();
  });

  it('prefers meet_character matches when present', () => {
    const meetSet = new Set(['1_2', '2_1']);
    // rng=0 → first eligible
    expect(selectSmartThumbnail(images, meetSet, () => 0)?.path).toBe('s1s2.png');
    // rng=0.99 → last eligible
    expect(selectSmartThumbnail(images, meetSet, () => 0.99)?.path).toBe('s2s1.png');
  });

  it('falls back to all images when no meet_character matches', () => {
    expect(selectSmartThumbnail(images, new Set(), () => 0)?.path).toBe('s1s1.png');
    expect(selectSmartThumbnail(images, new Set(['99_99']), () => 0)?.path).toBe('s1s1.png');
  });

  it('clamps rng=1.0 to the last index (no off-by-one out of bounds)', () => {
    // Math.floor(1.0 * length) would equal length (out of bounds). Helper
    // clamps to length-1.
    const out = selectSmartThumbnail(images, new Set(), () => 1.0);
    expect(out?.path).toBe('s2s1.png');
  });

  it('uses Math.random when no rng provided (smoke test)', () => {
    const out = selectSmartThumbnail(images, new Set());
    expect(out).not.toBeNull();
    expect(images.map((i) => i.path)).toContain(out!.path);
  });
});

import { sumScenesAndShotsFromPlan, findShotThumbnailFromWalkState } from './projectMetadataHelpers';

describe('sumScenesAndShotsFromPlan (bundle format)', () => {
  it('counts from {scenes, shots} arrays', () => {
    const plan = {
      scenes: [{ id: 'scene_1' }, { id: 'scene_2' }],
      shots: [
        { id: 'scene_1_shot_1' }, { id: 'scene_1_shot_2' },
        { id: 'scene_2_shot_1' }, { id: 'scene_2_shot_2' }, { id: 'scene_2_shot_3' },
      ],
    };
    expect(sumScenesAndShotsFromPlan(plan)).toEqual({ scenes: 2, shots: 5 });
  });

  it('derives scene count from distinct shot.scene when scenes array is missing', () => {
    const plan = {
      shots: [
        { scene: 1, shotNumber: 1 }, { scene: 1, shotNumber: 2 },
        { scene: 2, shotNumber: 1 }, { scene: 3, shotNumber: 1 },
      ],
    };
    expect(sumScenesAndShotsFromPlan(plan)).toEqual({ scenes: 3, shots: 4 });
  });

  it('returns null on missing / malformed plan', () => {
    expect(sumScenesAndShotsFromPlan(null)).toBeNull();
    expect(sumScenesAndShotsFromPlan(undefined)).toBeNull();
    expect(sumScenesAndShotsFromPlan({})).toBeNull();
    expect(sumScenesAndShotsFromPlan({ scenes: 'not array' as unknown as never })).toBeNull();
  });

  it('handles empty shots gracefully', () => {
    expect(sumScenesAndShotsFromPlan({ scenes: [], shots: [] })).toEqual({ scenes: 0, shots: 0 });
  });
});

describe('findShotThumbnailFromWalkState', () => {
  it('returns the lowest scene+shot first-frame outputPath', () => {
    const state = {
      nodes: {
        'shot_image:scene_1_shot_2': { status: 'completed', outputPath: 'assets/images/shots/scene_1_shot_2_first.png' },
        'shot_image:scene_1_shot_1': { status: 'completed', outputPath: 'assets/images/shots/scene_1_shot_1_first.png' },
        'shot_image:scene_2_shot_1': { status: 'completed', outputPath: 'assets/images/shots/scene_2_shot_1_first.png' },
      },
    };
    expect(findShotThumbnailFromWalkState(state)).toBe('assets/images/shots/scene_1_shot_1_first.png');
  });

  it('skips pending / failed instances', () => {
    const state = {
      nodes: {
        'shot_image:scene_1_shot_1': { status: 'pending', outputPath: 'a.png' },
        'shot_image:scene_1_shot_2': { status: 'completed', outputPath: 'assets/images/shots/scene_1_shot_2_first.png' },
      },
    };
    expect(findShotThumbnailFromWalkState(state)).toBe('assets/images/shots/scene_1_shot_2_first.png');
  });

  it('returns null when no matching first-frame is in state', () => {
    expect(findShotThumbnailFromWalkState({ nodes: {} })).toBeNull();
    expect(findShotThumbnailFromWalkState(null)).toBeNull();
    expect(findShotThumbnailFromWalkState(undefined)).toBeNull();
    // Has shot images but none matching first-frame pattern.
    expect(findShotThumbnailFromWalkState({
      nodes: { 'plot:': { status: 'completed', outputPath: 'plans/plot.md' } },
    })).toBeNull();
  });

  it('matches both _first.png and _first_frame_*.png patterns (Klein vs Qwen naming)', () => {
    const state1 = { nodes: { 'shot_image:scene_1_shot_1': { status: 'completed', outputPath: 'a/scene_1_shot_1_first.png' } } };
    const state2 = { nodes: { 'shot_image:scene_1_shot_1': { status: 'completed', outputPath: 'a/scene_1_shot_1_first_frame_klein_AbCd.png' } } };
    expect(findShotThumbnailFromWalkState(state1)).toBe('a/scene_1_shot_1_first.png');
    expect(findShotThumbnailFromWalkState(state2)).toBe('a/scene_1_shot_1_first_frame_klein_AbCd.png');
  });
});
