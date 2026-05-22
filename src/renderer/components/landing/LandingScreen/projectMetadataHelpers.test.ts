import { describe, expect, it } from '@jest/globals';
import {
  collectMeetCharacterShots,
  countScenesAndShots,
  extractSceneImages,
  selectSmartThumbnail,
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

  it('drops entries with missing scene_number, missing path, or bad shape', () => {
    const out = extractSceneImages({
      assets: [
        { type: 'scene_image', path: 'no-scene.png' }, // missing scene_number
        { type: 'scene_image', scene_number: 'one' as unknown as number, path: 'bad-type.png' },
        { type: 'scene_image', scene_number: 1, path: '' }, // empty path
        { type: 'scene_image', scene_number: 1, path: 'ok.png', metadata: { shot_number: 2 } },
        null,
        'string',
      ] as unknown[],
    });
    expect(out).toEqual([{ scene: 1, shot: 2, path: 'ok.png' }]);
  });

  it('defaults shot_number to 0 when missing (rare but possible on legacy entries)', () => {
    const out = extractSceneImages({
      assets: [{ type: 'scene_image', scene_number: 1, path: 'x.png' }],
    });
    expect(out[0]?.shot).toBe(0);
  });
});

describe('countScenesAndShots', () => {
  it('returns zeros for empty input', () => {
    expect(countScenesAndShots([])).toEqual({ scenes: 0, shots: 0 });
  });

  it('counts unique scenes and unique (scene, shot) pairs', () => {
    const out = countScenesAndShots([
      { scene: 1, shot: 1, path: 'a' },
      { scene: 1, shot: 2, path: 'b' },
      { scene: 1, shot: 2, path: 'c' }, // dup (scene, shot) → counted once
      { scene: 2, shot: 1, path: 'd' },
      { scene: 2, shot: 2, path: 'e' },
      { scene: 2, shot: 3, path: 'f' },
    ]);
    expect(out).toEqual({ scenes: 2, shots: 5 });
  });

  it('shot identity is per-scene (shot 1 in scene 1 != shot 1 in scene 2)', () => {
    const out = countScenesAndShots([
      { scene: 1, shot: 1, path: 'a' },
      { scene: 2, shot: 1, path: 'b' },
    ]);
    expect(out).toEqual({ scenes: 2, shots: 2 });
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
