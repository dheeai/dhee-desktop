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
  HistorySnapshot,
  KshanaEvent,
  KshanaEventName,
  RunTaskRequest,
  RedoNodeRequest,
} from '../../shared/kshanaIpc';

export type SessionStatus = 'idle' | 'running' | 'error' | 'connecting';

const RESUME_SESSION_KEY = 'kshana.sessionId';

function readStoredSessionId(): string | null {
  try {
    return window.localStorage.getItem(RESUME_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(RESUME_SESSION_KEY, id);
    else window.localStorage.removeItem(RESUME_SESSION_KEY);
  } catch {
    // localStorage may be disabled — fail silently. Resume won't work
    // but the chat itself still does.
  }
}

type RunTaskOpts = Omit<RunTaskRequest, 'sessionId' | 'task'>;
type RedoNodeOpts = Omit<RedoNodeRequest, 'sessionId' | 'nodeId'>;
type ConfigureProjectOpts = Omit<ConfigureProjectRequest, 'sessionId'>;

export interface KshanaSessionApi {
  sessionId: string | null;
  status: SessionStatus;
  /** Most recent error message from runTask, or null. */
  error: string | null;
  /**
   * Persisted chat snapshot returned by the main process when this
   * session was reconstructed from disk. Null on a fresh session.
   * Cleared after the consumer reads it (one-shot) by calling
   * `consumeHistory()`.
   */
  history: HistorySnapshot | null;
  /**
   * Read-and-clear the history snapshot. Idempotent — the second call
   * returns null. Use this from a useEffect that depends on
   * `sessionId` so each new session gets seeded exactly once.
   */
  consumeHistory: () => HistorySnapshot | null;
  /**
   * Hard-delete the persisted chat for the current session and switch
   * to a freshly-minted one. Updates `sessionId`, persists the new id
   * to localStorage, and resolves once the swap completes. Callers
   * should also wipe their own chat UI state when this resolves.
   */
  clearChatHistory: () => Promise<{ ok: boolean; error?: string }>;

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
  sendResponse: (response: string, toolCallId?: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Mark executor nodes pending without resuming the pipeline. Used
   * by the Prompts-tab edit flow after the user saves a per-shot
   * prompt change. Returns `{ ok, invalidated, notFound }` so callers
   * can surface partial-failure (mistyped node ids, etc.) inline.
   */
  invalidateNodes: (nodeIds: string[]) => Promise<{
    ok: boolean;
    invalidated?: string[];
    notFound?: string[];
    error?: string;
  }>;

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
  const [history, setHistory] = useState<HistorySnapshot | null>(null);

  // Track session id in a ref so callbacks captured in dependency lists
  // see the latest value without re-creating themselves.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  // Create a session on mount. Hard-coded to the 'interactive' role
  // so long-running pipeline tools (kshana_run_to / render_scene_bundle
  // / audit_fidelity) are stripped from this session's tool list —
  // they belong to a dedicated background session that ChatPanelEmbedded
  // creates lazily when the user clicks Resume.
  //
  // Resume: if localStorage has a remembered sessionId from a prior
  // app run, ask the main process to reconstruct it. Unknown ids fall
  // through to a fresh session — the main process tells us which by
  // returning `resumed`.
  useEffect(() => {
    let cancelled = false;
    const stored = readStoredSessionId();
    window.kshana
      .createSession({
        role: 'interactive',
        ...(stored ? { resumeSessionId: stored } : {}),
      })
      .then(
        (resp) => {
          if (cancelled) return;
          setSessionId(resp.sessionId);
          writeStoredSessionId(resp.sessionId);
          if (resp.resumed && resp.history) {
            setHistory(resp.history);
          } else {
            setHistory(null);
          }
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
      // NOTE: deliberately not deleting the session on unmount any
      // more. Pre-persistence we tore down to avoid stale state in
      // ConversationManager; now the kshana-core session is the
      // user's chat history, so we leave it alive. ConversationManager
      // still reaps it after its own idle timeout, and the JSONL on
      // disk is what matters for the next launch's resume.
    };
  }, []);

  const consumeHistory = useCallback<KshanaSessionApi['consumeHistory']>(() => {
    const snap = history;
    if (snap) setHistory(null);
    return snap;
  }, [history]);

  const clearChatHistory = useCallback<KshanaSessionApi['clearChatHistory']>(
    async () => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      try {
        const resp = await window.kshana.clearChatHistory({
          sessionId: id,
          role: 'interactive',
        });
        sessionIdRef.current = resp.newSessionId;
        setSessionId(resp.newSessionId);
        writeStoredSessionId(resp.newSessionId);
        setHistory(null);
        setStatus('idle');
        setError(null);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    [],
  );

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

  const invalidateNodes = useCallback<KshanaSessionApi['invalidateNodes']>(
    async (nodeIds) => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' };
      return window.kshana.invalidateNodes({ sessionId: id, nodeIds });
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
    history,
    consumeHistory,
    clearChatHistory,
    runTask,
    cancel,
    redoNode,
    configureProject,
    focusProject,
    setAutonomous,
    sendResponse,
    invalidateNodes,
    subscribe,
  };
}
