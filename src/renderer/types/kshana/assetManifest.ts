/**
 * Asset Manifest (.dhee/agent/manifest.json)
 * Location: <ProjectName>/.dhee/agent/manifest.json
 * Owner: Agent
 * Purpose: Canonical list of all generated assets
 */

/**
 * Types of assets that can be tracked in the manifest
 */
export type AssetType =
  // Reference images
  | 'character_ref'
  | 'setting_ref'
  // Scene assets
  | 'scene_image'
  | 'scene_video'
  | 'scene_infographic'
  | 'scene_thumbnail'
  // Audio assets
  | 'scene_dialogue_audio'
  | 'scene_music'
  | 'scene_sfx'
  | 'scene_audio_mix'
  // Text assets
  | 'scene_transcript'
  | 'scene_caption'
  // Final exports
  | 'final_video'
  | 'final_audio'
  | 'final_caption';

/**
 * Individual asset information
 */
export interface AssetInfo {
  /** Unique asset identifier */
  id: string;

  /** Type of asset */
  type: AssetType;

  /** Path to the asset file relative to project root */
  path: string;

  /** Entity slug (for character/setting assets) */
  entity_slug?: string;

  /** Scene number (for scene-specific assets) */
  scene_number?: number;

  /** Version number of the asset */
  version: number;

  /** Unix timestamp of creation */
  created_at: number;

  /** Additional metadata (prompt used, seed, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Asset manifest file structure
 */
export interface AssetManifest {
  /** Schema version for migration support */
  schema_version: '1';

  /** List of all assets */
  assets: AssetInfo[];

  /** Internal timestamp to force React re-renders (not persisted to disk) */
  _refreshedAt?: number;
}

/**
 * Creates a default empty asset manifest
 */
export function createDefaultAssetManifest(): AssetManifest {
  return {
    schema_version: '1',
    assets: [],
  };
}

/**
 * Creates a new AssetInfo object
 */
export function createAssetInfo(
  id: string,
  type: AssetType,
  path: string,
  version: number = 1,
  options?: {
    entity_slug?: string;
    scene_number?: number;
    metadata?: Record<string, unknown>;
  },
): AssetInfo {
  return {
    id,
    type,
    path,
    version,
    created_at: Date.now(),
    ...options,
  };
}

/**
 * Gets all assets of a specific type from the manifest
 */
export function getAssetsByType(
  manifest: AssetManifest,
  type: AssetType,
): AssetInfo[] {
  return manifest.assets.filter((asset) => asset.type === type);
}

/**
 * Gets all assets for a specific scene
 */
export function getAssetsByScene(
  manifest: AssetManifest,
  sceneNumber: number,
): AssetInfo[] {
  return manifest.assets.filter((asset) => asset.scene_number === sceneNumber);
}

/**
 * Gets the latest version of an asset by type and entity/scene
 */
export function getLatestAsset(
  manifest: AssetManifest,
  type: AssetType,
  options?: { entity_slug?: string; scene_number?: number },
): AssetInfo | undefined {
  const filtered = manifest.assets.filter((asset) => {
    if (asset.type !== type) return false;
    if (options?.entity_slug && asset.entity_slug !== options.entity_slug)
      return false;
    if (
      options?.scene_number !== undefined &&
      asset.scene_number !== options.scene_number
    )
      return false;
    return true;
  });

  if (filtered.length === 0) return undefined;

  return filtered.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  );
}
