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
import fs from 'fs';
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

type ConversationManagerConfig = {
  llmConfig: LLMClientConfig;
};

type ConversationEvents = Record<string, (...args: any[]) => void>;

type ConversationManager = {
  shutdown: () => void;
};

type AnalyticsIdentity = {
  distinctId?: string;
  installId?: string;
  userId?: string;
};

const dhee_CORE_MANAGER_MODULE = 'dhee-core/manager';

function getPackagedManagerModuleUrl(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (!resourcesPath) return null;

  return pathToFileURL(
    path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'dhee-core',
      'dist',
      'server',
      'manager.js',
    ),
  ).href;
}

type ManagerModule = {
  ConversationManager: new (
    config: ConversationManagerConfig,
  ) => ConversationManager;
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

  // ── Custom ComfyUI workflow management ─────────────────────────────
  /**
   * Pin the directory where user-uploaded workflows + manifests live.
   * Must be called before the WorkflowModeRegistry singleton is first
   * accessed — dhee-core throws if called too late.
   */
  setUserWorkflowsDir?: (path: string) => void;
  /**
   * Force the WorkflowModeRegistry to re-scan + re-apply the
   * COMFY_MODE filter. Must be called after any process.env change
   * that affects manifest visibility — flipping local↔cloud is the
   * common case during settings updates.
   */
  refreshWorkflowRegistry?: () => void;
  validateWorkflowFile?: (path: string) =>
    | { ok: true; parsed: { totalNodes: number; detectedPipeline: string; inputNodes: unknown[]; loraNodes: unknown[] } }
    | { ok: false; reason: string };
  listWorkflows?: (opts?: { userOnly?: boolean }) => Array<{
    id: string;
    displayName: string;
    pipeline: string;
    builtIn: boolean;
    isOverride: boolean;
    active: boolean;
  }>;
  getWorkflow?: (id: string) => Record<string, unknown> | undefined;
  updateWorkflow?: (id: string, patch: Record<string, unknown>) => Record<string, unknown>;
  deleteWorkflow?: (id: string) => void;

  // ── Session persistence ─────────────────────────────────────────
  /**
   * Returns a HistoryData snapshot for a sessionId by reading the
   * on-disk pi-coding-agent transcript. Returns null when the id is
   * unknown to the index. Optional in old dhee-core versions —
   * callers must null-check.
   */
  getSessionHistorySnapshot?: (sessionId: string) => {
    messages: Array<Record<string, unknown>>;
    toolCalls: Array<Record<string, unknown>>;
    focusedProject?: string;
    compactionCount: number;
  } | null;
  /** Hard-delete the JSONL transcript and forget the index entry. Idempotent. */
  clearSessionHistory?: (sessionId: string) => void;
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
      `[DheeCoreManager] Importing ${dhee_CORE_MANAGER_MODULE} via package exports`,
    );
    const module = (await import(
      /* webpackIgnore: true */ dhee_CORE_MANAGER_MODULE
    )) as ManagerModule;
    log.info('[DheeCoreManager] Package export import succeeded');
    return module;
  } catch (error) {
    log.error(
      `[DheeCoreManager] Package export import failed: ${
        (error as Error).message
      }\n${(error as Error).stack}`,
    );

    if (process.env.dhee_PACKAGED !== '1') {
      throw error;
    }

    const packagedModuleUrl = getPackagedManagerModuleUrl();
    if (!packagedModuleUrl) {
      log.error(
        '[DheeCoreManager] Cannot resolve packaged fallback manager URL',
      );
      throw error;
    }

    log.info(
      `[DheeCoreManager] Importing packaged fallback ${packagedModuleUrl}`,
    );
    const module = (await import(
      /* webpackIgnore: true */ packagedModuleUrl
    )) as ManagerModule;
    log.info('[DheeCoreManager] Packaged fallback import succeeded');
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
  };
};

let loadRunnersModule: () => Promise<RunnersModule> = () =>
  import(/* webpackIgnore: true */ 'dhee-core/runners') as Promise<RunnersModule>;

