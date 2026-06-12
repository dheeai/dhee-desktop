/**
 * `useDheeSession` — clean interface to the embedded kshana-ink
 * ConversationManager via the `window.dhee.*` IPC bridge.
 *
 * The session is a **singleton**: created once by `DheeSessionProvider`
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
 *   - Returns typed helpers that delegate to `window.dhee.*` —
 *     no boilerplate per call site.
 *   - `subscribe(eventName, cb)` is a passthrough to `window.dhee.on`
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
  dheeEvent,
  dheeEventName,
  RunnerStatusResponse,
  RunTaskRequest,
  StartRunRequest,
  StartRunResponse,
  ChatPromptRequest,
  RedoNodeRequest,
} from '../../shared/dheeIpc';
import { runnerBelongsToProject } from '../utils/runnerProjectScope';

export type SessionStatus = 'idle' | 'running' | 'error' | 'connecting';

const LEGACY_RESUME_SESSION_KEY = 'kshana.sessionId';
const PROJECT_SESSION_STORAGE_KEY = 'dhee.projectSessions.v1';

function normalizeProjectDirectory(
  projectDirectory: string | null | undefined,
): string | null {
  const normalized = (projectDirectory ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .trim();
  return normalized || null;
}

function historyMatchesProject(
  history: HistorySnapshot | null,
  projectDirectory: string | null,
): boolean {
  if (!history || !projectDirectory) return true;
  return normalizeProjectDirectory(history.projectDirectory) === projectDirectory;
}

function readLegacyStoredSessionId(): string | null {
  try {
    return window.localStorage.getItem(LEGACY_RESUME_SESSION_KEY);
  } catch {
    return null;
  }
}

function readStoredProjectSessions(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(PROJECT_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' &&
          entry[0].trim().length > 0 &&
          typeof entry[1] === 'string' &&
          entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function writeStoredProjectSessions(sessions: Record<string, string>): void {
  try {
    window.localStorage.setItem(
      PROJECT_SESSION_STORAGE_KEY,
      JSON.stringify(sessions),
    );
  } catch {
    // localStorage may be disabled - fail silently. Resume won't work
    // but the chat itself still does.
  }
}

function readStoredSessionIdForProject(
  projectDirectory: string | null,
): string | null {
  if (!projectDirectory) {
    return readLegacyStoredSessionId();
  }
  return readStoredProjectSessions()[projectDirectory] ?? null;
}

function writeStoredSessionIdForProject(
  projectDirectory: string | null,
  id: string,
): void {
  if (!projectDirectory) {
    try {
      window.localStorage.setItem(LEGACY_RESUME_SESSION_KEY, id);
    } catch {
      // no-project resume is best-effort
    }
    return;
  }
  const sessions = readStoredProjectSessions();
  sessions[projectDirectory] = id;
  writeStoredProjectSessions(sessions);
}

function deriveProjectName(
  projectDirectory: string | null,
  projectName: string | null | undefined,
): string | null {
  const trimmedName = projectName?.trim();
  if (trimmedName) return trimmedName;
  if (!projectDirectory) return null;
  return (
    projectDirectory
      .split('/')
      .pop()
      ?.replace(/\.dhee$/i, '')
      .trim() || null
  );
}

async function focusSessionForProject(params: {
  sessionId: string;
  projectDirectory: string | null;
  projectName: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.projectDirectory || !params.projectName) {
    return { ok: true };
  }
  try {
    return await window.dhee.focusProject({
      sessionId: params.sessionId,
      projectName: params.projectName,
      projectDir: params.projectDirectory,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
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

function sameRunnerStatus(
  a: RunnerStatusResponse | null,
  b: RunnerStatusResponse | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.active === b.active &&
    a.cancelling === b.cancelling &&
    a.taskId === b.taskId &&
    a.kind === b.kind &&
    a.projectName === b.projectName &&
    a.projectDir === b.projectDir &&
    a.startedAt === b.startedAt &&
    a.sessionId === b.sessionId
  );
}

/**
 * Call `window.dhee.createSession` with retry-on-rejection. The
 * rejection case is almost always "IPC handler not registered yet" —
 * the desktop's kshana-core manager boots asynchronously and the
 * bridge only registers AFTER manager.start() resolves, so a
 * fast-mounting renderer can outrun it. Exponential backoff caps
 * total wait at ~5s before surfacing the error.
 */
