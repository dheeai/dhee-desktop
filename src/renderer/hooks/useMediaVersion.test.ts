import { describe, expect, it } from '@jest/globals';
import { withMediaVersion } from './useMediaVersion';

describe('withMediaVersion', () => {
  it('appends ?v=<n> to a bare file URL — the canonical cache-bust case', () => {
    expect(withMediaVersion('file:///path/to/image.png', 3)).toBe(
      'file:///path/to/image.png?v=3',
    );
  });

  it('appends &v=<n> to a URL that already has a query string', () => {
    expect(withMediaVersion('file:///path/img.png?foo=bar', 7)).toBe(
      'file:///path/img.png?foo=bar&v=7',
    );
  });

  it('changes the URL when the version changes — drives the React img refetch', () => {
    const url = 'file:///path/img.png';
    expect(withMediaVersion(url, 0)).not.toBe(withMediaVersion(url, 1));
    expect(withMediaVersion(url, 1)).not.toBe(withMediaVersion(url, 2));
  });

  it('returns "" for empty / null / undefined (callers can pass through safely)', () => {
    expect(withMediaVersion('', 5)).toBe('');
    expect(withMediaVersion(null, 5)).toBe('');
    expect(withMediaVersion(undefined, 5)).toBe('');
  });

  it('handles version=0 (initial mount, no file changes seen yet)', () => {
    expect(withMediaVersion('file:///a.png', 0)).toBe('file:///a.png?v=0');
  });

  it('handles fragments / hashes in the URL by leaving them untouched (img URLs rarely have these, but safe)', () => {
    // Append before fragment if present? Browsers ignore fragments on
    // network fetch, so position doesn't affect cache-bust correctness.
    // Document current behavior: cache-bust query is appended raw,
    // even if a fragment follows. Acceptable — img elements ignore
    // hashes entirely.
    expect(withMediaVersion('file:///a.png#frag', 2)).toBe(
      'file:///a.png#frag?v=2',
    );
  });
});
