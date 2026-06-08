/**
 * artifactFormat — TDD coverage.
 *
 * The deliverables strip and the run model classify an artifact purely by
 * its output path extension, mirroring the Inspector card dispatch. Pure +
 * exhaustive so the strip never guesses wrong.
 *
 * Failure modes:
 *   1. images (png/jpg/jpeg/webp/gif) → 'image'
 *   2. video (mp4/webm/mov/mkv) → 'video'
 *   3. audio (wav/mp3/ogg/flac) → 'audio'
 *   4. json → 'json', md/txt → 'md'
 *   5. unknown extension / missing path → 'unknown'
 *   6. case-insensitive (.PNG)
 *   7. isPreviewable: image/video/audio true; json/md/unknown false
 */
import { describe, it, expect } from '@jest/globals';
import { inferArtifactFormat, isPreviewable } from './artifactFormat';

describe('inferArtifactFormat', () => {
  it('classifies images', () => {
    for (const p of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif']) {
      expect(inferArtifactFormat(p)).toBe('image');
    }
  });
  it('classifies video', () => {
    for (const p of ['a.mp4', 'a.webm', 'a.mov', 'a.mkv']) {
      expect(inferArtifactFormat(p)).toBe('video');
    }
  });
  it('classifies audio', () => {
    for (const p of ['a.wav', 'a.mp3', 'a.ogg', 'a.flac']) {
      expect(inferArtifactFormat(p)).toBe('audio');
    }
  });
  it('classifies text/data', () => {
    expect(inferArtifactFormat('plan.json')).toBe('json');
    expect(inferArtifactFormat('notes.md')).toBe('md');
    expect(inferArtifactFormat('notes.txt')).toBe('md');
  });
  it('is unknown for missing or odd extensions', () => {
    expect(inferArtifactFormat(undefined)).toBe('unknown');
    expect(inferArtifactFormat('')).toBe('unknown');
    expect(inferArtifactFormat('data.parquet')).toBe('unknown');
  });
  it('is case-insensitive', () => {
    expect(inferArtifactFormat('SHOT.PNG')).toBe('image');
  });
});

describe('isPreviewable', () => {
  it('is true for visual/audio media', () => {
    expect(isPreviewable('image')).toBe(true);
    expect(isPreviewable('video')).toBe(true);
    expect(isPreviewable('audio')).toBe(true);
  });
  it('is false for text/data/unknown', () => {
    expect(isPreviewable('json')).toBe(false);
    expect(isPreviewable('md')).toBe(false);
    expect(isPreviewable('unknown')).toBe(false);
  });
});
