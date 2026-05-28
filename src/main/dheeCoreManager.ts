/**
 * `dheeCoreManager` — main-process owner of the embedded
 * `ConversationManager` from dhee-ink. Replaces the legacy
 * spawn-and-WebSocket `localBackendManager` with an in-process
 * integration: dhee-ink's pipeline runs inside the Electron main
 * process, and events flow through callbacks to whoever owns the
 * IPC bridge.
 *
 * Lifetime: the manager is constructed once at app start, lives for
 * the duration of the Electron session, and is shut down on app quit
 * (or rebuilt on settings change via `restart()`).
 *
 * State ownership: `ConversationManager` already owns sessions,
 * AbortControllers, focused projects, and timer checkpoints. This
 * class is a thin facade that converts AppSettings → process.env
 * before constructing the manager, and translates the
 * `ConversationEvents` callback shape into a single
 * `dheeCoreEvent` stream the IPC bridge can re-publish over
 * `webContents.send`.
 */
import type { AppSettings, LLMTierConfig } from '../shared/settingsTypes';
import type { OkResponse } from '../shared/dheeIpc';
import log from 'electron-log';
import path from 'path';
import { existsSync as fsExistsSync, mkdirSync as fsMkdirSync } from 'fs';
import { app } from 'electron';
import { pathToFileURL } from 'url';
import { getComfyUiUrl, isComfyCloudUrl } from './utils/comfyUrl';
import { applyRuntimeAnalyticsConfig } from './cloudRuntimeConfig';

export interface dheeCloudAuthRuntime {
  websiteUrl: string;
  desktopToken: string;
}

type LLMClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

// Phase 6.4: ConversationManagerConfig + ConversationManager types
// removed — no embedded manager to type against. ConversationEvents
// kept as a loose record because buildEventsAdapter (still exported
// for the IPC bridge regression test) needs to declare the callback
// surface it returns.
type ConversationEvents = Record<string, (...args: any[]) => void>;

type AnalyticsIdentity = {
  distinctId?: string;
  installId?: string;
  userId?: string;
};

// Phase 6.4: import the embed-host helpers from the main `dhee-core`
// barrel. The legacy `./manager` entry (which exported a no-op
// ConversationManager + analytics + dev-env) is being deleted now
// that nothing in the manager construction path remains.
const dhee_CORE_MANAGER_MODULE = 'dhee-core';

function getPackagedManagerModuleUrl(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (!resourcesPath) return null;

  // Phase 6.4: the packaged fallback now points at dhee-core's main
  // dist entry (was ./dist/server/manager.js, gone in Phase 6.4).
  return pathToFileURL(
    path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'dhee-core',
      'dist',
      'index.js',
    ),
  ).href;
}

// Phase 6.4: narrowed to the host-helper surface that survives the
// ConversationManager / workflow-registry deletion. The dhee-core
// barrel still exports these so dheeCoreManager can configure analytics
// + load the dev .env at startup.
type ManagerModule = {
  captureAnalyticsEvent?: (
    event: string,
    properties?: Record<string, unknown>,
    options?: {
      identity?: AnalyticsIdentity;
      component?: string;
      timestamp?: string | Date;
    },
  ) => void;
  configureAnalytics?: (input: {
    platform?: 'desktop' | 'server' | 'website';
    appVersion?: string;
    identity?: AnalyticsIdentity;
    properties?: Record<string, unknown>;
  }) => void;
  configurePostHogRuntime?: (input: {
    apiKey?: string;
    host?: string;
    analyticsSalt?: string;
  }) => void;
  identifyAnalyticsUser?: (
    identity: { userId: string } & AnalyticsIdentity,
    properties?: Record<string, unknown>,
  ) => void;
  isPostHogEnabled?: () => boolean;
  setAnalyticsIdentity?: (identity: AnalyticsIdentity) => void;
  shutdownPostHog?: () => Promise<void>;
  /**
   * Optional in tests where the loader injects a stub. In production
   * the real bundle always exports it.
   *
   * Returns:
   *   - `root`: the dhee-ink package root (debug only)
   *   - `projectsDir`: where projects live, computed by dhee-ink's
   *     `getProjectsDir()`. We chdir to this so the package's
   *     filesystem helpers (which default to process.cwd()) line up.
   *     Honours dhee_PROJECTS_DIR override and the
   *     dhee_PACKAGED=1 → ~/dhee mapping.
   */
  loadDevEnv?: (root?: string) => {
    loaded: boolean;
    path: string | null;
    vars: string[];
    root: string;
    projectsDir: string;
  };

  // Phase 6.4: workflow CRUD + WorkflowModeRegistry + chat-session
  // persistence are no longer exposed by dhee-core (the underlying
  // services/comfyui/workflowIntegration.ts and
  // services/providers/WorkflowModeRegistry.ts were deleted in
  // d6f11bd). Workflow CRUD is stubbed in dheeCoreManager so the
  // Settings → Workflows panel doesn't crash; real implementation
  // returns when the bundle architecture re-introduces custom
  // workflow support. Chat-session persistence (getSessionHistorySnapshot
  // / clearSessionHistory) now lives in dheeCoreManager itself (Phase
  // 6.3 stubs) — no need to thread through the embedded core.
};

/**
 * dhee-ink's embed entries are ESM-only (transitive deps
 * `@mariozechner/pi-coding-agent` and `pi-ai` ship ESM with no CJS
 * `require` exports). The `webpackIgnore: true` magic comment tells
 * webpack to leave this dynamic import alone so Node's runtime ESM
 * loader handles it natively. Tests substitute this loader via the
 * exported `__setManagerLoader` to inject the mock module.
 */
let loadManagerModule: () => Promise<ManagerModule> = async () => {
  try {
    log.info(
      `[dheeCoreManager] Importing ${dhee_CORE_MANAGER_MODULE} via package exports`,
    );
    const module = (await import(
      /* webpackIgnore: true */ dhee_CORE_MANAGER_MODULE
    )) as ManagerModule;
    log.info('[dheeCoreManager] Package export import succeeded');
    return module;
  } catch (error) {
    log.error(
      `[dheeCoreManager] Package export import failed: ${
        (error as Error).message
      }\n${(error as Error).stack}`,
    );

    if (process.env.dhee_PACKAGED !== '1') {
      throw error;
    }

    const packagedModuleUrl = getPackagedManagerModuleUrl();
    if (!packagedModuleUrl) {
      log.error(
        '[dheeCoreManager] Cannot resolve packaged fallback manager URL',
      );
      throw error;
    }

    log.info(
      `[dheeCoreManager] Importing packaged fallback ${packagedModuleUrl}`,
    );
    const module = (await import(
      /* webpackIgnore: true */ packagedModuleUrl
    )) as ManagerModule;
    log.info('[dheeCoreManager] Packaged fallback import succeeded');
    return module;
  }
};

/** Test seam — replace the loader so unit tests can supply a fake. */
export function __setManagerLoader(loader: () => Promise<ManagerModule>): void {
  loadManagerModule = loader;
}

/**
 * `dhee-core/runners` is also ESM-only, so it has to come in via the
 * same `webpackIgnore`'d dynamic import as the manager bundle. The
 * earlier `require('dhee-core/runners')` threw `ERR_REQUIRE_ESM` at
 * the IPC boundary — Stop button "worked" in the UI (local spinner)
 * while the main process silently failed to call `runner.cancel()`.
 */
type RunnersModule = {
  getBackgroundTaskRunner: () => {
    cancel: () => boolean;
    getActive: () => null | {
      id: string;
      spec: { kind: string; projectName: string; sessionId: string };
      startedAt: number;
    };
    isCancelling: () => boolean;
  };
};

let loadRunnersModule: () => Promise<RunnersModule> = () =>
  import(/* webpackIgnore: true */ 'dhee-core/runners') as Promise<RunnersModule>;

/** Test seam — replace the loader so unit tests can supply a fake. */
export function __setRunnersLoader(loader: () => Promise<RunnersModule>): void {
  loadRunnersModule = loader;
}

/**
 * Subset of `dhee-core/dag` that owns walker-driven invalidate/regen.
 * Replaces the dead `ConversationManager.redoNode / invalidateNodes`
 * facade from BUG-016. See dhee-core/src/dag/projectRegen.ts for the
 * implementation that both the pi-agent tool and this manager call.
 */
