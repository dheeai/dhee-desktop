/**
 * Tests for `KshanaCoreManager` — the main-process owner of the
 * embedded `ConversationManager`.
 *
 * Goal: verify the manager translates AppSettings into env vars
 * BEFORE constructing ConversationManager, forwards every
 * ConversationEvents callback to the supplied event sink, and cleans
 * up correctly on stop()/restart().
 *
 * Strategy: mock `kshana-ink/manager` with a fake ConversationManager
 * whose runTask synchronously invokes provided ConversationEvents
 * callbacks. The mock records construction order so we can assert
 * env vars were set before the constructor ran.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { AppSettings } from '../shared/settingsTypes';

// ── Track construction order: each call to `new ConversationManager()`
// snapshots the relevant env vars at that moment. The test uses these
// snapshots to confirm the manager set env BEFORE construction.
const mockState: {
  envSnapshots: Array<Record<string, string | undefined>>;
  shutdownCalls: number;
  lastInstance: FakeConversationManager | null;
} = {
  envSnapshots: [],
  shutdownCalls: 0,
  lastInstance: null,
};

class FakeConversationManager {
  sessions = new Map<string, { id: string }>();

  constructor(_config: unknown) {
    mockState.envSnapshots.push({
      LLM_PROVIDER: process.env['LLM_PROVIDER'],
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
      COMFYUI_BASE_URL: process.env['COMFYUI_BASE_URL'],
      KSHANA_PROJECT_DIR: process.env['KSHANA_PROJECT_DIR'],
    });
    mockState.lastInstance = this;
  }

  createSession(_mode: 'local' | 'remote' = 'local') {
    const sessionId = `s-${this.sessions.size + 1}`;
    this.sessions.set(sessionId, { id: sessionId });
    return { id: sessionId, status: 'idle', taskHistory: [], lastActivity: Date.now() };
  }

  async configureSessionForProject(_sessionId: string, _opts: unknown) {
    // No-op in the mock
  }

  // The fake runTask invokes a couple of representative callbacks
  // synchronously so the test can assert the bridge wires them.
  // Signatures match the real ConversationEvents shape.
  async runTask(
    _sessionId: string,
    _task: string,
    events?: {
      onToolCall?: (sessionId: string, toolCallId: string, toolName: string, args: Record<string, unknown>, agentName?: string) => void;
      onAgentText?: (sessionId: string, text: string, isFinal: boolean) => void;
    },
  ) {
    events?.onToolCall?.('s-1', 'tc-1', 'kshana_run_to', { project: 'p1' });
    events?.onAgentText?.('s-1', 'done', true);
    return { status: 'completed' as const, output: 'done', todos: [] };
  }

  async redoNode(
    _sessionId: string,
    nodeId: string,
    opts?: { editedPrompt?: string },
  ) {
    return { ok: true, nodeId, editedPrompt: opts?.editedPrompt };
  }

  cancelTask(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  shutdown(): void {
    mockState.shutdownCalls += 1;
  }

  // No-ops for the rest of the surface
  setAutonomousMode(_sessionId: string, _enabled: boolean): void {}
  async focusSessionProject(_sessionId: string, _project: string): Promise<void> {}
  deleteSession(_sessionId: string): void {}
}

jest.mock('electron', () => ({
  app: { isPackaged: false },
}));

// Imported AFTER the jest.mock calls so the mock binds.
// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const { KshanaCoreManager, __setManagerLoader } = require('./kshanaCoreManager') as typeof import('./kshanaCoreManager');

// Inject the FakeConversationManager via the loader seam — production code
// uses a `webpackIgnore` dynamic import to load the real ESM bundle;
// tests bypass that by substituting the loader.
// FakeConversationManager only implements the surface KshanaCoreManager
// calls. Cast through `unknown` to skip TS structural checks against
// the real ConversationManager class — the production facade only
// touches the methods the fake provides.
// graceful-fs's process.chdir polyfill validates the target path with
// fs.realpathSync, so the fakes must point to existing directories.
// Use the home dir and the os tmpdir — both always exist and are
// distinct on every platform Jest runs on.
import os from 'os';
const FAKE_INK_ROOT = os.homedir();
const FAKE_PROJECTS_DIR = os.tmpdir();
const mockLoadDevEnv = jest.fn(() => ({
  loaded: false,
  path: null,
  vars: [] as string[],
  root: FAKE_INK_ROOT,
  projectsDir: FAKE_PROJECTS_DIR,
}));
__setManagerLoader(async () => ({
  ConversationManager: FakeConversationManager,
  loadDevEnv: mockLoadDevEnv,
} as unknown as Parameters<typeof __setManagerLoader>[0] extends () => Promise<infer M> ? M : never));

const baseSettings: AppSettings = {
  backendMode: 'local',
  llmBackend: 'local',
  comfyBackend: 'local',
  vlmBackend: 'local' as const,
  comfyuiMode: 'inherit',
  comfyuiUrl: '',
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai',
  lmStudioUrl: 'http://127.0.0.1:1234',
  lmStudioModel: 'qwen3',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: 'sk-test',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  openRouterApiKey: '',
  openRouterModel: 'z-ai/glm-4.7-flash',
  themeId: 'studio-neutral',
  piOversight: true,
  vlmJudge: true,
  vlmProvider: 'openai',
  vlmBaseUrl: '',
  vlmApiKey: '',
  vlmModel: '',
  llmUseSameForAllTiers: true,
  llmTierMedium: {
    provider: 'openai',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
  },
  llmTierLight: {
    provider: 'openai',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
  },
};

beforeEach(() => {
  mockState.envSnapshots = [];
  mockState.shutdownCalls = 0;
  mockState.lastInstance = null;
  delete process.env['LLM_PROVIDER'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['OPENAI_BASE_URL'];
  delete process.env['OPENAI_MODEL'];
  delete process.env['KSHANA_CLOUD'];
  delete process.env['KSHANA_CLOUD_URL'];
  delete process.env['LLM_CONTEXT_TOKENS'];
  delete process.env['COMFY_MODE'];
  delete process.env['COMFY_CLOUD_API_KEY'];
  delete process.env['COMFYUI_BASE_URL'];
  delete process.env['COMFYUI_TIMEOUT'];
  delete process.env['KSHANA_PROJECT_DIR'];
  delete process.env['GOOGLE_API_KEY'];
  delete process.env['GEMINI_MODEL'];
  delete process.env['VLM_PROVIDER'];
  delete process.env['VLM_BASE_URL'];
  delete process.env['VLM_API_KEY'];
  delete process.env['VLM_MODEL'];
  delete process.env['LLM_ROUTING_ENABLED'];
  for (const tier of ['HEAVY', 'MEDIUM', 'LIGHT']) {
    for (const k of ['PROVIDER', 'API_KEY', 'MODEL', 'BASE_URL']) {
      delete process.env[`LLM_TIER_${tier}_${k}`];
    }
  }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LLM_PURPOSE__')) delete process.env[k];
  }
});

describe('KshanaCoreManager', () => {
  it('start() writes LLM_PROVIDER and OPENAI_API_KEY to process.env BEFORE constructing ConversationManager', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);

    expect(mockState.envSnapshots).toHaveLength(1);
    expect(mockState.envSnapshots[0]?.LLM_PROVIDER).toBe('openai');
    expect(mockState.envSnapshots[0]?.OPENAI_API_KEY).toBe('sk-test');
  });

  // ── Mode-routing tests ──────────────────────────────────────────────
  // These pin the env shape kshana-core sees for each ComfyUI mode the
  // user can be in. Three paths matter:
  //   1. Kshana Cloud signed in → COMFYUI_BASE_URL=<websiteUrl>/comfy/api
  //      (covered by the test below).
  //   2. Local ComfyUI, no cloud auth → COMFYUI_BASE_URL=<user's local url>,
  //      COMFY_MODE='local', no COMFY_CLOUD_API_KEY.
  //   3. Direct ComfyUI Cloud (cloud.comfy.org) with the user's own key,
  //      no Kshana auth → COMFY_MODE='cloud', COMFY_CLOUD_API_KEY=user key.
  //
  // The "wait, why is it hitting localhost:3000" bug we hit in the wild
  // happened because path 1 silently overrides paths 2 and 3 — the user
  // had cloud.comfy.org configured in settings but was also signed in,
  // so the override won. These tests document the precedence.

  it('local mode: routes COMFYUI_BASE_URL to the user-configured local URL with COMFY_MODE=local', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      comfyuiMode: 'custom',
      comfyuiUrl: 'http://127.0.0.1:8188',
      comfyCloudApiKey: '',
    });

    expect(process.env['COMFY_MODE']).toBe('local');
    expect(process.env['COMFYUI_BASE_URL']).toBe('http://127.0.0.1:8188');
    // No cloud key should leak into a local-mode start.
    expect(process.env['COMFY_CLOUD_API_KEY']).toBeUndefined();
    // Kshana Cloud env is absent — no signed-in token in this scenario.
    expect(process.env['KSHANA_CLOUD']).toBeUndefined();
    expect(process.env['KSHANA_CLOUD_URL']).toBeUndefined();
  });

  it('local mode: COMFYUI_BASE_URL is in process.env BEFORE ConversationManager constructs (env-set order matters for kshana-core caching)', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      comfyuiMode: 'custom',
      comfyuiUrl: 'http://127.0.0.1:8188',
      comfyCloudApiKey: '',
    });

    expect(mockState.envSnapshots).toHaveLength(1);
    // The snapshot is captured inside the FakeConversationManager
    // constructor — proves env was written *before* construction.
    expect(mockState.envSnapshots[0]?.COMFYUI_BASE_URL).toBe('http://127.0.0.1:8188');
  });

  it('direct cloud mode (no Kshana auth): routes to user-configured cloud.comfy.org with the user-supplied key', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      comfyuiMode: 'custom',
      comfyuiUrl: 'https://cloud.comfy.org/api',
      comfyCloudApiKey: 'user-supplied-comfy-key',
    });

    expect(process.env['COMFY_MODE']).toBe('cloud');
    expect(process.env['COMFYUI_BASE_URL']).toBe('https://cloud.comfy.org/api');
    expect(process.env['COMFY_CLOUD_API_KEY']).toBe('user-supplied-comfy-key');
    // Without a cloudAuth runtime, the Kshana Cloud override path
    // must NOT fire — the user's settings win.
    expect(process.env['KSHANA_CLOUD']).toBeUndefined();
    expect(process.env['KSHANA_CLOUD_URL']).toBeUndefined();
  });

  it('Kshana Cloud auth overrides user comfyuiUrl: signed-in token wins over a local-mode setting', async () => {
    // The user has a local ComfyUI URL configured AND a valid Kshana
    // Cloud session. Today the cloud override silently takes
    // precedence — pin that behavior so a future refactor that
    // changes precedence (e.g. respecting comfyuiMode='custom' over
    // cloudAuth) trips this test and prompts a deliberate decision.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        comfyBackend: 'cloud',
  vlmBackend: 'local' as const,
        backendMode: 'cloud',
        comfyuiMode: 'custom',
        comfyuiUrl: 'http://127.0.0.1:8188',
        comfyCloudApiKey: 'ignored-when-cloud-auth-present',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    // Cloud override wins — local URL is ignored when comfyBackend='cloud'.
    expect(process.env['COMFY_MODE']).toBe('cloud');
    expect(process.env['COMFYUI_BASE_URL']).toBe(
      'https://desktop.example.test/comfy/api',
    );
    expect(process.env['COMFY_CLOUD_API_KEY']).toBe('desktop-jwt');
  });

  it('Kshana Cloud auth sets ComfyUI proxy env when comfyBackend=cloud (signed-in users get cloud ComfyUI when they opt in)', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(
      { ...baseSettings, comfyBackend: 'cloud',
  vlmBackend: 'local' as const, backendMode: 'cloud' },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    // Cloud-only env: identity + ComfyUI proxy. LLM is intentionally
    // absent — the Settings panel is the canonical LLM source.
    expect(process.env['KSHANA_CLOUD']).toBe('true');
    expect(process.env['KSHANA_CLOUD_URL']).toBe('https://desktop.example.test');
    expect(process.env['COMFY_MODE']).toBe('cloud');
    expect(process.env['COMFYUI_BASE_URL']).toBe(
      'https://desktop.example.test/comfy/api',
    );
    expect(process.env['COMFY_CLOUD_API_KEY']).toBe('desktop-jwt');
    expect(process.env['COMFYUI_TIMEOUT']).toBe('1800');
    expect(process.env['KSHANA_PROXY_BASE_URL']).toBeUndefined();
    expect(process.env['KSHANA_CLOUD_TOKEN']).toBeUndefined();
    expect(process.env['COMFY_CLOUD_AUTH_TOKEN']).toBeUndefined();
  });

  it('llmBackend=local + comfyBackend=cloud: LLM stays Settings while ComfyUI routes to the cloud proxy', async () => {
    // Regression: pre-split, cloud auth shorted out the LLM as soon
    // as a token was present, regardless of what the user typed into
    // the LLM section. Result: an LM Studio user got their requests
    // sent to cloud. With per-lane gating, llmBackend='local' keeps
    // the user's Settings even while ComfyUI is on cloud.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        llmBackend: 'local',
        comfyBackend: 'cloud',
  vlmBackend: 'local' as const,
        backendMode: 'cloud',
        llmProvider: 'openai',
        openaiApiKey: 'lm-studio-placeholder',
        openaiBaseUrl: 'http://127.0.0.1:1234/v1',
        openaiModel: 'qwen3',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    expect(process.env['LLM_PROVIDER']).toBe('openai');
    expect(process.env['OPENAI_BASE_URL']).toBe('http://127.0.0.1:1234/v1');
    expect(process.env['OPENAI_API_KEY']).toBe('lm-studio-placeholder');
    expect(process.env['OPENAI_MODEL']).toBe('qwen3');
    expect(process.env['COMFY_MODE']).toBe('cloud');
    expect(process.env['COMFYUI_BASE_URL']).toBe(
      'https://desktop.example.test/comfy/api',
    );
  });

  it('GIVEN llmBackend=cloud + cloud auth + stale openai* settings WHEN start runs THEN cloud proxy URL/token win and settings.openai{BaseUrl,Model,ApiKey} are ignored', async () => {
    // Cloud mode owns the LLM routing end-to-end: the proxy URL,
    // bearer token, and model id all come from the cloud-auth
    // payload, not from Settings. The model field in particular
    // matters — a leftover local-mode model name (e.g.
    // "Qwen3.5-9B-HighIQ-Heretic" carried over from when the user
    // had LM Studio configured) must NOT ride along on the cloud
    // request, because the proxy maps model ids to credit pools
    // and an unknown id produces a billing-side 402 instead of
    // the intended cloud-default model.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        llmBackend: 'cloud',
        comfyBackend: 'cloud',
        vlmBackend: 'local' as const,
        backendMode: 'cloud',
        llmProvider: 'openai',
        openaiBaseUrl: 'https://kshana.share.zrok.io',
        openaiApiKey: 'should-be-ignored',
        openaiModel: 'Qwen3.5-9B-HighIQ-Heretic',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    expect(process.env['LLM_PROVIDER']).toBe('openai');
    expect(process.env['OPENAI_BASE_URL']).toBe(
      'https://desktop.example.test/openai/api/v1',
    );
    expect(process.env['OPENAI_API_KEY']).toBe('desktop-jwt');
    // Model is the cloud-default sentinel — NOT settings.openaiModel.
    expect(process.env['OPENAI_MODEL']).toBe('gpt-4o');
  });

  it('llmBackend=local + cloud auth: LLM stays on Settings (signed-in users on Local keep their proxy)', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        llmBackend: 'local',
        comfyBackend: 'local',
  vlmBackend: 'local' as const,
        backendMode: 'local',
        llmProvider: 'openai',
        openaiBaseUrl: 'http://127.0.0.1:1234/v1',
        openaiApiKey: 'lm-studio-placeholder',
        openaiModel: 'qwen3',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    expect(process.env['LLM_PROVIDER']).toBe('openai');
    expect(process.env['OPENAI_BASE_URL']).toBe('http://127.0.0.1:1234/v1');
    expect(process.env['OPENAI_API_KEY']).toBe('lm-studio-placeholder');
    expect(process.env['OPENAI_MODEL']).toBe('qwen3');
  });

  it('mixed: llmBackend=cloud + comfyBackend=local — LLM goes to cloud proxy, ComfyUI stays on the user-configured local URL', async () => {
    // The split-lane scenario the user asked for: route paid LLM
    // through the metered proxy while keeping ComfyUI on a
    // self-hosted GPU.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        llmBackend: 'cloud',
        comfyBackend: 'local',
  vlmBackend: 'local' as const,
        backendMode: 'cloud',
        llmProvider: 'openai',
        openaiModel: 'Qwen3.6-35B-A3B',
        comfyuiMode: 'custom',
        comfyuiUrl: 'http://192.168.1.50:8188',
        comfyCloudApiKey: '',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    expect(process.env['OPENAI_BASE_URL']).toBe(
      'https://desktop.example.test/openai/api/v1',
    );
    expect(process.env['OPENAI_API_KEY']).toBe('desktop-jwt');
    expect(process.env['COMFY_MODE']).toBe('local');
    expect(process.env['COMFYUI_BASE_URL']).toBe('http://192.168.1.50:8188');
    expect(process.env['COMFY_CLOUD_API_KEY']).toBeUndefined();
  });

  it('mixed: llmBackend=local + comfyBackend=cloud — ComfyUI goes to cloud proxy, LLM uses Settings (e.g. LM Studio)', async () => {
    // The reverse split: free LLM on a local model, paid ComfyUI
    // through the metered proxy.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        llmBackend: 'local',
        comfyBackend: 'cloud',
  vlmBackend: 'local' as const,
        backendMode: 'cloud',
        llmProvider: 'openai',
        openaiBaseUrl: 'http://127.0.0.1:1234/v1',
        openaiApiKey: 'lm-studio-placeholder',
        openaiModel: 'qwen3',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    // LLM stays on Settings.
    expect(process.env['OPENAI_BASE_URL']).toBe('http://127.0.0.1:1234/v1');
    expect(process.env['OPENAI_API_KEY']).toBe('lm-studio-placeholder');
    expect(process.env['OPENAI_MODEL']).toBe('qwen3');
    // ComfyUI on cloud.
    expect(process.env['COMFY_MODE']).toBe('cloud');
    expect(process.env['COMFYUI_BASE_URL']).toBe(
      'https://desktop.example.test/comfy/api',
    );
    expect(process.env['COMFY_CLOUD_API_KEY']).toBe('desktop-jwt');
  });

  it('Kshana Cloud auth + Gemini in Settings: LLM stays Gemini', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        llmProvider: 'gemini',
        googleApiKey: 'google-key',
        geminiModel: 'gemini-2.5-flash',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    expect(process.env['LLM_PROVIDER']).toBe('gemini');
    expect(process.env['GOOGLE_API_KEY']).toBe('google-key');
    expect(process.env['GEMINI_MODEL']).toBe('gemini-2.5-flash');
    // OpenAI env not set — Gemini path should not leak it.
    expect(process.env['OPENAI_API_KEY']).toBeUndefined();
    expect(process.env['OPENAI_BASE_URL']).toBeUndefined();
  });

  it('runTask forwards onToolCall events to the supplied eventCb with the original payload', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);
    const { id: sessionId } = mgr.createSession();
    const events: Array<{ eventName: string; sessionId: string; data: unknown }> = [];

    await mgr.runTask(sessionId, 'a task', {}, (e: { eventName: string; sessionId: string; data: unknown }) => events.push(e));

    const toolCallEvent = events.find((e) => e.eventName === 'tool_call');
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent?.sessionId).toBe('s-1');
    expect(toolCallEvent?.data).toMatchObject({ toolName: 'kshana_run_to', toolCallId: 'tc-1' });
  });

  it('runTask forwards onAgentText events as stream chunks', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);
    const { id: sessionId } = mgr.createSession();
    const events: Array<{ eventName: string; data: unknown }> = [];

    await mgr.runTask(sessionId, 'task', {}, (e: { eventName: string; sessionId: string; data: unknown }) => events.push(e));

    const streamEvent = events.find((e) => e.eventName === 'stream_chunk');
    expect(streamEvent).toBeDefined();
    expect(streamEvent?.data).toMatchObject({ content: 'done', done: true });
  });

  it('cancelTask returns false when the session does not exist', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);
    expect(mgr.cancelTask('does-not-exist')).toBe(false);
  });

  it('redoNode forwards editedPrompt unchanged to the underlying ConversationManager', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);
    const { id: sessionId } = mgr.createSession();
    const result = await mgr.redoNode(sessionId, 'shot_image:scene_1_shot_4', {
      editedPrompt: 'a brand new prompt',
    });
    expect(result).toMatchObject({
      nodeId: 'shot_image:scene_1_shot_4',
      editedPrompt: 'a brand new prompt',
    });
  });

  it('restart() calls shutdown() then constructs a fresh ConversationManager', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);
    expect(mockState.envSnapshots).toHaveLength(1);
    await mgr.restart({ ...baseSettings, llmProvider: 'gemini', googleApiKey: 'g-key' });
    expect(mockState.shutdownCalls).toBe(1);
    expect(mockState.envSnapshots).toHaveLength(2);
    expect(mockState.envSnapshots[1]?.LLM_PROVIDER).toBe('gemini');
  });

  it('runTask before start() returns an error-shaped result rather than throwing', async () => {
    const mgr = new KshanaCoreManager();
    const events: Array<{ eventName: string; data: unknown }> = [];
    const result = await mgr.runTask('any', 'task', {}, (e: { eventName: string; sessionId: string; data: unknown }) => events.push(e));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/not started|start\(\) first/i);
  });

  it('stop() calls shutdown() and subsequent runTask returns failed', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);
    const { id: sessionId } = mgr.createSession();
    mgr.stop();
    expect(mockState.shutdownCalls).toBe(1);
    const result = await mgr.runTask(sessionId, 'task', {}, () => {});
    expect(result.status).toBe('failed');
  });

  it('start() exposes projectsDir via KSHANA_PROJECTS_DIR env (works dev + packaged, no global chdir)', async () => {
    // kshana-ink's loadProject / projectFileIO / projectExists default
    // basePath to process.cwd(). We can't chdir process-globally —
    // kshana-desktop's main process has many `process.cwd()` callers
    // that would silently break. Instead we surface the right base
    // via KSHANA_PROJECTS_DIR; kshana-ink's path defaults read it.
    delete process.env['KSHANA_PROJECTS_DIR'];
    const mgr = new KshanaCoreManager();
    await mgr.start(baseSettings);
    expect(process.env['KSHANA_PROJECTS_DIR']).toBe(FAKE_PROJECTS_DIR);
  });

  // ── LLM routing/tier env hygiene ────────────────────────────────────
  // kshana-core/.env can populate LLM_ROUTING_ENABLED + LLM_TIER_*_*
  // env vars before the desktop's applyEnvFromSettings runs. Pre-fix,
  // those vars survived and the LLMRouter / pi-agent silently routed
  // every call to whatever .env said (e.g. openrouter/deepseek),
  // ignoring the Settings panel entirely. Settings is the canonical
  // source — these tests pin that hygiene.

  it('start() clears LLM_ROUTING_ENABLED + LLM_TIER_*_* + LLM_PURPOSE__* leaked from kshana-core/.env when llmUseSameForAllTiers=true', async () => {
    process.env['LLM_ROUTING_ENABLED'] = 'true';
    process.env['LLM_TIER_HEAVY_PROVIDER'] = 'openrouter';
    process.env['LLM_TIER_HEAVY_API_KEY'] = 'sk-or-v1-stale';
    process.env['LLM_TIER_HEAVY_MODEL'] = 'deepseek/deepseek-v4-flash';
    process.env['LLM_TIER_MEDIUM_PROVIDER'] = 'openrouter';
    process.env['LLM_TIER_MEDIUM_MODEL'] = 'deepseek/deepseek-v4-flash';
    process.env['LLM_TIER_LIGHT_PROVIDER'] = 'openrouter';
    process.env['LLM_TIER_LIGHT_MODEL'] = 'deepseek/deepseek-v4-flash';
    process.env['LLM_PURPOSE__CONTENT__STORY_PROVIDER'] = 'openrouter';

    const mgr = new KshanaCoreManager();
    await mgr.start({ ...baseSettings, llmUseSameForAllTiers: true });

    expect(process.env['LLM_ROUTING_ENABLED']).toBeUndefined();
    expect(process.env['LLM_TIER_HEAVY_PROVIDER']).toBeUndefined();
    expect(process.env['LLM_TIER_HEAVY_API_KEY']).toBeUndefined();
    expect(process.env['LLM_TIER_HEAVY_MODEL']).toBeUndefined();
    expect(process.env['LLM_TIER_MEDIUM_PROVIDER']).toBeUndefined();
    expect(process.env['LLM_TIER_MEDIUM_MODEL']).toBeUndefined();
    expect(process.env['LLM_TIER_LIGHT_PROVIDER']).toBeUndefined();
    expect(process.env['LLM_TIER_LIGHT_MODEL']).toBeUndefined();
    expect(process.env['LLM_PURPOSE__CONTENT__STORY_PROVIDER']).toBeUndefined();
    // OPENAI_* still flows from Settings — verify the regular path wasn't broken.
    expect(process.env['LLM_PROVIDER']).toBe('openai');
    expect(process.env['OPENAI_BASE_URL']).toBe('https://api.openai.com/v1');
  });

  it('start() with llmUseSameForAllTiers=false writes LLM_ROUTING_ENABLED=true + per-tier env from settings', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      llmUseSameForAllTiers: false,
      // Heavy = flat fields (carried from baseSettings: openai @ api.openai.com/v1, gpt-4o, sk-test).
      llmTierMedium: {
        provider: 'openai',
        openaiBaseUrl: 'https://medium.example.test/v1',
        openaiApiKey: 'medium-key',
        openaiModel: 'medium-model',
        googleApiKey: '',
        geminiModel: 'gemini-2.5-flash',
      },
      llmTierLight: {
        provider: 'gemini',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: '',
        openaiModel: 'gpt-4o',
        googleApiKey: 'g-light-key',
        geminiModel: 'gemini-2.5-flash',
      },
    });

    expect(process.env['LLM_ROUTING_ENABLED']).toBe('true');

    // Heavy mirrors the flat OPENAI_* settings the user already supplied.
    expect(process.env['LLM_TIER_HEAVY_PROVIDER']).toBe('openai');
    expect(process.env['LLM_TIER_HEAVY_BASE_URL']).toBe('https://api.openai.com/v1');
    expect(process.env['LLM_TIER_HEAVY_API_KEY']).toBe('sk-test');
    expect(process.env['LLM_TIER_HEAVY_MODEL']).toBe('gpt-4o');

    // Medium = its own openai-compat config.
    expect(process.env['LLM_TIER_MEDIUM_PROVIDER']).toBe('openai');
    expect(process.env['LLM_TIER_MEDIUM_BASE_URL']).toBe('https://medium.example.test/v1');
    expect(process.env['LLM_TIER_MEDIUM_API_KEY']).toBe('medium-key');
    expect(process.env['LLM_TIER_MEDIUM_MODEL']).toBe('medium-model');

    // Light = gemini — provider gemini, gemini key, gemini model, gemini openai-compat URL.
    expect(process.env['LLM_TIER_LIGHT_PROVIDER']).toBe('gemini');
    expect(process.env['LLM_TIER_LIGHT_API_KEY']).toBe('g-light-key');
    expect(process.env['LLM_TIER_LIGHT_MODEL']).toBe('gemini-2.5-flash');
    expect(process.env['LLM_TIER_LIGHT_BASE_URL']).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    );
  });

  it('GIVEN llmBackend=cloud + llmUseSameForAllTiers=false + custom tier configs WHEN start runs THEN every tier uses the cloud proxy and per-tier settings are ignored', async () => {
    // Cloud-mode contract extends to the per-tier env vars: when
    // the user has opted out of "same for all tiers" but is on
    // cloud LLM, none of the LLM_TIER_*_BASE_URL / _MODEL / _API_KEY
    // entries should carry their custom-tier baseUrl/model/key
    // through to the cloud proxy. The proxy owns routing.
    //
    // Pre-fix this surfaces as the same bug shape as cloud-LLM
    // primary: a stray model id (e.g. a leftover gpt-3.5-turbo
    // from a tier the user once configured against api.openai.com)
    // hits the cloud proxy, lands in a credit pool the user
    // doesn't have, and returns 402.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        llmBackend: 'cloud',
        comfyBackend: 'local',
        vlmBackend: 'local',
        backendMode: 'cloud',
        llmUseSameForAllTiers: false,
        llmProvider: 'openai',
        openaiBaseUrl: 'https://stale.example.test/v1',
        openaiApiKey: 'stale-heavy-key',
        openaiModel: 'stale-heavy-model',
        llmTierMedium: {
          provider: 'openai',
          openaiBaseUrl: 'https://stale-medium.example.test/v1',
          openaiApiKey: 'stale-medium-key',
          openaiModel: 'stale-medium-model',
          googleApiKey: '',
          geminiModel: 'gemini-2.5-flash',
        },
        llmTierLight: {
          provider: 'gemini',
          openaiBaseUrl: 'https://api.openai.com/v1',
          openaiApiKey: '',
          openaiModel: 'gpt-4o',
          googleApiKey: 'stale-gemini-key',
          geminiModel: 'stale-gemini-model',
        },
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    const cloudUrl = 'https://desktop.example.test/openai/api/v1';

    // Every tier points at the cloud proxy with the desktop token
    // and the cloud-default model — settings tier configs ignored.
    for (const tier of ['HEAVY', 'MEDIUM', 'LIGHT']) {
      expect(process.env[`LLM_TIER_${tier}_PROVIDER`]).toBe('openai');
      expect(process.env[`LLM_TIER_${tier}_BASE_URL`]).toBe(cloudUrl);
      expect(process.env[`LLM_TIER_${tier}_API_KEY`]).toBe('desktop-jwt');
      expect(process.env[`LLM_TIER_${tier}_MODEL`]).toBe('gpt-4o');
    }

    // The flat OPENAI_* env still has the cloud-mode values too
    // (so a code path that reads OPENAI_BASE_URL — i.e. the no-routing
    // fallback — also lands on cloud, not on the stale Settings URL).
    expect(process.env['OPENAI_BASE_URL']).toBe(cloudUrl);
    expect(process.env['OPENAI_API_KEY']).toBe('desktop-jwt');
    expect(process.env['OPENAI_MODEL']).toBe('gpt-4o');
  });

  // ── VLM (vision judge) env wiring ───────────────────────────────────
  // VLM has its own env block (VLM_PROVIDER / VLM_API_KEY / VLM_MODEL /
  // VLM_BASE_URL) read by getVLMConfig() in kshana-core. Pre-fix the
  // desktop never set any of these — VLM was effectively dead unless
  // the user edited kshana-core/.env directly.

  it('GIVEN vlmBackend=cloud + cloud auth + stale vlmModel WHEN start runs THEN cloud proxy URL/token win and settings.vlmModel is ignored', async () => {
    // Same contract as cloud-LLM: in cloud mode the proxy owns
    // model selection, so settings.vlmModel must NOT ride through.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        vlmJudge: true,
        llmBackend: 'cloud',
        comfyBackend: 'local',
        vlmBackend: 'cloud',
        backendMode: 'cloud',
        vlmProvider: 'openai',
        vlmModel: 'gpt-4o-vision',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    expect(process.env['VLM_PROVIDER']).toBe('openai');
    expect(process.env['VLM_BASE_URL']).toBe(
      'https://desktop.example.test/openai/api/v1',
    );
    expect(process.env['VLM_API_KEY']).toBe('desktop-jwt');
    expect(process.env['VLM_MODEL']).toBe('gpt-4o');
  });

  it('mixed: llmBackend=cloud + vlmBackend=local — LLM goes to cloud proxy, VLM uses Settings (independent lanes)', async () => {
    // The third-lane independence: a user can route paid LLM through
    // the metered cloud proxy while keeping VLM judging on a local
    // self-hosted vision model (e.g. LM Studio with qwen-vl).
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        vlmJudge: true,
        llmBackend: 'cloud',
        comfyBackend: 'local',
        vlmBackend: 'local',
        backendMode: 'cloud',
        vlmProvider: 'openai',
        vlmBaseUrl: 'http://127.0.0.1:1234/v1',
        vlmApiKey: 'lm-studio-vision',
        vlmModel: 'qwen-vl-72b',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    // LLM cloud (metered).
    expect(process.env['OPENAI_BASE_URL']).toBe(
      'https://desktop.example.test/openai/api/v1',
    );
    expect(process.env['OPENAI_API_KEY']).toBe('desktop-jwt');
    // VLM local — does NOT borrow the cloud token, uses Settings.
    expect(process.env['VLM_PROVIDER']).toBe('openai');
    expect(process.env['VLM_BASE_URL']).toBe('http://127.0.0.1:1234/v1');
    expect(process.env['VLM_API_KEY']).toBe('lm-studio-vision');
    expect(process.env['VLM_MODEL']).toBe('qwen-vl-72b');
  });

  it('GIVEN llmBackend=local + vlmBackend=cloud WHEN start runs THEN LLM uses settings while VLM uses cloud (model is cloud default, not vlmModel)', async () => {
    // Independent-lane split: free local LLM (LM Studio) + VLM
    // judging via cloud. The local lane reads settings; the cloud
    // lane ignores vlmModel and uses the cloud-default sentinel.
    const mgr = new KshanaCoreManager();
    await mgr.start(
      {
        ...baseSettings,
        vlmJudge: true,
        llmBackend: 'local',
        comfyBackend: 'local',
        vlmBackend: 'cloud',
        backendMode: 'cloud',
        llmProvider: 'openai',
        openaiBaseUrl: 'http://127.0.0.1:1234/v1',
        openaiApiKey: 'lm-studio',
        openaiModel: 'qwen3',
        vlmProvider: 'openai',
        vlmModel: 'anthropic/claude-opus-4.6-fast',
      },
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );

    // LLM local — settings ride through.
    expect(process.env['OPENAI_BASE_URL']).toBe('http://127.0.0.1:1234/v1');
    expect(process.env['OPENAI_API_KEY']).toBe('lm-studio');
    // VLM cloud — proxy owns model; settings.vlmModel ignored.
    expect(process.env['VLM_BASE_URL']).toBe(
      'https://desktop.example.test/openai/api/v1',
    );
    expect(process.env['VLM_API_KEY']).toBe('desktop-jwt');
    expect(process.env['VLM_MODEL']).toBe('gpt-4o');
  });

  it('vlmJudge=true + local LLM: VLM env reflects user Settings (openai-compatible)', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      vlmJudge: true,
      llmBackend: 'local',
      vlmProvider: 'openai',
      vlmBaseUrl: 'http://127.0.0.1:1234/v1',
      vlmApiKey: 'lm-studio-vision-placeholder',
      vlmModel: 'qwen-vl-72b',
    });

    expect(process.env['VLM_PROVIDER']).toBe('openai');
    expect(process.env['VLM_BASE_URL']).toBe('http://127.0.0.1:1234/v1');
    expect(process.env['VLM_API_KEY']).toBe('lm-studio-vision-placeholder');
    expect(process.env['VLM_MODEL']).toBe('qwen-vl-72b');
  });

  it('vlmJudge=true + local LLM + Gemini VLM: VLM_BASE_URL set to gemini openai-compat endpoint', async () => {
    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      vlmJudge: true,
      llmBackend: 'local',
      vlmProvider: 'gemini',
      vlmApiKey: 'google-vision-key',
      vlmModel: 'gemini-2.5-pro',
    });

    expect(process.env['VLM_PROVIDER']).toBe('gemini');
    expect(process.env['VLM_BASE_URL']).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    );
    expect(process.env['VLM_API_KEY']).toBe('google-vision-key');
    expect(process.env['VLM_MODEL']).toBe('gemini-2.5-pro');
  });

  it('vlmJudge=true with empty VLM Settings preserves .env fallback values (dev-mode unchanged)', async () => {
    process.env['VLM_PROVIDER'] = 'openrouter';
    process.env['VLM_API_KEY'] = 'sk-or-v1-from-dotenv';
    process.env['VLM_MODEL'] = 'qwen/qwen3.5-9b';

    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      vlmJudge: true,
      llmBackend: 'local',
      vlmProvider: 'openai', // settings default, but other VLM fields empty
      vlmBaseUrl: '',
      vlmApiKey: '',
      vlmModel: '',
    });

    // setIfPresent skips empty values → .env fallback survives.
    // VLM_PROVIDER gets set to 'openai' explicitly though, since the
    // user picked that in Settings.
    expect(process.env['VLM_PROVIDER']).toBe('openai');
    expect(process.env['VLM_API_KEY']).toBe('sk-or-v1-from-dotenv');
    expect(process.env['VLM_MODEL']).toBe('qwen/qwen3.5-9b');
  });

  it('vlmJudge=false: VLM env left untouched (no auto-config)', async () => {
    process.env['VLM_PROVIDER'] = 'openrouter';
    process.env['VLM_API_KEY'] = 'sk-or-v1-from-dotenv';
    process.env['VLM_MODEL'] = 'qwen/qwen3.5-9b';

    const mgr = new KshanaCoreManager();
    await mgr.start({
      ...baseSettings,
      vlmJudge: false,
    });

    // Whatever was in the env stays. VLM calls are gated upstream by
    // the vlmJudge flag inside core, so no harm in leaving stale env.
    expect(process.env['VLM_PROVIDER']).toBe('openrouter');
    expect(process.env['VLM_API_KEY']).toBe('sk-or-v1-from-dotenv');
    expect(process.env['VLM_MODEL']).toBe('qwen/qwen3.5-9b');
  });

  it('two consecutive starts while signed in to Kshana Cloud preserve OPENAI_API_KEY from the dev .env fallback', async () => {
    // Regression: clearCloudProxyEnv used to delete OPENAI_API_KEY
    // whenever the previous start had set KSHANA_CLOUD='true'. That
    // dated from when cloud auth also rerouted the LLM. After the
    // "Settings is canonical for LLM" fix, cloud auth no longer owns
    // OPENAI_*; deleting them on restart wiped the .env fallback that
    // signed-in dev users with empty Settings.openaiApiKey rely on,
    // leaving resolvePiSessionModel with no api key on the second run.
    process.env['OPENAI_API_KEY'] = 'sk-from-dotenv';
    const settings: AppSettings = {
      ...baseSettings,
      llmProvider: 'openai',
      openaiApiKey: '', // empty — relying on .env fallback
      openaiBaseUrl: 'https://kshana.share.zrok.io',
      openaiModel: 'Qwen3.6-35B-A3B',
    };
    const cloudAuth = {
      websiteUrl: 'https://desktop.example.test/',
      desktopToken: 'desktop-jwt',
    };

    const mgr = new KshanaCoreManager();
    await mgr.start(settings, cloudAuth);
    expect(process.env['OPENAI_API_KEY']).toBe('sk-from-dotenv');

    await mgr.restart(settings, cloudAuth);
    // Restart with cloud auth still active must NOT delete the
    // .env-loaded api key the user is implicitly relying on.
    expect(process.env['OPENAI_API_KEY']).toBe('sk-from-dotenv');
  });

  it('start() does NOT clobber pre-existing process.env values when AppSettings has empty strings', async () => {
    // Pre-populate the env as kshana-ink/.env would. Setting must
    // pass through untouched when the matching AppSettings field is
    // empty — otherwise dev users with a working .env get
    // "No API key found" because applyEnvFromSettings overwrites
    // OPENAI_API_KEY (etc.) with "".
    process.env['OPENAI_API_KEY'] = 'sk-from-dotenv';
    process.env['OPENROUTER_API_KEY'] = 'sk-from-dotenv-or';
    const emptySettings: AppSettings = {
      ...baseSettings,
      llmProvider: 'openai',
      openaiApiKey: '',
      openRouterApiKey: '',
    };

    const mgr = new KshanaCoreManager();
    await mgr.start(emptySettings);

    expect(process.env['OPENAI_API_KEY']).toBe('sk-from-dotenv');
    expect(process.env['OPENROUTER_API_KEY']).toBe('sk-from-dotenv-or');
  });
});
