import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { AssetInfo, AssetManifest } from '../../types/dhee/assetManifest';
import { ImageAssetSyncEngine } from './ImageAssetSyncEngine';
import type { ImageProjectionSnapshot } from './types';

/**
 * Exercises the sync engine's reconcile/projection/diff logic against seeded
 * manifest + fallback-scan inputs, with no real IPC. Uses fake timers to
 * drive the 200ms coalesce window and an injectable now() / logger.
 *
 * Covered: the trigger->coalesce->reconcile pipeline, placement projection
 * from manifest vs fallback-scan vs expected-pending vs missing, unresolvedCount
 * derivation, dedupe within the dedupe window, project-directory reset, and
 * updatedAt stability across no-op reconciles.
 */

const COALESCE_MS = 200;

function manifestWith(assets: AssetInfo[]): AssetManifest {
  return { schema_version: '1', assets };
}

function sceneImage(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    id: overrides.id ?? 'asset-1',
    type: overrides.type ?? 'scene_image',
    path: overrides.path ?? 'agent/image-placements/image1_a.png',
    version: overrides.version ?? 1,
    created_at: overrides.created_at ?? 1,
    scene_number: overrides.scene_number,
    metadata: overrides.metadata,
  };
}

interface Harness {
  engine: ImageAssetSyncEngine;
  latest: () => ImageProjectionSnapshot;
  readAssetManifest: jest.Mock<(dir: string) => Promise<AssetManifest | null>>;
  scanImagePlacements: jest.Mock<(dir: string) => Promise<Record<number, string>>>;
  logEvents: Array<{ event: string; payload: Record<string, unknown> }>;
  setNow: (ms: number) => void;
}

function makeHarness(opts: {
  manifest?: AssetManifest | null;
  fallback?: Record<number, string>;
} = {}): Harness {
  let nowMs = 1_000;
  const logEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];

  const readAssetManifest = jest
    .fn<(dir: string) => Promise<AssetManifest | null>>()
    .mockResolvedValue(opts.manifest ?? null);
  const scanImagePlacements = jest
    .fn<(dir: string) => Promise<Record<number, string>>>()
    .mockResolvedValue(opts.fallback ?? {});

  const engine = new ImageAssetSyncEngine({
    readAssetManifest: readAssetManifest as never,
    scanImagePlacements: scanImagePlacements as never,
    logger: (event, payload) => logEvents.push({ event, payload }),
    now: () => nowMs,
  });

  return {
    engine,
    latest: () => engine.getSnapshot(),
    readAssetManifest,
    scanImagePlacements,
    logEvents,
    setNow: (ms) => {
      nowMs = ms;
    },
  };
}

