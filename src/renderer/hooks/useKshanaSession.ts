/**
 * `useKshanaSession` — React hook giving components a clean interface
 * to the embedded kshana-ink ConversationManager via the
 * `window.kshana.*` IPC bridge.
 *
 * Replaces the old WebSocket-based plumbing that ChatPanel and
 * ProjectContext currently use. The renderer's message-handling logic
 * (narrowing on event types, updating UI state) stays the same — only
 * the transport changes.
 *
 * The hook:
 *   - Creates a session on mount; cleans up on unmount.
 *   - Tracks `status` ('idle' | 'running' | 'error') so consumers can
 *     show busy state without driving their own state.
 *   - Returns typed helpers that delegate to `window.kshana.*` —
 *     no boilerplate per call site.
 *   - `subscribe(eventName, cb)` is a passthrough to `window.kshana.on`
 *     (returns the unsubscribe function). Components that want their
 *     own subscription lifetimes can use it directly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConfigureProjectRequest,
  KshanaEvent,
  KshanaEventName,
  RunTaskRequest,
  RedoNodeRequest,
} from '../../shared/kshanaIpc';

export type SessionStatus = 'idle' | 'running' | 'error' | 'connecting';

type RunTaskOpts = Omit<RunTaskRequest, 'sessionId' | 'task'>;
type RedoNodeOpts = Omit<RedoNodeRequest, 'sessionId' | 'nodeId'>;
type ConfigureProjectOpts = Omit<ConfigureProjectRequest, 'sessionId'>;

export interface KshanaSessionApi {
  sessionId: string | null;
  status: SessionStatus;
  /** Most recent error message from runTask, or null. */
  error: string | null;

  runTask: (task: string, opts?: RunTaskOpts) => Promise<{ ok: boolean; error?: string }>;
  cancel: () => Promise<{ cancelled: boolean }>;
  redoNode: (
    nodeId: string,
    opts?: RedoNodeOpts,
  ) => Promise<{ ok: boolean; error?: string }>;
  configureProject: (
    opts: ConfigureProjectOpts,
  ) => Promise<{ ok: boolean; error?: string }>;
  focusProject: (
    projectName: string,
    projectDir?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  setAutonomous: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  setPiOversight: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  setVlmJudge: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  sendResponse: (response: string, toolCallId?: string) => Promise<{ ok: boolean; error?: string }>;

  /**
   * Subscribe to streaming events from kshana-ink. `eventName` is
   * either a specific KshanaEventName or '*' for all events.
   * Returns an unsubscribe function — call it on component unmount
   * (or rely on the hook's own cleanup, which doesn't track external
   * subscriptions).
   */
  subscribe: (
    eventName: KshanaEventName | '*',
    cb: (event: KshanaEvent) => void,
  ) => () => void;
}

export function useKshanaSession(): KshanaSessionApi {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  // Track session id in a ref so callbacks captured in dependency lists
  // see the latest value without re-creating themselves.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  // Create a session on mount. Hard-coded to the 'interactive' role
  // so long-running pipeline tools (kshana_run_to / render_scene_bundle
  // / audit_fidelity) are stripped from this session's tool list —
  // they belong to a dedicated background session that ChatPanelEmbedded
  // creates lazily when the user clicks Resume.
  useEffect(() => {
    let cancelled = false;
    window.kshana.createSession({ role: 'interactive' }).then(
      (resp) => {
        if (cancelled) return;
        setSessionId(resp.sessionId);
        setStatus('idle');
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      },
    );
    return () => {
      cancelled = true;
      const id = sessionIdRef.current;
      if (id) {
        // Best-effort cleanup. Failure is non-fatal — main process
        // will reap stale sessions on its own timeout.
        window.kshana.deleteSession({ sessionId: id }).catch(() => {});
      }
    };
  }, []);

  const runTask = useCallback<KshanaSessionApi['runTask']>(
    async (task, opts) => {
      const id = sessionIdRef.current;
      if (!id) {
        return { ok: false, error: 'Session not yet created' };
      }
      setStatus('running');
      setError(null);
      const req: RunTaskRequest = { sessionId: id, task, ...(opts ?? {}) };
      try {
        const result = await window.kshana.runTask(req);
        if (result.ok) {
          setStatus('idle');
        } else {
          setStatus('error');
          setError(result.error ?? null);
        }
        return result;
      } catch (err) {
        setStatus('error');
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return { ok: false, error: msg };
      }
    },
    [],
  );

  const cancel = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return { cancelled: false };
    return window.kshana.cancelTask({ sessionId: id });
  }, []);

  const redoNode = useCallback<KshanaSessionApi['redoNode']>(
    async (nodeId, opts) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.redoNode({ sessionId: id, nodeId, ...(opts ?? {}) });
    },
    [],
  );

  const configureProject = useCallback<KshanaSessionApi['configureProject']>(
    async (opts) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.configureProject({ sessionId: id, ...opts });
    },
    [],
  );

  const focusProject = useCallback<KshanaSessionApi['focusProject']>(
    async (projectName, projectDir) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.focusProject({
        sessionId: id,
        projectName,
        ...(projectDir ? { projectDir } : {}),
      });
    },
    [],
  );

  const setAutonomous = useCallback<KshanaSessionApi['setAutonomous']>(
    async (enabled) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.setAutonomous({ sessionId: id, enabled });
    },
    [],
  );

  const setPiOversight = useCallback<KshanaSessionApi['setPiOversight']>(
    async (enabled) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.setPiOversight({ sessionId: id, enabled });
    },
    [],
  );

  const setVlmJudge = useCallback<KshanaSessionApi['setVlmJudge']>(
    async (enabled) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.setVlmJudge({ sessionId: id, enabled });
    },
    [],
  );

  const sendResponse = useCallback<KshanaSessionApi['sendResponse']>(
    async (response, toolCallId) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.sendResponse({
        sessionId: id,
        response,
        ...(toolCallId ? { toolCallId } : {}),
      });
    },
    [],
  );

  const subscribe = useCallback<KshanaSessionApi['subscribe']>(
    (eventName, cb) => window.kshana.on(eventName, cb),
    [],
  );

  return {
    sessionId,
    status,
    error,
    runTask,
    cancel,
    redoNode,
    configureProject,
    focusProject,
    setAutonomous,
    setPiOversight,
    setVlmJudge,
    sendResponse,
    subscribe,
  };
}
