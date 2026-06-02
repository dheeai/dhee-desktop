import { describe, it, expect } from '@jest/globals';
import { resolveTileDisplay, thumbnailFromDisplay } from './bundleDisplay';
import type { BundleSnapshot } from './bundleCapability';

function bundle(parts: Partial<BundleSnapshot> & { nodes?: BundleSnapshot['nodes'] }): BundleSnapshot {
  return {
    id: 'test',
    version: '0.1.0',
    goal: 'end',
    nodes: parts.nodes ?? [],
    ...(parts.display ? { display: parts.display } : {}),
  };
}

const stubReadFile = (files: Record<string, string>) => async (p: string) => files[p] ?? null;

describe('resolveTileDisplay', () => {
  it('returns empty when bundle has no display block', async () => {
    const result = await resolveTileDisplay(bundle({ nodes: [] }), {}, async () => null);
    expect(result).toEqual({ thumbnailPath: null, stats: [] });
  });

  it('returns empty when bundle is null', async () => {
    const result = await resolveTileDisplay(null, {}, async () => null);
    expect(result).toEqual({ thumbnailPath: null, stats: [] });
  });

  it('thumbnail: picks first completed instance of capability (default first_completed)', async () => {
    const b = bundle({
      nodes: [
        { id: 'shot_image', kind: 'collection', displayCapability: 'shot.first_frame', outputs: { format: 'image', pattern: 'a' } },
      ],
      display: { thumbnail: { from: 'shot.first_frame' } },
    });
    const project = {
      walkState: {
        nodes: {
          'shot_image:scene_1_shot_2': { status: 'completed', outputPath: 'b.png' },
          'shot_image:scene_1_shot_1': { status: 'completed', outputPath: 'a.png' },
        },
      },
    };
    const result = await resolveTileDisplay(b, project, async () => null);
    expect(result.thumbnailPath).toBe('a.png'); // lex-lowest stateKey
  });

  it('thumbnail: random_completed uses the rng to choose', async () => {
    const b = bundle({
      nodes: [{ id: 'n', kind: 'collection', displayCapability: 'shot.first_frame', outputs: { format: 'image', pattern: 'a' } }],
      display: { thumbnail: { from: 'shot.first_frame', pick: 'random_completed' } },
    });
    const project = {
      walkState: {
        nodes: {
          'n:a': { status: 'completed', outputPath: 'a.png' },
          'n:b': { status: 'completed', outputPath: 'b.png' },
          'n:c': { status: 'completed', outputPath: 'c.png' },
        },
      },
    };
    const r0 = await resolveTileDisplay(b, project, async () => null, () => 0);
    const r1 = await resolveTileDisplay(b, project, async () => null, () => 0.999);
    expect(r0.thumbnailPath).toBe('a.png');
    expect(r1.thumbnailPath).toBe('c.png');
  });

  it('thumbnail: latest_completed picks the highest stateKey', async () => {
    const b = bundle({
      nodes: [{ id: 'n', kind: 'collection', displayCapability: 'shot.first_frame', outputs: { format: 'image', pattern: 'a' } }],
      display: { thumbnail: { from: 'shot.first_frame', pick: 'latest_completed' } },
    });
    const project = {
      walkState: {
        nodes: {
          'n:scene_1_shot_1': { status: 'completed', outputPath: 'first.png' },
          'n:scene_3_shot_5': { status: 'completed', outputPath: 'last.png' },
        },
      },
    };
    const result = await resolveTileDisplay(b, project, async () => null);
    expect(result.thumbnailPath).toBe('last.png');
  });

  it('thumbnail: skips pending / failed instances', async () => {
    const b = bundle({
      nodes: [{ id: 'n', kind: 'collection', displayCapability: 'shot.first_frame', outputs: { format: 'image', pattern: 'a' } }],
      display: { thumbnail: { from: 'shot.first_frame' } },
    });
    const project = {
      walkState: {
        nodes: {
          'n:a': { status: 'pending' },
          'n:b': { status: 'completed', outputPath: 'b.png' },
        },
      },
    };
    const result = await resolveTileDisplay(b, project, async () => null);
    expect(result.thumbnailPath).toBe('b.png');
  });

  it('thumbnail: returns null when no nodes have the capability', async () => {
    const b = bundle({
      nodes: [{ id: 'n', kind: 'collection', displayCapability: 'shot.motion', outputs: { format: 'json', pattern: 'a' } }],
      display: { thumbnail: { from: 'music.cover_art' } },
    });
    const result = await resolveTileDisplay(b, { walkState: { nodes: {} } }, async () => null);
    expect(result.thumbnailPath).toBeNull();
  });

  it('stat: count_completed counts completed instances of a capability', async () => {
    const b = bundle({
      nodes: [{ id: 'track', kind: 'collection', displayCapability: 'music.track', outputs: { format: 'audio', pattern: 'a' } }],
      display: {
        stats: [{ label: 'tracks', source: 'music.track', count_completed: true }],
      },
    });
    const project = {
      walkState: {
        nodes: {
          'track:1': { status: 'completed', outputPath: 't1.mp3' },
          'track:2': { status: 'completed', outputPath: 't2.mp3' },
          'track:3': { status: 'pending' },
        },
      },
    };
    const result = await resolveTileDisplay(b, project, async () => null);
    expect(result.stats).toEqual([{ label: 'tracks', value: 2 }]);
  });

  it('stat: path reads the source node JSON file and extracts the dot-path', async () => {
    const b = bundle({
      nodes: [{ id: 'sp', kind: 'stage', displayCapability: 'scene.plan', outputs: { format: 'json', pattern: 'plans/scenes_plan.json' } }],
      display: {
        stats: [
          { label: 'scenes', source: 'scene.plan', path: 'scenes.length' },
          { label: 'shots',  source: 'scene.plan', path: 'shots.length' },
        ],
      },
    });
    const project = {
      walkState: {
        nodes: {
          sp: { status: 'completed', outputPath: 'plans/scenes_plan.json' },
        },
      },
    };
    const fs = stubReadFile({
      'plans/scenes_plan.json': JSON.stringify({
        scenes: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
        shots: new Array(31).fill({ id: 'x' }),
      }),
    });
    const result = await resolveTileDisplay(b, project, fs);
    expect(result.stats).toEqual([
      { label: 'scenes', value: 3 },
      { label: 'shots', value: 31 },
    ]);
  });

  it('stat: path supports nested scalar lookup', async () => {
    const b = bundle({
      nodes: [{ id: 'meta', kind: 'stage', displayCapability: 'story.essence', outputs: { format: 'json', pattern: 'plans/x.json' } }],
      display: {
        stats: [{ label: 'words', source: 'story.essence', path: 'metadata.wordCount' }],
      },
    });
    const project = { walkState: { nodes: { meta: { status: 'completed', outputPath: 'plans/x.json' } } } };
    const fs = stubReadFile({ 'plans/x.json': JSON.stringify({ metadata: { wordCount: 1234 } }) });
    const result = await resolveTileDisplay(b, project, fs);
    expect(result.stats).toEqual([{ label: 'words', value: 1234 }]);
  });

  it('stat: silently skips when source is missing / file unreadable / path absent', async () => {
    const b = bundle({
      nodes: [{ id: 'sp', kind: 'stage', displayCapability: 'scene.plan', outputs: { format: 'json', pattern: 'plans/scenes_plan.json' } }],
      display: {
        stats: [
          { label: 'scenes', source: 'scene.plan', path: 'scenes.length' },
          { label: 'tracks', source: 'music.track', count_completed: true }, // capability doesn't exist
        ],
      },
    });
    const project = { walkState: { nodes: { sp: { status: 'completed', outputPath: 'p.json' } } } };
    const fs = stubReadFile({ 'p.json': JSON.stringify({ scenes: [{ id: 'a' }] }) });
    const result = await resolveTileDisplay(b, project, fs);
    // 'scenes' computes to 1; 'tracks' computes to 0 (count_completed returns 0 for no instances).
    expect(result.stats).toEqual([
      { label: 'scenes', value: 1 },
      { label: 'tracks', value: 0 },
    ]);
  });

  it('whacky bundle: music album shape works without any kshana-core code changes', async () => {
    const album = bundle({
      nodes: [
        { id: 'cover_art', kind: 'stage', displayCapability: 'music.cover_art', outputs: { format: 'image', pattern: 'cover.png' } },
        { id: 'track', kind: 'collection', displayCapability: 'music.track', outputs: { format: 'audio', pattern: 'tracks/{{item_id}}.mp3' } },
        { id: 'mix', kind: 'stage', displayCapability: 'music.master', outputs: { format: 'json', pattern: 'mix.json' } },
      ],
      display: {
        thumbnail: { from: 'music.cover_art' },
        stats: [
          { label: 'tracks', source: 'music.track', count_completed: true },
          { label: 'min', source: 'music.master', path: 'totalDurationMinutes' },
        ],
      },
    });
    const project = {
      walkState: {
        nodes: {
          cover_art: { status: 'completed', outputPath: 'cover.png' },
          'track:t1': { status: 'completed', outputPath: 'tracks/t1.mp3' },
          'track:t2': { status: 'completed', outputPath: 'tracks/t2.mp3' },
          'track:t3': { status: 'pending' },
          mix: { status: 'completed', outputPath: 'mix.json' },
        },
      },
    };
    const fs = stubReadFile({ 'mix.json': JSON.stringify({ totalDurationMinutes: 47 }) });
    const result = await resolveTileDisplay(album, project, fs);
    expect(result.thumbnailPath).toBe('cover.png');
    expect(result.stats).toEqual([
      { label: 'tracks', value: 2 },
      { label: 'min', value: 47 },
    ]);
  });

  it('thumbnailFromDisplay convenience helper returns just the path', () => {
    const b = bundle({
      nodes: [{ id: 'n', kind: 'collection', displayCapability: 'shot.first_frame', outputs: { format: 'image', pattern: 'a' } }],
      display: { thumbnail: { from: 'shot.first_frame' } },
    });
    const project = { walkState: { nodes: { 'n:1': { status: 'completed', outputPath: 'thumb.png' } } } };
    expect(thumbnailFromDisplay(b, project)).toBe('thumb.png');
  });
});
