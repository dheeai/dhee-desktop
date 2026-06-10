/**
 * useRunModel — the shared reactive run model for the run cockpit.
 *
 * Composes the runner status, the agent-session status, the live instance
 * graph and the bundle metadata, then folds them through deriveRunModel
 * into one bundle-agnostic view. Both the TransportBar and the
 * DeliverablesStrip consume this so they always agree. Also exposes a
 * single `stop()` that cancels whatever is actually active (the walk
 * runner, else the agent turn).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRunnerStatus } from './useRunnerStatus';
import { useDheeSession } from './useDheeSession';
import { useInstanceGraph } from './useInstanceGraph';
import { useProject } from '../contexts/ProjectContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { deriveRunModel, type RunModel } from '../lib/runCockpit/deriveRunModel';
import { computeExpectedTotals } from '../lib/runCockpit/expectedTotals';

function joinPath(base: string, rel: string): string {
  return `${base.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;
}

export interface UseRunModelResult {
  model: RunModel;
  /** Cancel whatever is active: the walk runner if running, else the agent turn. */
  stop: () => void;
}

export function useRunModel(pollMs = 1500): UseRunModelResult {
  const runner = useRunnerStatus();
  const session = useDheeSession();
  const { bundle } = useProject();
  const { projectDirectory } = useWorkspace();

  const agentBusy = session.status === 'running';
  const live = runner.active || agentBusy;

  // Poll the projection while anything is in flight; idle = no polling.
  const { graph } = useInstanceGraph(projectDirectory, { pollMs: live ? pollMs : 0 });

  // 1s clock so elapsed/ETA tick independently of the graph poll cadence.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  // Stable expected fan-out totals (e.g. 50 shots) so collection counters
  // don't creep up as items materialize. Only re-reads source plans when
  // one actually changes — `planSig` captures each fan-out source stage's
  // completed output (path + version), so the effect is inert across the
  // many polls where nothing relevant changed.
  const planSig = useMemo(() => {
    const nodes = bundle?.nodes;
    if (!nodes) return '';
    const sourceStageIds = new Set<string>();
    for (const n of nodes) {
      if (n.kind === 'collection' && n.itemSource) {
        const src = nodes.find((x) => x.id === n.itemSource);
        if (src && src.kind !== 'collection') sourceStageIds.add(n.itemSource);
      }
    }
    const insts = graph?.instances ?? [];
    return [...sourceStageIds]
      .sort()
      .map((id) => {
        const done = insts.find(
          (i) => i.nodeId === id && i.status === 'completed' && i.outputPath,
        );
        return `${id}:${done?.outputPath ?? ''}:${done?.versionId ?? ''}`;
      })
      .join('|');
  }, [bundle, graph]);

  const [expectedTotals, setExpectedTotals] = useState<Record<string, number>>({});
  useEffect(() => {
    const nodes = bundle?.nodes;
    if (!nodes || !projectDirectory || !planSig) {
      setExpectedTotals({});
      return undefined;
    }
    let cancelled = false;
    const readJson = async (relPath: string): Promise<unknown | null> => {
      try {
        const raw = await window.electron.project.readFile(
          joinPath(projectDirectory, relPath),
        );
        return raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        return null;
      }
    };
    // `instances` is read here but the effect is intentionally keyed on
    // planSig (which encodes the only graph slice that affects the result)
    // so it doesn't re-read plans on every poll.
    void computeExpectedTotals(nodes, graph?.instances ?? [], readJson).then((t) => {
      if (!cancelled) setExpectedTotals(t);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSig, bundle, projectDirectory]);

  const model = useMemo(
    () =>
      deriveRunModel({
        instances: graph?.instances ?? [],
        edges: graph?.edges ?? [],
        bundleNodes: bundle?.nodes,
        expectedTotals,
        runnerActive: runner.active,
        cancelling: runner.cancelling,
        agentBusy,
        startedAt: runner.status?.startedAt,
        now,
      }),
    [
      graph,
      bundle,
      expectedTotals,
      runner.active,
      runner.cancelling,
      runner.status?.startedAt,
      agentBusy,
      now,
    ],
  );

  const stop = useCallback(() => {
    if (runner.active) void runner.cancel();
    else if (agentBusy) void session.cancel();
  }, [runner, agentBusy, session]);

  return { model, stop };
}
