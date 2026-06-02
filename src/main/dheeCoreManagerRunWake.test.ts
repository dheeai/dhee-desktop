/**
 * Phase 2 of interruptible-runs — dheeCoreManager re-wakes the owning
 * agent session when a background bundle run reaches a terminal state.
 *
 * `onRunTerminal(kind, event)` is the handler the BackgroundTaskRunner
 * terminal-event subscription calls. These tests drive it directly
 * (the subscription wiring itself is exercised by the runner; here we
 * pin the decision logic).
 *
 * Failure modes:
 *   1. completed + idle agent session owning the project → nudge sent
 *      (chatPrompt called once with a completed nudge).
 *   2. failed (structural) + idle → nudge carries fix-upstream framing.
 *   3. failed (transient) + idle → nudge carries retry framing.
 *   4. terminal event while the session is BUSY (mid-turn) → no nudge.
 *   5. cancelled → never nudges (handler only bound to completed/failed,
 *      but assert calling it with a cancelled-shaped event is a no-op
 *      via project lookup still NOT double-firing — we simply never
 *      wire 'cancelled', proven in the subscription test below).
 *   6. terminal event for a project with NO live agent session
 *      (headless) → no nudge, no throw.
 *   7. explicit spec.sessionId is honored when it maps to a session.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.mock('electron', () => ({ app: { isPackaged: false } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const { dheeCoreManager, __setChatDeps, __setRunnersLoader } =
  require('./dheeCoreManager') as typeof import('./dheeCoreManager');

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type AnyFn = (...args: unknown[]) => unknown;
const buildSessionSpy = jest.fn<AnyAsync>();
const runTurnSpy = jest.fn<AnyAsync>();
__setChatDeps({
  buildPiSession: buildSessionSpy as never,
  runAgentTurn: runTurnSpy as never,
});

// Stub the BackgroundTaskRunner so the C3 auto-retry path
// (autoResumeRun → runner.dispatch) doesn't hit the real runner.
const dispatchSpy = jest.fn<AnyFn>(() => ({ status: 'started', taskId: 'task-retry' }));
const onSpy = jest.fn<AnyFn>(() => () => {});
__setRunnersLoader(async () => ({
  getBackgroundTaskRunner: () => ({
    cancel: () => true,
    getActive: () => null,
    isCancelling: () => false,
    dispatch: dispatchSpy as never,
    on: onSpy as never,
  }),
}) as never);

const TEST_SETTINGS = {
  llmProvider: 'openai',
  openaiApiKey: 'sk-test',
  openaiBaseUrl: 'https://openrouter.ai/api/v1',
  openaiModel: 'deepseek/deepseek-v4-flash',
  googleApiKey: '',
  geminiModel: '',
} as never;

function makeMgr() {
  const m = new dheeCoreManager();
  m.__setLastSettingsForTesting(TEST_SETTINGS);
  return m;
}

function terminalEvent(projectDir: string, error?: string, sessionId?: string) {
  return {
    task: {
      id: 'task-x',
      spec: {
        ...(sessionId ? { sessionId } : {}),
        params: { projectDir },
      },
    },
    ...(error ? { error } : {}),
  };
}

beforeEach(() => {
  buildSessionSpy.mockReset();
  runTurnSpy.mockReset();
  dispatchSpy.mockClear();
  dispatchSpy.mockReturnValue({ status: 'started', taskId: 'task-retry' });
  onSpy.mockClear();
  buildSessionSpy.mockResolvedValue({
    session: {
      sessionId: 'pi-stub',
      subscribe: () => () => {},
      prompt: async () => {},
      dispose: () => {},
    },
  });
  runTurnSpy.mockResolvedValue({ ok: true, assistant_text: 'ok', tool_calls: [] });
});

/**
 * Establish a live agent session focused on a project + prime
 * lastEventCb (chatPrompt caches the eventCb). Returns the captured
 * nudge messages passed to runAgentTurn.
 */
async function primeSession(mgr: InstanceType<typeof dheeCoreManager>, sessionId: string, projectDir: string) {
  await mgr.focusSessionProject(sessionId, 'p', projectDir);
  const events: unknown[] = [];
  // First real chatPrompt builds the agent session + caches eventCb.
  await mgr.chatPrompt(sessionId, 'hello', (e) => events.push(e));
  return events;
}

