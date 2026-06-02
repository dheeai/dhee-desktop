/**
 * Tests for Phase 6.5a — dheeCoreManager.chatPrompt(sessionId, message)
 *
 * The chat panel now drives a real pi-coding-agent AgentSession in
 * process (was: synthetic stubs from Phase 6.3 that just returned a
 * random id and no actual LLM). Each chat turn:
 *
 *  1. Looks up the session's focused projectDir (Phase 6.1 map).
 *  2. Lazy-builds an AgentSession via buildPiSession on first message;
 *     reuses it on subsequent turns (long-lived per chat session).
 *  3. Calls runAgentTurn — text deltas + tool_execution_start events
 *     accumulate into {assistant_text, tool_calls}.
 *  4. Returns the envelope to the IPC bridge.
 *
 * Tests inject the buildPiSession + runAgentTurn deps via a seam so
 * we don't boot a real LLM.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.mock('electron', () => ({
  app: { isPackaged: false },
}));

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

// Phase 6.5b: chatPrompt now derives model + apiKey from cached
// settings. Tests seed a minimal AppSettings via the test seam.
const TEST_SETTINGS = {
  llmProvider: 'openai',
  openaiApiKey: 'sk-test-key',
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

beforeEach(() => {
  buildSessionSpy.mockReset();
  runTurnSpy.mockReset();
  buildSessionSpy.mockResolvedValue({
    session: {
      sessionId: 'pi-stub',
      sessionFile: '/tmp/stub.jsonl',
      subscribe: () => () => {},
      prompt: async () => {},
      dispose: () => {},
    },
  });
  runTurnSpy.mockResolvedValue({
    ok: true,
    assistant_text: 'Hello from the agent.',
    tool_calls: [{ name: 'dhee_get_status' }],
  });
});

describe('dheeCoreManager.chatPrompt (Phase 6.5a)', () => {
  it('builds an AgentSession on the first prompt, focused on the session\'s projectDir, and reuses it on subsequent prompts', async () => {
    const mgr = makeMgr();
    await mgr.focusSessionProject('s-1', 'Ruby V4', '/tmp/projects/Ruby_V4');

    const r1 = await mgr.chatPrompt('s-1', 'hello');
    expect(r1.ok).toBe(true);
    expect(buildSessionSpy).toHaveBeenCalledTimes(1);
    const firstCall = buildSessionSpy.mock.calls[0]![0] as { cwd?: string };
    expect(firstCall.cwd).toBe('/tmp/projects/Ruby_V4');

    const r2 = await mgr.chatPrompt('s-1', 'again');
    expect(r2.ok).toBe(true);
    // Second turn does NOT rebuild — same session reused.
    expect(buildSessionSpy).toHaveBeenCalledTimes(1);
    expect(runTurnSpy).toHaveBeenCalledTimes(2);
  });

  it('returns the assistant_text and tool_calls envelope from runAgentTurn', async () => {
    const mgr = makeMgr();
    await mgr.focusSessionProject('s-2', 'p', '/tmp/p');

    const r = await mgr.chatPrompt('s-2', 'do the thing');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.assistant_text).toBe('Hello from the agent.');
      expect(r.tool_calls.map((c) => c.name)).toEqual(['dhee_get_status']);
    }
  });

  it('passes keepAlive=true so the long-lived chat session is NOT disposed between turns', async () => {
    const mgr = makeMgr();
    await mgr.focusSessionProject('s-3', 'p', '/tmp/p');
    await mgr.chatPrompt('s-3', 'x');
    const opts = runTurnSpy.mock.calls[0]![2] as { keepAlive?: boolean } | undefined;
    expect(opts?.keepAlive).toBe(true);
  });

  it('errors clearly when chatPrompt is called for a session that has never been focused on a project', async () => {
    const mgr = makeMgr();
    const r = await mgr.chatPrompt('s-orphan', 'hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no project focused/i);
    expect(buildSessionSpy).not.toHaveBeenCalled();
  });

  it('surfaces the buildPiSession error so the renderer can show a clean failure (e.g. provider unauthed)', async () => {
    buildSessionSpy.mockRejectedValueOnce(new Error('No provider available'));
    const mgr = makeMgr();
    await mgr.focusSessionProject('s-4', 'p', '/tmp/p');
    const r = await mgr.chatPrompt('s-4', 'hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no provider/i);
  });

  it('surfaces the runAgentTurn error verbatim', async () => {
    runTurnSpy.mockResolvedValueOnce({ ok: false, error: 'LLM rate limit' });
    const mgr = makeMgr();
    await mgr.focusSessionProject('s-5', 'p', '/tmp/p');
    const r = await mgr.chatPrompt('s-5', 'hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rate limit/i);
  });

  it('deleteSession disposes the AgentSession and clears it from the map (next chatPrompt rebuilds)', async () => {
    const dispose = jest.fn();
    buildSessionSpy.mockResolvedValueOnce({
      session: {
        sessionId: 'pi-stub-d',
        sessionFile: '/tmp/stub.jsonl',
        subscribe: () => () => {},
        prompt: async () => {},
        dispose,
      },
    });
    const mgr = makeMgr();
    await mgr.focusSessionProject('s-6', 'p', '/tmp/p');
    await mgr.chatPrompt('s-6', 'first');
    mgr.deleteSession('s-6');
    expect(dispose).toHaveBeenCalledTimes(1);
    // Subsequent chat for that session would need a new focus, but
    // building a fresh session works again if focus is re-established.
    await mgr.focusSessionProject('s-6', 'p', '/tmp/p');
    await mgr.chatPrompt('s-6', 'second');
    expect(buildSessionSpy).toHaveBeenCalledTimes(2);
  });
});
