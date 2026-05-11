import { describe, expect, test } from '@jest/globals';
import type { AssetInfo } from '../../types/dhee/assetManifest';
import {
  inferImagePlacementNumberFromPath,
  resolvePlacementNumberFromAsset,
  matchAssetToPlacement,
  selectBestAssetForPlacement,
  buildAssetDedupeKey,
} from './ImagePlacementMatcher';

function createSceneImageAsset(
  overrides: Partial<AssetInfo> = {},
): AssetInfo {
  return {
    id: overrides.id ?? 'asset-1',
    type: overrides.type ?? 'scene_image',
    path: overrides.path ?? 'agent/image-placements/image1_test.png',
    version: overrides.version ?? 1,
    created_at: overrides.created_at ?? Date.now(),
    scene_number: overrides.scene_number,
    metadata: overrides.metadata,
  };
}

describe('ImagePlacementMatcher', () => {
  test('infers placement number from image filename path', () => {
    expect(
      inferImagePlacementNumberFromPath('agent/image-placements/image12_abc.png'),
    ).toBe(12);
    expect(inferImagePlacementNumberFromPath('agent/image-placements/other.png')).toBe(
      null,
    );
  });

  test('resolves placement number with metadata priority over scene_number and path', () => {
    const asset = createSceneImageAsset({
      scene_number: 4,
      metadata: { placementNumber: '8' },
      path: 'agent/image-placements/image2_test.png',
    });

    expect(resolvePlacementNumberFromAsset(asset)).toBe(8);
  });

  test('matches asset to placement using metadata, scene_number, then path fallback', () => {
    const metadataMatch = createSceneImageAsset({
      metadata: { placementNumber: 2 },
      scene_number: 9,
      path: 'agent/image-placements/image4_test.png',
    });
    const sceneMatch = createSceneImageAsset({
      id: 'scene-match',
      metadata: {},
      scene_number: 3,
      path: 'agent/image-placements/nomatch.png',
    });
    const pathMatch = createSceneImageAsset({
      id: 'path-match',
      metadata: {},
      path: 'agent/image-placements/image7_test.png',
    });

    expect(matchAssetToPlacement(metadataMatch, 2, 'scene_image')).toBe(true);
    expect(matchAssetToPlacement(sceneMatch, 3, 'scene_image')).toBe(true);
    expect(matchAssetToPlacement(pathMatch, 7, 'scene_image')).toBe(true);
  });

  test('selects exact target version when available, otherwise latest', () => {
    const assets: AssetInfo[] = [
      createSceneImageAsset({
        id: 'v1',
        version: 1,
        metadata: { placementNumber: 5 },
      }),
      createSceneImageAsset({
        id: 'v2',
        version: 2,
        metadata: { placementNumber: 5 },
      }),
      createSceneImageAsset({
        id: 'v3',
        version: 3,
        metadata: { placementNumber: 5 },
      }),
    ];

    expect(
      selectBestAssetForPlacement(assets, 5, 'scene_image', 2)?.id,
    ).toBe('v2');
    expect(selectBestAssetForPlacement(assets, 5, 'scene_image')?.id).toBe(
      'v3',
    );
  });

  test('builds dedupe key with placement identity dimensions', () => {
    const asset = createSceneImageAsset({
      id: 'img_a',
      version: 7,
      path: 'agent/image-placements/image3_x.png',
      metadata: { placementNumber: 3 },
    });

    expect(buildAssetDedupeKey(asset)).toBe(
      'img_a|agent/image-placements/image3_x.png|7|3',
    );
  });
});
