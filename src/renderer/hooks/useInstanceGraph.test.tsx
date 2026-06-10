/**
 * useInstanceGraph — TDD coverage.
 *
 * Thin reactive wrapper over window.dhee.resolveInstanceGraph (the
 * events.jsonl projection). The run cockpit polls this for live progress.
 *
 * Failure modes:
 *   1. fetches on mount and exposes the graph
 *   2. no projectDir → null, and the IPC is never called
 *   3. surfaces an error response without throwing
 */
import { describe, it, expect, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { useInstanceGraph } from './useInstanceGraph';

function stubDhee(resolve: (req: unknown) => unknown) {
  (window as unknown as { dhee: unknown }).dhee = { resolveInstanceGraph: resolve };
}

describe('useInstanceGraph', () => {
  it('fetches the graph on mount and exposes instances', async () => {
    const graph = { instances: [{ nodeId: 'story', status: 'completed' }], edges: [] };
    const spy = jest.fn(async () => ({ ok: true, graph }));
    stubDhee(spy);

    const { result } = renderHook(() => useInstanceGraph('/proj', { pollMs: 0 }));

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(result.current.graph?.instances).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ projectDir: '/proj' });
  });

  it('returns null and never calls IPC without a projectDir', async () => {
    const spy = jest.fn(async () => ({ ok: true, graph: { instances: [], edges: [] } }));
    stubDhee(spy);

    const { result } = renderHook(() => useInstanceGraph(null, { pollMs: 0 }));

    await waitFor(() => expect(result.current.graph).toBeNull());
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces an error response without throwing', async () => {
    const spy = jest.fn(async () => ({ ok: false, error: 'boom' }));
    stubDhee(spy);

    const { result } = renderHook(() => useInstanceGraph('/proj', { pollMs: 0 }));

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.graph).toBeNull();
  });
});