type DagModule = {
  regenerateNode: (opts: {
    projectDir: string;
    nodeId: string;
    itemId?: string;
    signal?: AbortSignal;
  }) => Promise<{
    ok: boolean;
    nodeId?: string;
    error?: string;
    finalVideoAbs?: string;
  }>;
  invalidateNodes: (opts: {
    projectDir: string;
    nodeIds: string[];
    source?: string;
  }) => Promise<{
    invalidated: string[];
    notFound: string[];
    error?: string;
  }>;
};

let loadDagModule: () => Promise<DagModule> = () =>
  import(/* webpackIgnore: true */ 'dhee-core/dag') as Promise<DagModule>;

/** Test seam — replace the loader so unit tests can supply a fake. */
export function __setDagLoader(loader: () => Promise<DagModule>): void {
  loadDagModule = loader;
}

/**
 * Phase 6.5: pi-agent chat surface. The desktop builds a long-lived
 * AgentSession per chat session and runs each user message through
 * `runAgentTurn`. Both helpers live in dhee-core; we lazy-import them
 * via the same dynamic-import pattern as the dag/runners modules so
 * the ESM-only bundle can load from CJS Electron main.
 */
type ChatDeps = {
  buildPiSession: (opts: {
    sessionManager: unknown;
    cwd?: string;
    sessionsDir?: string;
    modelProvider?: string;
    modelId?: string;
    apiKey?: string;
  }) => Promise<{
    session: {
      sessionId?: string;
      sessionFile?: string;
      subscribe: (cb: (ev: unknown) => void) => () => void;
      prompt: (m: string) => Promise<void>;
      dispose?: () => void;
    };
  }>;
  runAgentTurn: (
    session: unknown,
    message: string,
    opts?: { keepAlive?: boolean; onEvent?: (ev: unknown) => void },
  ) => Promise<
    | { ok: true; assistant_text: string; tool_calls: Array<{ name: string }> }
    | { ok: false; error: string }
  >;
};

let chatDeps: ChatDeps | null = null;

async function loadChatDeps(): Promise<ChatDeps> {
  if (chatDeps) return chatDeps;
  const mod = (await import(/* webpackIgnore: true */ 'dhee-core')) as ChatDeps & {
    SessionManager?: { inMemory: (cwd?: string) => unknown };
  };
  chatDeps = { buildPiSession: mod.buildPiSession, runAgentTurn: mod.runAgentTurn };
  return chatDeps;
}

/** Test seam — replace the chat helpers so jest doesn't boot a real LLM. */
export function __setChatDeps(deps: ChatDeps): void {
  chatDeps = deps;
}

/**
 * Phase 6.5b: derive the {provider, modelId, apiKey} pi-agent needs
 * from AppSettings. Returns null when no usable provider is configured —
 * the chatPrompt caller surfaces a clean "no LLM configured" error
 * instead of letting pi-coding-agent's auto-discovery silently no-op.
 *
 * Settings → pi-ai mapping (no chained imports of pi-ai's model
 * tables — provider/model ids are strings, validated downstream by
 * getModel()):
 *   - llmProvider='gemini' + googleApiKey → { google, geminiModel, googleApiKey }
 *   - llmProvider='openai' + openaiBaseUrl contains 'openrouter.ai'
 *     + openaiApiKey + openaiModel → { openrouter, openaiModel, openaiApiKey }
 *     The 'openai-compat-to-openrouter' detour is load-bearing —
 *     many users keep llmProvider='openai' for backwards compat with
 *     dhee-core's LLM dispatcher and rely on the base-URL override.
 *   - llmProvider='openai' otherwise → { openai, openaiModel, openaiApiKey }
 *
 * Exported for unit testing.
 */
export function resolvePiModelFromSettings(
  s: AppSettings,
): { provider: string; modelId: string; apiKey: string } | null {
  if (s.llmProvider === 'gemini') {
    const apiKey = s.googleApiKey?.trim();
    const modelId = (s.geminiModel || 'gemini-2.5-flash').trim();
    if (!apiKey || !modelId) return null;
    return { provider: 'google', modelId, apiKey };
  }
  // openai (default)
  const apiKey = s.openaiApiKey?.trim();
  const modelId = (s.openaiModel || 'gpt-4o').trim();
  if (!apiKey || !modelId) return null;
  if (s.openaiBaseUrl?.toLowerCase().includes('openrouter.ai')) {
    return { provider: 'openrouter', modelId, apiKey };
  }
  return { provider: 'openai', modelId, apiKey };
}

/**
 * Single normalized event the IPC bridge publishes downstream.
 * Mirrors the existing WebSocket `ServerMessage` shape so the renderer
 * doesn't have to learn a new schema — only the transport changes.
 */
export interface dheeCoreEvent {
  /** The dhee-ink ServerMessageType (`tool_call`, `agent_response`, …). */
  eventName: string;
  /** Session this event belongs to. */
  sessionId: string;
  /** Shape depends on eventName. Untyped at this layer; the renderer narrows. */
  data: unknown;
}

export type dheeCoreEventCallback = (event: dheeCoreEvent) => void;

/** Subset of `ConversationManager.runTask` opts the IPC bridge forwards. */
export interface RunTaskOpts {
  stopAtStage?: string;
}

export interface RedoNodeOpts {
  editedPrompt?: string;
  frame?: string;
  scope?: 'prompt' | 'image_only';
  /** For collection nodes — regenerate just this item (composes the walkState key as `nodeId:itemId`). */
  itemId?: string;
  /** Cooperative cancellation forwarded to the runner. */
  signal?: AbortSignal;
}

export interface ConfigureProjectOpts {
  projectDir: string;
  templateId?: string;
  style?: string;
  duration?: number;
  autonomousMode?: boolean;
}

export interface RunResult {
  status: 'completed' | 'failed' | 'cancelled' | 'awaiting_input';
  output?: string;
  error?: string;
}

/**
 * Apply AppSettings to `process.env` in-place. Mirrors
 * `buildLocalBackendEnv()` from `localBackendManager.ts` but does NOT
 * set `dhee_HOST/PORT/PUBLIC_HOST` (no Fastify in this path) and
 * does NOT delete NODE_OPTIONS / TS_NODE_* (those are already owned
 * by the main process and we don't spawn anything).
 *
 * Exported for testing.
 */
function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

/**
 * Clear all LLM routing/tier/purpose env vars before applying Settings.
 *
 * Why: dhee-core/.env can populate `LLM_ROUTING_ENABLED` and
 * `LLM_TIER_*_*` (and per-purpose `LLM_PURPOSE__*`). When the desktop
 * runs from a checkout, `import 'dotenv/config'` in dhee-core fires at
 * package-import time — *before* `applyEnvFromSettings` runs — so those
 * .env values land in process.env first. Without this clear, the
 * LLMRouter and PiSessionAgent silently route every call through whatever
 * the .env tier vars say, ignoring the Settings panel entirely.
 *
 * Settings is the canonical source: this function wipes any pre-existing
 * tier env so the per-tier writer below sees a clean slate, and so the
 * "useSameForAllTiers" path does not accidentally leave routing enabled.
 */
const GEMINI_OPENAI_COMPAT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/';

/**
 * The "primary" LLM section in Settings (flat openai/gemini fields)
 * doubles as the Heavy tier when per-tier routing is on. Project this
 * surface into a tier-shaped object so the writer below stays uniform.
 */
function tierConfigFromPrimarySettings(settings: AppSettings): LLMTierConfig {
  return {
    provider: settings.llmProvider === 'gemini' ? 'gemini' : 'openai',
    openaiBaseUrl: settings.openaiBaseUrl,
    openaiApiKey: settings.openaiApiKey,
    openaiModel: settings.openaiModel,
    googleApiKey: settings.googleApiKey,
    geminiModel: settings.geminiModel,
  };
}

/**
 * Write one tier's config into `LLM_TIER_<TIER>_*` env vars.
 *
 * The shape is dictated by dhee-core/src/core/llm/router.ts
 * (`readConfigFromEnv`): PROVIDER / API_KEY / MODEL / BASE_URL. For
 * gemini we set BASE_URL to its OpenAI-compatible endpoint so the
 * router can reuse the OpenAI client unchanged.
 */
