/**
 * Resolve a bundle's `display` block against project state into the
 * concrete numbers / paths a tile renderer needs. Pure functions — no
 * IO, no IPC. Caller provides the bundle (from `window.dhee.resolveBundle`)
 * and the parsed project.json content.
 *
 * The desktop UI never touches a hardcoded path or node id; everything
 * is driven by the bundle's display + per-node displayCapability tags.
 * That's the contract that makes wild bundle types (music albums,
 * 3D scans, text novellas, storyboards, you name it) render on the
 * landing screen without per-bundle desktop code.
 */
import {
  findByCapability,
  findInstanceByCapability,
  listCompletedItemIds,
  type BundleSnapshot,
  type ProjectStateLike,
} from './bundleCapability';

export interface ProjectLike {
  walkState?: ProjectStateLike;
  executorState?: ProjectStateLike;
}

export interface ResolvedTileDisplay {
  /** outputPath (relative to projectDir) for the thumbnail image, or null. */
  thumbnailPath: string | null;
  /** Computed stats with label and value, in declaration order. Empty if no stats declared. */
  stats: Array<{ label: string; value: number }>;
}

/**
 * Compute the tile's thumbnail + stats from the bundle's display block
 * and the current project state. Returns null thumbnail + empty stats
 * when the bundle has no display block or the state has nothing
 * matching.
 */
export function resolveTileDisplay(
  bundle: BundleSnapshot | null | undefined,
  project: ProjectLike | null | undefined,
  /** File-read function for resolving `stats[].path` lookups. Returns null on miss. */
  readFile: (relPath: string) => Promise<string | null>,
  rng: () => number = Math.random,
  /**
   * Existence probe for thumbnail candidates. A completed instance
   * whose artifact file was orphaned (preserve-on-overwrite moved it
   * aside before a failed re-render) must be skipped rather than
   * returned as a dead path. Defaults to "always exists" so pure
   * callers / tests that don't care about disk keep the canonical
   * pick behavior.
   */
  exists: (relPath: string) => Promise<boolean> = async () => true,
): Promise<ResolvedTileDisplay> {
  return (async (): Promise<ResolvedTileDisplay> => {
    const display = bundle?.display;
    if (!display) return { thumbnailPath: null, stats: [] };

    const thumbnailPath = display.thumbnail
      ? await resolveThumbnail(bundle, project, display.thumbnail, rng, exists)
      : null;

    const stats: Array<{ label: string; value: number }> = [];
    for (const stat of display.stats ?? []) {
      const value = await computeStat(bundle, project, stat, readFile);
      if (value !== null) stats.push({ label: stat.label, value });
    }

    return { thumbnailPath, stats };
  })();
}

async function resolveThumbnail(
  bundle: BundleSnapshot | null | undefined,
  project: ProjectLike | null | undefined,
  thumbnail: NonNullable<NonNullable<BundleSnapshot['display']>['thumbnail']>,
  rng: () => number,
  exists: (relPath: string) => Promise<boolean>,
): Promise<string | null> {
  const nodes = findByCapability(bundle, project, thumbnail.from);
  if (nodes.length === 0) return null;
  // Pool all completed instances across every node with that capability.
  const completed: Array<{ itemId?: string; outputPath: string; stateKey: string }> = [];
  for (const cn of nodes) {
    for (const inst of cn.instances) {
      if (inst.status !== 'completed' || !inst.outputPath) continue;
      completed.push({
        ...(inst.itemId !== undefined ? { itemId: inst.itemId } : {}),
        outputPath: inst.outputPath,
        stateKey: inst.stateKey,
      });
    }
  }
  if (completed.length === 0) return null;

  // Order the candidates by the pick strategy, then return the FIRST
  // whose artifact actually exists on disk. Skipping orphaned-but-
  // -completed instances (canonical file moved aside by a failed
  // re-render) is what keeps the tile from showing a dead path.
  const ordered = orderByPick(completed, thumbnail.pick ?? 'first_completed', rng);
  for (const c of ordered) {
    if (await exists(c.outputPath)) return c.outputPath;
  }
  return null;
}

