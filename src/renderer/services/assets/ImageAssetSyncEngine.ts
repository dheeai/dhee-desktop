import type { AssetInfo, AssetManifest } from '../../types/dhee/assetManifest';
import { ImageAssetProjectionStore } from './ImageAssetProjectionStore';
import {
  selectBestAssetForPlacement,
  resolvePlacementNumberFromAsset,
} from './ImagePlacementMatcher';
import {
  createEmptyImageProjectionSnapshot,
  type ImageProjectionSnapshot,
  type ImageSyncLogger,
  type ImageSyncTriggerSource,
  type PlacementProjection,
} from './types';

const COALESCE_WINDOW_MS = 200;
const DEDUPE_WINDOW_MS = 1500;

interface ImageAssetSyncEngineDependencies {
  readAssetManifest: (projectDirectory: string) => Promise<AssetManifest | null>;
  scanImagePlacements: (projectDirectory: string) => Promise<Record<number, string>>;
  logger?: ImageSyncLogger;
  now?: () => number;
}

export class ImageAssetSyncEngine {
  private readonly store = new ImageAssetProjectionStore();

  private readonly deps: ImageAssetSyncEngineDependencies;

  private projectDirectory: string | null = null;

  private expectedPlacements = new Set<number>();

  private triggerTimer: ReturnType<typeof setTimeout> | null = null;

  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  private unresolvedStartedAt: number | null = null;

  private pendingSource: ImageSyncTriggerSource | null = null;

  private pendingDedupeKeys = new Map<string, number>();

  private reconcileInFlight = false;

  private reconcileRerunRequested = false;

  constructor(deps: ImageAssetSyncEngineDependencies) {
    this.deps = deps;
  }

  setProjectDirectory(projectDirectory: string | null): void {
    if (this.projectDirectory === projectDirectory) return;

    this.projectDirectory = projectDirectory;
    this.expectedPlacements.clear();
    this.clearTimers();
    this.pendingSource = null;
    this.pendingDedupeKeys.clear();
    this.reconcileInFlight = false;
    this.reconcileRerunRequested = false;
    this.unresolvedStartedAt = null;
    this.store.reset(projectDirectory);
  }

  setExpectedPlacements(placementNumbers: number[]): void {
    const normalized = placementNumbers
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.trunc(value))
      .filter((value, index, all) => all.indexOf(value) === index);

    const next = new Set<number>(normalized);
    const hasChanged =
      next.size !== this.expectedPlacements.size ||
      [...next].some((value) => !this.expectedPlacements.has(value));

    if (!hasChanged) return;

