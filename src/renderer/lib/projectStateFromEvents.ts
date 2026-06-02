/**
 * projectStateFromEvents — minimal renderer-side projection of
 * `.dhee/events.jsonl` into the `{nodes: {key: {status,outputPath}}}`
 * shape that `resolveTileDisplay` reads to find a project's thumbnail.
 *
 * Why this exists separately from kshana-core's full `projectWalkState`:
 * the desktop's landing tile only needs to know "what's completed,
 * what's its outputPath." It does NOT need branches, versions, costs,
 * the full event-source machinery. A 30-line fold beats coupling the
 * renderer to the core's event types.
 *
 * Regression context: projects created via headless scripts that
 * called walkBundle WITHOUT `bundleSource` never wrote walkState to
 * project.json — state lives only in events.jsonl. The tile resolver
 * then sees `walkState: undefined`, treats every node as pending, and
 * returns a generic folder icon instead of a real thumbnail.
 */

interface RawEvent {
  kind?: string;
  branchId?: string;
  payload?: {
    nodeId?: string;
    itemId?: string;
    outputPath?: string;
  };
}

export interface ProjectedNodeEntry {
  status: 'completed';
  outputPath?: string;
}

export interface ProjectedWalkState {
  nodes: Record<string, ProjectedNodeEntry>;
}

function keyOf(nodeId: string, itemId?: string): string {
  return itemId !== undefined && itemId !== '' ? `${nodeId}:${itemId}` : nodeId;
}

/**
 * Parse a `.dhee/events.jsonl` payload and project it into a minimal
 * walkState. Tolerates torn last lines (drops them silently) and
 * filters to `branchId === 'main'` (or events with no branchId, which
 * predate the branch dimension).
 *
 * Latest `node.completed` per key wins; `node.invalidated` removes
 * the entry; everything else is ignored.
 */
export function projectStateFromEventsJsonl(jsonl: string): ProjectedWalkState {
  const out: ProjectedWalkState = { nodes: {} };
  if (!jsonl) return out;
  const lines = jsonl.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: RawEvent;
    try {
      ev = JSON.parse(line) as RawEvent;
    } catch {
      continue; // torn / malformed — drop
    }
    if (ev.branchId !== undefined && ev.branchId !== 'main') continue;
    const p = ev.payload;
    if (!p || typeof p.nodeId !== 'string') continue;
    const key = keyOf(p.nodeId, p.itemId);
    if (ev.kind === 'node.completed') {
      out.nodes[key] = {
        status: 'completed',
        ...(typeof p.outputPath === 'string' ? { outputPath: p.outputPath } : {}),
      };
    } else if (ev.kind === 'node.invalidated') {
      delete out.nodes[key];
    }
  }
  return out;
}