function writeTierEnv(tier: 'HEAVY' | 'MEDIUM' | 'LIGHT', cfg: LLMTierConfig): void {
  if (cfg.provider === 'gemini') {
    process.env[`LLM_TIER_${tier}_PROVIDER`] = 'gemini';
    process.env[`LLM_TIER_${tier}_BASE_URL`] = GEMINI_OPENAI_COMPAT_BASE_URL;
    if (cfg.googleApiKey.trim()) {
      process.env[`LLM_TIER_${tier}_API_KEY`] = cfg.googleApiKey.trim();
    }
    if (cfg.geminiModel.trim()) {
      process.env[`LLM_TIER_${tier}_MODEL`] = cfg.geminiModel.trim();
    }
    return;
  }
  process.env[`LLM_TIER_${tier}_PROVIDER`] = 'openai';
  if (cfg.openaiBaseUrl.trim()) {
    process.env[`LLM_TIER_${tier}_BASE_URL`] = cfg.openaiBaseUrl.trim();
  }
  if (cfg.openaiApiKey.trim()) {
    process.env[`LLM_TIER_${tier}_API_KEY`] = cfg.openaiApiKey.trim();
  }
  if (cfg.openaiModel.trim()) {
    process.env[`LLM_TIER_${tier}_MODEL`] = cfg.openaiModel.trim();
  }
}

function clearRoutingAndTierEnv(): void {
  delete process.env.LLM_ROUTING_ENABLED;
  for (const tier of ['HEAVY', 'MEDIUM', 'LIGHT']) {
    for (const k of ['PROVIDER', 'API_KEY', 'MODEL', 'BASE_URL']) {
      delete process.env[`LLM_TIER_${tier}_${k}`];
    }
  }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LLM_PURPOSE__')) delete process.env[k];
  }
}

function clearCloudProxyEnv(): void {
  const wasUsingDesktopCloudProxy = process.env.dhee_CLOUD === 'true';
  delete process.env.dhee_CLOUD;
  delete process.env.dhee_CLOUD_URL;
  delete process.env.LLM_CONTEXT_TOKENS;
  if (wasUsingDesktopCloudProxy) {
    // Cloud auth no longer touches OPENAI_* — Settings is the canonical
    // LLM source (see applyEnvFromSettings comment). Deleting them
    // here on every restart-while-signed-in nukes the dev fallback
    // OPENAI_API_KEY loaded from dhee-core/.env, leaving signed-in
    // users with empty openaiApiKey in Settings → resolvePiSessionModel
    // returning undefined → "Cannot read properties of undefined
    // (reading 'api')" on the next chat send. Only ComfyUI proxy env
    // is genuinely cloud-owned now.
    delete process.env.COMFY_CLOUD_API_KEY;
    delete process.env.COMFYUI_BASE_URL;
  }
}