    this.expectedPlacements = next;
    this.triggerReconcile('manual');
  }

  subscribe(listener: (snapshot: ImageProjectionSnapshot) => void): () => void {
    return this.store.subscribe(listener);
  }

  getSnapshot(): ImageProjectionSnapshot {
    return this.store.getSnapshot();
  }

  triggerReconcile(source: ImageSyncTriggerSource, dedupeKey?: string): void {
    const now = this.now();
    this.evictOldDedupeKeys(now);

    if (dedupeKey) {
      const previous = this.pendingDedupeKeys.get(dedupeKey);
      if (previous && now - previous < DEDUPE_WINDOW_MS) {
        this.log('image_sync.trigger_deduped', { source, dedupeKey });
        return;
      }
      this.pendingDedupeKeys.set(dedupeKey, now);
    }

    this.pendingSource = source;
    this.log('image_sync.trigger', {
      source,
      dedupeKey: dedupeKey ?? null,
      projectDirectory: this.projectDirectory,
    });

    if (this.triggerTimer) {
      return;
    }

    this.triggerTimer = setTimeout(() => {
      this.triggerTimer = null;
      this.runReconcile().catch((error) => {
        this.log('image_sync.reconcile_error', {
          source,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, COALESCE_WINDOW_MS);
  }

  dispose(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.triggerTimer) {
      clearTimeout(this.triggerTimer);
      this.triggerTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private evictOldDedupeKeys(now: number): void {
    for (const [key, timestamp] of this.pendingDedupeKeys) {
      if (now - timestamp > DEDUPE_WINDOW_MS) {
        this.pendingDedupeKeys.delete(key);
      }
    }
  }

  private async runReconcile(): Promise<void> {
    if (!this.projectDirectory) return;

    if (this.reconcileInFlight) {
      this.reconcileRerunRequested = true;
      return;
    }

    this.reconcileInFlight = true;
    const source = this.pendingSource ?? 'manual';
    this.pendingSource = null;
    const reconcileStartedAt = this.now();

    this.log('image_sync.reconcile_start', {
      source,
      projectDirectory: this.projectDirectory,
    });

    try {
      const [manifest, fallbackFiles] = await Promise.all([
        this.deps.readAssetManifest(this.projectDirectory),
        this.deps.scanImagePlacements(this.projectDirectory),
      ]);

      const imageAssets = (manifest?.assets ?? []).filter(
        (asset) => asset.type === 'scene_image',
      );

      const placementNumbers = this.collectPlacementNumbers(
        imageAssets,
        fallbackFiles,
      );
      const previousSnapshot = this.store.getSnapshot();
      const now = this.now();

      const placements: Record<number, PlacementProjection> = {};
      for (const placementNumber of placementNumbers) {
        const selectedAsset = selectBestAssetForPlacement(
          imageAssets,
          placementNumber,
          'scene_image',
        );
        const fallbackPath = fallbackFiles[placementNumber] ?? null;

        let status: PlacementProjection['status'] = 'missing';
        let sourceType: PlacementProjection['source'] = 'none';
        let path: string | null = null;
        let assetId: string | null = null;
        let version: number | null = null;

        if (selectedAsset?.path) {
          status = 'available';
          sourceType = 'manifest';
          path = selectedAsset.path;
          assetId = selectedAsset.id;
          version = selectedAsset.version;
        } else if (fallbackPath) {
          status = 'available';
          sourceType = 'fallback_scan';
          path = fallbackPath;
        } else if (this.expectedPlacements.has(placementNumber)) {
          status = 'pending';
        }

        const previousPlacement = previousSnapshot.placements[placementNumber];
        placements[placementNumber] = {
          placementNumber,
          status,
          source: sourceType,
          assetId,
          path,
          version,
          updatedAt:
            previousPlacement &&
            previousPlacement.status === status &&
            previousPlacement.path === path &&
            previousPlacement.assetId === assetId &&
            previousPlacement.version === version &&
            previousPlacement.source === sourceType
              ? previousPlacement.updatedAt
              : now,
        };
      }

      const unresolvedCount = [...this.expectedPlacements].filter((placement) => {
        return placements[placement]?.status !== 'available';
      }).length;

      const nextSnapshot: ImageProjectionSnapshot = {
        projectDirectory: this.projectDirectory,
        revision: previousSnapshot.revision + 1,
        placements,
        unresolvedCount,
        lastConvergedAt:
          unresolvedCount === 0
            ? previousSnapshot.unresolvedCount > 0
              ? now
              : previousSnapshot.lastConvergedAt
            : previousSnapshot.lastConvergedAt,
        lastTriggerSource: source,
        updatedAt: now,
      };

      const changed = this.store.commit(nextSnapshot);
      if (changed) {
        this.log('image_sync.reconcile_commit', {
          source,
          revision: nextSnapshot.revision,
          unresolvedCount,
          placementCount: Object.keys(placements).length,
          durationMs: this.now() - reconcileStartedAt,
        });
      } else {
        this.log('image_sync.reconcile_noop', {
          source,
          revision: previousSnapshot.revision,
          unresolvedCount,
          durationMs: this.now() - reconcileStartedAt,
        });
      }

      this.updateWatchdog(unresolvedCount);
    } finally {
      this.reconcileInFlight = false;
      if (this.reconcileRerunRequested) {
        this.reconcileRerunRequested = false;
        this.runReconcile().catch((error) => {
          this.log('image_sync.reconcile_error', {
            source,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  }

  private collectPlacementNumbers(
    imageAssets: AssetInfo[],
    fallbackFiles: Record<number, string>,
  ): number[] {
    const placements = new Set<number>();

    for (const expected of this.expectedPlacements) {
      placements.add(expected);
    }

    Object.keys(fallbackFiles).forEach((key) => {
      const placementNumber = Number(key);
      if (Number.isFinite(placementNumber)) {
        placements.add(placementNumber);
      }
    });

    imageAssets.forEach((asset) => {
      const placementNumber = resolvePlacementNumberFromAsset(asset);
      if (placementNumber !== null) {
        placements.add(placementNumber);
      }
    });

    return [...placements].sort((a, b) => a - b);
  }

  private updateWatchdog(unresolvedCount: number): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (unresolvedCount <= 0) {
      if (this.unresolvedStartedAt !== null) {
        this.log('image_sync.converged', {
          unresolvedCount,
          durationMs: this.now() - this.unresolvedStartedAt,
        });
      }
      this.unresolvedStartedAt = null;
      return;
    }

    if (this.unresolvedStartedAt === null) {
      this.unresolvedStartedAt = this.now();
    }

    const elapsedMs = this.now() - this.unresolvedStartedAt;
    const nextDelayMs = elapsedMs <= 30000 ? 1000 : 5000;
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      this.triggerReconcile('watchdog');
    }, nextDelayMs);
  }

  private log(event: string, payload: Record<string, unknown>): void {
    if (this.deps.logger) {
      this.deps.logger(event, payload);
      return;
    }
    console.log(`[ImageAssetSyncEngine] ${event}`, payload);
  }
}

export function createImageAssetSyncEngine(
  deps: ImageAssetSyncEngineDependencies,
): ImageAssetSyncEngine {
  return new ImageAssetSyncEngine(deps);
}

export const EMPTY_IMAGE_PROJECTION_SNAPSHOT =
  createEmptyImageProjectionSnapshot();
