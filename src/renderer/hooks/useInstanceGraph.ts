/**
 * useInstanceGraph — reactive access to the per-instance walk projection
 * (events.jsonl folded by dhee-core's projectInstanceGraph, fetched over
 * IPC via window.dhee.resolveInstanceGraph).
 *
 * Extracted from InstanceCardsCanvas so the run cockpit (transport bar,
 * stage rail, deliverables strip) can subscribe to the same source. A
 * stable JSON signature gates state updates so an unchanged poll never
 * forces a re-render. Pass pollMs to live-refresh during a run; 0 = fetch
 * once. See useInstanceGraph.test.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ResolveInstanceGraphRequest,
  InstanceGraphNode,
  InstanceGraphEdge,
} from '../../shared/dheeIpc';

export interface InstanceGraph {
  instances: InstanceGraphNode[];
  edges: InstanceGraphEdge[];
}

export interface UseInstanceGraphOptions {
  branchId?: string;
  /** Refresh interval in ms. 0 (default) = fetch once on mount/deps change. */
  pollMs?: number;
}

export interface UseInstanceGraphResult {
  graph: InstanceGraph | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useInstanceGraph(
  projectDir: string | null | undefined,
  opts: UseInstanceGraphOptions = {},
): UseInstanceGraphResult {
  const { branchId, pollMs = 0 } = opts;
  const [graph, setGraph] = useState<InstanceGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSig = useRef<string>('');

  const refresh = useCallback(async () => {
    if (!projectDir) {
      setGraph(null);
      lastSig.current = '';
      return;
    }
    try {
      const req: ResolveInstanceGraphRequest = { projectDir };
      if (branchId) req.branchId = branchId;
      const resp = await window.dhee.resolveInstanceGraph(req);
      if (!resp.ok || !resp.graph) {
        setError(resp.error ?? 'unknown error resolving instance graph');
        return;
      }
      setError(null);
      const sig = JSON.stringify(resp.graph);
      if (sig === lastSig.current) return; // unchanged → skip re-render
      lastSig.current = sig;
      setGraph(resp.graph);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectDir, branchId]);

  useEffect(() => {
    void refresh();
    if (!pollMs) return undefined;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { graph, error, refresh };
}
