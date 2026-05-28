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
__setRunnersLoader(async () => ({
  getBackgroundTaskRunner: () => ({
    cancel: () => true,
    getActive: () => null,
    isCancelling: () => false,
  }),
}));

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const regenerateNodeSpy = jest.fn<AnyAsync>();
const invalidateNodesSpy = jest.fn<AnyAsync>();
__setDagLoader(async () => ({
  regenerateNode: regenerateNodeSpy as never,
  invalidateNodes: invalidateNodesSpy as never,
}) as never);

// No baseSettings needed — these tests skip mgr.start() and exercise
// only the post-Phase-6 paths (redoNode / invalidateNodes / focus).

describe('dheeCoreManager.redoNode (Phase 6 rewire)', () => {
  beforeEach(() => {
    regenerateNodeSpy.mockReset();
    invalidateNodesSpy.mockReset();
    regenerateNodeSpy.mockResolvedValue({ ok: true, nodeId: 'story' });
    invalidateNodesSpy.mockResolvedValue({ invalidated: ['story'], notFound: [] });
  });

  it('looks up the focused projectDir for the session and forwards to dhee-core/dag.regenerateNode', async () => {
    // No need to call mgr.start() — redoNode/invalidateNodes after
    // Phase 6 don't touch the embedded ConversationManager, they only
    // read sessionProjects + lazy-load the dag module.
    const mgr = new dheeCoreManager();

    // Pretend the renderer told us this session is focused on /tmp/projects/Ruby_V4.
    await mgr.focusSessionProject('s-1', 'Ruby V4', '/tmp/projects/Ruby_V4');

    const result = await mgr.redoNode('s-1', 'story');

    expect(result.ok).toBe(true);
    expect(regenerateNodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: '/tmp/projects/Ruby_V4',
        nodeId: 'story',
      }),
    );

    // mgr.stop() not needed — nothing was started.
  });

  it('errors clearly when redoNode is called before the session has been focused on any project', async () => {
    // No need to call mgr.start() — redoNode/invalidateNodes after
    // Phase 6 don't touch the embedded ConversationManager, they only
    // read sessionProjects + lazy-load the dag module.
    const mgr = new dheeCoreManager();

    const result = await mgr.redoNode('s-orphan', 'story');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no project focused/i);
    expect(regenerateNodeSpy).not.toHaveBeenCalled();

    // mgr.stop() not needed — nothing was started.
  });

  it('forwards itemId for per-collection-item regeneration', async () => {
    // No need to call mgr.start() — redoNode/invalidateNodes after
    // Phase 6 don't touch the embedded ConversationManager, they only
    // read sessionProjects + lazy-load the dag module.
    const mgr = new dheeCoreManager();
    await mgr.focusSessionProject('s-2', 'Ruby V4', '/tmp/projects/Ruby_V4');

    await mgr.redoNode('s-2', 'shot_image', { itemId: 'scene_1_shot_3' });

    expect(regenerateNodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: '/tmp/projects/Ruby_V4',
        nodeId: 'shot_image',
        itemId: 'scene_1_shot_3',
      }),
    );
    // mgr.stop() not needed — nothing was started.
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