export function applyEnvFromSettings(
  settings: AppSettings,
  cloudAuth?: dheeCloudAuthRuntime | null,
): void {
  // Set env vars from settings, but only when the setting has a
  // non-empty value. Empty strings are treated as "use whatever is
  // already in process.env" — so dev users with dhee-ink/.env
  // loaded via loadDevEnv() see their keys come through. The
  // packaged build supplies all values via AppSettings UI, so this
  // skip-on-empty rule is a no-op there.
  const setIfPresent = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) process.env[key] = trimmed;
  };

  clearCloudProxyEnv();
  clearRoutingAndTierEnv();

  const cloudToken = cloudAuth?.desktopToken.trim();
  const cloudWebsiteUrl = cloudAuth?.websiteUrl.trim().replace(/\/$/, '');
  const haveCloudAuth = !!cloudToken && !!cloudWebsiteUrl;

  // Three independent backend lanes — LLM, ComfyUI, VLM — each can be
  // 'cloud' or 'local'. A user can keep ComfyUI on a self-hosted GPU
  // box while routing paid LLM traffic through the metered dhee
  // proxy and VLM judging back through their local LM-Studio vision
  // model — or any other combo. Cloud routing for any lane requires
  // a valid dhee Cloud sign-in (`haveCloudAuth`); without it the
  // lane falls through to Settings regardless of the toggle.
  const useCloudComfy = settings.comfyBackend === 'cloud' && haveCloudAuth;
  const useCloudLLM = settings.llmBackend === 'cloud' && haveCloudAuth;
  const useCloudVLM = settings.vlmBackend === 'cloud' && haveCloudAuth;

  // Cloud identity env (consumed by analytics, billing, etc.) fires
  // whenever ANY lane is on cloud — they share the same desktop token
  // + website URL.
  if (useCloudLLM || useCloudComfy || useCloudVLM) {
    process.env.dhee_CLOUD = 'true';
    process.env.dhee_CLOUD_URL = cloudWebsiteUrl!;
  }

  if (useCloudComfy) {
    process.env.COMFY_MODE = 'cloud';
    process.env.COMFYUI_BASE_URL = joinUrl(cloudWebsiteUrl!, '/comfy/api');
    process.env.COMFY_CLOUD_API_KEY = cloudToken!;
    process.env.COMFYUI_TIMEOUT = '1800';
  } else {
    const comfyUiUrl = getComfyUiUrl(settings);
    process.env.COMFYUI_TIMEOUT = String(settings.comfyuiTimeout || 1800);
    setIfPresent('COMFYUI_BASE_URL', comfyUiUrl);

    // Auto-derive COMFY_MODE from the URL. Without this, the ComfyUI
    // client in dhee-core falls back to its 'local' default and
    // uses COMFYUI_BASE_URL even when the URL points at
    // cloud.comfy.org — meaning the cloud-specific code path
    // (api-key auth, /api prefix, cloud workflow selection) is
    // skipped. See ComfyUIClient.getComfyConfig.
    if (isComfyCloudUrl(comfyUiUrl)) {
      process.env.COMFY_MODE = 'cloud';
      if (settings.comfyCloudApiKey.trim()) {
        process.env.COMFY_CLOUD_API_KEY = settings.comfyCloudApiKey.trim();
      }
    } else {
      process.env.COMFY_MODE = 'local';
    }
  }
  setIfPresent('dhee_PROJECT_DIR', settings.projectDir);

  // ── Named ComfyUI endpoints (DAG bundle architecture) ──
  // Bundles declare endpoint NAMES (e.g. "self.local"); the URL lives
  // here per-user. Forward each as ENDPOINT_<name_with_dots_as_underscores>
  // env var that the kshana-core process reads via resolveEndpointUrl().
  // Bundle stays portable across users; user keeps full control of
  // routing. P2P discovery will register additional names here later.
  for (const [endpointName, endpointUrl] of Object.entries(
    settings.comfyEndpoints ?? {},
  )) {
    const trimmed = typeof endpointUrl === 'string' ? endpointUrl.trim() : '';
    if (!trimmed) continue;
    const envKey = `ENDPOINT_${endpointName.replace(/\./g, '_')}`;
    process.env[envKey] = trimmed;
  }

  // LLM routing — gated by the dedicated `llmBackend` lane (set above
  // as `useCloudLLM`). This is independent of `comfyBackend`: a user
  // can run LLM through cloud while keeping ComfyUI local, or vice
  // versa. When cloud, the Settings LLM provider/baseUrl/apiKey
  // fields are ignored (and disabled in the UI).
  if (useCloudLLM) {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_BASE_URL = joinUrl(cloudWebsiteUrl!, '/openai/api/v1');
    process.env.OPENAI_API_KEY = cloudToken!;
    // Cloud mode owns model selection. Settings.openaiModel is
    // ignored — a leftover local-mode model id (e.g. an LM Studio
    // model name) carried into the cloud request would land in a
    // credit pool the user doesn't have, returning 402. Hardcoding
    // a known cloud-default sentinel avoids that failure mode.
    process.env.OPENAI_MODEL = 'gpt-4o';
  } else {
    switch (settings.llmProvider) {
      case 'gemini':
        process.env.LLM_PROVIDER = 'gemini';
        setIfPresent('GOOGLE_API_KEY', settings.googleApiKey);
        setIfPresent('GEMINI_MODEL', settings.geminiModel || 'gemini-2.5-flash');
        break;
      case 'openai':
      default:
        process.env.LLM_PROVIDER = 'openai';
        setIfPresent('OPENAI_API_KEY', settings.openaiApiKey);
        setIfPresent(
          'OPENAI_BASE_URL',
          settings.openaiBaseUrl || 'https://api.openai.com/v1',
        );
        setIfPresent('OPENAI_MODEL', settings.openaiModel || 'gpt-4o');
        break;
    }
  }

  // Phase 6.5b: bridge the user's settings to pi-ai's per-provider
  // env-var discovery. Pi-ai's `findEnvKeys()` reads canonical names
  // (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, …); without
  // these set explicitly, pi-coding-agent silently picks no model and
  // session.prompt() either errors with "No API key found" or returns
  // an empty stream.
  //
  // Cast wide: set every key the user has configured. Multiple keys
  // CAN coexist — pi-ai picks the one matching the selected model.
  //
  // OpenRouter is the load-bearing case: many users configure it via
  // settings.llmProvider='openai' + openaiBaseUrl pointing at
  // openrouter.ai. Detect that pattern and forward the key.
  if (
    settings.openaiApiKey?.trim() &&
    settings.openaiBaseUrl?.toLowerCase().includes('openrouter.ai')
  ) {
    setIfPresent('OPENROUTER_API_KEY', settings.openaiApiKey);
  }
  setIfPresent('OPENROUTER_API_KEY', settings.openRouterApiKey);
  setIfPresent('GEMINI_API_KEY', settings.googleApiKey);
  setIfPresent('GOOGLE_API_KEY', settings.googleApiKey);

  // VLM (vision judge) env wiring:
  //   - vlmJudge=false → leave VLM_* env alone. The .env-loaded fallback
  //     (dev users with VLM_* in dhee-core/.env) survives. Production
  //     users with vlmJudge off won't trigger VLM calls anyway, so the
  //     stale env doesn't matter.
  //   - vlmJudge=true + llmBackend='cloud' + cloudAuth → auto-route VLM
  //     to the same dhee Cloud proxy as the LLM. The user doesn't
  //     have to reconfigure.
  //   - vlmJudge=true + local LLM → set VLM_* from Settings (skip-on-empty
  //     so the .env fallback still fires for dev users who haven't filled
  //     the VLM Settings fields).
  if (settings.vlmJudge) {
    if (useCloudVLM) {
      process.env.VLM_PROVIDER = 'openai';
      process.env.VLM_BASE_URL = joinUrl(cloudWebsiteUrl!, '/openai/api/v1');
      process.env.VLM_API_KEY = cloudToken!;
      // Cloud mode: model selection is owned by the cloud proxy. The
      // Settings UI no longer exposes a VLM Model ID field in cloud
      // mode, so we send a vision-capable default and let the proxy
      // map / override it.
      process.env.VLM_MODEL = 'gpt-4o';
    } else if (settings.vlmProvider === 'gemini') {
      process.env.VLM_PROVIDER = 'gemini';
      setIfPresent('VLM_API_KEY', settings.vlmApiKey);
      setIfPresent('VLM_MODEL', settings.vlmModel);
      // gemini's openai-compatible endpoint is the default-base-url
      // table; setting VLM_BASE_URL explicitly here keeps the env
      // self-describing for log-line readers.
      process.env.VLM_BASE_URL =
        'https://generativelanguage.googleapis.com/v1beta/openai/';
    } else {
      // openai-compatible (default). User-supplied baseUrl is the only
      // way to point at a self-hosted vision model (LM Studio with
      // qwen-vl, llama.cpp with llava, etc.).
      setIfPresent('VLM_PROVIDER', 'openai');
      setIfPresent('VLM_BASE_URL', settings.vlmBaseUrl);
      setIfPresent('VLM_API_KEY', settings.vlmApiKey);
      setIfPresent('VLM_MODEL', settings.vlmModel);
    }
  }

  // Per-tier routing: when the user opted out of the
  // "use same LLM for everything" toggle, mirror the three tier
  // configs into LLM_TIER_*_* env vars and flip on
  // LLM_ROUTING_ENABLED. dhee-core's LLMRouter picks these up at
  // construction time. Heavy = the flat OPENAI_*/GOOGLE_*/GEMINI_*
  // fields the user already entered (so the primary section in the UI
  // doubles as the heavy tier).
  //
  // Cloud-LLM mode overrides this: when llmBackend='cloud', every tier
  // must point at the cloud proxy with the cloud token and the
  // cloud-default model — settings.llmTier* configs are ignored, same
  // contract as the flat OPENAI_* block above. Without this override,
  // a user who once configured a per-tier model against a different
  // baseUrl would have that stale value ride through to the cloud
  // proxy and produce a 402 from the credit pool.
  if (!settings.llmUseSameForAllTiers) {
    process.env.LLM_ROUTING_ENABLED = 'true';
    if (useCloudLLM) {
      const cloudCfg: LLMTierConfig = {
        provider: 'openai',
        openaiBaseUrl: joinUrl(cloudWebsiteUrl!, '/openai/api/v1'),
        openaiApiKey: cloudToken!,
        openaiModel: 'gpt-4o',
        googleApiKey: '',
        geminiModel: '',
      };
      writeTierEnv('HEAVY', cloudCfg);
      writeTierEnv('MEDIUM', cloudCfg);
      writeTierEnv('LIGHT', cloudCfg);
    } else {
      writeTierEnv('HEAVY', tierConfigFromPrimarySettings(settings));
      writeTierEnv('MEDIUM', settings.llmTierMedium);
      writeTierEnv('LIGHT', settings.llmTierLight);
    }
  }

  // NODE_ENV is set by the Electron build pipeline (webpack
  // DefinePlugin replaces process.env.NODE_ENV at compile time);
  // setting it at runtime is both redundant and triggers a terser
  // "Invalid assignment" because the LHS gets constant-folded.

  log.info(
    `[applyEnvFromSettings] LLM_PROVIDER=${process.env.LLM_PROVIDER} ` +
      `OPENAI_BASE_URL=${process.env.OPENAI_BASE_URL ?? '(unset)'} ` +
      `OPENAI_MODEL=${process.env.OPENAI_MODEL ?? '(unset)'} ` +
      `GEMINI_MODEL=${process.env.GEMINI_MODEL ?? '(unset)'} ` +
      `COMFY_MODE=${process.env.COMFY_MODE ?? '(unset)'} ` +
      `COMFYUI_BASE_URL=${process.env.COMFYUI_BASE_URL ?? '(unset)'}`,
  );
}

/**
 * Build the `LLMClientConfig` from settings. The provider routing
 * (`LLM_PROVIDER` env var) is set by `applyEnvFromSettings`;
 * dhee-ink's `getLLMConfig()` reads that env to dispatch. The
 * explicit `LLMClientConfig` here just carries baseUrl / apiKey /
 * model so the manager doesn't need to read env vars at construction
 * time for the active provider.
 */
function buildLLMConfig(settings: AppSettings): LLMClientConfig {
  // Settings panel is the only source of truth. cloudAuth used to
  // override here too — pulled out so the desktop's UI matches what
  // dhee-core actually sees.
  switch (settings.llmProvider) {
    case 'gemini':
      return {
        apiKey: settings.googleApiKey.trim(),
        model: settings.geminiModel.trim() || 'gemini-2.5-flash',
      };
    case 'openai':
    default:
      return {
        apiKey: settings.openaiApiKey.trim(),
        baseUrl: settings.openaiBaseUrl.trim() || 'https://api.openai.com/v1',
        model: settings.openaiModel.trim() || 'gpt-4o',
      };
  }
}

/**
 * Translate a `ConversationEvents` object (the dhee-ink callback
 * surface) into a stream of `dheeCoreEvent`s on `eventCb`. Each
 * callback's args are normalized into a `data` payload; the
 * `eventName` matches the existing WebSocket `ServerMessageType` so
 * the renderer doesn't have to learn new event names.
 *
 * Exported for testing — IPC bridge tests use this directly to verify
 * event translation independently of the full manager wiring.
 */
