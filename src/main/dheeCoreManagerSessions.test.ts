/**
 * Tests for Phase 6.3 — chat session methods reimplemented as in-process
 * synthetic stubs so the renderer's chat panel + Resume button can mount
 * without errors. None of these methods touch the dead ConversationManager
 * facade anymore. The chat-as-pi-agent rebuild (Phase 6.4) will replace
 * the synthetic stubs with real pi-coding-agent session state.
 *
 * Strategy: skip mgr.start() — none of these methods need the embedded
 * runtime.
 */
import { describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhee-sessions-test-'));

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (key: string) => {
      if (key === 'userData') return userDataRoot;
      throw new Error(`unexpected app.getPath key: ${key}`);
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const { dheeCoreManager, __setDagLoader, __setRunnersLoader } =
  require('./dheeCoreManager') as typeof import('./dheeCoreManager');

// configureSessionForProject test exercises redoNode; needs a dag stub
// or jest tries to parse the ESM dist.
__setDagLoader(async () => ({
  regenerateNode: (async () => ({ ok: false, error: 'stubbed' })) as never,
  invalidateNodes: (async () => ({ invalidated: [], notFound: [] })) as never,
}) as never);
// And runTask -> runners (referenced by deleteSession test).
__setRunnersLoader(async () => ({
  getBackgroundTaskRunner: () => ({
    cancel: () => false,
    getActive: () => null,
    isCancelling: () => false,
    dispatch: () => ({ status: 'started' as const, taskId: 't-stub' }),
    on: () => () => {},
  }),
}) as never);

describe('dheeCoreManager.createSession (Phase 6.3)', () => {
  it('returns a synthetic id without booting ConversationManager', () => {
    const mgr = new dheeCoreManager();
    const out = mgr.createSession();
    expect(typeof out.id).toBe('string');
    expect(out.id.length).toBeGreaterThan(4);
    expect(out.resumed).toBe(false);
  });

  it('honors a resumeSessionId: returns that id and resumed=true', () => {
    const mgr = new dheeCoreManager();
    const out = mgr.createSession('interactive', 's-existing-123');
    expect(out.id).toBe('s-existing-123');
    expect(out.resumed).toBe(true);
  });
});

describe('dheeCoreManager session-history & cleanup stubs (Phase 6.3)', () => {
  it('getSessionHistorySnapshot returns null when no project is focused', () => {
    const mgr = new dheeCoreManager();
    expect(mgr.getSessionHistorySnapshot('s-x')).toBeNull();
  });

  it('getSessionHistorySnapshot rehydrates user+assistant turns from the focused project JSONL (Phase 6.5c.d)', async () => {
    const projectDir = path.join(userDataRoot, 'projects', 'RubyV4');
    fs.mkdirSync(projectDir, { recursive: true });
    const sessionsDir = path.join(userDataRoot, 'pi-sessions', 'RubyV4');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const jsonl = [
      JSON.stringify({
        type: 'message',
        id: 'm-1',
        timestamp: '2026-05-29T10:00:00.000Z',
        message: { role: 'user', content: 'hello', timestamp: 1716981600000 },
      }),
      JSON.stringify({
        type: 'message',
        id: 'm-2',
        timestamp: '2026-05-29T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hi there' }],
          timestamp: 1716981601000,
        },
      }),
      // synthetic seeded user noise — should be filtered
      JSON.stringify({
        type: 'message',
        id: 'm-3',
        timestamp: '2026-05-29T10:00:02.000Z',
        message: { role: 'user', content: '[SYSTEM EVENT] dispatched', timestamp: 1716981602000 },
      }),
      // compaction marker — bump count, skip from messages
      JSON.stringify({ type: 'compaction', timestamp: '2026-05-29T10:00:03.000Z' }),
    ].join('\n');
    fs.writeFileSync(path.join(sessionsDir, 'sess.jsonl'), jsonl);

    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-rehydrate', 'RubyV4', projectDir);
    const snap = mgr.getSessionHistorySnapshot('s-rehydrate');
    expect(snap).not.toBeNull();
    expect(snap?.focusedProject).toBe('RubyV4');
    expect(snap?.compactionCount).toBe(1);
    expect(snap?.messages).toHaveLength(2);
    expect(snap?.messages[0]).toMatchObject({ type: 'user', content: 'hello' });
    expect(snap?.messages[1]).toMatchObject({ type: 'agent', content: 'hi there' });
  });

  it('clearChatHistory mints a fresh session id and does not throw', () => {
    const mgr = new dheeCoreManager();
    const out = mgr.clearChatHistory('s-old');
    expect(typeof out.newSessionId).toBe('string');
    expect(out.newSessionId).not.toBe('s-old');
  });

  it('deleteSession is idempotent and removes the session→project mapping', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-d', 'p', '/tmp/p');
    mgr.deleteSession('s-d');
    // After delete, runTask for that session should error with "no project focused"
    // (the map entry is gone).
    const result = await mgr.runTask('s-d', 'task', {}, () => {});
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/no project focused/i);
  });
});

describe('dheeCoreManager.configureSessionForProject (Phase 6.3)', () => {
  it('populates the session→project map so subsequent runTask + redoNode can find the projectDir', async () => {
    const mgr = new dheeCoreManager();
    await mgr.configureSessionForProject('s-cfg', {
      projectDir: '/tmp/configured-project',
    });
    const result = await mgr.redoNode('s-cfg', 'story');
    // We DO care that the session→project lookup found
    // '/tmp/configured-project' — i.e. it did NOT bail with
    // "no project focused". redoNode now invalidates (stubbed ok) then
    // dispatches through the runner (stubbed 'started'), so it resolves
    // ok with no error. The point is the project was found.
    expect(result.ok).toBe(true);
    expect(result.error ?? '').not.toMatch(/no project focused/i);
  });
});

describe('dheeCoreManager flag setters (Phase 6.3)', () => {
  it('setAutonomousMode + setPiOversight + setVlmJudge do not throw and persist per session', () => {
    const mgr = new dheeCoreManager();
    mgr.setAutonomousMode('s-1', true);
    mgr.setPiOversight('s-1', false);
    mgr.setVlmJudge('s-1', true);
    // No accessor exposed today; the contract is "doesn't throw and
    // keeps state for future consumers." When a consumer lands they'll
    // need their own coverage. The check here pins the IPC handler's
    // happy-path so the renderer's settings toggle doesn't crash.
    expect(() => mgr.setAutonomousMode('s-other', false)).not.toThrow();
  });
});
