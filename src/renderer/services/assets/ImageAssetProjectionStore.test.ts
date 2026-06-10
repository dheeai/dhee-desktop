import { describe, expect, jest, test } from '@jest/globals';
import { ImageAssetProjectionStore } from './ImageAssetProjectionStore';
import {
  createEmptyImageProjectionSnapshot,
  type ImageProjectionSnapshot,
  type PlacementProjection,
} from './types';

/**
 * Locks in the projection store's two load-bearing behaviors:
 *  - subscribe() pushes the current snapshot immediately + on every commit,
 *    and the returned unsubscribe stops further notifications.
 *  - commit() is value-equality-gated: structurally-equal snapshots are
 *    dropped (returns false, no emit) so consumers don't churn on no-op
 *    reconciles; any real field/placement change commits + emits.
 */

function placement(
  overrides: Partial<PlacementProjection> = {},
): PlacementProjection {
  return {
    placementNumber: overrides.placementNumber ?? 1,
    status: overrides.status ?? 'available',
    assetId: overrides.assetId ?? 'asset-1',
    path: overrides.path ?? 'agent/image-placements/image1.png',
    version: overrides.version ?? 1,
    source: overrides.source ?? 'manifest',
    updatedAt: overrides.updatedAt ?? 1000,
  };
}

function snapshot(
  overrides: Partial<ImageProjectionSnapshot> = {},
): ImageProjectionSnapshot {
  return {
    ...createEmptyImageProjectionSnapshot('/proj'),
    ...overrides,
  };
}

describe('ImageAssetProjectionStore — subscription', () => {
  test('subscribe immediately delivers the current snapshot', () => {
    const store = new ImageAssetProjectionStore();
    const listener = jest.fn();

    store.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(store.getSnapshot());
  });

  test('subscribers are notified on commit, and unsubscribe stops them', () => {
    const store = new ImageAssetProjectionStore();
    store.reset('/proj');
    const listener = jest.fn();

    const unsubscribe = store.subscribe(listener);
    listener.mockClear(); // drop the immediate delivery

    const next = snapshot({ revision: 1, placements: { 1: placement() } });
    store.commit(next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(next);

    unsubscribe();
    store.commit(snapshot({ revision: 2, placements: { 2: placement({ placementNumber: 2 }) } }));
    expect(listener).toHaveBeenCalledTimes(1); // no further calls after unsubscribe
  });

  test('reset replaces the snapshot and emits to subscribers', () => {
    const store = new ImageAssetProjectionStore();
    const listener = jest.fn();
    store.subscribe(listener);
    listener.mockClear();

    store.reset('/new-proj');

    expect(store.getSnapshot().projectDirectory).toBe('/new-proj');
    expect(store.getSnapshot().revision).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('ImageAssetProjectionStore — commit equality gate', () => {
  test('commit returns true and swaps snapshot when content differs', () => {
    const store = new ImageAssetProjectionStore();
    store.reset('/proj');

    const next = snapshot({ revision: 1, placements: { 1: placement() } });
    const changed = store.commit(next);

    expect(changed).toBe(true);
    expect(store.getSnapshot()).toBe(next);
  });

  test('commit returns false (no emit) when a structurally-equal snapshot arrives', () => {
    const store = new ImageAssetProjectionStore();
    store.reset('/proj');
    const first = snapshot({ revision: 1, placements: { 1: placement() } });
    store.commit(first);

    const listener = jest.fn();
    store.subscribe(listener);
    listener.mockClear();

    // Same field values, fresh object refs, different revision/updatedAt
    // (revision & updatedAt are intentionally NOT part of equality).
    const equalish = snapshot({
      revision: 999,
      updatedAt: 5000,
      placements: { 1: placement({ updatedAt: 99999 }) },
    });
    const changed = store.commit(equalish);

    expect(changed).toBe(false);
    expect(store.getSnapshot()).toBe(first); // unchanged
    expect(listener).not.toHaveBeenCalled();
  });

  test('a placement field change (e.g. version) breaks equality and commits', () => {
    const store = new ImageAssetProjectionStore();
    store.reset('/proj');
    store.commit(snapshot({ placements: { 1: placement({ version: 1 }) } }));

    const changed = store.commit(
      snapshot({ placements: { 1: placement({ version: 2 }) } }),
    );

    expect(changed).toBe(true);
    expect(store.getSnapshot().placements[1]!.version).toBe(2);
  });

  test('a different placement-key set breaks equality and commits', () => {
    const store = new ImageAssetProjectionStore();
    store.reset('/proj');
    store.commit(snapshot({ placements: { 1: placement() } }));

    const changed = store.commit(
      snapshot({
        placements: {
          1: placement(),
          2: placement({ placementNumber: 2, assetId: 'asset-2' }),
        },
      }),
    );

    expect(changed).toBe(true);
    expect(Object.keys(store.getSnapshot().placements)).toEqual(['1', '2']);
  });

  test('a top-level field change (unresolvedCount) breaks equality', () => {
    const store = new ImageAssetProjectionStore();
    store.reset('/proj');
    store.commit(snapshot({ unresolvedCount: 0, placements: { 1: placement() } }));

    const changed = store.commit(
      snapshot({ unresolvedCount: 1, placements: { 1: placement() } }),
    );

    expect(changed).toBe(true);
    expect(store.getSnapshot().unresolvedCount).toBe(1);
  });
});