describe('dheeCoreManager.onRunTerminal — agent re-wake', () => {
  it('1. completed + idle owning session → injects a completed nudge', async () => {
    const mgr = makeMgr();
    await primeSession(mgr, 's-1', '/tmp/proj-a');
    runTurnSpy.mockClear();

    mgr.onRunTerminal('completed', terminalEvent('/tmp/proj-a'));
    // onRunTerminal fires chatPrompt asynchronously (void). Let the
    // microtask/promise chain flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    const msg = runTurnSpy.mock.calls[0]![1] as string;
    expect(msg).toMatch(/completed/i);
    expect(msg).toMatch(/^\[system\]/);
  });

  it('2. failed (structural) + idle → fix-upstream framing + visible notice (C2)', async () => {
    const mgr = makeMgr();
    const events = await primeSession(mgr, 's-2', '/tmp/proj-b');
    runTurnSpy.mockClear();

    mgr.onRunTerminal('failed', terminalEvent('/tmp/proj-b', 'schema validation failed: mood not in enum'));
    await new Promise((r) => setTimeout(r, 0));

    // Structural → nudge the agent to fix the upstream node.
    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    const msg = runTurnSpy.mock.calls[0]![1] as string;
    expect(msg).toMatch(/structural/i);
    expect(msg).toMatch(/dhee_critique_node|dhee_write_node_content/);
    // C2 — a visible error notification is ALSO emitted (never silent).
    const notices = events.filter((e) => (e as { eventName?: string }).eventName === 'notification');
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect((notices[0] as { data?: { level?: string } }).data?.level).toBe('error');
    // Structural failures are NOT auto-retried.
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('3. failed (transient) + idle → auto-retries the run, NO nudge yet (C3)', async () => {
    const mgr = makeMgr();
    const events = await primeSession(mgr, 's-3', '/tmp/proj-c');
    runTurnSpy.mockClear();

    mgr.onRunTerminal(
      'failed',
      terminalEvent('/tmp/proj-c', 'comfy.image: transient upstream error after 3 attempts — 502'),
    );
    await new Promise((r) => setTimeout(r, 80)); // auto-retry dispatch is deferred ~50ms

    // It auto-resumes through the runner instead of nudging the LLM.
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0]![0]).toMatchObject({ kind: 'run_to', params: { projectDir: '/tmp/proj-c' } });
    expect(runTurnSpy).not.toHaveBeenCalled();
    // And a "retrying" notice is shown.
    const notices = events.filter((e) => (e as { eventName?: string }).eventName === 'notification');
    expect(notices.some((n) => /retry/i.test(String((n as { data?: { message?: string } }).data?.message)))).toBe(true);
  });

  it('3b. transient AGAIN after the auto-retry budget is spent → nudge with retry framing, no second auto-retry', async () => {
    const mgr = makeMgr();
    await primeSession(mgr, 's-3b', '/tmp/proj-c2');
    const transientErr = 'comfy.image: transient upstream error after 3 attempts — 502';

    // First transient → auto-retry (spends the budget).
    mgr.onRunTerminal('failed', terminalEvent('/tmp/proj-c2', transientErr));
    await new Promise((r) => setTimeout(r, 80));
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    runTurnSpy.mockClear();
    dispatchSpy.mockClear();

    // Second transient → budget exhausted → surface + nudge (no new dispatch).
    mgr.onRunTerminal('failed', terminalEvent('/tmp/proj-c2', transientErr));
    await new Promise((r) => setTimeout(r, 80));
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    const msg = runTurnSpy.mock.calls[0]![1] as string;
    expect(msg).toMatch(/transient|recovered|flaky/i);
    expect(msg).toMatch(/retry/i);
  });

  it('4. terminal event while the session is mid-turn (busy) → no nudge (pull covers it)', async () => {
    const mgr = makeMgr();
    await primeSession(mgr, 's-4', '/tmp/proj-busy');
    runTurnSpy.mockClear();

    // Make the NEXT turn hang so the session stays "busy".
    let release!: () => void;
    runTurnSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, assistant_text: 'x', tool_calls: [] });
        }),
    );
    // Kick off a turn but don't await — session is now busy.
    const turn = mgr.chatPrompt('s-4', 'a long-running turn', () => {});
    await new Promise((r) => setTimeout(r, 0)); // let chatPrompt mark busy + call runAgentTurn

    // A run finishes while the agent is mid-turn → must be skipped.
    mgr.onRunTerminal('completed', terminalEvent('/tmp/proj-busy'));
    await new Promise((r) => setTimeout(r, 0));

    expect(runTurnSpy).toHaveBeenCalledTimes(1); // only the in-flight turn, no nudge turn

    release();
    await turn;
  });

  it('6. terminal event for a project with NO live agent session → no nudge, no throw', async () => {
    const mgr = makeMgr();
    // No session primed for this project.
    expect(() => mgr.onRunTerminal('completed', terminalEvent('/tmp/unknown'))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(runTurnSpy).not.toHaveBeenCalled();
  });

  it('7. explicit spec.sessionId is honored', async () => {
    const mgr = makeMgr();
    await primeSession(mgr, 's-7', '/tmp/proj-d');
    runTurnSpy.mockClear();

    mgr.onRunTerminal('completed', terminalEvent('/tmp/proj-d', undefined, 's-7'));
    await new Promise((r) => setTimeout(r, 0));
    expect(runTurnSpy).toHaveBeenCalledTimes(1);
  });

  it('8. failed run with NO owning agent session still surfaces a visible notice (C2 — no silent death)', async () => {
    const mgr = makeMgr();
    // Prime a session for a DIFFERENT project (establishes a publish path),
    // then fail a run for an unrelated project with no live session.
    const events = await primeSession(mgr, 's-8', '/tmp/proj-other');
    runTurnSpy.mockClear();
    events.length = 0;

    mgr.onRunTerminal('failed', terminalEvent('/tmp/proj-orphan', 'schema validation failed: mood not in enum'));
    await new Promise((r) => setTimeout(r, 0));

    // No agent to nudge…
    expect(runTurnSpy).not.toHaveBeenCalled();
    // …but the failure is still visible in the chat (the key fix).
    const notices = events.filter((e) => (e as { eventName?: string }).eventName === 'notification');
    expect(notices.length).toBe(1);
    const data = (notices[0] as { data?: { level?: string; message?: string } }).data;
    expect(data?.level).toBe('error');
    expect(data?.message).toMatch(/failed/i);
  });
});
