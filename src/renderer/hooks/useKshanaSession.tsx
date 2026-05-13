/**
 * `useKshanaSession` — clean interface to the embedded kshana-ink
 * ConversationManager via the `window.kshana.*` IPC bridge.
 *
 * The session is a **singleton**: created once by `KshanaSessionProvider`
 * mounted near the root of the app, shared across every consumer
 * (chat panel, redo dropdown, etc.). Earlier this hook created a new
 * session per mount, which raced badly — `createSession` on the
 * kshana-core side does `sessions.set(id, freshState)` even when
 * resuming an id, so a second consumer's mount silently wiped the
 * first consumer's `sessionContext` (the focused-project working dir),
 * causing later IPC calls to fail with "Session project not configured."
 *
 * Replaces the old WebSocket-based plumbing that ChatPanel and
 * ProjectContext currently use. The renderer's message-handling logic
 * (narrowing on event types, updating UI state) stays the same — only
 * the transport changes.
 *
 * The provider:
 *   - Creates a session on mount; persists `sessionId` to localStorage
 *     for resume on the next launch.
 *   - Tracks `status` ('idle' | 'running' | 'error') so consumers can
 *     show busy state without driving their own state.
 *   - Returns typed helpers that delegate to `window.kshana.*` —
 *     no boilerplate per call site.
 *   - `subscribe(eventName, cb)` is a passthrough to `window.kshana.on`
 *     (returns the unsubscribe function). Components that want their
 *     own subscription lifetimes can use it directly.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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

/**
 * Detect server responses where the session id we sent isn't in the
 * server's in-memory `sessions` Map. Three possible causes:
 *  1. Desktop process restarted between the renderer's last
 *     createSession and this IPC call (settings update / account
 *     change triggers ConversationManager.restart()).
 *  2. The 30-minute idle reaper kicked in after a long pause.
 *  3. Startup race: the renderer's createSession fired before the
 *     IPC bridge was ready, so the server never saw it.
 *
 * In every case, calling createSession with the same id resurrects
 * the server-side session (`findStoredSession` rebuilds it from the
 * on-disk JSONL). The self-heal wrapper below uses this predicate to
 * decide whether to retry the failing operation.
 */
function isSessionNotFoundError(err: string | undefined | null): boolean {
  if (!err) return false;
  return /Session not found/i.test(err);
}

/**
 * Wait `ms` milliseconds, then resolve. Used for backoff between
 * retried createSession calls.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Call `window.kshana.createSession` with retry-on-rejection. The
 * rejection case is almost always "IPC handler not registered yet" —
 * the desktop's kshana-core manager boots asynchronously and the
 * bridge only registers AFTER manager.start() resolves, so a
 * fast-mounting renderer can outrun it. Exponential backoff caps
 * total wait at ~5s before surfacing the error.
 */