/** Test seam — replace the loader so unit tests can supply a fake. */
export function __setRunnersLoader(loader: () => Promise<RunnersModule>): void {
  loadRunnersModule = loader;
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
  };
}

export class dheeCoreManager {
  private cm: ConversationManager | null = null;

  private managerModule: ManagerModule | null = null;

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

    // Pin the user-workflows directory under userData/ so custom
    // ComfyUI workflows uploaded by the user (via the chat or the
    // Settings → Workflows tab) live in a writable, per-install
    // location. Must happen BEFORE ConversationManager is constructed
    // — once the WorkflowModeRegistry singleton is accessed, dhee-
    // core refuses further setUserWorkflowsDir calls.
    if (this.managerModule.setUserWorkflowsDir) {
      const userWorkflowsDir = path.join(
        app.getPath('userData'),
        'workflows',
        'user',
      );
      try {
        if (!fs.existsSync(userWorkflowsDir)) {
          fs.mkdirSync(userWorkflowsDir, { recursive: true });
        }
        this.managerModule.setUserWorkflowsDir(userWorkflowsDir);
        log.info(`[DheeCoreManager] User workflows dir: ${userWorkflowsDir}`);
      } catch (err) {
        log.warn(
          `[DheeCoreManager] Could not pin user workflows dir: ${(err as Error).message}`,
        );
      }
    }

    applyEnvFromSettings(settings, cloudAuth);

    // applyEnvFromSettings may have just flipped COMFY_MODE
    // (local ↔ cloud). The WorkflowModeRegistry's mode-filtered
    // view is computed at refresh() time, not on every lookup, so
    // without an explicit refresh the previous mode's filter
    // state would persist after restart() — making custom
    // workflows look "missing" until the next process restart.
    try {
      this.managerModule.refreshWorkflowRegistry?.();
    } catch (err) {
      log.warn(
        `[DheeCoreManager] WorkflowModeRegistry refresh failed: ${(err as Error).message}`,
      );
    }