/** Advance past the coalesce window and flush the async reconcile chain. */
async function flushReconcile(): Promise<void> {
  jest.advanceTimersByTime(COALESCE_MS);
  // Reconcile awaits Promise.all(read, scan) then commits; let microtasks run.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ImageAssetSyncEngine — reconcile projection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('does not reconcile until a project directory is set', async () => {
    const h = makeHarness({ fallback: { 1: 'a.png' } });
    h.engine.triggerReconcile('manual');
    await flushReconcile();

    expect(h.readAssetManifest).not.toHaveBeenCalled();
    expect(h.latest().revision).toBe(0);
  });

  test('projects a manifest scene_image as available/manifest source', async () => {
    const h = makeHarness({
      manifest: manifestWith([
        sceneImage({ id: 'm1', metadata: { placementNumber: 1 }, version: 4 }),
      ]),
    });
    h.engine.setProjectDirectory('/proj');
    h.engine.triggerReconcile('project_load');
    await flushReconcile();

    const snap = h.latest();
    expect(snap.placements[1]).toMatchObject({
      placementNumber: 1,
      status: 'available',
      source: 'manifest',
      assetId: 'm1',
      version: 4,
      path: 'agent/image-placements/image1_a.png',
    });
    expect(snap.unresolvedCount).toBe(0);
    expect(snap.lastTriggerSource).toBe('project_load');
    expect(snap.revision).toBe(1);
  });

  test('falls back to scan when manifest has no matching asset', async () => {
    const h = makeHarness({
      manifest: manifestWith([]),
      fallback: { 2: '/abs/agent/image-placements/image2.png' },
    });
    h.engine.setProjectDirectory('/proj');
    h.engine.triggerReconcile('file_watch');
    await flushReconcile();

    const p = h.latest().placements[2]!;
    expect(p.status).toBe('available');
    expect(p.source).toBe('fallback_scan');
    expect(p.path).toBe('/abs/agent/image-placements/image2.png');
    expect(p.assetId).toBeNull();
  });

  test('expected-but-unresolved placement is pending and counted as unresolved', async () => {
    const h = makeHarness({ manifest: manifestWith([]) });
    h.engine.setProjectDirectory('/proj');
    // setExpectedPlacements itself triggers a 'manual' reconcile.
    h.engine.setExpectedPlacements([5, 6]);
    await flushReconcile();

    const snap = h.latest();
    expect(snap.placements[5]).toMatchObject({ status: 'pending', source: 'none' });
    expect(snap.placements[6]!.status).toBe('pending');
    expect(snap.unresolvedCount).toBe(2);
  });

  test('mixes available + pending: only the unresolved expected ones are counted', async () => {
    const h = makeHarness({
      manifest: manifestWith([
        sceneImage({ id: 'm5', metadata: { placementNumber: 5 } }),
      ]),
    });
    h.engine.setProjectDirectory('/proj');
    h.engine.setExpectedPlacements([5, 6]);
    await flushReconcile();

    const snap = h.latest();
    expect(snap.placements[5]!.status).toBe('available');
    expect(snap.placements[6]!.status).toBe('pending');
    expect(snap.unresolvedCount).toBe(1); // 5 resolved, 6 still pending
  });

  test('coalesces multiple triggers in the window into one reconcile', async () => {
    const h = makeHarness({ manifest: manifestWith([]) });
    h.engine.setProjectDirectory('/proj');
    h.readAssetManifest.mockClear();

    h.engine.triggerReconcile('file_watch');
    h.engine.triggerReconcile('file_watch');
    h.engine.triggerReconcile('ws_asset');
    await flushReconcile();

    expect(h.readAssetManifest).toHaveBeenCalledTimes(1);
    // Last pending source wins.
    expect(h.latest().lastTriggerSource).toBe('ws_asset');
  });

  test('dedupes triggers sharing a dedupeKey within the dedupe window', async () => {
    const h = makeHarness({ manifest: manifestWith([]) });
    h.engine.setProjectDirectory('/proj');

    h.engine.triggerReconcile('ws_asset', 'asset-x');
    h.engine.triggerReconcile('ws_asset', 'asset-x'); // deduped
    await flushReconcile();

    const deduped = h.logEvents.filter((e) => e.event === 'image_sync.trigger_deduped');
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.payload).toMatchObject({ dedupeKey: 'asset-x' });
  });

  test('a no-op reconcile preserves placement.updatedAt across runs', async () => {
    const h = makeHarness({
      manifest: manifestWith([
        sceneImage({ id: 'm1', metadata: { placementNumber: 1 } }),
      ]),
    });
    h.engine.setProjectDirectory('/proj');
    h.setNow(2_000);
    h.engine.triggerReconcile('project_load');
    await flushReconcile();
    const firstUpdatedAt = h.latest().placements[1]!.updatedAt;
    expect(firstUpdatedAt).toBe(2_000);

    // Re-reconcile at a later clock with identical inputs -> same field values,
    // so updatedAt must be carried over from the previous placement.
    h.setNow(9_999);
    h.engine.triggerReconcile('file_watch');
    await flushReconcile();
    expect(h.latest().placements[1]!.updatedAt).toBe(firstUpdatedAt);
  });

  test('setProjectDirectory(null) resets the projection to empty', async () => {
    const h = makeHarness({
      manifest: manifestWith([
        sceneImage({ id: 'm1', metadata: { placementNumber: 1 } }),
      ]),
    });
    h.engine.setProjectDirectory('/proj');
    h.engine.triggerReconcile('project_load');
    await flushReconcile();
    expect(Object.keys(h.latest().placements)).toHaveLength(1);

    h.engine.setProjectDirectory(null);
    const snap = h.latest();
    expect(snap.projectDirectory).toBeNull();
    expect(snap.placements).toEqual({});
    expect(snap.revision).toBe(0);
  });

  test('subscribe receives the committed snapshot after reconcile', async () => {
    const h = makeHarness({
      manifest: manifestWith([
        sceneImage({ id: 'm3', metadata: { placementNumber: 3 } }),
      ]),
    });
    const received: ImageProjectionSnapshot[] = [];
    h.engine.subscribe((s) => received.push(s));
    h.engine.setProjectDirectory('/proj');
    h.engine.triggerReconcile('manual');
    await flushReconcile();

    const last = received[received.length - 1]!;
    expect(last.placements[3]!.status).toBe('available');
  });
});
