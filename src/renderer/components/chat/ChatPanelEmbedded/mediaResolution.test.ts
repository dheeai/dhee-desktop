/**
 * mediaResolution — TDD coverage.
 *
 * extractToolResultFilePath failure modes:
 *  1. dhee custom tool returns result.details.file_path → extracted.
 *  2. legacy flat shape (result.file_path at top level) → extracted.
 *  3. both shapes present → details wins (preferred).
 *  4. no file_path anywhere → null.
 *  5. undefined result → null.
 *  6. asset_type and created_at extracted from same nested level.
 *
 * cacheBustMediaSrc failure modes:
 *  7. URL + numeric key → appends ?v=<key>.
 *  8. URL with existing query string + key → appends &v=<key>.
 *  9. URL already cache-busted → unchanged (no double append).
 * 10. Empty / null key → URL unchanged.
 * 11. Empty URL → empty URL.
 */
import { describe, it, expect } from '@jest/globals';
import {
  extractToolResultFilePath,
  cacheBustMediaSrc,
} from './mediaResolution';

describe('extractToolResultFilePath', () => {
  it('1. dhee tool shape (details.file_path)', () => {
    const r = extractToolResultFilePath({
      content: [{ type: 'text', text: '/foo.png (image, 123 bytes)' }],
      details: { file_path: '/foo.png', asset_type: 'image', created_at: 1700000000000 },
    });
    expect(r.filePath).toBe('/foo.png');
    expect(r.assetType).toBe('image');
    expect(r.createdAt).toBe(1700000000000);
  });

  it('2. legacy flat shape', () => {
    const r = extractToolResultFilePath({
      file_path: '/legacy.mp4',
      asset_type: 'video',
      created_at: 1234,
    });
    expect(r.filePath).toBe('/legacy.mp4');
    expect(r.assetType).toBe('video');
    expect(r.createdAt).toBe(1234);
  });

  it('3. both shapes → details wins', () => {
    const r = extractToolResultFilePath({
      file_path: '/legacy.png',
      details: { file_path: '/preferred.png' },
    });
    expect(r.filePath).toBe('/preferred.png');
  });

  it('4. no file_path → null', () => {
    expect(extractToolResultFilePath({ content: [] }).filePath).toBeNull();
  });

  it('5. undefined result → null', () => {
    expect(extractToolResultFilePath(undefined).filePath).toBeNull();
  });

  it('6. extracts asset_type + created_at from details', () => {
    const r = extractToolResultFilePath({
      details: { file_path: '/x.png', asset_type: 'image', created_at: 999 },
    });
    expect(r.assetType).toBe('image');
    expect(r.createdAt).toBe(999);
  });
});

describe('cacheBustMediaSrc', () => {
  it('7. URL + numeric key → ?v=key', () => {
    expect(cacheBustMediaSrc('file:///foo.png', 1700000000000)).toBe(
      'file:///foo.png?v=1700000000000',
    );
  });

  it('8. URL with existing query → &v=key', () => {
    expect(cacheBustMediaSrc('http://x/y?a=1', 99)).toBe('http://x/y?a=1&v=99');
  });

  it('9. URL already cache-busted → unchanged', () => {
    expect(cacheBustMediaSrc('file:///foo.png?v=1', 2)).toBe('file:///foo.png?v=1');
  });

  it('10. null/empty key → unchanged', () => {
    expect(cacheBustMediaSrc('file:///foo.png', null)).toBe('file:///foo.png');
    expect(cacheBustMediaSrc('file:///foo.png', undefined)).toBe('file:///foo.png');
    expect(cacheBustMediaSrc('file:///foo.png', '')).toBe('file:///foo.png');
  });

  it('11. empty URL → unchanged', () => {
    expect(cacheBustMediaSrc('', 123)).toBe('');
  });
});