export function buildEventsAdapter(
  eventCb: dheeCoreEventCallback,
): ConversationEvents {
  const emit = (eventName: string, sessionId: string, data: unknown) =>
    eventCb({ eventName, sessionId, data });

  return {
    onProgress: (sessionId, percentage, message) =>
      emit('progress', sessionId, { percentage, message }),
    onToolCall: (sessionId, toolCallId, toolName, args, agentName) =>
      emit('tool_call', sessionId, {
        toolCallId,
        toolName,
        arguments: args,
        agentName,
        status: 'in_progress',
      }),
    onToolResult: (
      sessionId,
      toolCallId,
      toolName,
      result,
      isError,
      agentName,
    ) =>
      emit('tool_result', sessionId, {
        toolCallId,
        toolName,
        result,
        isError,
        agentName,
      }),
    onTodoUpdate: (sessionId, todos) =>
      emit('todo_updated', sessionId, { todos }),
    onAgentText: (sessionId, text, isFinal) =>
      emit('stream_chunk', sessionId, {
        content: text,
        done: isFinal ?? false,
      }),
    onQuestion: (
      sessionId,
      question,
      isConfirmation,
      options,
      autoApproveTimeoutMs,
    ) =>
      emit('agent_question', sessionId, {
        question,
        isConfirmation,
        options,
        autoApproveTimeoutMs,
      }),
    onAgentStatus: (sessionId, status, agentName) =>
      emit('status', sessionId, { status, agentName }),
    onStreamingText: (sessionId, chunk, done) =>
      emit('stream_chunk', sessionId, { content: chunk, done }),
    onToolStreaming: (
      sessionId,
      toolCallId,
      chunk,
      done,
      agentName,
      toolName,
      reset,
    ) =>
      emit('stream_chunk', sessionId, {
        content: chunk,
        done,
        toolCallId,
        agentName,
        toolName,
        reset,
      }),
    onContextUsage: (sessionId, data) => emit('context_usage', sessionId, data),
    onPhaseTransition: (sessionId, data) =>
      emit('phase_transition', sessionId, data),
    onTimelineUpdate: (sessionId, data) =>
      emit('timeline_update', sessionId, data),
    onNotification: (sessionId, data) => emit('notification', sessionId, data),
    onProjectFocused: (sessionId, data) =>
      emit('project_focused', sessionId, data),
    onMediaGenerated: (sessionId, data) =>
      emit('media_generated', sessionId, data),
    // Session lifecycle transitions. The renderer subscribes via the
    // 'session_status' channel to render a "thinking…" /
    // "Supervisor reviewing…" pill so the chat is no longer "frozen
    // with no visible explanation" during server-initiated turns.
    onSessionStatus: (sessionId, data) =>
      emit('session_status', sessionId, data),
  };
}

export class dheeCoreManager {
  /**
   * Phase 6.4: replaces the old `cm: ConversationManager | null` field.
   * The embedded ConversationManager was deleted along with the legacy
   * pi-coding-agent stack (d6f11bd); started state is now just a flag
   * the IPC bridge can poll via `isStarted()`.
   */
  private started = false;

  private managerModule: ManagerModule | null = null;

  /**
   * sessionId → absolute projectDir for the project that session is
   * focused on. Populated by `focusSessionProject` (called from the
   * renderer when the user opens a project). Read by `redoNode` and
   * `invalidateNodes` so they know which project's walkState to
   * mutate — replacing the equivalent session-scoped state that used
   * to live in the now-defunct `ConversationManager` (BUG-016).
   */
  private sessionProjects = new Map<string, string>();

  /**
   * Phase 6.3: per-session boolean flags (autonomous mode, pi
   * oversight, VLM judge) the renderer sets via IPC. No consumer
   * reads them in this manager today — they're held for the
   * eventual pi-agent-in-process integration to consume.
   */
  private sessionFlags = new Map<
    string,
    { autonomousMode?: boolean; piOversight?: boolean; vlmJudge?: boolean }
  >();

  /** Lazy-loaded dhee-core/dag for the walker-driven invalidate + regen helpers. */
  private dagModule: DagModule | null = null;

  /**
   * Phase 6.5b: most recent AppSettings handed to start() / restart().
   * chatPrompt reads `llmProvider` / `openaiApiKey` / `openaiBaseUrl` /
   * `openaiModel` / `googleApiKey` / `geminiModel` etc. from here to
   * derive the {provider, modelId, apiKey} triple it passes to
   * buildPiSession. Necessary because pi-coding-agent's
   * `findInitialModel` heuristic doesn't reliably pick up env-only
   * credentials.
   */
  private lastSettings: AppSettings | null = null;

  /**
   * Test seam — seed `lastSettings` without going through start().
   * Tests inject minimal AppSettings so chatPrompt's resolver can
   * return a model triple. Production callers go through start().
   */
  __setLastSettingsForTesting(s: AppSettings): void {
    this.lastSettings = s;
  }

  /**
   * Phase 6.5: long-lived pi-coding-agent AgentSession per chat
   * sessionId. Built lazily on the first chatPrompt + reused across
   * turns so context + transcript persist for the lifetime of the
   * desktop process. Disposed on deleteSession.
   */
  private agentSessions = new Map<
    string,
    {
      session: {
        sessionId?: string;
        sessionFile?: string;
        subscribe: (cb: (ev: unknown) => void) => () => void;
        prompt: (m: string) => Promise<void>;
        dispose?: () => void;
      };
    }
  >();

  private async getDagModule(): Promise<DagModule> {
    if (!this.dagModule) {
      this.dagModule = await loadDagModule();
    }
    return this.dagModule;
  }

  /**
   * Construct the embedded ConversationManager. Sets process.env
   * from settings BEFORE constructing the manager so any tool that
   * reads env vars at construction time sees the right values.
   *
   * Async because the manager bundle is ESM and loaded via dynamic
   * import (CJS Electron main → ESM dhee-ink). Subsequent calls
   * reuse the cached module reference.
   */
  async start(
    settings: AppSettings,
    cloudAuth?: dheeCloudAuthRuntime | null,
  ): Promise<void> {
    await applyRuntimeAnalyticsConfig({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      dirname: __dirname,
      env: process.env,
    });

    if (!this.managerModule) {
      this.managerModule = await loadManagerModule();
    }
    this.managerModule.configurePostHogRuntime?.({
      apiKey: process.env.POSTHOG_API_KEY,
      host: process.env.POSTHOG_HOST,
      analyticsSalt: process.env.ANALYTICS_SALT,
    });
    // Load dhee-ink/.env BEFORE applying AppSettings so the
    // settings UI's explicit values still win for any field the user
    // has filled in. Loaded values fill the gaps (LLM_TIER_*,
    // GROQ_*, OpenRouter keys, etc. that the desktop UI doesn't
    // model). In packaged builds the .env doesn't ship, so this is
    // a no-op there.
    const devEnv = this.managerModule.loadDevEnv?.();
    // dhee-ink's filesystem helpers (projectFileIO, loadProject)
    // default basePath to `process.cwd()`. Embedded in Electron, cwd
    // points at dhee-desktop/ — not where projects live.
    //
    // Setting dhee_PROJECTS_DIR exposes the right basePath via env;
    // dhee-ink reads this in `getProjectsDir()` and (per the
    // companion fix in projectFileIO) uses it as the default basePath
    // when no session-context override is in scope.
    //
    // Using an env var (instead of process.chdir) is critical because
    // many handlers in dhee-desktop's main process call
    // `process.cwd()` directly for path normalization — chdir-ing
    // globally would silently break those.
    if (devEnv?.projectsDir) {
      process.env.dhee_PROJECTS_DIR = devEnv.projectsDir;
    }

    // Phase 6.4: WorkflowModeRegistry + ConversationManager were
    // deleted with the legacy stack. We no longer need to:
    //   - pin a user-workflows dir (no registry to feed)
    //   - refresh the WorkflowModeRegistry after a COMFY_MODE flip
    //   - construct a ConversationManager (the embed-host helpers
    //     we still use are pure functions exported from dhee-core).

    applyEnvFromSettings(settings, cloudAuth);

    // Phase 6.5b: cache settings so chatPrompt can derive
    // {provider, modelId, apiKey} for the pi-agent.
    this.lastSettings = settings;

    // Seed process-wide oversight + VLM flags from persisted
    // AppSettings on the very first run. Pi-agent-in-process
    // consumers (Phase 6.5) will read these per-session via
    // setPiOversight / setVlmJudge.
    this.setPiOversight('', settings.piOversight);
    this.setVlmJudge('', settings.vlmJudge);
    this.started = true;
  }

  /**
   * Tear down. Safe to call when not started. Phase 6.4: there's no
   * embedded ConversationManager to shutdown anymore — just flip the
   * started flag so isStarted() reflects reality.
   */
  stop(): void {
    this.started = false;
  }

