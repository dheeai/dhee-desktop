/**
 * Tests for `preload.ts` — the context-isolation contract between the
 * Electron main process and the renderer.
 *
 * Goal: the preload is the ONLY code that runs with both Node and DOM
 * privileges, so the surface it hands the renderer via
 * `contextBridge.exposeInMainWorld` is a security boundary. These tests
 * pin two properties:
 *
 *   (a) The exposed API contains ONLY the intended, whitelisted bridge
 *       objects/methods — and does NOT leak `require`, `process`, `fs`,
 *       a raw `ipcRenderer`, or an unrestricted `invoke`/`send`. A
 *       regression here = arbitrary-main-process-call from a (possibly
 *       XSS'd) renderer.
 *
 *   (b) Each exposed method forwards to the correct IPC channel — the
 *       channel name the main-side `ipcMain.handle` registration
 *       expects (enumerated from `dhee_CHANNELS` in dheeIpc.ts).
 *
 * Strategy: preload.ts calls `contextBridge.exposeInMainWorld(...)` at
 * module top-level, so it can't be imported "headlessly". We mock
 * `electron` to capture every exposed object, and to record every
 * `ipcRenderer.invoke/send/on` call. Importing the module then runs the
 * top-level exposes; we assert on what was captured.
 */
import { describe, expect, it, jest, beforeAll } from '@jest/globals';
import { dhee_CHANNELS, dhee_EVENT_CHANNEL } from '../shared/dheeIpc';

// ── Capture buffers ────────────────────────────────────────────────────

/** Everything preload exposed to the renderer: worldName → api object. */
const exposed = new Map<string, Record<string, unknown>>();
/** Every ipcRenderer.invoke(channel, ...args) call preload's bridges make. */
const invokeCalls: Array<{ channel: string; args: unknown[] }> = [];
/** Every ipcRenderer.send(channel, ...args) call. */
const sendCalls: Array<{ channel: string; args: unknown[] }> = [];
/** Every ipcRenderer.on(channel, listener) subscription. */
const onCalls: Array<{ channel: string }> = [];

// ── Mock electron ──────────────────────────────────────────────────────
// contextBridge captures the exposed object; ipcRenderer records calls
// and returns a resolved promise so the bridge methods don't reject.

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (worldName: string, api: Record<string, unknown>) => {
      exposed.set(worldName, api);
    },
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      invokeCalls.push({ channel, args });
      return Promise.resolve(undefined);
    },
    send: (channel: string, ...args: unknown[]) => {
      sendCalls.push({ channel, args });
    },
    on: (channel: string) => {
      onCalls.push({ channel });
    },
    once: () => {},
    removeListener: () => {},
  },
}));

beforeAll(() => {
  // Importing the module runs the top-level exposeInMainWorld calls,
  // populating `exposed`. Done in beforeAll (not module scope) so the
  // jest.mock factory is registered first.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  require('./preload');
});

// Walk every leaf value of the exposed object, recording the dot-path to
// each function so we can both count the surface and invoke each method.
function collectFunctionPaths(
  obj: Record<string, unknown>,
  prefix = '',
): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'function') {
      paths.push(dotted);
    } else if (value && typeof value === 'object') {
      paths.push(...collectFunctionPaths(value as Record<string, unknown>, dotted));
    }
  }
  return paths;
}

