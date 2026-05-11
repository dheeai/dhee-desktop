import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AssetInfo, AssetManifest } from '../../types/dhee';
import {
  ensureProjectThumbnailFromManifest,
  selectProjectThumbnailSourceAsset,
} from './projectThumbnail';

function createAsset(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    id: overrides.id ?? 'asset-1',
    type: overrides.type ?? 'scene_image',
    path: overrides.path ?? 'assets/images/scene-1-shot-1.png',
    version: overrides.version ?? 1,
    created_at: overrides.created_at ?? 100,
    scene_number: overrides.scene_number,
    metadata: overrides.metadata ?? { shot_number: 1 },
  };
}

describe('projectThumbnail', () => {
  const mockCheckFileExists = jest.fn<(filePath: string) => Promise<boolean>>();
  const mockMkdir =
    jest.fn<(dirPath: string, meta?: unknown) => Promise<void>>();
  const mockCopyFileExact =
    jest.fn<
      (
        sourcePath: string,
        destinationPath: string,
        meta?: unknown,
      ) => Promise<void>
    >();

  beforeEach(() => {
    mockCheckFileExists.mockReset();
    mockMkdir.mockReset();
    mockCopyFileExact.mockReset();

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        project: {
          checkFileExists: mockCheckFileExists,
          mkdir: mockMkdir,
          copyFileExact: mockCopyFileExact,
        },
      },
    });
  });

  it('selects the earliest eligible shot-level scene image', () => {
    const manifest: AssetManifest = {
      schema_version: '1',
      assets: [
        createAsset({
          id: 'scene-image-no-shot',
          created_at: 10,
          metadata: {},
        }),
        createAsset({
          id: 'shot-2',
          created_at: 40,
          metadata: { shot_number: 2 },
        }),
        createAsset({
          id: 'shot-1',
          created_at: 20,
          metadata: { shot_number: 1 },
        }),
      ],
    };

    expect(selectProjectThumbnailSourceAsset(manifest)?.id).toBe('shot-1');
  });

  it('creates a project thumbnail from the first shot image and adds manifest entry', async () => {
    const manifest: AssetManifest = {
      schema_version: '1',
      assets: [
        createAsset({
          id: 'shot-1',
          path: 'assets/images/scene1-shot1.png',
          created_at: 20,
          scene_number: 1,
          metadata: { shot_number: 1 },
        }),
      ],
    };

    mockCheckFileExists.mockImplementation(async (filePath: string) => {
      return filePath === '/projects/demo/assets/images/scene1-shot1.png';
    });
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFileExact.mockResolvedValue(undefined);

    const result = await ensureProjectThumbnailFromManifest(
      '/projects/demo',
      manifest,
    );

    const fileOpMeta = {
      source: 'renderer',
      projectRoot: '/projects/demo',
    };
    expect(mockMkdir).toHaveBeenCalledWith(
      '/projects/demo/.dhee/ui',
      fileOpMeta,
    );
    expect(mockCopyFileExact).toHaveBeenCalledWith(
      '/projects/demo/assets/images/scene1-shot1.png',
      '/projects/demo/.dhee/ui/thumbnail.png',
      fileOpMeta,
    );
    expect(result.changed).toBe(true);
    expect(result.manifest.assets).toContainEqual(
      expect.objectContaining({
        type: 'scene_thumbnail',
        path: '.dhee/ui/thumbnail.png',
      }),
    );
  });

  it('does not replace an existing thumbnail file', async () => {
    const manifest: AssetManifest = {
      schema_version: '1',
      assets: [
        createAsset({
          id: 'shot-1',
          path: 'assets/images/scene1-shot1.png',
          metadata: { shot_number: 1 },
        }),
      ],
    };

    mockCheckFileExists.mockImplementation(async (filePath: string) => {
      return filePath === '/projects/demo/.dhee/ui/thumbnail.png';
    });

    const result = await ensureProjectThumbnailFromManifest(
      '/projects/demo',
      manifest,
    );

    expect(mockCopyFileExact).not.toHaveBeenCalled();
    expect(result.manifest.assets).toContainEqual(
      expect.objectContaining({
        type: 'scene_thumbnail',
        path: '.dhee/ui/thumbnail.png',
      }),
    );
  });

  it('ignores scene images without shot_number metadata', async () => {
    const manifest: AssetManifest = {
      schema_version: '1',
      assets: [
        createAsset({
          id: 'scene-only',
          path: 'assets/images/scene1.png',
          metadata: { placementNumber: 1 },
        }),
      ],
    };

    mockCheckFileExists.mockResolvedValue(false);

    const result = await ensureProjectThumbnailFromManifest(
      '/projects/demo',
      manifest,
    );

    expect(result.changed).toBe(false);
    expect(mockCopyFileExact).not.toHaveBeenCalled();
  });
});
