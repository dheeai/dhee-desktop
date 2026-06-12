/**
 * Tests for the Phase 6.2 runTask rewire — dheeCoreManager.runTask
 * dispatches via the BackgroundTaskRunner (dhee-core/runners) directly,
 * NOT through the dead ConversationManager.runTask facade. Runner
 * events are translated into `dheeCoreEvent`s for the IPC bridge.
 *
 * Strategy: stub the runners module with a tiny in-memory emitter so
 * we can drive the terminal events ourselves and assert what runTask
 * resolves to + what flows through eventCb.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { EventEmitter } from 'node:events';

jest.mock('electron', () => ({
  app: { isPackaged: false },
}));

// Imported AFTER the jest.mock call so the mock binds.
// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const {
  dheeCoreManager,
  __setRunnersLoader,
} = require('./dheeCoreManager') as typeof import('./dheeCoreManager');

interface FakeTask {
  id: string;
  spec: { kind: string; projectName: string; sessionId: string; params: unknown };
}

// Hand-rolled fake BackgroundTaskRunner.
type AnyEvent = (...args: unknown[]) => void;
let lastDispatched: { spec: FakeTask['spec']; taskId: string } | null = null;
let activeTask: FakeTask | null = null;
const runnerEmitter = new EventEmitter();
const fakeRunner = {
  dispatch(spec: FakeTask['spec']) {
    if (activeTask) {
      return {
        status: 'rejected' as const,
        reason: 'task_already_running' as const,
        activeTaskId: activeTask.id,
        activeTaskKind: activeTask.spec.kind,
        activeProjectName: activeTask.spec.projectName,
      };
    }
    const taskId = 't-' + Math.random().toString(36).slice(2, 6);
    activeTask = { id: taskId, spec };
    lastDispatched = { spec, taskId };
    return { status: 'started' as const, taskId };
  },
  cancel(_taskId?: string) {
    if (!activeTask) return false;
    activeTask = null;
    return true;
  },
  getActive() {
    return activeTask;
  },
  isCancelling() {
    return false;
  },
  on(event: string, handler: AnyEvent): () => void {
    runnerEmitter.on(event, handler);
    return () => runnerEmitter.off(event, handler);
  },
};
__setRunnersLoader(async () => ({ getBackgroundTaskRunner: () => fakeRunner }) as never);

function emitRunnerEvent(event: string, payload: Record<string, unknown>): void {
  // The runner injects `task: {...}` in every payload — mimic that.
  runnerEmitter.emit(event, { ...payload, task: activeTask });
}

beforeEach(() => {
  lastDispatched = null;
  activeTask = null;
  runnerEmitter.removeAllListeners();
});

describe('dheeCoreManager.runTask (Phase 6.2 rewire)', () => {
  it('dispatches a run_to task with the focused projectDir and resolves when the runner emits completed', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-1', 'Ruby V4', '/tmp/projects/Ruby_V4');

    const events: Array<{ eventName: string; data: unknown }> = [];
    const cb = (e: { eventName: string; data: unknown }) => events.push(e);

    const promise = mgr.runTask('s-1', 'go go go', {}, cb);

    // Give the dispatch a microtask to settle.
    await Promise.resolve();
    expect(lastDispatched).not.toBeNull();
    expect(lastDispatched!.spec).toMatchObject({
      kind: 'run_to',
      projectName: 'Ruby_V4',
      sessionId: 's-1',
      params: { projectDir: '/tmp/projects/Ruby_V4' },
    });

    emitRunnerEvent('completed', {});
    const result = await promise;
    expect(result.status).toBe('completed');
  });

  it('returns failed with task_already_running when the runner is busy', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-2', 'a', '/tmp/a');
    await mgr.focusSessionProject('s-3', 'b', '/tmp/b');

    const first = mgr.runTask('s-2', 'first', {}, () => {});
    await Promise.resolve();
    const second = await mgr.runTask('s-3', 'second', {}, () => {});
    expect(second.status).toBe('failed');
    expect(second.error).toMatch(/already running/i);
    // Clean up the first one so the EventEmitter handlers aren't dangling.
    emitRunnerEvent('completed', {});
    await first;
  });

  it('resolves failed with the runner error when the task fails', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-4', 'p', '/tmp/p');
    const promise = mgr.runTask('s-4', 'go', {}, () => {});
    await Promise.resolve();
    emitRunnerEvent('failed', { error: 'comfy unreachable' });
    const result = await promise;
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/comfy unreachable/);
  });

  it('resolves cancelled when the runner emits cancelled', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-5', 'p', '/tmp/p');
    const promise = mgr.runTask('s-5', 'go', {}, () => {});
    await Promise.resolve();
    emitRunnerEvent('cancelled', {});
    const result = await promise;
    expect(result.status).toBe('cancelled');
  });

  it('forwards runner tool/result/notification events through eventCb', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-6', 'p', '/tmp/p');
    const events: Array<{ eventName: string; data: unknown }> = [];
    const cb = (e: { eventName: string; data: unknown }) => events.push(e);
    const promise = mgr.runTask('s-6', 'go', {}, cb);
    await Promise.resolve();
    emitRunnerEvent('tool', { toolName: 'llm.generate', nodeId: 'story' });
    emitRunnerEvent('result', {
      toolName: 'llm.generate',
      nodeId: 'story',
      filePath: '/tmp/p/plans/story.md',
      status: 'success',
    });
    emitRunnerEvent('notification', { level: 'info', message: 'wrote story' });
    emitRunnerEvent('completed', {});
    await promise;

    const names = events.map((e) => e.eventName);
    expect(names).toContain('tool_call');
    expect(names).toContain('tool_result');
    expect(names).toContain('notification');
    expect(names).not.toContain('status');
  });

  it('errors clearly when runTask is called for a session that has never been focused', async () => {
    const mgr = new dheeCoreManager();
    const result = await mgr.runTask('s-orphan', 'go', {}, () => {});
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/no project focused/i);
  });

  it('forwards stopAtStage as `stage` in the dispatched params', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-7', 'p', '/tmp/p');
    const promise = mgr.runTask('s-7', 'go', { stopAtStage: 'shot_image' }, () => {});
    await Promise.resolve();
    expect((lastDispatched!.spec.params as { stage?: string }).stage).toBe('shot_image');
    emitRunnerEvent('completed', {});
    await promise;
  });
});

describe('dheeCoreManager.startRun', () => {
  it('dispatches a run_to task for the provided projectDir and returns the task id immediately', async () => {
    const mgr = new dheeCoreManager();
    const result = await mgr.startRun(
      's-start',
      { projectDir: '/tmp/projects/DirectStart', stopAtStage: 'scene_clip' },
      () => {},
    );

    expect(result).toEqual({ ok: true, taskId: lastDispatched!.taskId });
    expect(lastDispatched!.spec).toMatchObject({
      kind: 'run_to',
      projectName: 'DirectStart',
      sessionId: 's-start',
      params: {
        projectDir: '/tmp/projects/DirectStart',
        stage: 'scene_clip',
      },
    });

    emitRunnerEvent('completed', {});
  });

  it('returns a rejection error when the background runner is already busy', async () => {
    const mgr = new dheeCoreManager();
    const first = await mgr.startRun(
      's-first',
      { projectDir: '/tmp/projects/First' },
      () => {},
    );
    expect(first.ok).toBe(true);

    const second = await mgr.startRun(
      's-second',
      { projectDir: '/tmp/projects/Second' },
      () => {},
    );

    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already running/i);

    emitRunnerEvent('completed', {});
  });
});

describe('dheeCoreManager.cancelTask (Phase 6.2 rewire)', () => {
  it('delegates to BackgroundTaskRunner.cancel(); session id is informational', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-8', 'p', '/tmp/p');
    // We don't need the long-running promise here — just dispatch via the
    // runner directly. Saves wrestling with EventEmitter lifecycle.
    const promise = mgr.runTask('s-8', 'go', {}, () => {});
    await Promise.resolve();
    expect(activeTask).not.toBeNull();
    const taskAtCancel = activeTask;
    const cancelled = await mgr.cancelTask('s-8');
    expect(cancelled).toBe(true);
    // Real BackgroundTaskRunner emits 'cancelled' after cancel(). Mirror that
    // here so the awaiting runTask promise resolves.
    activeTask = taskAtCancel;
    emitRunnerEvent('cancelled', {});
    await promise;
  });

  it('returns false when nothing is running', async () => {
    const mgr = new dheeCoreManager();
    const cancelled = await mgr.cancelTask('s-nothing');
    expect(cancelled).toBe(false);
  });

  it('BUG: returns within ~100ms even when the agent session abort() is slow (mid-tool comfy / llm)', async () => {
    // Real-world repro from the prompt-relay E2E project:
    // user clicks Stop mid-dhee_critique_node. The agent's
    // sess.abort() can take 30-90s to resolve because it waits for
    // the in-flight LLM/Comfy job to release the agent's lock.
    // cancelTask MUST NOT block the UI on that — fire abort, return
    // immediately; let the long tail finish in the background.
    const mgr = new dheeCoreManager();
    // Stub an AgentSession whose abort() hangs forever. If cancelTask
    // awaits this, the test times out at 5s.
    let abortCalled = false;
    mgr.__setAgentSessionForTesting('s-stuck', {
      subscribe: () => () => undefined,
      prompt: async () => undefined,
      abort: () => {
        abortCalled = true;
        return new Promise<void>(() => undefined);  // never resolves
      },
      dispose: () => undefined,
    });

    const t0 = Date.now();
    const result = await mgr.cancelTask('s-stuck');
    const elapsed = Date.now() - t0;

    // abort() must have been fired (signal propagation).
    expect(abortCalled).toBe(true);
    // cancelTask must NOT wait for abort() to resolve.
    expect(elapsed).toBeLessThan(200);
    // Still returns true because abort was triggered.
    expect(result).toBe(true);
  });
});
