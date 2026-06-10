/**
 * Run-cockpit vocabulary — TDD coverage.
 *
 * The cockpit is bundle-agnostic: it shows a narrative video bundle and a
 * (hypothetical) financial-report bundle with the SAME chrome, deriving all
 * human-facing words from the bundle's node ids + artifact formats rather
 * than hardcoding "shots" / "rendering". These pure helpers do that
 * derivation, so they are unit-tested directly (no React, no IPC).
 *
 * Failure modes guarded:
 *
 *   humanizeId:
 *     1. snake_case → Title Case ('shot_image' → 'Shot Image')
 *     2. embedded digits kept as their own token ('scene_1_shot_3')
 *     3. camelCase boundary split ('ltxDirector' → 'Ltx Director')
 *     4. kebab-case ('final-video' → 'Final Video')
 *     5. already-spaced input is left readable
 *     6. empty / undefined → ''
 *
 *   phaseVerb (drives "Rendering…" vs "Composing…" vs "Working…"):
 *     7. image/video → 'Rendering'
 *     8. audio → 'Composing'
 *     9. json/md/txt → 'Writing' (model-authored text/data)
 *    10. unknown / missing → 'Working' (safe generic, never video-specific)
 *
 *   pluralizeNoun (the counter's unit noun, count-aware):
 *    11. count === 1 → singular untouched
 *    12. vowel/consonant tail → +s ('shot image' → 'shot images')
 *    13. sibilant tail → +es ('box' → 'boxes')
 *    14. already plural → untouched ('frames' → 'frames')
 */
import { describe, it, expect } from '@jest/globals';
import { humanizeId, phaseVerb, pluralizeNoun } from './vocab';

describe('humanizeId', () => {
  it('title-cases snake_case', () => {
    expect(humanizeId('shot_image')).toBe('Shot Image');
    expect(humanizeId('scenes_plan')).toBe('Scenes Plan');
  });
  it('keeps embedded digits as tokens', () => {
    expect(humanizeId('scene_1_shot_3')).toBe('Scene 1 Shot 3');
  });
  it('splits camelCase boundaries', () => {
    expect(humanizeId('ltxDirector')).toBe('Ltx Director');
  });
  it('handles kebab-case', () => {
    expect(humanizeId('final-video')).toBe('Final Video');
  });
  it('leaves already-spaced input readable', () => {
    expect(humanizeId('Final Video')).toBe('Final Video');
  });
  it('returns empty string for empty/undefined', () => {
    expect(humanizeId('')).toBe('');
    expect(humanizeId(undefined)).toBe('');
  });
});

describe('phaseVerb', () => {
  it('renders pixels', () => {
    expect(phaseVerb('image')).toBe('Rendering');
    expect(phaseVerb('video')).toBe('Rendering');
  });
  it('composes audio', () => {
    expect(phaseVerb('audio')).toBe('Composing');
  });
  it('writes model text/data', () => {
    expect(phaseVerb('json')).toBe('Writing');
    expect(phaseVerb('md')).toBe('Writing');
    expect(phaseVerb('txt')).toBe('Writing');
  });
  it('falls back to a generic, non-video verb', () => {
    expect(phaseVerb(undefined)).toBe('Working');
    expect(phaseVerb('parquet')).toBe('Working');
  });
});

describe('pluralizeNoun', () => {
  it('leaves singular alone at count 1', () => {
    expect(pluralizeNoun('shot image', 1)).toBe('shot image');
  });
  it('adds s for ordinary tails', () => {
    expect(pluralizeNoun('shot image', 23)).toBe('shot images');
    expect(pluralizeNoun('report', 4)).toBe('reports');
  });
  it('adds es for sibilant tails', () => {
    expect(pluralizeNoun('box', 2)).toBe('boxes');
    expect(pluralizeNoun('pass', 3)).toBe('passes');
  });
  it('leaves an already-plural noun untouched', () => {
    expect(pluralizeNoun('frames', 12)).toBe('frames');
  });
});
