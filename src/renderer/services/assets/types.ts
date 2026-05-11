import type { AssetInfo } from '../../types/dhee/assetManifest';

export type ImageSyncTriggerSource =
  | 'ws_asset'
  | 'file_watch'
  | 'watchdog'
  | 'manual'
  | 'project_load'
  | 'manifest_written';

export type PlacementProjectionStatus = 'missing' | 'pending' | 'available' | 'error';

export type PlacementProjectionSource = 'manifest' | 'fallback_scan' | 'none';

export interface PlacementProjection {
  placementNumber: number;
  status: PlacementProjectionStatus;
  assetId: string | null;
  path: string | null;
  version: number | null;
  source: PlacementProjectionSource;
  updatedAt: number;
}

export interface ImageProjectionSnapshot {
  projectDirectory: string | null;
  revision: number;
  placements: Record<number, PlacementProjection>;
  unresolvedCount: number;
  lastConvergedAt: number | null;
  lastTriggerSource: ImageSyncTriggerSource | null;
  updatedAt: number;
}

export interface ImageSyncTrigger {
  source: ImageSyncTriggerSource;
  dedupeKey?: string;
  at: number;
}

export interface ImageSyncReconcileResult {
  snapshot: ImageProjectionSnapshot;
  manifestAssets: AssetInfo[];
  unresolvedCount: number;
}

export interface ImageSyncLogger {
  (event: string, payload: Record<string, unknown>): void;
}

export function createEmptyImageProjectionSnapshot(
  projectDirectory: string | null = null,
): ImageProjectionSnapshot {
  return {
    projectDirectory,
    revision: 0,
    placements: {},
    unresolvedCount: 0,
    lastConvergedAt: null,
    lastTriggerSource: null,
    updatedAt: Date.now(),
  };
}
