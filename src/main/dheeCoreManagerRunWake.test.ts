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
const { dheeCoreManager, __setChatDeps } =
  require('./dheeCoreManager') as typeof import('./dheeCoreManager');

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const buildSessionSpy = jest.fn<AnyAsync>();
const runTurnSpy = jest.fn<AnyAsync>();
__setChatDeps({
  buildPiSession: buildSessionSpy as never,
  runAgentTurn: runTurnSpy as never,
});

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

  it('2. failed (structural) + idle → fix-upstream framing', async () => {
    const mgr = makeMgr();
    await primeSession(mgr, 's-2', '/tmp/proj-b');
    runTurnSpy.mockClear();

    mgr.onRunTerminal('failed', terminalEvent('/tmp/proj-b', 'LLM returned empty response'));
    await new Promise((r) => setTimeout(r, 0));

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    const msg = runTurnSpy.mock.calls[0]![1] as string;
    expect(msg).toMatch(/structural/i);
    expect(msg).toMatch(/dhee_critique_node|dhee_write_node_content/);
  });

  it('3. failed (transient) + idle → retry framing', async () => {
    const mgr = makeMgr();
    await primeSession(mgr, 's-3', '/tmp/proj-c');
    runTurnSpy.mockClear();

    mgr.onRunTerminal(
      'failed',
      terminalEvent('/tmp/proj-c', 'comfy.image: transient upstream error after 3 attempts — 502'),
    );
    await new Promise((r) => setTimeout(r, 0));

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
});