    const config: ConversationManagerConfig = {
      llmConfig: buildLLMConfig(settings),
    };
    this.cm = new this.managerModule.ConversationManager(config);
    // Seed core's process-wide oversightState from the persisted
    // AppSettings on the very first run. Subsequent updates flow
    // through main.ts's `settings:update` IPC handler, which
    // calls setPiOversight / setVlmJudge directly. Without this
    // seed, a fresh manager would default both to true and then
    // immediately get overwritten on the user's next settings
    // change — fine in practice but the symmetry's nicer.
    this.setPiOversight('', settings.piOversight);
    this.setVlmJudge('', settings.vlmJudge);
  }

  /** Tear down the manager. Safe to call when not started. */
  stop(): void {
    if (this.cm) {
      this.cm.shutdown();
      this.cm = null;
    }
  }

  /** Replace the manager (used when settings change). */
  async restart(
    settings: AppSettings,
    cloudAuth?: dheeCloudAuthRuntime | null,
  ): Promise<void> {
    this.stop();
    await this.start(settings, cloudAuth);
  }

  /** Whether `start()` has run and the manager is alive. */
  isStarted(): boolean {
    return this.cm !== null;
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
  createSession(
    role?: 'interactive' | 'background',
    resumeSessionId?: string,
  ): { id: string; resumed: boolean } {
    const cm = this.requireStarted();
    // ConversationManager.createSession(mode, remoteFs, role, existingSessionId) —
    // 4th arg added by the persistence work; older builds will ignore it.
    const session = (
      cm as unknown as {
        createSession: (
          mode?: 'local' | 'remote',
          remoteFs?: undefined,
          role?: 'interactive' | 'background',
          existingSessionId?: string,
        ) => { id: string };
      }
    ).createSession('local', undefined, role ?? 'interactive', resumeSessionId);
    const resumed = !!resumeSessionId && session.id === resumeSessionId;
    return { id: session.id, resumed };
  }

  /**
   * Read the persisted chat snapshot for a sessionId. Returns null
   * when dhee-core doesn't expose the helper (older version) or
   * the id is unknown.
   */
  getSessionHistorySnapshot(sessionId: string): {
    messages: Array<Record<string, unknown>>;
    toolCalls: Array<Record<string, unknown>>;
    focusedProject?: string;
    compactionCount: number;
  } | null {
    const fn = this.managerModule?.getSessionHistorySnapshot;
    if (typeof fn !== 'function') return null;
    try {
      return fn(sessionId);
    } catch (err) {
      log.warn('[DheeCoreManager] getSessionHistorySnapshot failed:', err);
      return null;
    }
  }

  /**
   * Hard-delete the persisted chat for `oldSessionId` and mint a fresh
   * session for the renderer to switch to. Returns the new id. Tears
   * down any in-memory ActiveSession for the old id along the way.
   */
  clearChatHistory(
    oldSessionId: string,
    role?: 'interactive' | 'background',
  ): { newSessionId: string } {
    const cm = this.requireStarted();
    // Drop the in-memory state (cancels any in-flight task).
    try {
      (cm as unknown as { deleteSession?: (id: string) => void }).deleteSession?.(oldSessionId);
    } catch (err) {
      log.warn('[DheeCoreManager] deleteSession during clearChatHistory failed:', err);
    }
    // Wipe the JSONL + sessionStore index.
    try {
      this.managerModule?.clearSessionHistory?.(oldSessionId);
    } catch (err) {
      log.warn('[DheeCoreManager] clearSessionHistory failed:', err);
    }
    const fresh = this.createSession(role);
    return { newSessionId: fresh.id };
  }

  async configureSessionForProject(
    sessionId: string,
    opts: ConfigureProjectOpts,
  ): Promise<void> {
    const cm = this.requireStarted();
    // Pass through whatever ConversationManager expects. The actual
    // shape may differ per dhee-ink version; we forward the opts
    // object as-is and let the manager validate.
    await (
      cm as unknown as {
        configureSessionForProject: (...a: unknown[]) => Promise<void>;
      }
    ).configureSessionForProject(sessionId, opts);
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
  async runTask(
    sessionId: string,
    task: string,
    opts: RunTaskOpts,
    eventCb: dheeCoreEventCallback,
  ): Promise<RunResult> {
    if (!this.cm) {
      return {
        status: 'failed',
        error: 'dheeCoreManager not started — call start() first.',
      };
    }
    const events = buildEventsAdapter(eventCb);
    try {
      const result = await (
        this.cm as unknown as {
          runTask: (
            sessionId: string,
            task: string,
            events?: ConversationEvents,
            opts?: RunTaskOpts,
          ) => Promise<{ status: string; output?: string; error?: string }>;
        }
      ).runTask(sessionId, task, events, opts);
      return {
        status: result.status as RunResult['status'],
        ...(result.output ? { output: result.output } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (err) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Mirror of ConversationManager.cancelTask — returns false if no session. */
  cancelTask(sessionId: string): boolean {
    if (!this.cm) return false;
    return (
      this.cm as unknown as { cancelTask: (s: string) => boolean }
    ).cancelTask(sessionId);
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
    taskId?: string;
    kind?: string;
    projectName?: string;
    startedAt?: number;
    sessionId?: string;
  }> {
    const mod = await loadRunnersModule();
    const active = mod.getBackgroundTaskRunner().getActive();
    if (!active) return { active: false };
    return {
      active: true,
      taskId: active.id,
      kind: active.spec.kind,
      projectName: active.spec.projectName,
      startedAt: active.startedAt,
      sessionId: active.spec.sessionId,
    };
  }

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
    if (!this.cm) return { ok: false, error: 'dheeCoreManager not started' };
    return (
      this.cm as unknown as {
        redoNode: (
          s: string,
          n: string,
          o?: RedoNodeOpts,
        ) => Promise<{
          ok: boolean;
          nodeId?: string;
          editedPrompt?: string;
          error?: string;
        }>;
      }
    ).redoNode(sessionId, nodeId, opts);
  }

  /**
   * Mark executor nodes pending on disk without resuming the
   * pipeline. Driven by the desktop's Prompts-tab edit flow.
   */
  async invalidateNodes(
    sessionId: string,
    nodeIds: string[],
  ): Promise<{ invalidated: string[]; notFound: string[] }> {
    if (!this.cm) throw new Error('dheeCoreManager not started');
    return (
      this.cm as unknown as {
        invalidateNodes(
          s: string,
          ids: string[],
        ): Promise<{ invalidated: string[]; notFound: string[] }>;
      }
    ).invalidateNodes(sessionId, nodeIds);
  }

  setAutonomousMode(sessionId: string, enabled: boolean): void {
    if (!this.cm) return;
    (
      this.cm as unknown as {
        setAutonomousMode: (s: string, e: boolean) => void;
      }
    ).setAutonomousMode(sessionId, enabled);
  }

  setPiOversight(sessionId: string, enabled: boolean): void {
    if (!this.cm) return;
    const fn = (this.cm as unknown as { setPiOversight?: (s: string, e: boolean) => void }).setPiOversight;
    if (typeof fn === 'function') fn.call(this.cm, sessionId, enabled);
  }

  setVlmJudge(sessionId: string, enabled: boolean): void {
    if (!this.cm) return;
    const fn = (this.cm as unknown as { setVLMJudge?: (s: string, e: boolean) => void }).setVLMJudge;
    if (typeof fn === 'function') fn.call(this.cm, sessionId, enabled);
  }

  // ── Custom ComfyUI workflow management ─────────────────────────────
  // Pass-through to dhee-core's workflowIntegration helpers. Same
  // helpers the pi-agent tools wrap, so a workflow saved via the
  // Settings UI shows up in chat-driven generations and vice versa.

  validateWorkflow(workflowPath: string):
    | { ok: true; totalNodes: number; detectedPipeline: string; inputNodeCount: number; loraCount: number }
    | { ok: false; reason: string }
    | { ok: false; reason: string; error: true } {
    if (!this.managerModule?.validateWorkflowFile) {
      return { ok: false, reason: 'dhee-core not started yet', error: true };
    }
    const result = this.managerModule.validateWorkflowFile(workflowPath);
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      totalNodes: result.parsed.totalNodes,
      detectedPipeline: result.parsed.detectedPipeline,
      inputNodeCount: result.parsed.inputNodes.length,
      loraCount: result.parsed.loraNodes.length,
    };
  }

  listWorkflows(opts?: { userOnly?: boolean }): Array<{
    id: string;
    displayName: string;
    pipeline: string;
    builtIn: boolean;
    isOverride: boolean;
    active: boolean;
  }> {
    if (!this.managerModule?.listWorkflows) return [];
    return this.managerModule.listWorkflows(opts);
  }

  getWorkflow(id: string): Record<string, unknown> | undefined {
    if (!this.managerModule?.getWorkflow) return undefined;
    return this.managerModule.getWorkflow(id);
  }

  updateWorkflow(id: string, patch: Record<string, unknown>): Record<string, unknown> {
    if (!this.managerModule?.updateWorkflow) {
      throw new Error('dhee-core not started yet');
    }
    return this.managerModule.updateWorkflow(id, patch);
  }

  deleteWorkflow(id: string): void {
    if (!this.managerModule?.deleteWorkflow) {
      throw new Error('dhee-core not started yet');
    }
    this.managerModule.deleteWorkflow(id);
  }

  async focusSessionProject(
    sessionId: string,
    projectName: string,
  ): Promise<OkResponse> {
    if (!this.cm) return { ok: false, error: 'dheeCoreManager not started' };
    try {
      await (
        this.cm as unknown as {
          focusSessionProject: (s: string, p: string) => Promise<unknown>;
        }
      ).focusSessionProject(sessionId, projectName);
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: message };
    }
  }

  deleteSession(sessionId: string): void {
    if (!this.cm) return;
    (
      this.cm as unknown as { deleteSession: (s: string) => void }
    ).deleteSession(sessionId);
  }

  private requireStarted(): ConversationManager {
    if (!this.cm) {
      throw new Error('dheeCoreManager not started — call start() first.');
    }
    return this.cm;
  }
}