async function createSessionWithRetry(
  resumeSessionId: string | null,
  shouldAbort: () => boolean,
): Promise<
  | { sessionId: string; resumed?: boolean; history?: unknown }
  | { error: string }
> {
  // 100ms, 200ms, 400ms, 800ms, 1600ms — 3.1s total worst case.
  const backoffMs = [0, 100, 200, 400, 800, 1600];
  let lastErr: unknown = null;
  for (const delay of backoffMs) {
    if (shouldAbort()) return { error: 'aborted' };
    if (delay > 0) await sleep(delay);
    try {
      const resp = await window.dhee.createSession({
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
type StartRunOpts = Omit<StartRunRequest, 'sessionId'>;
type ChatPromptOpts = Omit<ChatPromptRequest, 'sessionId' | 'message'>;
type RedoNodeOpts = Omit<RedoNodeRequest, 'sessionId' | 'nodeId'>;
type ConfigureProjectOpts = Omit<ConfigureProjectRequest, 'sessionId'>;

const RUNNER_STATUS_POLL_MS = 1500;

export interface DheeSessionExecution {
  active: boolean;
  runnerActive: boolean;
  chatBusy: boolean;
  pendingCancel: boolean;
  otherProjectRunner: RunnerStatusResponse | null;
  cancel: () => Promise<void>;
}

export interface DheeSessionApi {
  sessionId: string | null;
  /** Normalized active project directory this session is scoped to. */
  projectDirectory: string | null;
  /** Active project name this session is focused to, when available. */
  projectName: string | null;
  status: SessionStatus;
  /** Most recent error message from runTask, or null. */
  error: string | null;
  /** Unified execution state used by Stop controls and navigation guards. */
  execution: DheeSessionExecution;
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

  runTask: (
    task: string,
    opts?: RunTaskOpts,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Directly dispatch a bundle run through the BackgroundTaskRunner.
   * This intentionally does not mark the chat session as running;
   * runnerStatus drives long-run UI state.
   */
  startRun: (opts: StartRunOpts) => Promise<StartRunResponse>;
  /**
   * Phase 6.5c: chat-input path. Sends a user message to the in-
   * process pi-agent (NOT BackgroundTaskRunner) and returns the
   * assistant's reply + any tools the agent called. One-shot for
   * now — streaming will come in 6.5c.b.
   */
  chatPrompt: (
    message: string,
    opts?: ChatPromptOpts,
  ) => Promise<
    | { ok: true; assistant_text: string; tool_calls: Array<{ name: string }> }
    | { ok: false; error: string }
  >;
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
  sendResponse: (
    response: string,
    toolCallId?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Mark executor nodes pending without resuming the pipeline. Used
   * by the Prompts-tab edit flow after the user saves a per-shot
   * prompt change. Returns `{ ok, invalidated, notFound }` so callers
   * can surface partial-failure (mistyped node ids, etc.) inline.
   */
  invalidateNodes: (
    nodeIds: string[],
    opts?: { source?: string },
  ) => Promise<{
    ok: boolean;
    invalidated?: string[];
    notFound?: string[];
    error?: string;
  }>;

  /**
   * Subscribe to streaming events from kshana-ink. `eventName` is
   * either a specific dheeEventName or '*' for all events.
   * Returns an unsubscribe function — call it on component unmount
   * (or rely on the hook's own cleanup, which doesn't track external
   * subscriptions).
   */
  subscribe: (
    eventName: dheeEventName | '*',
    cb: (event: dheeEvent) => void,
  ) => () => void;
}

/**
 * Internal — creates and owns the single session. Used by the
 * provider; callers must not use this directly (call `useDheeSession`
 * to read the session from context instead).
 */
interface DheeSessionScope {
  projectDirectory?: string | null;
  projectName?: string | null;
}

function useCreateKshanaSession(scope: DheeSessionScope): DheeSessionApi {
  const activeProjectDirectory = useMemo(
    () => normalizeProjectDirectory(scope.projectDirectory),
    [scope.projectDirectory],
  );
  const activeProjectName = useMemo(
    () => deriveProjectName(activeProjectDirectory, scope.projectName),
    [activeProjectDirectory, scope.projectName],
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistorySnapshot | null>(null);
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatusResponse | null>(
    null,
  );
  const [pendingCancel, setPendingCancel] = useState(false);

  // Track session id in a ref so callbacks captured in dependency lists
  // see the latest value without re-creating themselves.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const projectDirectoryRef = useRef<string | null>(activeProjectDirectory);
  const projectNameRef = useRef<string | null>(activeProjectName);
  projectDirectoryRef.current = activeProjectDirectory;
  projectNameRef.current = activeProjectName;
  const runnerActive = runnerBelongsToProject(runnerStatus, {
    projectDirectory: activeProjectDirectory,
    projectName: activeProjectName,
  });
  const otherProjectRunner =
    runnerStatus?.active && !runnerActive ? runnerStatus : null;
  const chatBusy = status === 'running';

  // Create or resume the session for the current project scope. Project
  // sessions are stored by normalized absolute project directory so
  // project B cannot hydrate project A's conversation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionId(null);
      sessionIdRef.current = null;
      setHistory(null);
      setError(null);
      setStatus('connecting');

      const projectDirectory = activeProjectDirectory;
      const projectName = activeProjectName;
      const stored = readStoredSessionIdForProject(projectDirectory);
      const resp = await createSessionWithRetry(stored, () => cancelled);
      if (cancelled) return;
      if ('error' in resp) {
        setError(resp.error);
        setStatus('error');
        return;
      }

      const focusResult = await focusSessionForProject({
        sessionId: resp.sessionId,
        projectDirectory,
        projectName,
      });
      if (cancelled) return;
      if (!focusResult.ok) {
        setSessionId(resp.sessionId);
        sessionIdRef.current = resp.sessionId;
        writeStoredSessionIdForProject(projectDirectory, resp.sessionId);
        setHistory(null);
        setError(focusResult.error ?? 'Failed to focus project');
        setStatus('error');
        return;
      }

      sessionIdRef.current = resp.sessionId;
      setSessionId(resp.sessionId);
      writeStoredSessionIdForProject(projectDirectory, resp.sessionId);

      let nextHistory: HistorySnapshot | null = null;
      if (projectDirectory) {
        try {
          const historyResp = await window.dhee.getHistory({
            sessionId: resp.sessionId,
            projectDir: projectDirectory,
          });
          const candidate = historyResp.history ?? null;
          nextHistory = historyMatchesProject(candidate, projectDirectory)
            ? candidate
            : null;
        } catch {
          nextHistory = null;
        }
        if (
          cancelled ||
          sessionIdRef.current !== resp.sessionId ||
          projectDirectoryRef.current !== projectDirectory
        ) {
          return;
        }
      } else if (resp.resumed && resp.history) {
        nextHistory = resp.history as HistorySnapshot;
      }
      setHistory(nextHistory);
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
  }, [activeProjectDirectory, activeProjectName]);

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
   * `dheeCoreManager.restart()` (fired by settings updates and
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
      // Server lost the session. Resurrect for the active project scope
      // and re-focus before retrying the operation.
      const projectDirectory = projectDirectoryRef.current;
      const projectName = projectNameRef.current;
      const stored = readStoredSessionIdForProject(projectDirectory) ?? id;
      const resp = await createSessionWithRetry(stored, () => false);
      if ('error' in resp) {
        return {
          ok: false,
          error: `Session lost and could not be resurrected: ${resp.error}`,
        } as R;
      }
      const focusResult = await focusSessionForProject({
        sessionId: resp.sessionId,
        projectDirectory,
        projectName,
      });
      if (!focusResult.ok) {
        return {
          ok: false,
          error:
            focusResult.error ?? 'Session resurrected but project focus failed',
        } as R;
      }
      sessionIdRef.current = resp.sessionId;
      setSessionId(resp.sessionId);
      writeStoredSessionIdForProject(projectDirectory, resp.sessionId);
      setStatus('idle');
      setError(null);
      return operation(resp.sessionId);
    },
    [],
  );

  const consumeHistory = useCallback<DheeSessionApi['consumeHistory']>(() => {
    const snap = history;
    if (snap) setHistory(null);
    return snap;
  }, [history]);

  const refreshHistory = useCallback<
    DheeSessionApi['refreshHistory']
  >(async () => {
    const id = sessionIdRef.current;
    if (!id) return null;
    const projectDirectory = projectDirectoryRef.current;
    try {
      const resp = await window.dhee.getHistory({
        sessionId: id,
        ...(projectDirectory ? { projectDir: projectDirectory } : {}),
      });
      const candidate = resp.history ?? null;
      const snap = historyMatchesProject(candidate, projectDirectory)
        ? candidate
        : null;
      if (
        sessionIdRef.current !== id ||
        projectDirectoryRef.current !== projectDirectory
      ) {
        return null;
      }
      setHistory(snap);
      return snap;
    } catch {
      // Refresh failures are non-fatal — the panel just stays on
      // whatever state it already had. The user can retry by
      // re-mounting (close-and-reopen project).
      return null;
    }
  }, []);

  const clearChatHistory = useCallback<
    DheeSessionApi['clearChatHistory']
  >(async () => {
    const id = sessionIdRef.current;
    if (!id) return { ok: false, error: 'Session not yet created' };
    try {
      const projectDirectory = projectDirectoryRef.current;
      const projectName = projectNameRef.current;
      const resp = await window.dhee.clearChatHistory({
        sessionId: id,
        role: 'interactive',
      });
      const focusResult = await focusSessionForProject({
        sessionId: resp.newSessionId,
        projectDirectory,
        projectName,
      });
      if (!focusResult.ok) {
        return {
          ok: false,
          error: focusResult.error ?? 'Failed to focus project',
        };
      }
      sessionIdRef.current = resp.newSessionId;
      setSessionId(resp.newSessionId);
      writeStoredSessionIdForProject(projectDirectory, resp.newSessionId);
      setHistory(null);
      setStatus('idle');
      setError(null);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }, []);

  const runTask = useCallback<DheeSessionApi['runTask']>(
    async (task, opts) => {
      setStatus('running');
      setError(null);
      try {
        const result = await runWithSelfHeal<{ ok: boolean; error?: string }>(
          (sessionId) => {
            const req: RunTaskRequest = { sessionId, task, ...(opts ?? {}) };
            return window.dhee.runTask(req);
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

  const startRun = useCallback<DheeSessionApi['startRun']>(
    (opts) =>
      runWithSelfHeal((sessionId) =>
        window.dhee.startRun({ sessionId, ...opts }),
      ),
    [runWithSelfHeal],
  );

  const cancel = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return { cancelled: false };
    return window.dhee.cancelTask({ sessionId: id });
  }, []);

  const cancelExecution = useCallback(async () => {
    setPendingCancel(true);
    const projectDirectory = projectDirectoryRef.current;
    const runnerCancel = window.dhee
      .runnerCancel(
        projectDirectory ? { projectDir: projectDirectory } : undefined,
      )
      .catch(() => undefined);
    const chatCancel = cancel().catch(() => undefined);
    await runnerCancel;
    await chatCancel;
  }, [cancel]);

  /**
   * Phase 6.5c: chat-input path. Distinct from runTask which dispatches
   * bundle runs via BackgroundTaskRunner. chatPrompt drives the per-
   * session pi-agent and returns its reply.
   *
   * Flips local status to 'running' for the duration of the call so
   * the chat panel's header Stop button surfaces (it's gated on
   * `session.status === 'running'`). Without this flip, an agent
   * looping through tool calls during onboarding / regen looked
   * unstoppable from the UI — the only escape was killing the desktop.
   */
  const chatPrompt = useCallback<DheeSessionApi['chatPrompt']>(
    async (message, opts) => {
      setStatus('running');
      setError(null);
      try {
        const result = await runWithSelfHeal<
          | {
              ok: true;
              assistant_text: string;
              tool_calls: Array<{ name: string }>;
            }
          | { ok: false; error: string }
        >((activeSessionId) =>
          window.dhee.chatPrompt({
            sessionId: activeSessionId,
            message,
            ...(opts ?? {}),
          }),
        );
        if (result.ok) {
          setStatus('idle');
        } else {
          setStatus('error');
          setError(result.error ?? null);
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus('error');
        setError(msg);
        return { ok: false, error: msg };
      }
    },
    [runWithSelfHeal],
  );

  const redoNode = useCallback<DheeSessionApi['redoNode']>(
    (nodeId, opts) =>
      runWithSelfHeal((sessionId) =>
        window.dhee.redoNode({ sessionId, nodeId, ...(opts ?? {}) }),
      ),
    [runWithSelfHeal],
  );

  const configureProject = useCallback<DheeSessionApi['configureProject']>(
    (opts) =>
      runWithSelfHeal((sessionId) =>
        window.dhee.configureProject({ sessionId, ...opts }),
      ),
    [runWithSelfHeal],
  );

  const focusProject = useCallback<DheeSessionApi['focusProject']>(
    (projectName, projectDir) =>
      runWithSelfHeal((sessionId) =>
        window.dhee.focusProject({
          sessionId,
          projectName,
          ...(projectDir ? { projectDir } : {}),
        }),
      ),
    [runWithSelfHeal],
  );

  const setAutonomous = useCallback<DheeSessionApi['setAutonomous']>(
    (enabled) =>
      runWithSelfHeal((sessionId) =>
        window.dhee.setAutonomous({ sessionId, enabled }),
      ),
    [runWithSelfHeal],
  );

  const sendResponse = useCallback<DheeSessionApi['sendResponse']>(
    (response, toolCallId) =>
      runWithSelfHeal((sessionId) =>
        window.dhee.sendResponse({
          sessionId,
          response,
          ...(toolCallId ? { toolCallId } : {}),
        }),
      ),
    [runWithSelfHeal],
  );

  const invalidateNodes = useCallback<DheeSessionApi['invalidateNodes']>(
    (nodeIds, opts) =>
      runWithSelfHeal((sessionId) =>
        window.dhee.invalidateNodes({
          sessionId,
          nodeIds,
          ...(opts?.source ? { source: opts.source } : {}),
        }),
      ),
    [runWithSelfHeal],
  );

  const subscribe = useCallback<DheeSessionApi['subscribe']>(
    (eventName, cb) => window.dhee.on(eventName, cb),
    [],
  );

  // Reflect SERVER-side session status transitions in local UI state.
  // Without this, `status` was set only optimistically when the user
  // typed (useDheeSession.tsx:369) — server-initiated turns (the
  // supervisor pi-agent that auto-engages on runner `completed`)
  // never flipped the local status to 'running', so the chat header
  // stayed on "Ready" / "Resume" while the agent was actually busy
  // working on the user's behalf (the 2026-05-22 missing-Stop-button
  // bug).
  //
  // Mapping: server 'running' → 'running'; server 'completed' /
  // 'awaiting_input' / 'idle' → 'idle'; server 'error' → 'error'.
  // Ignore events for other sessionIds (multi-window safety).
  useEffect(() => {
    if (!sessionId) return undefined;
    const unsubscribe = window.dhee.on('session_status', (event) => {
      if (event.sessionId !== sessionId) return;
      const data = event.data as { status?: string } | null;
      const serverStatus = data?.status;
      if (!serverStatus) return;
      if (serverStatus === 'running') {
        setStatus('running');
      } else if (serverStatus === 'error') {
        setStatus('error');
      } else if (
        serverStatus === 'completed' ||
        serverStatus === 'awaiting_input' ||
        serverStatus === 'idle'
      ) {
        setStatus('idle');
      }
    });
    return unsubscribe;
  }, [sessionId]);

  useEffect(() => {
    setRunnerStatus(null);
    setPendingCancel(false);

    let cancelled = false;
    const tick = async () => {
      try {
        const nextStatus = await window.dhee.runnerStatus();
        if (cancelled) return;
        const ownsRunner = runnerBelongsToProject(nextStatus, {
          projectDirectory: activeProjectDirectory,
          projectName: activeProjectName,
        });
        setRunnerStatus((prev) =>
          sameRunnerStatus(prev, nextStatus) ? prev : nextStatus,
        );
        if (nextStatus?.cancelling && ownsRunner) {
          setPendingCancel(true);
        }
      } catch {
        if (!cancelled) {
          const idleStatus: RunnerStatusResponse = { active: false };
          setRunnerStatus((prev) =>
            sameRunnerStatus(prev, idleStatus) ? prev : idleStatus,
          );
        }
      }
    };

    tick();
    const handle = setInterval(tick, RUNNER_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [activeProjectDirectory, activeProjectName]);

  useEffect(() => {
    if (!runnerActive && !chatBusy && pendingCancel) {
      setPendingCancel(false);
    }
  }, [runnerActive, chatBusy, pendingCancel]);

  const execution = useMemo<DheeSessionExecution>(
    () => ({
      active: runnerActive || chatBusy || pendingCancel,
      runnerActive,
      chatBusy,
      pendingCancel,
      otherProjectRunner,
      cancel: cancelExecution,
    }),
    [
      runnerActive,
      chatBusy,
      pendingCancel,
      otherProjectRunner,
      cancelExecution,
    ],
  );

  return {
    sessionId,
    projectDirectory: activeProjectDirectory,
    projectName: activeProjectName,
    status,
    error,
    execution,
    history,
    consumeHistory,
    refreshHistory,
    clearChatHistory,
    runTask,
    startRun,
    chatPrompt,
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

const KshanaSessionContext = createContext<DheeSessionApi | null>(null);

/**
 * Mount once near the root of the app. Owns the single kshana-core
 * session; descendants read it via `useDheeSession()`.
 *
 * Why a provider (not a per-mount hook): `window.dhee.createSession`
 * is treated as idempotent on the renderer (we always pass the
 * persisted sessionId for resume), but the server side currently
 * overwrites `sessions.set(id, freshState)` on every call. Two
 * concurrent mounts therefore race — whichever lands second wipes the
 * other's `sessionContext` (focused-project working dir). A singleton
 * means there's only one `createSession` call for the app's lifetime
 * and that race goes away.
 */
export interface DheeSessionProviderProps extends DheeSessionScope {
  children: ReactNode;
}

export function DheeSessionProvider({
  children,
  projectDirectory,
  projectName,
}: DheeSessionProviderProps) {
  const api = useCreateKshanaSession({ projectDirectory, projectName });
  // Identity-stable memo by api fields so consumers re-render only on
  // actual changes, not on every parent render. The api object is
  // already rebuilt each render anyway (it's a fresh object literal),
  // so we memoise on the underlying values that matter.
  const value = useMemo<DheeSessionApi>(
    () => api,
    [
      api.sessionId,
      api.projectDirectory,
      api.projectName,
      api.status,
      api.error,
      api.execution,
      api.history,
      api.consumeHistory,
      api.refreshHistory,
      api.clearChatHistory,
      api.runTask,
      api.startRun,
      api.chatPrompt,
      api.cancel,
      api.redoNode,
      api.configureProject,
      api.focusProject,
      api.setAutonomous,
      api.sendResponse,
      api.invalidateNodes,
      api.subscribe,
    ],
  );
  return (
    <KshanaSessionContext.Provider value={value}>
      {children}
    </KshanaSessionContext.Provider>
  );
}

export function useDheeSession(): DheeSessionApi {
  const ctx = useContext(KshanaSessionContext);
  if (!ctx) {
    throw new Error('useDheeSession must be used within a DheeSessionProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant for components that legitimately mount outside
 * a provider (e.g., NewProjectDialog inside test fixtures that don't
 * stage the full session graph). Returns `null` when no provider is
 * present so callers can guard their session-dependent side effects
 * (typically: chat reset, runTask). Production mounts under the
 * provider so the hook returns the full API.
 */
export function useOptionalKshanaSession(): DheeSessionApi | null {
  return useContext(KshanaSessionContext);
}
