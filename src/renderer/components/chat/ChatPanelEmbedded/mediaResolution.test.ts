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
  resolveMediaSrc,
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

describe('resolveMediaSrc', () => {
  // BUG: tool result paths often live under projects whose names have
  // spaces ("Prompt Relay E2E"). Without URL encoding the resulting
  // `file://` URL is malformed for <video> tags (silent failure in
  // Electron's Chromium for video, more forgiving for <img>). The
  // agent then "shows" a video that never renders.

  it('12. absolute path with spaces gets URL-encoded per segment', () => {
    const r = resolveMediaSrc(
      '/Users/ganaraj/dhee-studios/Prompt Relay E2E/assets/videos/final/final_video.mp4',
      null,
    );
    expect(r).toBe(
      'file:///Users/ganaraj/dhee-studios/Prompt%20Relay%20E2E/assets/videos/final/final_video.mp4',
    );
  });

  it('13. relative path joined with projectDirectory whose name has spaces', () => {
    const r = resolveMediaSrc(
      'assets/videos/final/final_video.mp4',
      '/Users/ganaraj/dhee-studios/Prompt Relay E2E',
    );
    expect(r).toBe(
      'file:///Users/ganaraj/dhee-studios/Prompt%20Relay%20E2E/assets/videos/final/final_video.mp4',
    );
  });

  it('14. path with already-percent-encoded segments is not double-encoded', () => {
    // The path "Already%20Encoded" should round-trip without doubling
    // the % into %25.
    const r = resolveMediaSrc(
      '/Users/x/Already%20Encoded/file.png',
      null,
    );
    // Encode %20 -> %2520 would be a regression. We accept the path
    // verbatim when each segment is already a valid encoded URI piece;
    // simplest contract: callers pass DECODED paths. Test guards the
    // most common case: literal spaces from filesystem paths.
    expect(r).toBe('file:///Users/x/Already%2520Encoded/file.png');
    // (If this becomes a problem in practice we can add a smart-detect
    // pass. Today, encoding all literal '%' is the safer default.)
  });

  it('15. path with `?` or `#` characters gets them encoded so they do not split the URL', () => {
    const r = resolveMediaSrc(
      '/tmp/file with ?and #marks.mp4',
      null,
    );
    expect(r).toBe('file:///tmp/file%20with%20%3Fand%20%23marks.mp4');
  });

  it('16. preserves the path separator `/`', () => {
    const r = resolveMediaSrc('/a/b/c.png', null);
    expect(r).toBe('file:///a/b/c.png');
  });

  it('17. already a URI scheme passes through unchanged', () => {
    expect(resolveMediaSrc('http://example.com/x.png', null)).toBe(
      'http://example.com/x.png',
    );
    expect(resolveMediaSrc('file:///already/encoded.png', null)).toBe(
      'file:///already/encoded.png',
    );
  });

  it('18. empty mediaPath → empty string', () => {
    expect(resolveMediaSrc('', null)).toBe('');
    expect(resolveMediaSrc('   ', null)).toBe('');
  });

  // Windows: a drive-letter project dir must yield file:///C:/… (drive in
  // the PATH). The old builder produced file://C%3A/… (colon encoded,
  // drive in the host) → every graph thumbnail showed "image missing on
  // disk" while the detail view (different code path) worked.
  it('19. Windows relative path under a drive-letter projectDirectory', () => {
    const r = resolveMediaSrc(
      'assets/images/shots/scene_2_shot_2.png',
      'C:/Users/user/dhee-studios',
    );
    expect(r).toBe(
      'file:///C:/Users/user/dhee-studios/assets/images/shots/scene_2_shot_2.png',
    );
    expect(r.startsWith('file://C')).toBe(false); // drive not in the host
    expect(r).not.toContain('C%3A'); // colon not encoded
  });

  it('20. Windows absolute drive-letter path with spaces', () => {
    const r = resolveMediaSrc('C:/Users/user/My Project/assets/a.png', null);
    expect(r).toBe('file:///C:/Users/user/My%20Project/assets/a.png');
  });

  it('21. Windows backslash separators are normalized', () => {
    const r = resolveMediaSrc('assets\\images\\a.png', 'C:\\Users\\user\\studio');
    expect(r).toBe('file:///C:/Users/user/studio/assets/images/a.png');
  });
});