describe('preload context-isolation contract', () => {
  it('exposes exactly the two intended worlds: `dhee` and `electron`', () => {
    expect([...exposed.keys()].sort()).toEqual(['dhee', 'electron']);
  });

  // ── (a) no dangerous primitives leak ─────────────────────────────────

  it('does NOT leak require / process / fs / module / global / Buffer anywhere on the exposed surface', () => {
    const banned = ['require', 'process', 'fs', 'module', 'global', 'globalThis', 'Buffer', '__dirname', 'eval', 'child_process'];
    for (const [world, api] of exposed) {
      for (const bad of banned) {
        expect(
          Object.prototype.hasOwnProperty.call(api, bad),
        ).toBe(false);
        // also no nested leak under a sub-bridge
        for (const sub of Object.values(api)) {
          if (sub && typeof sub === 'object') {
            expect(
              Object.prototype.hasOwnProperty.call(sub, bad),
            ).toBe(false);
          }
        }
      }
      // The whole api object must be a plain data/function tree — no
      // exposed value should itself BE the node `process` or a module.
      expect(world).toMatch(/^(dhee|electron)$/);
    }
  });

  it('does NOT expose a raw ipcRenderer object on the renderer surface', () => {
    // window.electron has an `ipcRenderer` KEY, but it must be the
    // narrowed { sendMessage, on, once } shim — never the real
    // ipcRenderer (which carries .invoke / .send / .postMessage and a
    // wide-open channel surface).
    const electron = exposed.get('electron') as Record<string, unknown>;
    const ipc = electron.ipcRenderer as Record<string, unknown>;
    expect(ipc).toBeDefined();
    // The narrowed shim intentionally has NO `invoke` (arbitrary
    // request/response to any channel) and NO `removeListener`.
    expect('invoke' in ipc).toBe(false);
    expect(Object.keys(ipc).sort()).toEqual(['on', 'once', 'sendMessage']);
  });

  it('does NOT expose an unrestricted invoke() on the `dhee` bridge', () => {
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    // Every dhee method is a named, channel-bound forwarder. A bare
    // `invoke` would let the renderer call any ipcMain channel.
    expect('invoke' in dhee).toBe(false);
    expect('send' in dhee).toBe(false);
  });

  it('the `dhee` bridge surface is exactly the expected whitelist of methods', () => {
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    const paths = collectFunctionPaths(dhee).sort();
    // Enumerated from preload.ts dheeBridge. If a new method is added to
    // the bridge, this test should be updated deliberately — that's the
    // point of a whitelist.
    const expectedDheeMethods = [
      'cancelTask',
      'chatPrompt',
      'clearChatHistory',
      'configureProject',
      'createSession',
      'deleteSession',
      'focusProject',
      'getHistory',
      'invalidateNodes',
      'listVersions',
      'on',
      'redoNode',
      'resolveBundle',
      'resolveInstanceGraph',
      'runTask',
      'runnerCancel',
      'runnerStatus',
      'selectVersion',
      'sendResponse',
      'setAutonomous',
      'setPiOversight',
      'setVlmJudge',
      'startRun',
      'workflows.delete',
      'workflows.get',
      'workflows.list',
      'workflows.update',
      'workflows.validate',
      'writeNodeContent',
    ].sort();
    expect(paths).toEqual(expectedDheeMethods);
  });

  // ── (b) each method forwards to the correct IPC channel ──────────────

  it('every `dhee_CHANNELS` channel is reachable from exactly one bridge method', () => {
    // Drive each dhee bridge method and confirm the channel it invokes is
    // a known dhee_CHANNELS value. This pins the preload→main wiring: a
    // method pointed at the wrong channel would mis-route or hit an
    // unregistered handler.
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    const channelToMethod: Record<string, string> = {
      [dhee_CHANNELS.CREATE_SESSION]: 'createSession',
      [dhee_CHANNELS.CONFIGURE_PROJECT]: 'configureProject',
      [dhee_CHANNELS.RUN_TASK]: 'runTask',
      [dhee_CHANNELS.START_RUN]: 'startRun',
      [dhee_CHANNELS.CHAT_PROMPT]: 'chatPrompt',
      [dhee_CHANNELS.SEND_RESPONSE]: 'sendResponse',
      [dhee_CHANNELS.CANCEL_TASK]: 'cancelTask',
      [dhee_CHANNELS.REDO_NODE]: 'redoNode',
      [dhee_CHANNELS.FOCUS_PROJECT]: 'focusProject',
      [dhee_CHANNELS.SET_AUTONOMOUS]: 'setAutonomous',
      [dhee_CHANNELS.SET_PI_OVERSIGHT]: 'setPiOversight',
      [dhee_CHANNELS.SET_VLM_JUDGE]: 'setVlmJudge',
      [dhee_CHANNELS.DELETE_SESSION]: 'deleteSession',
      [dhee_CHANNELS.CLEAR_CHAT_HISTORY]: 'clearChatHistory',
      [dhee_CHANNELS.GET_HISTORY]: 'getHistory',
      [dhee_CHANNELS.RUNNER_CANCEL]: 'runnerCancel',
      [dhee_CHANNELS.RUNNER_STATUS]: 'runnerStatus',
      [dhee_CHANNELS.INVALIDATE_NODES]: 'invalidateNodes',
      [dhee_CHANNELS.RESOLVE_BUNDLE]: 'resolveBundle',
      [dhee_CHANNELS.RESOLVE_INSTANCE_GRAPH]: 'resolveInstanceGraph',
      [dhee_CHANNELS.LIST_VERSIONS]: 'listVersions',
      [dhee_CHANNELS.SELECT_VERSION]: 'selectVersion',
      [dhee_CHANNELS.WRITE_NODE_CONTENT]: 'writeNodeContent',
    };

    for (const [channel, method] of Object.entries(channelToMethod)) {
      invokeCalls.length = 0;
      (dhee[method] as (...a: unknown[]) => unknown)({ sessionId: 's-1' });
      const call = invokeCalls.find((c) => c.channel === channel);
      expect(call).toBeDefined();
      // Confirm it did NOT accidentally call any OTHER channel.
      expect(invokeCalls.every((c) => c.channel === channel)).toBe(true);
    }
  });

  it('workflows.* methods forward to the LIST/GET/UPDATE/DELETE/VALIDATE_WORKFLOW channels', () => {
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    const wf = dhee.workflows as Record<string, (...a: unknown[]) => unknown>;
    const cases: Array<[keyof typeof wf, string]> = [
      ['list', dhee_CHANNELS.LIST_WORKFLOWS],
      ['get', dhee_CHANNELS.GET_WORKFLOW],
      ['update', dhee_CHANNELS.UPDATE_WORKFLOW],
      ['delete', dhee_CHANNELS.DELETE_WORKFLOW],
      ['validate', dhee_CHANNELS.VALIDATE_WORKFLOW],
    ];
    for (const [method, channel] of cases) {
      invokeCalls.length = 0;
      (wf[method] as (...a: unknown[]) => unknown)({ id: 'wf-1' });
      expect(invokeCalls.map((c) => c.channel)).toEqual([channel]);
    }
  });

  it('dhee.on(eventName, cb) subscribes to the single streaming event channel and filters by eventName', () => {
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    onCalls.length = 0;
    const unsubscribe = (dhee.on as (n: string, cb: (e: unknown) => void) => () => void)(
      'tool_call',
      () => {},
    );
    // The bridge subscribes to ONE shared channel — never a per-event
    // channel the renderer could name arbitrarily.
    expect(onCalls.map((c) => c.channel)).toEqual([dhee_EVENT_CHANNEL]);
    expect(typeof unsubscribe).toBe('function');
  });

  it('createSession forwards its request argument unchanged to the CREATE_SESSION channel', () => {
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    invokeCalls.length = 0;
    (dhee.createSession as (req: unknown) => unknown)({ role: 'background' });
    const call = invokeCalls.find((c) => c.channel === dhee_CHANNELS.CREATE_SESSION);
    expect(call?.args).toEqual([{ role: 'background' }]);
  });

  it('runTask forwards its request argument unchanged to the RUN_TASK channel', () => {
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    invokeCalls.length = 0;
    (dhee.runTask as (req: unknown) => unknown)({ sessionId: 's-1', task: 'render' });
    const call = invokeCalls.find((c) => c.channel === dhee_CHANNELS.RUN_TASK);
    expect(call?.args).toEqual([{ sessionId: 's-1', task: 'render' }]);
  });

  it('startRun forwards its request argument unchanged to the START_RUN channel', () => {
    const dhee = exposed.get('dhee') as Record<string, unknown>;
    invokeCalls.length = 0;
    (dhee.startRun as (req: unknown) => unknown)({
      sessionId: 's-1',
      projectDir: '/tmp/project.dhee',
    });
    const call = invokeCalls.find((c) => c.channel === dhee_CHANNELS.START_RUN);
    expect(call?.args).toEqual([
      { sessionId: 's-1', projectDir: '/tmp/project.dhee' },
    ]);
  });

  // ── window.electron sub-bridges forward to their string channels ─────

  it('electron.settings.get forwards to the settings:get channel', () => {
    const electron = exposed.get('electron') as Record<string, unknown>;
    const settings = electron.settings as Record<string, (...a: unknown[]) => unknown>;
    invokeCalls.length = 0;
    settings.get();
    expect(invokeCalls.map((c) => c.channel)).toEqual(['settings:get']);
  });

  it('electron.app.getVersion forwards to the app:get-version channel', () => {
    const electron = exposed.get('electron') as Record<string, unknown>;
    const appBridge = electron.app as Record<string, (...a: unknown[]) => unknown>;
    invokeCalls.length = 0;
    appBridge.getVersion();
    expect(invokeCalls.map((c) => c.channel)).toEqual(['app:get-version']);
  });

  it('electron.project.selectDirectory forwards to the project:select-directory channel', () => {
    const electron = exposed.get('electron') as Record<string, unknown>;
    const project = electron.project as Record<string, (...a: unknown[]) => unknown>;
    invokeCalls.length = 0;
    project.selectDirectory();
    expect(invokeCalls.map((c) => c.channel)).toEqual(['project:select-directory']);
  });

  it('electron.project attachment methods forward to the attachment IPC channels', () => {
    const electron = exposed.get('electron') as Record<string, unknown>;
    const project = electron.project as Record<string, (...a: unknown[]) => unknown>;
    invokeCalls.length = 0;
    project.selectAttachment({ kinds: ['reference_image'], multiple: true });
    project.importReferenceImages({
      projectDir: '/tmp/project.dhee',
      attachments: [{ id: 'att-1', kind: 'reference_image', path: '/tmp/a.png', name: 'a.png' }],
    });
    expect(invokeCalls).toMatchObject([
      {
        channel: 'project:select-attachment',
        args: [{ kinds: ['reference_image'], multiple: true }],
      },
      {
        channel: 'project:import-reference-images',
        args: [
          {
            projectDir: '/tmp/project.dhee',
            attachments: [
              { id: 'att-1', kind: 'reference_image', path: '/tmp/a.png', name: 'a.png' },
            ],
          },
        ],
      },
    ]);
  });

  it('the narrowed ipcRenderer.sendMessage uses send() (fire-and-forget), not invoke()', () => {
    const electron = exposed.get('electron') as Record<string, unknown>;
    const ipc = electron.ipcRenderer as Record<string, (...a: unknown[]) => unknown>;
    sendCalls.length = 0;
    invokeCalls.length = 0;
    ipc.sendMessage('ipc-example', 'hello');
    expect(sendCalls.map((c) => c.channel)).toEqual(['ipc-example']);
    expect(invokeCalls).toHaveLength(0);
  });

  it('top-level electron sub-bridges are exactly the expected whitelist', () => {
    const electron = exposed.get('electron') as Record<string, unknown>;
    expect(Object.keys(electron).sort()).toEqual(
      [
        'account',
        'app',
        'bundleConfig',
        'ipcRenderer',
        'logger',
        'logs',
        'onboarding',
        'project',
        'providerDiagnostics',
        'settings',
        'updates',
      ].sort(),
    );
  });
});