  /** Replace the manager (used when settings change). */
  async restart(
    settings: AppSettings,
    cloudAuth?: dheeCloudAuthRuntime | null,
  ): Promise<void> {
    this.stop();
    await this.start(settings, cloudAuth);
  }

  /** Whether `start()` has run. */
  isStarted(): boolean {
    return this.started;
  }

  configureAnalytics(input: {
    appVersion: string;
    installId: string;
    userId?: string;
    properties?: Record<string, unknown>;
  }): void {
    this.managerModule?.configureAnalytics?.({
      platform: 'desktop',
      appVersion: input.appVersion,
      identity: {
        installId: input.installId,
        ...(input.userId ? { userId: input.userId } : {}),
      },
      properties: input.properties,
    });
  }

  setAnalyticsIdentity(identity: { installId: string; userId?: string }): void {
    this.managerModule?.setAnalyticsIdentity?.({
      installId: identity.installId,
      ...(identity.userId ? { userId: identity.userId } : {}),
    });
  }

  identifyAnalyticsUser(identity: { installId: string; userId: string }): void {
    this.managerModule?.identifyAnalyticsUser?.({
      installId: identity.installId,
      userId: identity.userId,
    });
  }

  captureAnalyticsEvent(
    event: string,
    properties: Record<string, unknown> = {},
  ): void {
    this.managerModule?.captureAnalyticsEvent?.(event, properties, {
      component: 'dhee-desktop',
    });
  }

  isAnalyticsEnabled(): boolean {
    return this.managerModule?.isPostHogEnabled?.() === true;
  }

  async flushAnalytics(): Promise<void> {
    await this.managerModule?.shutdownPostHog?.();
  }

  /**
   * Create a new session; returns the session id and (when resuming
   * from disk) the persisted chat snapshot.
   *
   * `role` controls long-running tool availability — `'interactive'`
   * (default) strips dhee_run_to / render_scene_bundle /
   * audit_fidelity so a chat session can't accidentally block on a
   * 1–4h task. `'background'` opts in to the full toolkit.
   *
   * When `resumeSessionId` is set and recognized by dhee-core's
   * sessionStore, the in-memory ActiveSession is reconstructed under
   * that id (the on-disk JSONL is reopened on next agent build) and
   * `resumed` is true. Unknown ids fall through to a fresh-session
   * create — `id` will differ from the request and `resumed` will
   * be false.
   */
  /**
   * Phase 6.3 stub: synthetic session id, no embedded chat state.
   *
   * The renderer's chat panel calls this on mount to get a sessionId
   * it then uses as the key for focusProject / runTask / redoNode /
   * etc. Real session state (pi-coding-agent persistence, history
   * replay) returns in Phase 6.4 when the chat panel is rebuilt to
   * drive pi-agent in-process. Until then we hand back an id that's
   * good enough to thread through the IPC layer.
   */
  createSession(
    _role?: 'interactive' | 'background',
    resumeSessionId?: string,
  ): { id: string; resumed: boolean } {
    if (resumeSessionId) {
      return { id: resumeSessionId, resumed: true };
    }
    const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return { id, resumed: false };
  }

  /**
   * Read the persisted chat snapshot for a sessionId. Returns null
   * when dhee-core doesn't expose the helper (older version) or
   * the id is unknown.
   */
  /**
   * Phase 6.3 stub: no chat history persisted today. The renderer
   * treats null as "fresh session, nothing to replay." Real history
   * comes back in Phase 6.4 alongside pi-agent in-process.
   */
  getSessionHistorySnapshot(_sessionId: string): {
    messages: Array<Record<string, unknown>>;
    toolCalls: Array<Record<string, unknown>>;
    focusedProject?: string;
    compactionCount: number;
  } | null {
    return null;
  }

  /**
   * Hard-delete the persisted chat for `oldSessionId` and mint a fresh
   * session for the renderer to switch to. Returns the new id. Tears
   * down any in-memory ActiveSession for the old id along the way.
   */
  /**
   * Phase 6.3 stub: no persisted history to clear; drop the in-memory
   * session→project mapping and mint a fresh sessionId.
   */
  clearChatHistory(
    oldSessionId: string,
    role?: 'interactive' | 'background',
  ): { newSessionId: string } {
    this.sessionProjects.delete(oldSessionId);
    this.sessionFlags.delete(oldSessionId);
    const fresh = this.createSession(role);
    return { newSessionId: fresh.id };
  }

  /**
   * Phase 6.3 stub: pin the session→projectDir mapping. Mirrors
   * focusSessionProject — both IPC paths land in the same map so
   * runTask + redoNode + invalidateNodes find the projectDir
   * regardless of which one the renderer fired.
   */
  async configureSessionForProject(
    sessionId: string,
    opts: ConfigureProjectOpts,
  ): Promise<void> {
    if (opts.projectDir) {
      this.sessionProjects.set(sessionId, opts.projectDir);
    }
    return;
  }

  /**
   * Run a task on the given session. `eventCb` receives a stream of
   * dheeCoreEvents (mirroring the existing WebSocket message types)
   * — typically the IPC bridge re-publishes each event over
   * `webContents.send('dhee:event', …)`.
   *
   * Returns an error-shaped result rather than throwing if the manager
   * hasn't been started — the caller (IPC bridge) shouldn't have to
   * try/catch every call.
   */
  /**
   * Phase 6.2 rewire: dispatch a bundle DAG run via the
   * BackgroundTaskRunner singleton — no longer routes through the
   * dead ConversationManager.runTask facade. The `task` string is
   * informational only (the runner reads the spec's projectDir +
   * stage; it doesn't interpret natural language). For pi-agent-
   * driven chat where the model picks tools, Phase 6.2b will hang
   * pi-agent in-process and have it call dhee_run_bundle.
   *
   * Translates the runner's typed events (tool / result /
   * notification / asset / terminal) into dheeCoreEvents matching
   * the existing renderer vocabulary (tool_call / tool_result /
   * status / asset / etc).
   */
  async runTask(
    sessionId: string,
    _task: string,
    opts: RunTaskOpts,
    eventCb: dheeCoreEventCallback,
  ): Promise<RunResult> {
    const projectDir = this.sessionProjects.get(sessionId);
    if (!projectDir) {
      return {
        status: 'failed',
        error: `no project focused for session ${sessionId} — call focusSessionProject first`,
      };
    }
    const projectName = path.basename(projectDir);

    const runnersMod = await loadRunnersModule();
    const runner = runnersMod.getBackgroundTaskRunner() as unknown as {
      dispatch: (spec: {
        kind: 'run_to';
        projectName: string;
        params: { projectDir: string; stage?: string };
        sessionId: string;
      }) =>
        | { status: 'started'; taskId: string }
        | {
            status: 'rejected';
            reason: 'task_already_running';
            activeTaskId: string;
            activeTaskKind: string;
            activeProjectName: string;
          };
      on: (event: string, handler: (payload: unknown) => void) => () => void;
    };

    const dispatchResult = runner.dispatch({
      kind: 'run_to',
      projectName,
      params: {
        projectDir,
        ...(opts.stopAtStage ? { stage: opts.stopAtStage } : {}),
      },
      sessionId,
    });

    if (dispatchResult.status === 'rejected') {
      return {
        status: 'failed',
        error: `task already running on project '${dispatchResult.activeProjectName}' (taskId ${dispatchResult.activeTaskId})`,
      };
    }

    const taskId = dispatchResult.taskId;
    const emit = (eventName: string, data: unknown) =>
      eventCb({ eventName, sessionId, data });

    return new Promise<RunResult>((resolve) => {
      const offs: Array<() => void> = [];
      const cleanup = () => {
        for (const off of offs) off();
      };
      const matches = (e: unknown): e is { task?: { id?: string } } =>
        typeof e === 'object' && e !== null && (e as { task?: { id?: string } }).task?.id === taskId;

      offs.push(
        runner.on('tool', (e) => {
          if (!matches(e)) return;
          const evt = e as { toolName?: string; nodeId?: string };
          emit('tool_call', {
            toolCallId: evt.nodeId ?? `${taskId}:${evt.toolName ?? 'tool'}`,
            toolName: evt.toolName,
            arguments: {},
            status: 'in_progress',
          });
        }),
      );
      offs.push(
        runner.on('result', (e) => {
          if (!matches(e)) return;
          const evt = e as {
            toolName?: string;
            nodeId?: string;
            filePath?: string;
            status?: string;
            error?: string;
          };
          emit('tool_result', {
            toolCallId: evt.nodeId ?? `${taskId}:${evt.toolName ?? 'tool'}`,
            toolName: evt.toolName,
            result: {
              filePath: evt.filePath,
              status: evt.status,
              error: evt.error,
            },
            isError: evt.status === 'error' || !!evt.error,
          });
        }),
      );
      offs.push(
        runner.on('notification', (e) => {
          if (!matches(e)) return;
          const evt = e as { level?: string; message?: string };
          emit('status', { status: 'info', level: evt.level, message: evt.message });
        }),
      );
      offs.push(
        runner.on('asset', (e) => {
          if (!matches(e)) return;
          const evt = e as { kind?: string; filePath?: string; nodeId?: string };
          emit('asset', { kind: evt.kind, filePath: evt.filePath, nodeId: evt.nodeId });
        }),
      );
      offs.push(
        runner.on('completed', (e) => {
          if (!matches(e)) return;
          cleanup();
          resolve({ status: 'completed' });
        }),
      );
      offs.push(
        runner.on('failed', (e) => {
          if (!matches(e)) return;
          const evt = e as { error?: string };
          cleanup();
          resolve({ status: 'failed', error: evt.error });
        }),
      );
      offs.push(
        runner.on('cancelled', (e) => {
          if (!matches(e)) return;
          cleanup();
          resolve({ status: 'cancelled' });
        }),
      );
    });
  }