async function createSessionWithRetry(
  resumeSessionId: string | null,
  shouldAbort: () => boolean,
): Promise<{ sessionId: string; resumed?: boolean; history?: unknown } | { error: string }> {
  // 100ms, 200ms, 400ms, 800ms, 1600ms — 3.1s total worst case.
  const backoffMs = [0, 100, 200, 400, 800, 1600];
  let lastErr: unknown = null;
  for (const delay of backoffMs) {
    if (shouldAbort()) return { error: 'aborted' };
    if (delay > 0) await sleep(delay);
    try {
      const resp = await window.kshana.createSession({
        role: 'interactive',
        ...(resumeSessionId ? { resumeSessionId } : {}),
      });
      return resp;
    } catch (err) {
      lastErr = err;
    }
  }
  return {
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
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
   * Refetch the persisted chat snapshot for the current sessionId
   * from disk and store it on `history`. Used by the chat panel on
   * mount so a remount (e.g. user navigated to Settings and back)
   * re-hydrates with everything streamed since the session was
   * created — `createSession`'s initial `history` only covers the
   * moment of resume. A no-op when no sessionId is set yet.
   */
  refreshHistory: () => Promise<HistorySnapshot | null>;
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

/**
 * Internal — creates and owns the single session. Used by the
 * provider; callers must not use this directly (call `useKshanaSession`
 * to read the session from context instead).
 */
function useCreateKshanaSession(): KshanaSessionApi {
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
    (async () => {
      const stored = readStoredSessionId();
      const resp = await createSessionWithRetry(stored, () => cancelled);
      if (cancelled) return;
      if ('error' in resp) {
        setError(resp.error);
        setStatus('error');
        return;
      }
      setSessionId(resp.sessionId);
      writeStoredSessionId(resp.sessionId);
      if (resp.resumed && resp.history) {
        setHistory(resp.history as HistorySnapshot);
      } else {
        setHistory(null);
      }
      setStatus('idle');
    })();
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

  /**
   * Self-heal wrapper for IPC operations that take a sessionId and
   * return `{ ok, error }`. Runs the operation; if the server reports
   * "Session not found", calls createSession with the same id to
   * resurrect it (the on-disk JSONL is reopened on resume so chat
   * history isn't lost), then retries the operation ONCE with the
   * fresh id. Anything other than "Session not found" is returned
   * verbatim — the caller still sees the real error.
   *
   * Mid-session resurrection is needed because the desktop's
   * `kshanaCoreManager.restart()` (fired by settings updates and
   * account changes) wipes ConversationManager's in-memory sessions
   * Map without notifying the renderer. Pre-fix, the next IPC call
   * after a restart would hard-fail with "Session not found" and the
   * user would have to ⌘+R to recover.
   */
  const runWithSelfHeal = useCallback(
    async <R extends { ok: boolean; error?: string }>(
      operation: (sessionId: string) => Promise<R>,
    ): Promise<R> => {
      const id = sessionIdRef.current;
      if (!id) return { ok: false, error: 'Session not yet created' } as R;
      const first = await operation(id);
      if (first.ok || !isSessionNotFoundError(first.error)) return first;
      // Server lost the session. Resurrect via createSession (resume
      // path will rebuild from the on-disk JSONL if the id is known).
      const stored = readStoredSessionId() ?? id;
      const resp = await createSessionWithRetry(stored, () => false);
      if ('error' in resp) {
        return {
          ok: false,
          error: `Session lost and could not be resurrected: ${resp.error}`,
        } as R;
      }
      sessionIdRef.current = resp.sessionId;
      setSessionId(resp.sessionId);
      writeStoredSessionId(resp.sessionId);
      setStatus('idle');
      setError(null);
      return operation(resp.sessionId);
    },
    [],
  );

  const consumeHistory = useCallback<KshanaSessionApi['consumeHistory']>(() => {
    const snap = history;
    if (snap) setHistory(null);
    return snap;
  }, [history]);

  const refreshHistory = useCallback<KshanaSessionApi['refreshHistory']>(
    async () => {
      const id = sessionIdRef.current;
      if (!id) return null;
      try {
        const resp = await window.kshana.getHistory({ sessionId: id });
        const snap = resp.history ?? null;
        setHistory(snap);
        return snap;
      } catch {
        // Refresh failures are non-fatal — the panel just stays on
        // whatever state it already had. The user can retry by
        // re-mounting (close-and-reopen project).
        return null;
      }
    },
    [],
  );

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
      setStatus('running');
      setError(null);
      try {
        const result = await runWithSelfHeal<{ ok: boolean; error?: string }>(
          (sessionId) => {
            const req: RunTaskRequest = { sessionId, task, ...(opts ?? {}) };
            return window.kshana.runTask(req);
          },
        );
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
    [runWithSelfHeal],
  );

  const cancel = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return { cancelled: false };
    return window.kshana.cancelTask({ sessionId: id });
  }, []);

  const redoNode = useCallback<KshanaSessionApi['redoNode']>(
    (nodeId, opts) =>
      runWithSelfHeal((sessionId) =>
        window.kshana.redoNode({ sessionId, nodeId, ...(opts ?? {}) }),
      ),
    [runWithSelfHeal],
  );

  const configureProject = useCallback<KshanaSessionApi['configureProject']>(
    (opts) =>
      runWithSelfHeal((sessionId) =>
        window.kshana.configureProject({ sessionId, ...opts }),
      ),
    [runWithSelfHeal],
  );

  const focusProject = useCallback<KshanaSessionApi['focusProject']>(
    (projectName, projectDir) =>
      runWithSelfHeal((sessionId) =>
        window.kshana.focusProject({
          sessionId,
          projectName,
          ...(projectDir ? { projectDir } : {}),
        }),
      ),
    [runWithSelfHeal],
  );

  const setAutonomous = useCallback<KshanaSessionApi['setAutonomous']>(
    (enabled) =>
      runWithSelfHeal((sessionId) =>
        window.kshana.setAutonomous({ sessionId, enabled }),
      ),
    [runWithSelfHeal],
  );

  const sendResponse = useCallback<KshanaSessionApi['sendResponse']>(
    (response, toolCallId) =>
      runWithSelfHeal((sessionId) =>
        window.kshana.sendResponse({
          sessionId,
          response,
          ...(toolCallId ? { toolCallId } : {}),
        }),
      ),
    [runWithSelfHeal],
  );

  const invalidateNodes = useCallback<KshanaSessionApi['invalidateNodes']>(
    (nodeIds) =>
      runWithSelfHeal((sessionId) =>
        window.kshana.invalidateNodes({ sessionId, nodeIds }),
      ),
    [runWithSelfHeal],
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
    refreshHistory,
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

const KshanaSessionContext = createContext<KshanaSessionApi | null>(null);

/**
 * Mount once near the root of the app. Owns the single kshana-core
 * session; descendants read it via `useKshanaSession()`.
 *
 * Why a provider (not a per-mount hook): `window.kshana.createSession`
 * is treated as idempotent on the renderer (we always pass the
 * persisted sessionId for resume), but the server side currently
 * overwrites `sessions.set(id, freshState)` on every call. Two
 * concurrent mounts therefore race — whichever lands second wipes the
 * other's `sessionContext` (focused-project working dir). A singleton
 * means there's only one `createSession` call for the app's lifetime
 * and that race goes away.
 */
export function KshanaSessionProvider({ children }: { children: ReactNode }) {
  const api = useCreateKshanaSession();
  // Identity-stable memo by api fields so consumers re-render only on
  // actual changes, not on every parent render. The api object is
  // already rebuilt each render anyway (it's a fresh object literal),
  // so we memoise on the underlying values that matter.
  const value = useMemo<KshanaSessionApi>(() => api, [
    api.sessionId,
    api.status,
    api.error,
    api.history,
    api.consumeHistory,
    api.refreshHistory,
    api.clearChatHistory,
    api.runTask,
    api.cancel,
    api.redoNode,
    api.configureProject,
    api.focusProject,
    api.setAutonomous,
    api.sendResponse,
    api.invalidateNodes,
    api.subscribe,
  ]);
  return (
    <KshanaSessionContext.Provider value={value}>
      {children}
    </KshanaSessionContext.Provider>
  );
}

export function useKshanaSession(): KshanaSessionApi {
  const ctx = useContext(KshanaSessionContext);
  if (!ctx) {
    throw new Error(
      'useKshanaSession must be used within a KshanaSessionProvider',
    );
  }
  return ctx;
}
