import type { AssetInfo, AssetType } from '../../types/dhee/assetManifest';

function parsePlacementNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function inferImagePlacementNumberFromPath(
  path: string | undefined | null,
): number | null {
  if (!path) return null;
  const filename = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const match = filename.match(/image(\d+)(?:[-_]|\.|$)/i);
  if (!match) return null;
  return parsePlacementNumber(match[1]);
}

export function resolvePlacementNumberFromAsset(
  asset: Pick<AssetInfo, 'metadata' | 'scene_number' | 'path'>,
): number | null {
  const fromMetadata = parsePlacementNumber(asset.metadata?.placementNumber);
  if (fromMetadata !== null) return fromMetadata;

  const fromSceneNumber = parsePlacementNumber(asset.scene_number);
  if (fromSceneNumber !== null) return fromSceneNumber;

  return inferImagePlacementNumberFromPath(asset.path);
}

export function matchAssetToPlacement(
  asset: Pick<AssetInfo, 'type' | 'metadata' | 'scene_number' | 'path'>,
  placementNumber: number,
  assetType: AssetType,
): boolean {
  if (asset.type !== assetType) return false;
  const resolvedPlacement = resolvePlacementNumberFromAsset(asset);
  return resolvedPlacement === placementNumber;
}

export function selectBestAssetForPlacement(
  assets: AssetInfo[],
  placementNumber: number,
  assetType: AssetType,
  targetVersion?: number,
): AssetInfo | undefined {
  const matches = assets.filter((asset) =>
    matchAssetToPlacement(asset, placementNumber, assetType),
  );

  if (matches.length === 0) return undefined;

  if (targetVersion !== undefined) {
    const exactVersion = matches.find((asset) => asset.version === targetVersion);
    if (exactVersion) return exactVersion;
  }

  return matches.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  );
}

export function buildAssetDedupeKey(
  asset: Pick<AssetInfo, 'id' | 'path' | 'version' | 'metadata' | 'scene_number'>,
): string {
  const placementNumber = resolvePlacementNumberFromAsset(asset);
  return `${asset.id}|${asset.path}|${asset.version}|${placementNumber ?? 'unknown'}`;
}
