/**
 * expectedTotals — bundle-agnostic resolution of how many items a
 * collection stage WILL ultimately produce, so the run cockpit can show a
 * stable "47 / 50" instead of a denominator that creeps up as the walker
 * lazily materializes each item (47/48 → 48/49 …).
 *
 * Driven ENTIRELY by the bundle's own fan-out metadata:
 *   - `itemSource` — the upstream node a collection iterates.
 *   - `itemKey`    — which array, inside that source's JSON output, to
 *                    fan out over (e.g. "shots" vs "scenes").
 *
 * No node names or domain terms are baked in, so a narrative bundle
 * (itemKey "shots") and a finance bundle (itemKey "lineItems") resolve
 * through the identical path: read the source stage's JSON output, count
 * `output[itemKey].length`. A collection that fans out 1:1 from another
 * collection inherits that collection's expected total.
 */
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

export interface ExpectedTotalsNode {
  id: string;
  kind?: string;
  itemSource?: string;
  itemKey?: string;
}

/** Length of the (dot-path) array inside a parsed JSON object, or undefined. */
function arrayLengthAt(obj: unknown, path: string): number | undefined {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return Array.isArray(cur) ? cur.length : undefined;
}

/**
 * Resolve the expected item count for every collection node it can.
 *
 * @param nodes     bundle nodes (need id, kind, itemSource, itemKey)
 * @param instances live instance graph — used only to find each source
 *                  stage's completed output path (no domain assumptions)
 * @param readJson  reads + parses a relative artifact path; null on miss
 * @returns map nodeId → expected count (only nodes it could resolve)
 */
export async function computeExpectedTotals(
  nodes: ExpectedTotalsNode[],
  instances: InstanceGraphNode[],
  readJson: (relPath: string) => Promise<unknown | null>,
): Promise<Record<string, number>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // First completed instance with an output, per node — the source plan a
  // collection iterates is a single-instance stage, so its output is that
  // stage's plan file.
  const outputByNode = new Map<string, string>();
  for (const i of instances) {
    if (i.status === 'completed' && i.outputPath && !outputByNode.has(i.nodeId)) {
      outputByNode.set(i.nodeId, i.outputPath);
    }
  }

  const planCache = new Map<string, unknown | null>();
  const readPlan = async (relPath: string): Promise<unknown | null> => {
    if (planCache.has(relPath)) return planCache.get(relPath) ?? null;
    const v = await readJson(relPath).catch(() => null);
    planCache.set(relPath, v);
    return v;
  };

  const out: Record<string, number> = {};
  const resolving = new Set<string>();

  async function resolve(id: string): Promise<number | undefined> {
    if (id in out) return out[id];
    if (resolving.has(id)) return undefined; // cycle guard
    const node = byId.get(id);
    if (!node || node.kind !== 'collection' || !node.itemSource) return undefined;

    resolving.add(id);
    const source = byId.get(node.itemSource);
    let total: number | undefined;
    if (source && source.kind === 'collection') {
      // 1:1 fan-out off another collection — inherit its expected total.
      total = await resolve(source.id);
    } else if (node.itemKey) {
      // Fan-out off a stage's plan: count the named array in its output.
      const planPath = outputByNode.get(node.itemSource);
      if (planPath) {
        const plan = await readPlan(planPath);
        total = arrayLengthAt(plan, node.itemKey);
      }
    }
    resolving.delete(id);

    if (typeof total === 'number') out[id] = total;
    return total;
  }

  for (const n of nodes) {
    if (n.kind === 'collection') {
      // eslint-disable-next-line no-await-in-loop
      await resolve(n.id);
    }
  }
  return out;
}
