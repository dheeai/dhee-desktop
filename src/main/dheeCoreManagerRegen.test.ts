/**
 * Tests for the BUG-016 / Inspector Canvas Phase 6 rewire — dheeCoreManager.redoNode
 * and invalidateNodes call into dhee-core/dag directly, NOT into the
 * dead ConversationManager facade. The session→project mapping is
 * populated by focusSessionProject so the handlers know which project
 * to mutate.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.mock('electron', () => ({
  app: { isPackaged: false },
}));

// Imported AFTER the jest.mock call so the mock binds.
// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const {
  dheeCoreManager,
  __setDagLoader,
  __setManagerLoader,
  __setRunnersLoader,
} = require('./dheeCoreManager') as typeof import('./dheeCoreManager');

// Minimal pass-through manager loader (the live one is unused now but
// dheeCoreManager still requires it for boot until Phase 6.x deletes
// it entirely).
const fakeShutdown = jest.fn();
class FakeConversationManager {
  constructor(_cfg: unknown) {}
  shutdown(): void {
    fakeShutdown();
  }
}
__setManagerLoader(async () => ({
  ConversationManager: FakeConversationManager as unknown as new (cfg: unknown) => unknown,
}) as never);

// The BackgroundTaskRunner mock — redoNode now dispatches the actual
// re-render through here (so the run is visible to runnerStatus +
// cancellable), instead of calling dag.regenerateNode directly.
type AnyFn = (...args: unknown[]) => unknown;
const dispatchSpy = jest.fn<AnyFn>();
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

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const regenerateNodeSpy = jest.fn<AnyAsync>();
const invalidateNodesSpy = jest.fn<AnyAsync>();
__setDagLoader(async () => ({
  regenerateNode: regenerateNodeSpy as never,
  invalidateNodes: invalidateNodesSpy as never,
}) as never);

// No baseSettings needed — these tests skip mgr.start() and exercise
// only the post-Phase-6 paths (redoNode / invalidateNodes / focus).

describe('dheeCoreManager.redoNode (routes through the tracked runner)', () => {
  beforeEach(() => {
    regenerateNodeSpy.mockReset();
    invalidateNodesSpy.mockReset();
    dispatchSpy.mockReset();
    onSpy.mockClear();
    invalidateNodesSpy.mockResolvedValue({ invalidated: ['story'], notFound: [] });
    dispatchSpy.mockReturnValue({ status: 'started', taskId: 't-1' });
  });

  it('invalidates the node then dispatches a run_to through the BackgroundTaskRunner — NOT a direct (untracked) regenerateNode', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-1', 'Ruby V4', '/tmp/projects/Ruby_V4');

    const result = await mgr.redoNode('s-1', 'story');

    expect(result.ok).toBe(true);
    // Cheap invalidate first.
    expect(invalidateNodesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectDir: '/tmp/projects/Ruby_V4', nodeIds: ['story'] }),
    );
    // The render is dispatched through the runner so it's visible to
    // runnerStatus + cancellable — this is the whole fix.
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'run_to',
        projectName: 'Ruby_V4',
        params: expect.objectContaining({ projectDir: '/tmp/projects/Ruby_V4' }),
      }),
    );
    // It must NOT use the old untracked direct-run path.
    expect(regenerateNodeSpy).not.toHaveBeenCalled();
  });

  it('forwards itemId into the per-instance invalidation key', async () => {
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-2', 'Ruby V4', '/tmp/projects/Ruby_V4');

    await mgr.redoNode('s-2', 'shot_image', { itemId: 'scene_1_shot_3' });

    expect(invalidateNodesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ nodeIds: ['shot_image:scene_1_shot_3'] }),
    );
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it('works with an explicit projectDir + no session (the Inspector path)', async () => {
    const mgr = new dheeCoreManager();

    const result = await mgr.redoNode(undefined, 'story', { projectDir: '/tmp/projects/Ruby_V4' });

    expect(result.ok).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'run_to',
        params: expect.objectContaining({ projectDir: '/tmp/projects/Ruby_V4' }),
      }),
    );
  });

  it('returns a clear error when a run is already active (dispatch rejected) — does not silently no-op', async () => {
    dispatchSpy.mockReturnValue({
      status: 'rejected',
      reason: 'task_already_running',
      activeTaskId: 't-prev',
      activeTaskKind: 'run_to',
      activeProjectName: 'Ruby V4',
    });
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-3', 'Ruby V4', '/tmp/projects/Ruby_V4');

    const result = await mgr.redoNode('s-3', 'story');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already (running|active)/i);
  });

  it('errors clearly when called before the session has been focused on any project (no invalidate, no dispatch)', async () => {
    const mgr = new dheeCoreManager();

    const result = await mgr.redoNode('s-orphan', 'story');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no project focused/i);
    expect(invalidateNodesSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('aborts (no dispatch) when the invalidate step fails', async () => {
    invalidateNodesSpy.mockResolvedValue({ invalidated: [], notFound: [], error: 'boom' });
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-4', 'Ruby V4', '/tmp/projects/Ruby_V4');

    const result = await mgr.redoNode('s-4', 'story');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('dheeCoreManager.invalidateNodes (Phase 6 rewire)', () => {
  beforeEach(() => {
    regenerateNodeSpy.mockReset();
    invalidateNodesSpy.mockReset();
    invalidateNodesSpy.mockResolvedValue({ invalidated: ['story'], notFound: [] });
  });

  it('uses the focused projectDir and forwards (nodeIds, source) to dhee-core/dag.invalidateNodes', async () => {
    // No need to call mgr.start() — redoNode/invalidateNodes after
    // Phase 6 don't touch the embedded ConversationManager, they only
    // read sessionProjects + lazy-load the dag module.
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-3', 'Ruby V4', '/tmp/projects/Ruby_V4');

    const result = await mgr.invalidateNodes('s-3', ['story'], 'inspector-menu');

    expect(result).toEqual({ invalidated: ['story'], notFound: [] });
    expect(invalidateNodesSpy).toHaveBeenCalledWith({
      projectDir: '/tmp/projects/Ruby_V4',
      nodeIds: ['story'],
      source: 'inspector-menu',
    });
    // mgr.stop() not needed — nothing was started.
  });

  it('throws when called for a session that has never been focused on a project', async () => {
    // No need to call mgr.start() — redoNode/invalidateNodes after
    // Phase 6 don't touch the embedded ConversationManager, they only
    // read sessionProjects + lazy-load the dag module.
    const mgr = new dheeCoreManager();

    await expect(mgr.invalidateNodes('s-orphan', ['story'])).rejects.toThrow(/no project focused/i);
    expect(invalidateNodesSpy).not.toHaveBeenCalled();
    // mgr.stop() not needed — nothing was started.
  });
});
