/**
 * Renderer-side bundle capability query.
 *
 * The desktop discovers what artifacts a bundle produces by looking at
 * the `displayCapability` tags on its nodes — never by hardcoded node
 * ids or filesystem paths. This module mirrors dhee-core's
 * capabilities.ts query surface so renderer views can compute
 * lookups locally (no IPC round-trip per query). The bundle definition
 * itself comes via `window.dhee.resolveBundle()` (one IPC call,
 * renderer caches it for the project's lifetime).
 *
 * The shape here matches `ResolveBundleResponse.bundle` from
 * `src/shared/dheeIpc.ts` — keep in sync.
 */

import type { ResolveBundleResponse } from '../../shared/dheeIpc';

export type BundleSnapshot = NonNullable<ResolveBundleResponse['bundle']>;
export type BundleNode = BundleSnapshot['nodes'][number];

export interface NodeStateLike {
  outputPath?: string;
  outputPaths?: Record<string, string>;
  status?: string;
}

export interface ProjectStateLike {
  nodes?: Record<string, NodeStateLike>;
}

export interface CapabilityInstance {
  /** '<nodeId>:<itemId>' for collection items; '<nodeId>' for stages. */
  stateKey: string;
  /** Item id (e.g. 'scene_1_shot_2') — undefined for stages. */
  itemId?: string;
  status: 'completed' | 'pending' | 'failed' | string;
  /** Path relative to projectDir (as the walker recorded it). */
  outputPath?: string;
  outputPaths?: Record<string, string>;
}

export interface CapabilityNode {
  node: BundleNode;
  instances: CapabilityInstance[];
}

/**
 * Returns every bundle node tagged with the given capability, paired
 * with the per-instance walkState entries.
 *
 * Reads `walkState.nodes` first; falls back to `executorState.nodes`
 * for projects produced by the legacy executor (pre-bundle).
 */
export function findByCapability(
  bundle: BundleSnapshot | null | undefined,
  project: { walkState?: ProjectStateLike; executorState?: ProjectStateLike } | null | undefined,
  capability: string,
): CapabilityNode[] {
  if (!bundle) return [];
  const stateNodes = project?.walkState?.nodes ?? project?.executorState?.nodes ?? {};
  const out: CapabilityNode[] = [];
  for (const node of bundle.nodes) {
    if (node.displayCapability !== capability) continue;
    const instances: CapabilityInstance[] = [];
    for (const [key, entry] of Object.entries(stateNodes)) {
      const isStageKey = key === node.id;
      const collectionPrefix = `${node.id}:`;
      const isCollectionKey = key.startsWith(collectionPrefix);
      if (!isStageKey && !isCollectionKey) continue;
      const itemId = isCollectionKey ? key.slice(collectionPrefix.length) : undefined;
      instances.push({
        stateKey: key,
        ...(itemId !== undefined ? { itemId } : {}),
        status: entry.status ?? 'pending',
        ...(entry.outputPath ? { outputPath: entry.outputPath } : {}),
        ...(entry.outputPaths ? { outputPaths: entry.outputPaths } : {}),
      });
    }
    out.push({ node, instances });
  }
  return out;
}

/** Single-item lookup. Returns the completed instance or undefined. */
export function findInstanceByCapability(
  bundle: BundleSnapshot | null | undefined,
  project: { walkState?: ProjectStateLike; executorState?: ProjectStateLike } | null | undefined,
  capability: string,
  itemId: string,
): CapabilityInstance | undefined {
  for (const cn of findByCapability(bundle, project, capability)) {
    const match = cn.instances.find((i) => i.itemId === itemId && i.status === 'completed');
    if (match) return match;
  }
  return undefined;
}

/** Unique completed itemIds across all nodes tagged with the capability, sorted. */
export function listCompletedItemIds(
  bundle: BundleSnapshot | null | undefined,
  project: { walkState?: ProjectStateLike; executorState?: ProjectStateLike } | null | undefined,
  capability: string,
): string[] {
  const set = new Set<string>();
  for (const cn of findByCapability(bundle, project, capability)) {
    for (const inst of cn.instances) {
      if (inst.itemId && inst.status === 'completed') set.add(inst.itemId);
    }
  }
  return Array.from(set).sort();
}