function orderByPick(
  completed: Array<{ outputPath: string; stateKey: string }>,
  pick: 'first_completed' | 'latest_completed' | 'random_completed',
  rng: () => number,
): Array<{ outputPath: string; stateKey: string }> {
  switch (pick) {
    case 'random_completed': {
      // Start at the rng-chosen index, then rotate so existence
      // fallback continues deterministically through the rest.
      const idx = Math.min(Math.floor(rng() * completed.length), completed.length - 1);
      return [...completed.slice(idx), ...completed.slice(0, idx)];
    }
    case 'latest_completed':
      // Highest stateKey first — for scene_N_shot_M ids this is the
      // most recently materialized chain step.
      return [...completed].sort((a, b) => b.stateKey.localeCompare(a.stateKey));
    case 'first_completed':
    default:
      // Lowest stateKey first — the opening shot for scene_N_shot_M ids.
      return [...completed].sort((a, b) => a.stateKey.localeCompare(b.stateKey));
  }
}

async function computeStat(
  bundle: BundleSnapshot | null | undefined,
  project: ProjectLike | null | undefined,
  stat: NonNullable<NonNullable<BundleSnapshot['display']>['stats']>[number],
  readFile: (relPath: string) => Promise<string | null>,
): Promise<number | null> {
  if (stat.count_completed) {
    const ids = listCompletedItemIds(bundle, project, stat.source);
    return ids.length;
  }
  if (stat.path) {
    // Find the (stage) node tagged with `source` and read its output.
    // Stage nodes have no itemId in walkState — findInstanceByCapability
    // skips them because it filters by itemId match. Use findByCapability
    // and pick the first completed instance with an outputPath.
    const nodes = findByCapability(bundle, project, stat.source);
    let outputPath: string | undefined;
    for (const cn of nodes) {
      const completed = cn.instances.find((i) => i.status === 'completed' && i.outputPath);
      if (completed) {
        outputPath = completed.outputPath;
        break;
      }
    }
    if (!outputPath) return null;
    const raw = await readFile(outputPath).catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const value = dotPathLookup(parsed, stat.path);
      if (typeof value === 'number') return value;
      if (Array.isArray(value)) return value.length;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function dotPathLookup(obj: unknown, path: string): unknown {
  // Supports 'foo.bar.length' — if the final segment is 'length' and
  // the parent is an array, returns the array length.
  let cur: unknown = obj;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i === parts.length - 1 && part === 'length' && Array.isArray(cur)) {
      return cur.length;
    }
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Convenience helper for callers that only want the thumbnail path and
 * don't care about on-disk existence (pure / synchronous). Returns the
 * canonical pick without probing disk — same as the existence-unaware
 * default of resolveTileDisplay.
 */
export function thumbnailFromDisplay(
  bundle: BundleSnapshot | null | undefined,
  project: ProjectLike | null | undefined,
  rng?: () => number,
): string | null {
  const thumbnail = bundle?.display?.thumbnail;
  if (!thumbnail) return null;
  const nodes = findByCapability(bundle, project, thumbnail.from);
  if (nodes.length === 0) return null;
  const completed: Array<{ outputPath: string; stateKey: string }> = [];
  for (const cn of nodes) {
    for (const inst of cn.instances) {
      if (inst.status !== 'completed' || !inst.outputPath) continue;
      completed.push({ outputPath: inst.outputPath, stateKey: inst.stateKey });
    }
  }
  if (completed.length === 0) return null;
  const ordered = orderByPick(completed, thumbnail.pick ?? 'first_completed', rng ?? Math.random);
  return ordered[0]?.outputPath ?? null;
}

// Re-export so callers can also do their own ad-hoc lookups against
// the same bundle snapshot the tile uses.
export { findByCapability, findInstanceByCapability, listCompletedItemIds };
