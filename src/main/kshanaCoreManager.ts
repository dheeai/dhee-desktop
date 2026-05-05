/**
 * `KshanaCoreManager` — main-process owner of the embedded
 * `ConversationManager` from kshana-ink. Replaces the legacy
 * spawn-and-WebSocket `localBackendManager` with an in-process
 * integration: kshana-ink's pipeline runs inside the Electron main
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
 * `KshanaCoreEvent` stream the IPC bridge can re-publish over
 * `webContents.send`.
 */
import type { AppSettings } from '../shared/settingsTypes';
import type { OkResponse } from '../shared/kshanaIpc';
import log from 'electron-log';
import path from 'path';
import { pathToFileURL } from 'url';
import { getComfyUiUrl, isComfyCloudUrl, withV1Suffix } from './utils/comfyUrl';

export interface KshanaCloudAuthRuntime {
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

const KSHANA_CORE_MANAGER_MODULE = 'kshana-core/manager';

function getPackagedManagerModuleUrl(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (!resourcesPath) return null;

  return pathToFileURL(
    path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'kshana-core',
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
  /**
   * Optional in tests where the loader injects a stub. In production
   * the real bundle always exports it.
   *
   * Returns:
   *   - `root`: the kshana-ink package root (debug only)
   *   - `projectsDir`: where projects live, computed by kshana-ink's
   *     `getProjectsDir()`. We chdir to this so the package's
   *     filesystem helpers (which default to process.cwd()) line up.
   *     Honours KSHANA_PROJECTS_DIR override and the
   *     KSHANA_PACKAGED=1 → ~/Kshana mapping.
   */
  loadDevEnv?: (root?: string) => {
    loaded: boolean;
    path: string | null;
    vars: string[];
    root: string;
    projectsDir: string;
  };
};

/**
 * kshana-ink's embed entries are ESM-only (transitive deps
 * `@mariozechner/pi-coding-agent` and `pi-ai` ship ESM with no CJS
 * `require` exports). The `webpackIgnore: true` magic comment tells
 * webpack to leave this dynamic import alone so Node's runtime ESM
 * loader handles it natively. Tests substitute this loader via the
 * exported `__setManagerLoader` to inject the mock module.
 */
let loadManagerModule: () => Promise<ManagerModule> = async () => {
  try {
    log.info(
      `[KshanaCoreManager] Importing ${KSHANA_CORE_MANAGER_MODULE} via package exports`,
    );
    const module = (await import(
      /* webpackIgnore: true */ KSHANA_CORE_MANAGER_MODULE
    )) as ManagerModule;
    log.info('[KshanaCoreManager] Package export import succeeded');
    return module;
  } catch (error) {
    log.error(
      `[KshanaCoreManager] Package export import failed: ${
        (error as Error).message
      }\n${(error as Error).stack}`,
    );

    if (process.env.KSHANA_PACKAGED !== '1') {
      throw error;
    }

    const packagedModuleUrl = getPackagedManagerModuleUrl();
    if (!packagedModuleUrl) {
      log.error(
        '[KshanaCoreManager] Cannot resolve packaged fallback manager URL',
      );
      throw error;
    }

    log.info(
      `[KshanaCoreManager] Importing packaged fallback ${packagedModuleUrl}`,
    );
    const module = (await import(
      /* webpackIgnore: true */ packagedModuleUrl
    )) as ManagerModule;
    log.info('[KshanaCoreManager] Packaged fallback import succeeded');
    return module;
  }
};

/** Test seam — replace the loader so unit tests can supply a fake. */
export function __setManagerLoader(loader: () => Promise<ManagerModule>): void {
  loadManagerModule = loader;
}

/**
 * Single normalized event the IPC bridge publishes downstream.
 * Mirrors the existing WebSocket `ServerMessage` shape so the renderer
 * doesn't have to learn a new schema — only the transport changes.
 */
export interface KshanaCoreEvent {
  /** The kshana-ink ServerMessageType (`tool_call`, `agent_response`, …). */
  eventName: string;
  /** Session this event belongs to. */
  sessionId: string;
  /** Shape depends on eventName. Untyped at this layer; the renderer narrows. */
  data: unknown;
}

export type KshanaCoreEventCallback = (event: KshanaCoreEvent) => void;

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
 * set `KSHANA_HOST/PORT/PUBLIC_HOST` (no Fastify in this path) and
 * does NOT delete NODE_OPTIONS / TS_NODE_* (those are already owned
 * by the main process and we don't spawn anything).
 *
 * Exported for testing.
 */
function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function clearCloudProxyEnv(): void {
  const wasUsingDesktopCloudProxy = process.env.KSHANA_CLOUD === 'true';
  delete process.env.KSHANA_CLOUD;
  delete process.env.KSHANA_CLOUD_URL;
  delete process.env.LLM_CONTEXT_TOKENS;
  if (wasUsingDesktopCloudProxy) {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.COMFY_CLOUD_URL;
    delete process.env.COMFY_CLOUD_API_KEY;
  }
}

export function applyEnvFromSettings(
  settings: AppSettings,
  cloudAuth?: KshanaCloudAuthRuntime | null,
): void {
  // Set env vars from settings, but only when the setting has a
  // non-empty value. Empty strings are treated as "use whatever is
  // already in process.env" — so dev users with kshana-ink/.env
  // loaded via loadDevEnv() see their keys come through. The
  // packaged build supplies all values via AppSettings UI, so this
  // skip-on-empty rule is a no-op there.
  const setIfPresent = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) process.env[key] = trimmed;
  };

  clearCloudProxyEnv();

  const cloudToken = cloudAuth?.desktopToken.trim();
  const cloudWebsiteUrl = cloudAuth?.websiteUrl.trim().replace(/\/$/, '');

  if (cloudToken && cloudWebsiteUrl) {
    process.env.KSHANA_CLOUD = 'true';
    process.env.KSHANA_CLOUD_URL = cloudWebsiteUrl;
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_CONTEXT_TOKENS = '160000';
    process.env.OPENAI_API_KEY = cloudToken;
    process.env.OPENAI_BASE_URL = joinUrl(cloudWebsiteUrl, '/openai/api/v1');
    process.env.OPENAI_MODEL = 'deepseek/deepseek-v4-flash';
    process.env.COMFY_MODE = 'cloud';
    process.env.COMFY_CLOUD_URL = joinUrl(cloudWebsiteUrl, '/comfy/api');
    process.env.COMFY_CLOUD_API_KEY = cloudToken;
    process.env.COMFYUI_TIMEOUT = '1800';
    return;
  }

  const comfyUiUrl = getComfyUiUrl(settings);
  process.env.COMFYUI_TIMEOUT = String(settings.comfyuiTimeout || 1800);
  setIfPresent('COMFYUI_BASE_URL', comfyUiUrl);

  // Auto-derive COMFY_MODE from the URL. Without this, the
  // ComfyUI client in kshana-core falls back to its 'local'
  // default and uses COMFYUI_BASE_URL even when the URL points
  // at cloud.comfy.org — meaning the cloud-specific code path
  // (api-key auth, /api prefix, cloud workflow selection) is
  // skipped and image generation hits the wrong endpoint
  // shape. See ComfyUIClient.getComfyConfig + WorkflowModeRegistry.
  if (isComfyCloudUrl(comfyUiUrl)) {
    process.env.COMFY_MODE = 'cloud';
    if (settings.comfyCloudApiKey.trim()) {
      process.env.COMFY_CLOUD_API_KEY = settings.comfyCloudApiKey.trim();
    }
    // Tell the cloud client where to actually post — it reads
    // COMFY_CLOUD_URL, not COMFYUI_BASE_URL, in cloud mode.
    setIfPresent('COMFY_CLOUD_URL', comfyUiUrl);
  } else {
    process.env.COMFY_MODE = 'local';
  }
  setIfPresent('KSHANA_PROJECT_DIR', settings.projectDir);

  switch (settings.llmProvider) {
    case 'gemini':
      process.env.LLM_PROVIDER = 'gemini';
      setIfPresent('GOOGLE_API_KEY', settings.googleApiKey);
      setIfPresent('GEMINI_MODEL', settings.geminiModel || 'gemini-2.5-flash');
      break;
    case 'openai':
      process.env.LLM_PROVIDER = 'openai';
      setIfPresent('OPENAI_API_KEY', settings.openaiApiKey);
      setIfPresent(
        'OPENAI_BASE_URL',
        settings.openaiBaseUrl || 'https://api.openai.com/v1',
      );
      setIfPresent('OPENAI_MODEL', settings.openaiModel || 'gpt-4o');
      break;
    case 'openrouter':
      process.env.LLM_PROVIDER = 'openrouter';
      setIfPresent('OPENROUTER_API_KEY', settings.openRouterApiKey);
      setIfPresent(
        'OPENROUTER_MODEL',
        settings.openRouterModel || 'z-ai/glm-4.7-flash',
      );
      break;
    case 'lmstudio':
    default:
      process.env.LLM_PROVIDER = 'lmstudio';
      setIfPresent(
        'LMSTUDIO_BASE_URL',
        withV1Suffix(settings.lmStudioUrl || 'http://127.0.0.1:1234'),
      );
      setIfPresent('LMSTUDIO_MODEL', settings.lmStudioModel || 'qwen3');
      break;
  }

  // NODE_ENV is set by the Electron build pipeline (webpack
  // DefinePlugin replaces process.env.NODE_ENV at compile time);
  // setting it at runtime is both redundant and triggers a terser
  // "Invalid assignment" because the LHS gets constant-folded.
}

/**
 * Build the `LLMClientConfig` from settings. The provider routing
 * (`LLM_PROVIDER` env var) is set by `applyEnvFromSettings`;
 * kshana-ink's `getLLMConfig()` reads that env to dispatch. The
 * explicit `LLMClientConfig` here just carries baseUrl / apiKey /
 * model so the manager doesn't need to read env vars at construction
 * time for the active provider.
 */
function buildLLMConfig(
  settings: AppSettings,
  cloudAuth?: KshanaCloudAuthRuntime | null,
): LLMClientConfig {
  const cloudToken = cloudAuth?.desktopToken.trim();
  const cloudWebsiteUrl = cloudAuth?.websiteUrl.trim().replace(/\/$/, '');

  if (cloudToken && cloudWebsiteUrl) {
    return {
      apiKey: cloudToken,
      baseUrl: joinUrl(cloudWebsiteUrl, '/openai/api/v1'),
      model: 'deepseek/deepseek-v4-flash',
    };
  }

  switch (settings.llmProvider) {
    case 'gemini':
      return {
        apiKey: settings.googleApiKey.trim(),
        model: settings.geminiModel.trim() || 'gemini-2.5-flash',
      };
    case 'openai':
      return {
        apiKey: settings.openaiApiKey.trim(),
        baseUrl: settings.openaiBaseUrl.trim() || 'https://api.openai.com/v1',
        model: settings.openaiModel.trim() || 'gpt-4o',
      };
    case 'openrouter':
      return {
        apiKey: settings.openRouterApiKey.trim(),
        model: settings.openRouterModel.trim() || 'z-ai/glm-4.7-flash',
      };
    case 'lmstudio':
    default:
      return {
        baseUrl: withV1Suffix(
          settings.lmStudioUrl.trim() || 'http://127.0.0.1:1234',
        ),
        model: settings.lmStudioModel.trim() || 'qwen3',
      };
  }
}

/**
 * Translate a `ConversationEvents` object (the kshana-ink callback
 * surface) into a stream of `KshanaCoreEvent`s on `eventCb`. Each
 * callback's args are normalized into a `data` payload; the
 * `eventName` matches the existing WebSocket `ServerMessageType` so
 * the renderer doesn't have to learn new event names.
 *
 * Exported for testing — IPC bridge tests use this directly to verify
 * event translation independently of the full manager wiring.
 */
export function buildEventsAdapter(
  eventCb: KshanaCoreEventCallback,
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

export class KshanaCoreManager {
  private cm: ConversationManager | null = null;

  private managerModule: ManagerModule | null = null;

  /**
   * Construct the embedded ConversationManager. Sets process.env
   * from settings BEFORE constructing the manager so any tool that
   * reads env vars at construction time sees the right values.
   *
   * Async because the manager bundle is ESM and loaded via dynamic
   * import (CJS Electron main → ESM kshana-ink). Subsequent calls
   * reuse the cached module reference.
   */
  async start(
    settings: AppSettings,
    cloudAuth?: KshanaCloudAuthRuntime | null,
  ): Promise<void> {
    if (!this.managerModule) {
      this.managerModule = await loadManagerModule();
    }
    // Load kshana-ink/.env BEFORE applying AppSettings so the
    // settings UI's explicit values still win for any field the user
    // has filled in. Loaded values fill the gaps (LLM_TIER_*,
    // GROQ_*, OpenRouter keys, etc. that the desktop UI doesn't
    // model). In packaged builds the .env doesn't ship, so this is
    // a no-op there.
    const devEnv = this.managerModule.loadDevEnv?.();
    // kshana-ink's filesystem helpers (projectFileIO, loadProject)
    // default basePath to `process.cwd()`. Embedded in Electron, cwd
    // points at kshana-desktop/ — not where projects live.
    //
    // Setting KSHANA_PROJECTS_DIR exposes the right basePath via env;
    // kshana-ink reads this in `getProjectsDir()` and (per the
    // companion fix in projectFileIO) uses it as the default basePath
    // when no session-context override is in scope.
    //
    // Using an env var (instead of process.chdir) is critical because
    // many handlers in kshana-desktop's main process call
    // `process.cwd()` directly for path normalization — chdir-ing
    // globally would silently break those.
    if (devEnv?.projectsDir) {
      process.env.KSHANA_PROJECTS_DIR = devEnv.projectsDir;
    }
    applyEnvFromSettings(settings, cloudAuth);
    const config: ConversationManagerConfig = {
      llmConfig: buildLLMConfig(settings, cloudAuth),
    };
    this.cm = new this.managerModule.ConversationManager(config);
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
    cloudAuth?: KshanaCloudAuthRuntime | null,
  ): Promise<void> {
    this.stop();
    await this.start(settings, cloudAuth);
  }

  /** Whether `start()` has run and the manager is alive. */
  isStarted(): boolean {
    return this.cm !== null;
  }

  /**
   * Create a new session; returns the session id.
   *
   * `role` controls long-running tool availability — `'interactive'`
   * (default) strips kshana_run_to / render_scene_bundle /
   * audit_fidelity so a chat session can't accidentally block on a
   * 1–4h task. `'background'` opts in to the full toolkit.
   */
  createSession(role?: 'interactive' | 'background'): string {
    const cm = this.requireStarted();
    // ConversationManager.createSession(mode, remoteFs, role) —
    // 3rd arg defaults to 'interactive' on the kshana-core side.
    const session = (
      cm as unknown as {
        createSession: (
          mode?: 'local' | 'remote',
          remoteFs?: undefined,
          role?: 'interactive' | 'background',
        ) => { id: string };
      }
    ).createSession('local', undefined, role ?? 'interactive');
    return session.id;
  }

  async configureSessionForProject(
    sessionId: string,
    opts: ConfigureProjectOpts,
  ): Promise<void> {
    const cm = this.requireStarted();
    // Pass through whatever ConversationManager expects. The actual
    // shape may differ per kshana-ink version; we forward the opts
    // object as-is and let the manager validate.
    await (
      cm as unknown as {
        configureSessionForProject: (...a: unknown[]) => Promise<void>;
      }
    ).configureSessionForProject(sessionId, opts);
  }

  /**
   * Run a task on the given session. `eventCb` receives a stream of
   * KshanaCoreEvents (mirroring the existing WebSocket message types)
   * — typically the IPC bridge re-publishes each event over
   * `webContents.send('kshana:event', …)`.
   *
   * Returns an error-shaped result rather than throwing if the manager
   * hasn't been started — the caller (IPC bridge) shouldn't have to
   * try/catch every call.
   */
  async runTask(
    sessionId: string,
    task: string,
    opts: RunTaskOpts,
    eventCb: KshanaCoreEventCallback,
  ): Promise<RunResult> {
    if (!this.cm) {
      return {
        status: 'failed',
        error: 'KshanaCoreManager not started — call start() first.',
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
  cancelBackgroundTask(): boolean {
    // The runner is a kshana-core singleton; reach it via the
    // already-loaded kshana-core bundle. Dynamic import keeps the
    // dist-aware require path consistent with how the rest of this
    // file pulls in core modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('kshana-core/runners') as {
      getBackgroundTaskRunner: () => {
        cancel: () => boolean;
      };
    };
    return mod.getBackgroundTaskRunner().cancel();
  }

  /** Snapshot of the runner's current state (or `{ active: false }`). */
  getBackgroundTaskStatus(): {
    active: boolean;
    taskId?: string;
    kind?: string;
    projectName?: string;
    startedAt?: number;
    sessionId?: string;
  } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('kshana-core/runners') as {
      getBackgroundTaskRunner: () => {
        getActive: () => null | {
          id: string;
          spec: { kind: string; projectName: string; sessionId: string };
          startedAt: number;
        };
      };
    };
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
    if (!this.cm) return { ok: false, error: 'KshanaCoreManager not started' };
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

  setAutonomousMode(sessionId: string, enabled: boolean): void {
    if (!this.cm) return;
    (
      this.cm as unknown as {
        setAutonomousMode: (s: string, e: boolean) => void;
      }
    ).setAutonomousMode(sessionId, enabled);
  }

  async focusSessionProject(
    sessionId: string,
    projectName: string,
  ): Promise<OkResponse> {
    if (!this.cm) return { ok: false, error: 'KshanaCoreManager not started' };
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
      throw new Error('KshanaCoreManager not started — call start() first.');
    }
    return this.cm;
  }
}