  /**
   * Phase 6.2 rewire: cancel the active BackgroundTaskRunner task.
   * Session id is informational only — the runner is global (one
   * task at a time). Returns false when nothing is running.
   *
   * Phase 6.5c.e: ALSO aborts the per-session AgentSession (if one
   * exists) so the Stop button halts pi-agent mid-prompt, not just
   * the runner task. Without this the agent keeps reasoning + may
   * call more tools even though the user clicked Stop.
   */
  async cancelTask(sessionId: string): Promise<boolean> {
    let aborted = false;
    const agentSession = this.agentSessions.get(sessionId);
    if (agentSession?.session) {
      try {
        const sess = agentSession.session as { abort?: () => Promise<void> };
        if (typeof sess.abort === 'function') {
          await sess.abort();
          aborted = true;
        }
      } catch {
        // Best-effort — runner cancel below still fires.
      }
    }
    const runnersMod = await loadRunnersModule();
    const runnerCancelled = runnersMod.getBackgroundTaskRunner().cancel();
    return runnerCancelled || aborted;
  }

  /**
   * Cancel whatever the BackgroundTaskRunner is currently
   * executing. Independent of any chat session — used by the Stop
   * button so cancellation is instant even while the main session
   * is mid-reply.
   */
  async cancelBackgroundTask(): Promise<boolean> {
    const mod = await loadRunnersModule();
    return mod.getBackgroundTaskRunner().cancel();
  }

  /** Snapshot of the runner's current state (or `{ active: false }`). */
  async getBackgroundTaskStatus(): Promise<{
    active: boolean;
    cancelling?: boolean;
    taskId?: string;
    kind?: string;
    projectName?: string;
    startedAt?: number;
    sessionId?: string;
  }> {
    const mod = await loadRunnersModule();
    const runner = mod.getBackgroundTaskRunner();
    const active = runner.getActive();
    if (!active) return { active: false };
    return {
      active: true,
      cancelling: runner.isCancelling(),
      taskId: active.id,
      kind: active.spec.kind,
      projectName: active.spec.projectName,
      startedAt: active.startedAt,
      sessionId: active.spec.sessionId,
    };
  }

