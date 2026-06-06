/**
 * projectDisplay.toFileUrl — the landing project-tile thumbnail URL.
 * On Windows a drive-letter path must become file:///C:/… ; the old
 * `encodeURI(file://${path})` produced file://C:/… (drive in the URL
 * host) so the <img> failed and the tile fell back to the folder
 * placeholder ("Agentic Workspace").
 */
import { describe, it, expect } from '@jest/globals';
import { toFileUrl } from './projectDisplay';

describe('projectDisplay.toFileUrl', () => {
  it('Unix absolute path → file:///… (unchanged)', () => {
    expect(toFileUrl('/Users/x/proj/.dhee/ui/thumbnail.png')).toBe(
      'file:///Users/x/proj/.dhee/ui/thumbnail.png',
    );
  });

  it('Windows drive-letter path → file:///C:/… (drive in path, not host)', () => {
    const u = toFileUrl('C:/Users/user/dhee-studios/.dhee/ui/thumbnail.png');
    expect(u).toBe('file:///C:/Users/user/dhee-studios/.dhee/ui/thumbnail.png');
    expect(u.startsWith('file://C')).toBe(false);
  });

  it('encodes spaces in the path', () => {
    expect(toFileUrl('C:/Users/My Project/thumb.png')).toBe(
      'file:///C:/Users/My%20Project/thumb.png',
    );
  });

  it('normalizes Windows backslashes', () => {
    expect(toFileUrl('C:\\Users\\user\\thumb.png')).toBe(
      'file:///C:/Users/user/thumb.png',
    );
  });
});
