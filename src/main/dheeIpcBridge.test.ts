/**
 * Tests for `dheeIpcBridge` — the typed IPC layer that connects
 * `dheeCoreManager` (main process) to the renderer.
 *
 * Goal: verify that
 *   1. each public method on dheeCoreManager has a matching
 *      `ipcMain.handle(channel, …)` registration
 *   2. invoking the handler delegates correctly to the manager
 *   3. streaming events received from dheeCoreManager via its
 *      eventCb are re-published on `webContents.send('dhee:event', …)`
 *   4. unknown event names don't crash the bridge
 *
 * The bridge is pure plumbing — these tests use a hand-rolled mock
 * for ipcMain (records handlers in a map) and a mock dheeCoreManager
 * (records calls). No real Electron is needed.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  dhee_CHANNELS,
  dhee_EVENT_CHANNEL,
} from '../shared/dheeIpc';

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

// ── Mock dheeCoreManager ─────────────────────────────────────────────

const managerCalls: Array<{ method: string; args: unknown[] }> = [];
let runTaskEventCb:
  | ((e: { eventName: string; sessionId: string; data: unknown }) => void)
  | null = null;
let startRunEventCb:
  | ((e: { eventName: string; sessionId: string; data: unknown }) => void)
  | null = null;
let chatPromptEventCb:
  | ((e: { eventName: string; sessionId: string; data: unknown }) => void)
  | null = null;

const fakeManager = {
  isStarted: () => true,
  createSession: (role?: string, resumeSessionId?: string) => {
    managerCalls.push({ method: 'createSession', args: [role, resumeSessionId] });
    return { id: 's-1', resumed: false };
  },
  getSessionHistorySnapshot: (sessionId: string) => {
    managerCalls.push({ method: 'getSessionHistorySnapshot', args: [sessionId] });
    return null;
  },
  clearChatHistory: (sessionId: string, role?: string) => {
    managerCalls.push({ method: 'clearChatHistory', args: [sessionId, role] });
    return { newSessionId: 's-2' };
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
  startRun: async (
    sessionId: string,
    opts: unknown,
    eventCb: (e: { eventName: string; sessionId: string; data: unknown }) => void,
  ) => {
    managerCalls.push({ method: 'startRun', args: [sessionId, opts] });
    startRunEventCb = eventCb;
    return { ok: true, taskId: 'task-started' };
  },
  chatPrompt: async (
    sessionId: string,
    message: string,
    eventCb: (e: { eventName: string; sessionId: string; data: unknown }) => void,
  ) => {
    managerCalls.push({ method: 'chatPrompt', args: [sessionId, message] });
    chatPromptEventCb = eventCb;
    return { ok: true, assistant_text: 'ok' };
  },
  cancelTask: (sessionId: string) => {
    managerCalls.push({ method: 'cancelTask', args: [sessionId] });
    return sessionId === 's-1';
  },
  cancelBackgroundTask: async (projectDir?: string) => {
    managerCalls.push({ method: 'cancelBackgroundTask', args: [projectDir] });
    return projectDir === '/tmp/project-a.dhee';
  },
  getBackgroundTaskStatus: () => {
    managerCalls.push({ method: 'getBackgroundTaskStatus', args: [] });
    return { active: true, projectDir: '/tmp/project-a.dhee' };
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
  startRunEventCb = null;
  chatPromptEventCb = null;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const { registerdheeIpcBridge } = require('./dheeIpcBridge') as typeof import('./dheeIpcBridge');

describe('dheeIpcBridge', () => {
  it('registers a handler for every channel in dhee_CHANNELS', () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    for (const channel of Object.values(dhee_CHANNELS)) {
      expect(handlerRegistry.has(channel)).toBe(true);
    }
  });

  it('createSession channel returns the session id from the manager', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.CREATE_SESSION)!;
    const result = await handler({} as never);
    expect(result).toEqual({ sessionId: 's-1', resumed: false });
  });

  it('runTask channel forwards (sessionId, task, opts) to dheeCoreManager.runTask', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.RUN_TASK)!;
    await handler({} as never, { sessionId: 's-1', task: 'hi', stopAtStage: 'shot_image' });
    const call = managerCalls.find((c) => c.method === 'runTask');
    expect(call).toBeDefined();
    expect(call?.args[0]).toBe('s-1');
    expect(call?.args[1]).toBe('hi');
    expect(call?.args[2]).toMatchObject({ stopAtStage: 'shot_image' });
  });

  it('startRun channel forwards sessionId and projectDir, returning the runner task id', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.START_RUN)!;
    const result = await handler({} as never, {
      sessionId: 's-1',
      projectDir: '/tmp/project-a.dhee',
      stopAtStage: 'scene_clip',
    });
    expect(result).toEqual({ ok: true, taskId: 'task-started' });
    const call = managerCalls.find((c) => c.method === 'startRun');
    expect(call?.args[0]).toBe('s-1');
    expect(call?.args[1]).toEqual({
      projectDir: '/tmp/project-a.dhee',
      stopAtStage: 'scene_clip',
    });
    expect(startRunEventCb).not.toBeNull();
  });

  it('startRun channel forwards runner rejection errors', async () => {
    const manager = {
      ...fakeManager,
      startRun: async (sessionId: string, opts: unknown) => {
        managerCalls.push({ method: 'startRunRejected', args: [sessionId, opts] });
        return { ok: false, error: 'task already running on project' };
      },
    };
    registerdheeIpcBridge(
      manager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.START_RUN)!;
    const result = await handler({} as never, {
      sessionId: 's-1',
      projectDir: '/tmp/project-a.dhee',
    });
    expect(result).toEqual({
      ok: false,
      error: 'task already running on project',
    });
  });

  it('runTask forwards projectDir attachments as structured task hints', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.RUN_TASK)!;
    await handler({} as never, {
      sessionId: 's-1',
      task: 'use these',
      projectDir: '/tmp/project-a.dhee',
      attachments: [
        {
          id: 'att-1',
          kind: 'reference_image',
          path: '/tmp/project-a.dhee/assets/uploads/characters/hero.png',
          name: 'hero.png',
          meta: {
            purpose: 'character_ref',
            referenceRole: 'character',
            projectRelativePath: 'assets/uploads/characters/hero.png',
          },
        },
      ],
    });
    const call = managerCalls.find((c) => c.method === 'runTask');
    expect(call?.args[1]).toContain('use these');
    expect(call?.args[1]).toContain('Attached character reference images:');
    expect(call?.args[1]).toContain('hero.png: assets/uploads/characters/hero.png');
  });

  it('chatPrompt forwards projectDir attachments through the same media hint path', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.CHAT_PROMPT)!;
    await handler({} as never, {
      sessionId: 's-1',
      message: 'replace hero',
      projectDir: '/tmp/project-a.dhee',
      attachments: [
        {
          id: 'att-1',
          kind: 'reference_image',
          path: '/tmp/project-a.dhee/assets/uploads/characters/hero.png',
          name: 'hero.png',
          meta: {
            purpose: 'character_ref',
            referenceRole: 'character',
            projectRelativePath: 'assets/uploads/characters/hero.png',
          },
        },
      ],
    });
    const call = managerCalls.find((c) => c.method === 'chatPrompt');
    expect(call?.args[0]).toBe('s-1');
    expect(call?.args[1]).toContain('replace hero');
    expect(call?.args[1]).toContain('Attached character reference images:');
    expect(chatPromptEventCb).not.toBeNull();
  });

  it('runTask routes events from manager.eventCb to webContents.send(dhee_EVENT_CHANNEL, …)', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.RUN_TASK)!;
    await handler({} as never, { sessionId: 's-1', task: 'hi' });
    expect(runTaskEventCb).not.toBeNull();
    runTaskEventCb!({
      eventName: 'tool_call',
      sessionId: 's-1',
      data: { toolName: 'dhee_run_to', toolCallId: 'tc-1', arguments: {} },
    });
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]?.channel).toBe(dhee_EVENT_CHANNEL);
    expect(sentEvents[0]?.payload).toMatchObject({
      eventName: 'tool_call',
      sessionId: 's-1',
    });
  });

  it('cancelTask channel returns the boolean from manager.cancelTask', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.CANCEL_TASK)!;
    expect(await handler({} as never, { sessionId: 's-1' })).toEqual({ cancelled: true });
    expect(await handler({} as never, { sessionId: 'unknown' })).toEqual({ cancelled: false });
  });

  it('runnerCancel forwards optional projectDir to the manager', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.RUNNER_CANCEL)!;
    expect(await handler({} as never, { projectDir: '/tmp/project-a.dhee' })).toEqual({ cancelled: true });
    const call = managerCalls.find((c) => c.method === 'cancelBackgroundTask');
    expect(call?.args).toEqual(['/tmp/project-a.dhee']);
  });

  it('runnerStatus includes the manager projectDir field', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.RUNNER_STATUS)!;
    expect(await handler({} as never)).toEqual({
      active: true,
      projectDir: '/tmp/project-a.dhee',
    });
  });

  it('invalidateNodes channel forwards (sessionId, nodeIds) and returns the manager result', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.INVALIDATE_NODES)!;
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

  it('getHistory channel returns the on-disk snapshot for a sessionId', async () => {
    // Override getSessionHistorySnapshot to return a sample snapshot
    // for this single test.
    const sample = {
      messages: [
        { id: 'm-1', type: 'user' as const, content: 'hi', timestamp: 1 },
      ],
      toolCalls: [],
      compactionCount: 0,
    };
    const manager = {
      ...fakeManager,
      getSessionHistorySnapshot: (sessionId: string, projectDir?: string) => {
        managerCalls.push({ method: 'getSessionHistorySnapshot', args: [sessionId, projectDir] });
        return sample;
      },
    };
    registerdheeIpcBridge(
      manager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.GET_HISTORY)!;
    const result = await handler({} as never, {
      sessionId: 's-1',
      projectDir: '/tmp/project-a',
    });
    expect(result).toEqual({ sessionId: 's-1', history: sample });
    const call = managerCalls.find((c) => c.method === 'getSessionHistorySnapshot');
    expect(call?.args).toEqual(['s-1', '/tmp/project-a']);
  });

  it('getHistory returns { history: null } when the on-disk snapshot is empty (avoids re-seeding empty state)', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.GET_HISTORY)!;
    const result = await handler({} as never, { sessionId: 's-1' });
    expect(result).toEqual({ sessionId: 's-1', history: null });
  });

  it('invalidateNodes wraps manager errors in { ok: false, error }', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.INVALIDATE_NODES)!;
    const result = (await handler({} as never, {
      sessionId: 'boom',
      nodeIds: ['x'],
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/forced failure/);
  });

  it('redoNode channel forwards editedPrompt unchanged', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.REDO_NODE)!;
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
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const handler = handlerRegistry.get(dhee_CHANNELS.CONFIGURE_PROJECT)!;
    const result = await handler({} as never, {
      sessionId: 's-1',
      projectDir: '/path/to/project',
      templateId: 'narrative',
    });
    expect(result).toEqual({ ok: true });
  });

  it('focusProject sets dhee_PROJECTS_DIR to dirname(projectDir) so dhee-ink looks in the right place', async () => {
    // Real desktop scenario: user opens
    //   /Users/foo/MyVideos/storyA.dhee
    // The bridge must update dhee_PROJECTS_DIR=/Users/foo/MyVideos/
    // so the embedded core's project.json read resolves correctly.
    delete process.env['dhee_PROJECTS_DIR'];
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const focusHandler = handlerRegistry.get(dhee_CHANNELS.FOCUS_PROJECT)!;
    const focusResult = await focusHandler({} as never, {
      sessionId: 's-1',
      projectName: 'storyA',
      projectDir: '/Users/foo/MyVideos/storyA.dhee',
    });
    expect(process.env['dhee_PROJECTS_DIR']).toBe('/Users/foo/MyVideos');
    expect(focusResult).toEqual({ ok: true });
  });

  it('focusProject without projectDir leaves dhee_PROJECTS_DIR untouched (backwards-compat)', async () => {
    process.env['dhee_PROJECTS_DIR'] = '/preset/dir';
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const focusHandler = handlerRegistry.get(dhee_CHANNELS.FOCUS_PROJECT)!;
    await focusHandler({} as never, { sessionId: 's-1', projectName: 'storyA' });
    expect(process.env['dhee_PROJECTS_DIR']).toBe('/preset/dir');
  });

  it('handler invocations are isolated — calls do not leak between channels', async () => {
    registerdheeIpcBridge(
      fakeManager as unknown as import('./dheeCoreManager').dheeCoreManager,
      browserWindowMock as unknown as import('electron').BrowserWindow,
    );
    const focusHandler = handlerRegistry.get(dhee_CHANNELS.FOCUS_PROJECT)!;
    const setAutoHandler = handlerRegistry.get(dhee_CHANNELS.SET_AUTONOMOUS)!;
    await focusHandler({} as never, { sessionId: 's-1', projectName: 'parvati' });
    await setAutoHandler({} as never, { sessionId: 's-1', enabled: true });
    expect(managerCalls.find((c) => c.method === 'focusSessionProject')).toBeDefined();
    expect(managerCalls.find((c) => c.method === 'setAutonomousMode')).toBeDefined();
  });
});
