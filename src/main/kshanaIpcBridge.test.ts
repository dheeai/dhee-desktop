/**
 * Tests for `kshanaIpcBridge` — the typed IPC layer that connects
 * `KshanaCoreManager` (main process) to the renderer.
 *
 * Goal: verify that
 *   1. each public method on KshanaCoreManager has a matching
 *      `ipcMain.handle(channel, …)` registration
 *   2. invoking the handler delegates correctly to the manager
 *   3. streaming events received from KshanaCoreManager via its
 *      eventCb are re-published on `webContents.send('kshana:event', …)`
 *   4. unknown event names don't crash the bridge
 *
 * The bridge is pure plumbing — these tests use a hand-rolled mock
 * for ipcMain (records handlers in a map) and a mock KshanaCoreManager
 * (records calls). No real Electron is needed.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  KSHANA_CHANNELS,
  KSHANA_EVENT_CHANNEL,
} from '../shared/kshanaIpc';

// ── Hand-rolled mocks ──────────────────────────────────────────────────

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlerRegistry = new Map<string, Handler>();
const sentEvents: Array<{ channel: string; payload: unknown }> = [];

const ipcMainMock = {
  handle: (channel: string, handler: Handler) => {
    handlerRegistry.set(channel, handler);
  },
  removeHandler: (channel: string) => {
    handlerRegistry.delete(channel);
  },
};

const webContentsMock = {
  send: (channel: string, payload: unknown) => {
    sentEvents.push({ channel, payload });
  },
};

const browserWindowMock = {
  webContents: webContentsMock,
};

jest.mock('electron', () => ({
  ipcMain: ipcMainMock,
  app: { isPackaged: false },
}));

// ── Mock KshanaCoreManager ─────────────────────────────────────────────

const managerCalls: Array<{ method: string; args: unknown[] }> = [];
let runTaskEventCb:
  | ((e: { eventName: string; sessionId: string; data: unknown }) => void)
  | null = null;

const fakeManager = {
  isStarted: () => true,
  createSession: () => {
    managerCalls.push({ method: 'createSession', args: [] });
    return 's-1';
  },
  configureSessionForProject: async (sessionId: string, opts: unknown) => {
    managerCalls.push({ method: 'configureSessionForProject', args: [sessionId, opts] });
  },
  runTask: async (
    sessionId: string,
    task: string,
    opts: unknown,
    eventCb: (e: { eventName: string; sessionId: string; data: unknown }) => void,
  ) => {
    managerCalls.push({ method: 'runTask', args: [sessionId, task, opts] });
    runTaskEventCb = eventCb;
    return { status: 'completed' };
  },
  cancelTask: (sessionId: string) => {
    managerCalls.push({ method: 'cancelTask', args: [sessionId] });
    return sessionId === 's-1';
  },
  redoNode: async (sessionId: string, nodeId: string, opts: unknown) => {
    managerCalls.push({ method: 'redoNode', args: [sessionId, nodeId, opts] });
    return { ok: true };
  },
  focusSessionProject: async (sessionId: string, projectName: string) => {
    managerCalls.push({ method: 'focusSessionProject', args: [sessionId, projectName] });
    return { ok: true as const };
  },
  setAutonomousMode: (sessionId: string, enabled: boolean) => {
    managerCalls.push({ method: 'setAutonomousMode', args: [sessionId, enabled] });
  },
  deleteSession: (sessionId: string) => {
    managerCalls.push({ method: 'deleteSession', args: [sessionId] });
  },
  invalidateNodes: async (sessionId: string, nodeIds: string[]) => {
    managerCalls.push({ method: 'invalidateNodes', args: [sessionId, nodeIds] });
    if (sessionId === 'boom') throw new Error('forced failure');
    return { invalidated: nodeIds, notFound: [] as string[] };
  },
};

beforeEach(() => {
  handlerRegistry.clear();
  sentEvents.length = 0;
  managerCalls.length = 0;
  runTaskEventCb = null;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const { registerKshanaIpcBridge } = require('./kshanaIpcBridge') as typeof import('./kshanaIpcBridge');

describe('kshanaIpcBridge', () => {
  it('registers a handler for every channel in KSHANA_CHANNELS', () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    for (const channel of Object.values(KSHANA_CHANNELS)) {
      expect(handlerRegistry.has(channel)).toBe(true);
    }
  });

  it('createSession channel returns the session id from the manager', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.CREATE_SESSION)!;
    const result = await handler({} as never);
    expect(result).toEqual({ sessionId: 's-1' });
  });

  it('runTask channel forwards (sessionId, task, opts) to KshanaCoreManager.runTask', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.RUN_TASK)!;
    await handler({} as never, { sessionId: 's-1', task: 'hi', stopAtStage: 'shot_image' });
    const call = managerCalls.find((c) => c.method === 'runTask');
    expect(call).toBeDefined();
    expect(call?.args[0]).toBe('s-1');
    expect(call?.args[1]).toBe('hi');
    expect(call?.args[2]).toMatchObject({ stopAtStage: 'shot_image' });
  });

  it('runTask routes events from manager.eventCb to webContents.send(KSHANA_EVENT_CHANNEL, …)', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.RUN_TASK)!;
    await handler({} as never, { sessionId: 's-1', task: 'hi' });
    expect(runTaskEventCb).not.toBeNull();
    runTaskEventCb!({
      eventName: 'tool_call',
      sessionId: 's-1',
      data: { toolName: 'kshana_run_to', toolCallId: 'tc-1', arguments: {} },
    });
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]?.channel).toBe(KSHANA_EVENT_CHANNEL);
    expect(sentEvents[0]?.payload).toMatchObject({
      eventName: 'tool_call',
      sessionId: 's-1',
    });
  });

  it('cancelTask channel returns the boolean from manager.cancelTask', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.CANCEL_TASK)!;
    expect(await handler({} as never, { sessionId: 's-1' })).toEqual({ cancelled: true });
    expect(await handler({} as never, { sessionId: 'unknown' })).toEqual({ cancelled: false });
  });

  it('invalidateNodes channel forwards (sessionId, nodeIds) and returns the manager result', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.INVALIDATE_NODES)!;
    const result = await handler({} as never, {
      sessionId: 's-1',
      nodeIds: ['shot_image:scene_1_shot_2'],
    });
    expect(result).toEqual({
      ok: true,
      invalidated: ['shot_image:scene_1_shot_2'],
      notFound: [],
    });
    const call = managerCalls.find((c) => c.method === 'invalidateNodes');
    expect(call?.args).toEqual(['s-1', ['shot_image:scene_1_shot_2']]);
  });

  it('invalidateNodes wraps manager errors in { ok: false, error }', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.INVALIDATE_NODES)!;
    const result = (await handler({} as never, {
      sessionId: 'boom',
      nodeIds: ['x'],
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/forced failure/);
  });

  it('redoNode channel forwards editedPrompt unchanged', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.REDO_NODE)!;
    await handler({} as never, {
      sessionId: 's-1',
      nodeId: 'shot_image:scene_1_shot_4',
      editedPrompt: 'new prompt',
    });
    const call = managerCalls.find((c) => c.method === 'redoNode');
    expect(call?.args[1]).toBe('shot_image:scene_1_shot_4');
    expect((call?.args[2] as { editedPrompt: string }).editedPrompt).toBe('new prompt');
  });

  it('configureProject channel returns { ok: true } on success', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(KSHANA_CHANNELS.CONFIGURE_PROJECT)!;
    const result = await handler({} as never, {
      sessionId: 's-1',
      projectDir: '/path/to/project',
      templateId: 'narrative',
    });
    expect(result).toEqual({ ok: true });
  });

  it('focusProject sets KSHANA_PROJECTS_DIR to dirname(projectDir) so kshana-ink looks in the right place', async () => {
    // Real desktop scenario: user opens
    //   /Users/foo/MyVideos/storyA.kshana
    // The bridge must update KSHANA_PROJECTS_DIR=/Users/foo/MyVideos/
    // so the embedded core's project.json read resolves correctly.
    delete process.env['KSHANA_PROJECTS_DIR'];
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const focusHandler = handlerRegistry.get(KSHANA_CHANNELS.FOCUS_PROJECT)!;
    const focusResult = await focusHandler({} as never, {
      sessionId: 's-1',
      projectName: 'storyA',
      projectDir: '/Users/foo/MyVideos/storyA.kshana',
    });
    expect(process.env['KSHANA_PROJECTS_DIR']).toBe('/Users/foo/MyVideos');
    expect(focusResult).toEqual({ ok: true });
  });

  it('focusProject without projectDir leaves KSHANA_PROJECTS_DIR untouched (backwards-compat)', async () => {
    process.env['KSHANA_PROJECTS_DIR'] = '/preset/dir';
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const focusHandler = handlerRegistry.get(KSHANA_CHANNELS.FOCUS_PROJECT)!;
    await focusHandler({} as never, { sessionId: 's-1', projectName: 'storyA' });
    expect(process.env['KSHANA_PROJECTS_DIR']).toBe('/preset/dir');
  });

  it('handler invocations are isolated — calls do not leak between channels', async () => {
    registerKshanaIpcBridge(
      fakeManager as unknown as import('./kshanaCoreManager').KshanaCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const focusHandler = handlerRegistry.get(KSHANA_CHANNELS.FOCUS_PROJECT)!;
    const setAutoHandler = handlerRegistry.get(KSHANA_CHANNELS.SET_AUTONOMOUS)!;
    await focusHandler({} as never, { sessionId: 's-1', projectName: 'parvati' });
    await setAutoHandler({} as never, { sessionId: 's-1', enabled: true });
    expect(managerCalls.find((c) => c.method === 'focusSessionProject')).toBeDefined();
    expect(managerCalls.find((c) => c.method === 'setAutonomousMode')).toBeDefined();
  });
});
