/**
 * Watch tab — version-list builder.
 *
 * Filters the asset manifest down to `final_video` entries, sorts
 * them oldest-first, and assigns V1, V2, V3… labels. Each version
 * carries a `changes` summary derived from the assembly-time diff
 * stamped into the asset's metadata by `executeFinalAssembly`. V1
 * (and any older final without diff metadata) renders as
 * "Initial cut" — the UI doesn't synthesize fake change lists.
 *
 * Pure module: no I/O, no React. The desktop's manifest type calls
 * the timestamp field `created_at` but dhee-core writes
 * `createdAt`; this helper accepts whichever shape the asset has on
 * disk so the Watch UI doesn't lose timestamps to that mismatch.
 */
import type { AssetInfo } from '../../../types/dhee/assetManifest';

export type ChangeSummary =
  | { kind: 'initial' }
  | {
      kind: 'diff';
      fromVersionLabel: string;
      added: string[];
      removed: string[];
      modified: string[];
      reorderedCount: number;
    };

export interface FinalVideoVersion {
  assetId: string;
  versionLabel: string;
  path: string;
  /** Milliseconds since epoch. 0 if unparseable. */
  createdAtMs: number;
  durationSeconds?: number;
  changes: ChangeSummary;
}

interface AssetWithMaybeCamelCreatedAt extends AssetInfo {
  /** Some manifests stamp `createdAt` instead of `created_at`. */
  createdAt?: number;
}

interface DiffMetadata {
  added?: string[];
  removed?: string[];
  modified?: string[];
  reorderedCount?: number;
  /** 1-indexed version number this diff is FROM (the predecessor). */
  fromVersion?: number;
}

function getCreatedAtMs(asset: AssetWithMaybeCamelCreatedAt): number {
  const v = asset.createdAt ?? asset.created_at;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function buildFinalVideoVersions(assets: AssetInfo[]): FinalVideoVersion[] {
  // Sort chronologically (oldest → newest) so labels are deterministic:
  // the first-ever assembly is V1, the second V2, etc. The DISPLAY
  // order is the reverse — Watch shows newest-first so the user lands
  // on the latest cut without scrolling. Label identity ≠ display
  // position.
  const finals = assets
    .filter((a) => a.type === 'final_video')
    .map((a) => a as AssetWithMaybeCamelCreatedAt)
    .sort((a, b) => getCreatedAtMs(a) - getCreatedAtMs(b));

  const versions = finals.map((asset, idx) => {
    const versionNumber = idx + 1;
    const meta = asset.metadata ?? {};
    const diff = meta['diff'] as DiffMetadata | undefined;

    const changes: ChangeSummary = diff
      ? {
          kind: 'diff',
          fromVersionLabel: diff.fromVersion ? `V${diff.fromVersion}` : `V${versionNumber - 1}`,
          added: diff.added ?? [],
          removed: diff.removed ?? [],
          modified: diff.modified ?? [],
          reorderedCount: diff.reorderedCount ?? 0,
        }
      : { kind: 'initial' };

    return {
      assetId: asset.id,
      versionLabel: `V${versionNumber}`,
      path: asset.path,
      createdAtMs: getCreatedAtMs(asset),
      durationSeconds:
        typeof meta['duration'] === 'number' ? (meta['duration'] as number) : undefined,
      changes,
    };
  });

  // Reverse for display: newest first.
  return versions.reverse();
}

/**
 * Render a one-line human summary from a ChangeSummary. Used by the
 * Watch tab when a card hasn't been expanded — the long-form
 * (per-segment list) is rendered inline by the component itself.
 */
export function summarizeChanges(changes: ChangeSummary): string {
  if (changes.kind === 'initial') return 'Initial cut';
  const parts: string[] = [];
  if (changes.added.length) parts.push(`${changes.added.length} added`);
  if (changes.removed.length) parts.push(`${changes.removed.length} removed`);
  if (changes.modified.length) parts.push(`${changes.modified.length} changed`);
  if (changes.reorderedCount > 0) parts.push(`${changes.reorderedCount} reordered`);
  if (parts.length === 0) return 'No changes from previous version';
  return parts.join(' · ');
}