  /**
   * Regenerate a single bundle node (or a single collection-item of a
   * node). Looks up the session's focused projectDir from
   * `sessionProjects`, then forwards to dhee-core/dag.regenerateNode
   * — which invalidates the walkState entry, persists the change, and
   * dispatches `runProjectViaBundle({runOnly:[nodeId]})` so the
   * walker re-runs that node and its downstream.
   *
   * Phase 6 (BUG-016 proper fix): replaces the dead
   * `ConversationManager.redoNode` facade. Pre-Phase-6 this method
   * silently threw because the stub manager has no redoNode method.
   */
  async redoNode(
    sessionId: string,
    nodeId: string,
    opts?: RedoNodeOpts,
  ): Promise<{
    ok: boolean;
    nodeId?: string;
    editedPrompt?: string;
    error?: string;
  }> {
    const projectDir = this.sessionProjects.get(sessionId);
    if (!projectDir) {
      return {
        ok: false,
        error: `no project focused for session ${sessionId} — call focusSessionProject first`,
      };
    }
    const dag = await this.getDagModule();
    const result = await dag.regenerateNode({
      projectDir,
      nodeId,
      ...(opts?.itemId ? { itemId: opts.itemId } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
    return {
      ok: result.ok,
      ...(result.nodeId ? { nodeId: result.nodeId } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }

  /**
   * Mark walker nodes as invalidated on disk without dispatching a
   * re-run. The walker picks them up on the next dispatch.
   *
   * Phase 6 (BUG-016 proper fix): replaces the dead
   * `ConversationManager.invalidateNodes` facade.
   */
  async invalidateNodes(
    sessionId: string,
    nodeIds: string[],
    source?: string,
  ): Promise<{ invalidated: string[]; notFound: string[] }> {
    const projectDir = this.sessionProjects.get(sessionId);
    if (!projectDir) {
      throw new Error(
        `no project focused for session ${sessionId} — call focusSessionProject first`,
      );
    }
    const dag = await this.getDagModule();
    const result = await dag.invalidateNodes({
      projectDir,
      nodeIds,
      ...(source ? { source } : {}),
    });
    if (result.error) throw new Error(result.error);
    return { invalidated: result.invalidated, notFound: result.notFound };
  }

  // Phase 6.3 stubs — store the flags per session so the IPC handlers
  // don't throw on the now-dead ConversationManager. No consumer reads
  // them in this manager today; pi-agent-in-process (Phase 6.4) will.

  setAutonomousMode(sessionId: string, enabled: boolean): void {
    const f = this.sessionFlags.get(sessionId) ?? {};
    f.autonomousMode = enabled;
    this.sessionFlags.set(sessionId, f);
  }

  setPiOversight(sessionId: string, enabled: boolean): void {
    const f = this.sessionFlags.get(sessionId) ?? {};
    f.piOversight = enabled;
    this.sessionFlags.set(sessionId, f);
  }

  setVlmJudge(sessionId: string, enabled: boolean): void {
    const f = this.sessionFlags.get(sessionId) ?? {};
    f.vlmJudge = enabled;
    this.sessionFlags.set(sessionId, f);
  }

  // ── Custom ComfyUI workflow management ─────────────────────────────
  // Phase 6.4 stubs. The underlying services/comfyui/workflowIntegration.ts
  // + services/providers/WorkflowModeRegistry.ts were deleted in d6f11bd
  // (full legacy cleanup). Until the bundle architecture reintroduces
  // a workflow registry, these methods keep the Settings → Workflows
  // panel from crashing by reporting "no workflows" / "not supported."
  // Re-enabling is tracked separately from BUG-016.

  validateWorkflow(_workflowPath: string):
    | { ok: true; totalNodes: number; detectedPipeline: string; inputNodeCount: number; loraCount: number }
    | { ok: false; reason: string }
    | { ok: false; reason: string; error: true } {
    return {
      ok: false,
      reason: 'Custom workflow validation is temporarily disabled (Phase 6.4 cleanup; reintroduces in the bundle-native workflow registry).',
      error: true,
    };
  }

  listWorkflows(_opts?: { userOnly?: boolean }): Array<{
    id: string;
    displayName: string;
    pipeline: string;
    builtIn: boolean;
    isOverride: boolean;
    active: boolean;
  }> {
    return [];
  }

  getWorkflow(_id: string): Record<string, unknown> | undefined {
    return undefined;
  }

  updateWorkflow(_id: string, _patch: Record<string, unknown>): Record<string, unknown> {
    throw new Error(
      'Custom workflow CRUD is temporarily disabled (Phase 6.4 cleanup; returns with the bundle-native workflow registry).',
    );
  }

  deleteWorkflow(_id: string): void {
    throw new Error(
      'Custom workflow CRUD is temporarily disabled (Phase 6.4 cleanup; returns with the bundle-native workflow registry).',
    );
  }

  /**
   * Record which project a session is focused on. The renderer fires
   * this from `useDheeSession.focusProject(projectName, projectDir)`
   * when the user opens a project; redoNode / invalidateNodes both
   * read from the resulting map to know which project's walkState to
   * mutate (Phase 6 — see sessionProjects field).
   *
   * `projectDir` is optional only for backwards compat with the
   * pre-Phase-6 IPC contract. Newer callers must pass it explicitly.
   */
  async focusSessionProject(
    sessionId: string,
    _projectName: string,
    projectDir?: string,
  ): Promise<OkResponse> {
    if (projectDir) {
      this.sessionProjects.set(sessionId, projectDir);
    }
    // The dead ConversationManager facade used to track project focus
    // internally; we now own that mapping. Returning ok eagerly is
    // safe — no other call path depends on the legacy stub anymore.
    return { ok: true };
  }

  /**
   * Phase 6.5: send a user message to the chat session's pi-agent and
   * return the assistant text + tool-call summary.
   *
   * Lazy-builds an AgentSession on the first message of the session
   * (focused on the project's directory so dhee-agent's tools see the
   * right cwd). Subsequent messages reuse the same session for
   * context continuity. Disposal happens in deleteSession.
   *
   * Errors are wrapped in {ok:false, error} envelopes so the IPC
   * bridge can surface them in the chat panel without crashing.
   */
  async chatPrompt(
    sessionId: string,
    message: string,
    eventCb?: dheeCoreEventCallback,
  ): Promise<
    | { ok: true; assistant_text: string; tool_calls: Array<{ name: string }> }
    | { ok: false; error: string }
  > {
    const projectDir = this.sessionProjects.get(sessionId);
    if (!projectDir) {
      return {
        ok: false,
        error: `no project focused for session ${sessionId} — call focusSessionProject first`,
      };
    }

    // chatDeps is lazy-loaded from dhee-core; tests inject via __setChatDeps.
    let deps: ChatDeps;
    try {
      deps = await loadChatDeps();
    } catch (err) {
      return { ok: false, error: `failed to load pi-agent helpers: ${(err as Error).message}` };
    }

    let entry = this.agentSessions.get(sessionId);
    if (!entry) {
      // Phase 6.5b: derive the explicit {provider, modelId, apiKey} so
      // pi-coding-agent doesn't fall back to its silent-no-op
      // auto-discovery. Hard-fail with a clear message when settings
      // don't yield a usable provider — better than the previous
      // "ok:true with empty assistant_text" silent failure.
      if (!this.lastSettings) {
        return {
          ok: false,
          error: 'dheeCoreManager not started yet — chatPrompt needs cached settings.',
        };
      }
      const piModel = resolvePiModelFromSettings(this.lastSettings);
      if (!piModel) {
        return {
          ok: false,
          error:
            "No LLM provider configured. Open Settings → Quickstart to add an API key (OpenRouter / OpenAI / Gemini), then send the message again.",
        };
      }
      try {
        // Phase 6.5c.d: persist chat history per project. Pi-coding-
        // agent's `continueRecent` picks the most recent JSONL in
        // sessionsDir (or mints a new one); the desktop's chat panel
        // gets resumable conversations across restarts.
        //
        // sessionsDir resolution is fault-tolerant — if app.getPath
        // isn't available (jest electron-mock doesn't stub it) or
        // the dir can't be created, we fall through to the in-memory
        // session manager (no persistence; old behavior).
        let sessionsDir: string | undefined;
        try {
          const projectSlug = path.basename(projectDir).replace(/[^A-Za-z0-9_\-]+/g, '_');
          const userData = app.getPath?.('userData');
          if (userData) {
            sessionsDir = path.join(userData, 'pi-sessions', projectSlug);
            if (!fsExistsSync(sessionsDir)) {
              fsMkdirSync(sessionsDir, { recursive: true });
            }
          }
        } catch {
          sessionsDir = undefined;
        }
        const built = await deps.buildPiSession({
          sessionManager: undefined as never,
          cwd: projectDir,
          ...(sessionsDir ? { sessionsDir } : {}),
          modelProvider: piModel.provider,
          modelId: piModel.modelId,
          apiKey: piModel.apiKey,
        });
        entry = { session: built.session };
        this.agentSessions.set(sessionId, entry);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    // Phase 6.5c.b: translate pi-agent events into dheeCoreEvents
    // the renderer's chat panel already knows how to handle. Streaming
    // text becomes 'stream_chunk' events; tool_execution_start
    // becomes 'tool_call'; tool_execution_end becomes 'tool_result'
    // (with details.file_path forwarded so the show_* tools render
    // inline media). The chat panel's existing listeners (subscribe
    // via window.dhee.on) pick these up; no panel changes needed.
    let toolCallCounter = 0;
    const onEvent = eventCb
      ? (ev: unknown) => {
          const e = ev as {
            type?: string;
            assistantMessageEvent?: { type?: string; delta?: string };
            toolName?: string;
            toolCallId?: string;
            args?: unknown;
            arguments?: unknown;
            result?: unknown;
            isError?: boolean;
            details?: unknown;
          };
          if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
            const delta = e.assistantMessageEvent.delta ?? '';
            if (delta) {
              eventCb({
                eventName: 'stream_chunk',
                sessionId,
                data: { content: delta, done: false },
              });
            }
            return;
          }
          if (e.type === 'tool_execution_start') {
            toolCallCounter += 1;
            // Pi's ToolExecutionStartEvent uses `args` (not `arguments`)
            // for the parsed parameters. ToolCallCard.summarizeArgs
            // expects the renderer-side `arguments` key, so map.
            const toolCallId = e.toolCallId ?? `tc-${sessionId}-${toolCallCounter}`;
            const startEvt = ev as { args?: unknown };
            eventCb({
              eventName: 'tool_call',
              sessionId,
              data: {
                toolCallId,
                toolName: e.toolName ?? 'unknown',
                arguments: startEvt.args ?? {},
                status: 'in_progress',
              },
            });
            return;
          }
          if (e.type === 'tool_execution_end') {
            // Pi's ToolExecutionEndEvent.result is the AgentToolResult
            // returned by the tool's execute() — has shape
            // `{content: [...], details: {...}}`. ToolCallCard.tsx
            // looks for `result.file_path` (top-level), so flatten
            // details onto result so dhee_show_* tools' file_path
            // surfaces inline.
            const piResult = e.result as
              | { content?: Array<{ type?: string; text?: string }>; details?: Record<string, unknown> }
              | undefined;
            const flatResult: Record<string, unknown> = {
              ...(piResult?.details ?? {}),
              ...(Array.isArray(piResult?.content) && piResult.content[0]?.type === 'text'
                ? { content: piResult.content[0].text }
                : {}),
            };
            eventCb({
              eventName: 'tool_result',
              sessionId,
              data: {
                toolCallId: e.toolCallId,
                toolName: e.toolName,
                result: flatResult,
                isError: e.isError ?? false,
              },
            });
            return;
          }
        }
      : undefined;

    const result = await deps.runAgentTurn(entry.session, message, {
      keepAlive: true,
      ...(onEvent ? { onEvent } : {}),
    });

    // Emit a final stream_chunk(done:true) so the renderer can close
    // any open streaming bubble. Idempotent — no-op if the chat panel
    // didn't open one.
    if (eventCb) {
      eventCb({
        eventName: 'stream_chunk',
        sessionId,
        data: { content: '', done: true },
      });
    }
    return result;
  }

  /**
   * Phase 6.5: also dispose the long-lived AgentSession when its
   * sessionId is deleted. Phase 6.3 just cleared the in-process
   * mappings; now we also release the pi-agent JSONL handle + any
   * provider sockets the agent opened.
   */
  deleteSession(sessionId: string): void {
    const agent = this.agentSessions.get(sessionId);
    if (agent?.session.dispose) {
      try {
        agent.session.dispose();
      } catch {
        // Best-effort — never let disposal failure block the IPC handler.
      }
    }
    this.agentSessions.delete(sessionId);
    this.sessionProjects.delete(sessionId);
    this.sessionFlags.delete(sessionId);
  }

  // Phase 6.4: requireStarted() removed — no embedded ConversationManager
  // to require. Methods that need the started state read `this.started`
  // directly.
}
