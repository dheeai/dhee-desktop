import { describe, it, expect } from '@jest/globals';
import { extractRehydratedMedia } from './rehydratedMedia';

describe('extractRehydratedMedia', () => {
  it('uses details.file_path + asset_type + created_at', () => {
    expect(
      extractRehydratedMedia({
        details: {
          file_path: '/p/assets/shot.png',
          asset_type: 'image',
          created_at: 1234,
        },
      }),
    ).toEqual({ path: '/p/assets/shot.png', kind: 'image', createdAt: 1234 });
  });

  it('infers kind from the extension when asset_type is absent', () => {
    expect(extractRehydratedMedia({ details: { file_path: '/p/final.mp4' } })).toEqual({
      path: '/p/final.mp4',
      kind: 'video',
    });
  });

  it('parses a file path out of the result text when there is no details.file_path', () => {
    expect(
      extractRehydratedMedia({
        resultText:
          '/Users/g/dhee-studios/x/assets/images/shots/scene_4_shot_19_first.png (image, 1423195 bytes)',
      }),
    ).toEqual({
      path: '/Users/g/dhee-studios/x/assets/images/shots/scene_4_shot_19_first.png',
      kind: 'image',
    });
  });

  it('returns null for non-media paths or no path', () => {
    expect(extractRehydratedMedia({ details: { file_path: '/p/script.md' } })).toBeNull();
    expect(extractRehydratedMedia({ resultText: 'Status counts: completed 3' })).toBeNull();
    expect(extractRehydratedMedia({})).toBeNull();
  });
});
