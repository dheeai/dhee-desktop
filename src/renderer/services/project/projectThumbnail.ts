import type { AssetInfo, AssetManifest } from '../../types/dhee';

const PROJECT_THUMBNAIL_DIR = '.dhee/ui';
const PROJECT_THUMBNAIL_FILE_BASENAME = 'thumbnail';
const SUPPORTED_THUMBNAIL_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '');
}

function joinPath(basePath: string, segment: string): string {
  const normalizedBase = normalizePath(basePath);
  const normalizedSegment = segment.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSegment}`;
}

function getPathExtension(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const basename = normalizedPath.split('/').pop() ?? normalizedPath;
  const lastDotIndex = basename.lastIndexOf('.');
  if (lastDotIndex < 0) {
    return '';
  }
  return basename.slice(lastDotIndex).toLowerCase();
}

function getThumbnailExtension(
  filePath: string,
): '.jpg' | '.png' | '.webp' | null {
  const extension = getPathExtension(filePath);
  if (extension === '.jpeg' || extension === '.jpg') {
    return '.jpg';
  }
  if (extension === '.png') {
    return '.png';
  }
  if (extension === '.webp') {
    return '.webp';
  }
  return null;
}

function getThumbnailCandidateRelativePaths(): string[] {
  return ['.jpg', '.png', '.webp'].map(
    (extension) =>
      `${PROJECT_THUMBNAIL_DIR}/${PROJECT_THUMBNAIL_FILE_BASENAME}${extension}`,
  );
}

function parseShotNumber(asset: AssetInfo): number | null {
  const shotNumber = asset.metadata?.shot_number;
  if (typeof shotNumber === 'number' && Number.isFinite(shotNumber)) {
    return shotNumber;
  }
  if (typeof shotNumber === 'string' && shotNumber.trim()) {
    const parsed = Number(shotNumber);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isEligibleThumbnailSource(asset: AssetInfo): boolean {
  return (
    asset.type === 'scene_image' &&
    parseShotNumber(asset) !== null &&
    getThumbnailExtension(asset.path) !== null &&
    SUPPORTED_THUMBNAIL_EXTENSIONS.has(getPathExtension(asset.path))
  );
}

export function selectProjectThumbnailSourceAsset(
  manifest: AssetManifest,
): AssetInfo | null {
  const candidates = manifest.assets
    .filter(isEligibleThumbnailSource)
    .sort((left, right) => {
      if (left.created_at !== right.created_at) {
        return left.created_at - right.created_at;
      }

      const leftScene = left.scene_number ?? Number.MAX_SAFE_INTEGER;
      const rightScene = right.scene_number ?? Number.MAX_SAFE_INTEGER;
      if (leftScene !== rightScene) {
        return leftScene - rightScene;
      }

      const leftShot = parseShotNumber(left) ?? Number.MAX_SAFE_INTEGER;
      const rightShot = parseShotNumber(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftShot !== rightShot) {
        return leftShot - rightShot;
      }

      return left.path.localeCompare(right.path);
    });

  return candidates[0] ?? null;
}

function buildSceneThumbnailAsset(
  currentManifest: AssetManifest,
  thumbnailRelativePath: string,
  sourceAsset: AssetInfo | null,
): { manifest: AssetManifest; changed: boolean } {
  const nextThumbnailAsset: AssetInfo = {
    id: 'project-thumbnail',
    type: 'scene_thumbnail',
    path: thumbnailRelativePath,
    version: 1,
    created_at: sourceAsset?.created_at ?? Date.now(),
    scene_number: sourceAsset?.scene_number,
    metadata: {
      source_asset_id: sourceAsset?.id ?? null,
      shot_number: sourceAsset ? parseShotNumber(sourceAsset) : null,
    },
  };

  const existingIndex = currentManifest.assets.findIndex(
    (asset) => asset.type === 'scene_thumbnail',
  );

  if (existingIndex >= 0) {
    const existingAsset = currentManifest.assets[existingIndex]!;
    if (
      existingAsset.path === nextThumbnailAsset.path &&
      existingAsset.scene_number === nextThumbnailAsset.scene_number &&
      existingAsset.metadata?.source_asset_id ===
        nextThumbnailAsset.metadata?.source_asset_id &&
      existingAsset.metadata?.shot_number ===
        nextThumbnailAsset.metadata?.shot_number
    ) {
      return { manifest: currentManifest, changed: false };
    }

    return {
      manifest: {
        ...currentManifest,
        assets: currentManifest.assets.map((asset, index) =>
          index === existingIndex ? nextThumbnailAsset : asset,
        ),
      },
      changed: true,
    };
  }

  return {
    manifest: {
      ...currentManifest,
      assets: [...currentManifest.assets, nextThumbnailAsset],
    },
    changed: true,
  };
}

async function findExistingProjectThumbnail(
  projectDirectory: string,
): Promise<string | null> {
  const candidateRelativePaths = getThumbnailCandidateRelativePaths();

  const findAtIndex = async (index: number): Promise<string | null> => {
    if (index >= candidateRelativePaths.length) {
      return null;
    }

    const relativePath = candidateRelativePaths[index]!;
    const absolutePath = joinPath(projectDirectory, relativePath);
    const exists = await window.electron.project.checkFileExists(absolutePath);
    if (exists) {
      return relativePath;
    }

    return findAtIndex(index + 1);
  };

  return findAtIndex(0);
}

function buildThumbnailAssetResult(
  manifest: AssetManifest,
  thumbnailRelativePath: string,
  sourceAsset: AssetInfo | null,
): { manifest: AssetManifest; changed: boolean } {
  return buildSceneThumbnailAsset(manifest, thumbnailRelativePath, sourceAsset);
}

export async function ensureProjectThumbnailFromManifest(
  projectDirectory: string,
  manifest: AssetManifest,
): Promise<{ manifest: AssetManifest; changed: boolean }> {
  const existingThumbnailPath =
    await findExistingProjectThumbnail(projectDirectory);
  if (existingThumbnailPath) {
    return buildThumbnailAssetResult(manifest, existingThumbnailPath, null);
  }

  const sourceAsset = selectProjectThumbnailSourceAsset(manifest);
  if (!sourceAsset) {
    return { manifest, changed: false };
  }

  const sourcePath = joinPath(projectDirectory, sourceAsset.path);
  const sourceExists =
    await window.electron.project.checkFileExists(sourcePath);
  if (!sourceExists) {
    return { manifest, changed: false };
  }

  const extension = getThumbnailExtension(sourceAsset.path);
  if (!extension) {
    return { manifest, changed: false };
  }
  const thumbnailRelativePath = `${PROJECT_THUMBNAIL_DIR}/${PROJECT_THUMBNAIL_FILE_BASENAME}${extension}`;
  const thumbnailDirectory = joinPath(projectDirectory, PROJECT_THUMBNAIL_DIR);
  const thumbnailAbsolutePath = joinPath(
    projectDirectory,
    thumbnailRelativePath,
  );
  const fileOpMeta = {
    source: 'renderer' as const,
    projectRoot: projectDirectory,
  };

  await window.electron.project.mkdir(thumbnailDirectory, fileOpMeta);
  await window.electron.project.copyFileExact(
    sourcePath,
    thumbnailAbsolutePath,
    fileOpMeta,
  );

  return buildThumbnailAssetResult(
    manifest,
    thumbnailRelativePath,
    sourceAsset,
  );
}
