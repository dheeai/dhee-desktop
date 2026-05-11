/**
 * Pure helper that turns the asset manifest into Watch's V1/V2/V3
 * sidebar list. Tested as data-in / data-out — no React.
 */
import { describe, expect, it } from '@jest/globals';
import {
  buildFinalVideoVersions,
  summarizeChanges,
  type ChangeSummary,
} from './buildFinalVideoVersions';
import type { AssetInfo } from '../../../types/dhee/assetManifest';

interface SeedAsset {
  id: string;
  type?: AssetInfo['type'];
  path?: string;
  createdAtMs?: number;
  duration?: number;
  diff?: {
    fromVersion?: number;
    added?: string[];
    removed?: string[];
    modified?: string[];
    reorderedCount?: number;
  };
}

function makeAsset(s: SeedAsset): AssetInfo {
  return {
    id: s.id,
    type: s.type ?? 'final_video',
    path: s.path ?? `assets/videos/final/${s.id}.mp4`,
    version: 1,
    // Use the on-disk camelCase shape the executor actually writes.
    // The desktop's AssetInfo type says `created_at` but the
    // manifest contains `createdAt` — the helper handles both.
    ...(s.createdAtMs !== undefined ? { createdAt: s.createdAtMs } : {}),
    metadata: {
      ...(s.duration !== undefined ? { duration: s.duration } : {}),
      ...(s.diff ? { diff: s.diff } : {}),
    },
  } as AssetInfo & { createdAt?: number };
}

describe('buildFinalVideoVersions', () => {
  describe('GIVEN a manifest with mixed asset types', () => {
    describe('WHEN building the version list', () => {
      it('THEN scene_video and other types are excluded — only final_video survives', () => {
        const assets: AssetInfo[] = [
          makeAsset({ id: 'fv1', createdAtMs: 100 }),
          makeAsset({ id: 'sv1', type: 'scene_video', createdAtMs: 50 }),
          makeAsset({ id: 'sv2', type: 'scene_video', createdAtMs: 200 }),
          makeAsset({ id: 'cr1', type: 'character_ref', createdAtMs: 10 }),
        ];
        const versions = buildFinalVideoVersions(assets);
        expect(versions).toHaveLength(1);
        expect(versions[0]?.assetId).toBe('fv1');
      });
    });
  });

  describe('GIVEN three final_video assets in random order', () => {
    describe('WHEN building the version list', () => {
      it('THEN labels are assigned chronologically (oldest=V1) but the list is returned newest-first for display', () => {
        const assets: AssetInfo[] = [
          makeAsset({ id: 'b', createdAtMs: 200 }),
          makeAsset({ id: 'c', createdAtMs: 300 }),
          makeAsset({ id: 'a', createdAtMs: 100 }),
        ];
        const versions = buildFinalVideoVersions(assets);
        // Newest first in the list — Watch shows V3 at the top.
        expect(versions.map((v) => v.assetId)).toEqual(['c', 'b', 'a']);
        // But labels still reflect chronological position (a was made
        // first → V1, c was made last → V3). The label is identity,
        // not display-position.
        expect(versions.map((v) => v.versionLabel)).toEqual(['V3', 'V2', 'V1']);
      });
    });
  });

  describe('GIVEN a final_video without diff metadata (legacy or V1)', () => {
    it('WHEN building THEN its changes is { kind: "initial" }', () => {
      const versions = buildFinalVideoVersions([
        makeAsset({ id: 'a', createdAtMs: 100 }),
      ]);
      expect(versions[0]?.changes).toEqual({ kind: 'initial' });
    });
  });

  describe('GIVEN a final_video with diff metadata', () => {
    it('WHEN building THEN changes carries the structured diff', () => {
      const versions = buildFinalVideoVersions([
        makeAsset({
          id: 'a',
          createdAtMs: 100,
          diff: {
            fromVersion: 2,
            added: ['shot_video:scene_2_shot_3'],
            removed: [],
            modified: ['shot_video:scene_1_shot_2'],
            reorderedCount: 0,
          },
        }),
      ]);
      const changes = versions[0]?.changes as Extract<ChangeSummary, { kind: 'diff' }>;
      expect(changes.kind).toBe('diff');
      expect(changes.fromVersionLabel).toBe('V2');
      expect(changes.added).toEqual(['shot_video:scene_2_shot_3']);
      expect(changes.modified).toEqual(['shot_video:scene_1_shot_2']);
    });
  });

  describe('GIVEN duration metadata on the asset', () => {
    it('WHEN building THEN durationSeconds is propagated', () => {
      const versions = buildFinalVideoVersions([
        makeAsset({ id: 'a', createdAtMs: 100, duration: 42.5 }),
      ]);
      expect(versions[0]?.durationSeconds).toBe(42.5);
    });
  });
});

describe('summarizeChanges', () => {
  describe('GIVEN an initial-cut summary', () => {
    it('THEN it renders as "Initial cut"', () => {
      expect(summarizeChanges({ kind: 'initial' })).toBe('Initial cut');
    });
  });

  describe('GIVEN a diff with no actual changes (re-assembly with same inputs)', () => {
    it('THEN it renders as "No changes from previous version"', () => {
      expect(
        summarizeChanges({
          kind: 'diff',
          fromVersionLabel: 'V2',
          added: [],
          removed: [],
          modified: [],
          reorderedCount: 0,
        }),
      ).toBe('No changes from previous version');
    });
  });

  describe('GIVEN a diff with mixed change types', () => {
    it('THEN counts are joined with separator, in order added · removed · changed · reordered', () => {
      expect(
        summarizeChanges({
          kind: 'diff',
          fromVersionLabel: 'V2',
          added: ['x', 'y'],
          removed: ['z'],
          modified: ['a', 'b', 'c'],
          reorderedCount: 1,
        }),
      ).toBe('2 added · 1 removed · 3 changed · 1 reordered');
    });
  });
});
