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

  const model = useMemo(
    () =>
      deriveRunModel({
        instances: graph?.instances ?? [],
        edges: graph?.edges ?? [],
        bundleNodes: bundle?.nodes,
        runnerActive: runner.active,
        cancelling: runner.cancelling,
        agentBusy,
        startedAt: runner.status?.startedAt,
        now,
      }),
    [graph, bundle, runner.active, runner.cancelling, runner.status?.startedAt, agentBusy, now],
  );

  const stop = useCallback(() => {
    if (runner.active) void runner.cancel();
    else if (agentBusy) void session.cancel();
  }, [runner, agentBusy, session]);

  return { model, stop };
}
