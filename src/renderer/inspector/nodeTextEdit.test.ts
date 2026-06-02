import { describe, it, expect } from '@jest/globals';
import { prepareEdit, applyEdit, readDotPath, setDotPath } from './nodeTextEdit';

describe('prepareEdit — what the user actually edits', () => {
  it('md file → whole text, kind=text', () => {
    const r = prepareEdit({ content: '# Plot\n\nOnce…', outputPath: 'plans/plot.md' });
    expect(r.kind).toBe('text');
    expect(r.editable).toContain('Once');
  });

  it('json with a string headlineField → just that field (no JSON guts)', () => {
    const content = JSON.stringify({ imagePrompt: 'a wide shot of the lighthouse', characters: ['elara'], seed: 42 });
    const r = prepareEdit({ content, outputPath: 'prompts/shot_image/s1.json', headlineField: 'imagePrompt' });
    expect(r.kind).toBe('json-field');
    expect(r.editable).toBe('a wide shot of the lighthouse');
    expect(r.editable).not.toContain('{'); // no guts
    expect(r.headlineField).toBe('imagePrompt');
    expect(r.label).toMatch(/image prompt/i);
  });

  it('json with a nested dot-path headlineField', () => {
    const content = JSON.stringify({ frames: { first_frame: { imagePrompt: 'close up' } } });
    const r = prepareEdit({ content, outputPath: 's.json', headlineField: 'frames.first_frame.imagePrompt' });
    expect(r.kind).toBe('json-field');
    expect(r.editable).toBe('close up');
  });

  it('json with no headlineField → pretty raw JSON fallback', () => {
    const content = JSON.stringify({ a: 1, b: 2 });
    const r = prepareEdit({ content, outputPath: 's.json' });
    expect(r.kind).toBe('json-raw');
    expect(r.editable).toContain('"a": 1'); // pretty-printed
  });

  it('json where headlineField is not a string → raw fallback', () => {
    const content = JSON.stringify({ characters: ['a', 'b'] });
    const r = prepareEdit({ content, outputPath: 's.json', headlineField: 'characters' });
    expect(r.kind).toBe('json-raw');
  });

  it('unparseable json → raw kind with the original bytes', () => {
    const r = prepareEdit({ content: '{ not json', outputPath: 's.json', headlineField: 'imagePrompt' });
    expect(r.kind).toBe('json-raw');
    expect(r.editable).toBe('{ not json');
  });
});

describe('applyEdit — merge back to canonical bytes', () => {
  it('text → verbatim', () => {
    const r = applyEdit({ original: 'old', kind: 'text', edited: 'new prose' });
    expect(r).toEqual({ ok: true, content: 'new prose' });
  });

  it('json-field → ONLY the field changes, everything else preserved', () => {
    const original = JSON.stringify({ imagePrompt: 'old', characters: ['elara'], seed: 42 });
    const r = applyEdit({ original, kind: 'json-field', headlineField: 'imagePrompt', edited: 'a NEW wide shot' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content);
      expect(parsed.imagePrompt).toBe('a NEW wide shot');
      expect(parsed.characters).toEqual(['elara']); // preserved
      expect(parsed.seed).toBe(42); // preserved
    }
  });

  it('json-field nested path preserves siblings', () => {
    const original = JSON.stringify({ frames: { first_frame: { imagePrompt: 'old', w: 1920 } } });
    const r = applyEdit({ original, kind: 'json-field', headlineField: 'frames.first_frame.imagePrompt', edited: 'new' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p = JSON.parse(r.content);
      expect(p.frames.first_frame.imagePrompt).toBe('new');
      expect(p.frames.first_frame.w).toBe(1920);
    }
  });

  it('json-raw → validates + normalizes', () => {
    const r = applyEdit({ original: '{}', kind: 'json-raw', edited: '{"a":1}' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.content).a).toBe(1);
  });

  it('json-raw with invalid JSON → error (does not write)', () => {
    const r = applyEdit({ original: '{}', kind: 'json-raw', edited: '{ broken' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid json/i);
  });

  it('json-field without headlineField → error', () => {
    const r = applyEdit({ original: '{}', kind: 'json-field', edited: 'x' });
    expect(r.ok).toBe(false);
  });

  it('round-trips: prepare then apply on a shot prompt keeps the rest intact', () => {
    const content = JSON.stringify({ imagePrompt: 'a', characters: ['x'], cameraWork: 'wide' });
    const prepared = prepareEdit({ content, outputPath: 's.json', headlineField: 'imagePrompt' });
    const applied = applyEdit({ original: content, kind: prepared.kind, ...(prepared.headlineField ? { headlineField: prepared.headlineField } : {}), edited: 'b' });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      const p = JSON.parse(applied.content);
      expect(p.imagePrompt).toBe('b');
      expect(p.cameraWork).toBe('wide');
    }
  });
});

describe('dot-path helpers', () => {
  it('readDotPath nested', () => {
    expect(readDotPath({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5);
    expect(readDotPath({ a: 1 }, 'a.b')).toBeUndefined();
  });
  it('setDotPath creates intermediate objects + preserves siblings', () => {
    const o: Record<string, unknown> = { keep: 1 };
    setDotPath(o, 'a.b', 'v');
    expect(o).toEqual({ keep: 1, a: { b: 'v' } });
  });
});
