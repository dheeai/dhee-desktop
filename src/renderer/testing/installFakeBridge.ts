/**
 * Layer-2 e2e test bridge.
 *
 * Installs in-memory fakes for `window.dhee` and a minimal
 * `window.electron` so the renderer can run in a plain browser
 * (no Electron, no preload, no dhee-ink) for fast Playwright tests.
 *
 * Driven by JSON scenarios loaded via `window.__dheeTest.loadScenario`.
 * A scenario maps incoming bridge calls to scripted streaming events
 * — same wire shape dhee-ink emits, so the chat UI's event handlers
 * don't know the difference.
 *
 * Imported by `index.tsx` only when `process.env.dhee_TEST_BRIDGE === '1'`.
 */
import type {
  dheeEvent,
  dheeEventName,
  CreateSessionResponse,
  CreateProjectRequest,
  ConfigureProjectRequest,
  OkResponse,
  RunTaskRequest,
  SendResponseRequest,
  CancelTaskRequest,
  CancelTaskResponse,
  RedoNodeRequest,
  FocusProjectRequest,
  SetAutonomousRequest,
  DeleteSessionRequest,
  RunnerCancelRequest,
  RunnerCancelResponse,
  RunnerStatusResponse,
} from '../../shared/dheeIpc';

// ── Scenario shape ───────────────────────────────────────────────────

export type ScenarioChannel =
  | 'runTask'
  | 'sendResponse'
  | 'redoNode'
  | 'focusProject';

export interface ScenarioEmit {
  /** Delay in ms before this event fires, relative to the rule trigger. */
  after?: number;
  event: dheeEventName;
  data: unknown;
}

export interface ScenarioRule {
  on: {
    channel: ScenarioChannel;
    /** Substring match against the inbound payload's main text/id field. */
    match?: string;
  };
  emit: ScenarioEmit[];
}

/**
 * Which renderer surface the test bridge should mount.
 *
 * - `chat` (default) — `ChatPanelEmbedded` only, project auto-opened from
 *   the scenario. Used by all the existing chat-flow specs.
 * - `landing` — full `<App />`, NO project auto-opened. Used by Landing
 *   screen + Settings tests that navigate from there.
 * - `workspace` — full `<App />`, project auto-opened. Used by tests that
 *   need the full WorkspaceLayout (Timeline, Assets, Storyboard, etc.).
 */
export type ScenarioSurface = 'chat' | 'landing' | 'workspace';

export interface Scenario {
  /** Pre-set project so the test surface auto-focuses on mount (chat / workspace). */
  project?: { name: string; directory?: string };
  /** Which renderer surface to mount. Defaults to `chat`. */
  surface?: ScenarioSurface;
  /**
   * Override the return value of `electron.*` bridge calls before the
   * renderer mounts. Equivalent to calling `setBridgeReturn` for each
   * entry, but applied synchronously inside `loadScenario` so that
   * mount-time loads (e.g. `recentProjects`) see the seeded value.
   */
  bridgeReturns?: Record<string, unknown>;
  /**
   * Seed per-path return values for `window.electron.project.readFile`.
   * Each key is matched as a path suffix or substring against the actual
   * path argument. The value is the raw file content string (or null to
   * simulate a missing file). Checked before `bridgeReturns['project.readFile']`.
   *
   * Example: `{ 'project.json': JSON.stringify(myProjectData) }`
   */
  fileReturns?: Record<string, string | null>;
  rules: ScenarioRule[];
}

// ── Test API exposed on window.__dheeTest ──────────────────────────

interface RecordedCall {
  channel: string;
  args: unknown;
  at: number;
}

export interface dheeTestApi {
  loadScenario(scenario: Scenario): void;
  /** Pick a scenario from the bundled catalog by name. */
  loadScenarioByName(name: string): boolean;
  /** All scenarios available in the bundled catalog. */
  listScenarios(): string[];
  emit(eventName: dheeEventName, data: unknown): void;
  getCalls(channel?: string): RecordedCall[];
  getProject(): { name: string | null; directory: string | null };
  /** Which surface the scenario asked for. Read by TestApp on mount. */
  getSurface(): ScenarioSurface;
  /**
   * Override the return value of an `electron.*` bridge call by dotted
   * path, e.g. `'project.getRecent'` or `'settings.get'`. Required for
   * tests that need a non-empty initial state — the default fakes return
   * `[]` / `{}` / `null`.
   */
  setBridgeReturn(path: string, value: unknown): void;
  /**
   * Fire an event into a subscribed `electron.*` listener. Use to drive
   * UI reactions to backend state, file changes, settings updates, etc.
   * `channel` examples: `'backend:state'`, `'settings:updated'`,
   * `'project:file-change'`, `'project:manifest-written'`.
   */
  emitElectron(channel: string, payload: unknown): void;
  reset(): void;
}

// ── Internal state ───────────────────────────────────────────────────

interface ListenerSlot {
  eventName: dheeEventName | '*';
  cb: (event: dheeEvent) => void;
  active: boolean;
}

interface BridgeState {
  scenario: Scenario;
  listeners: ListenerSlot[];
  calls: RecordedCall[];
  sessionId: string;
  project: { name: string | null; directory: string | null };
  timers: Set<ReturnType<typeof setTimeout>>;
  /** Per-path override values for `electron.*` bridge calls. */
  bridgeReturns: Map<string, unknown>;
  /** Subscribed listeners keyed by channel (`backend:state`, etc.). */
  electronListeners: Map<string, Set<(payload: unknown) => void>>;
}

const state: BridgeState = {
  scenario: { rules: [] },
  listeners: [],
  calls: [],
  sessionId: 'test-session-1',
  project: { name: null, directory: null },
  timers: new Set(),
  bridgeReturns: new Map(),
  electronListeners: new Map(),
};

/**
 * Resolve the override (if any) for a given dotted bridge path.
 *
 * Override may be:
 *   - a literal value (returned as-is)
 *   - a function `(...args) => value` (called with the bridge call's args
 *     so tests can express path-dependent logic, e.g. checkFileExists
 *     returning true for project dirs but false for `*.json` probes)
 */
function bridgeReturn<T>(path: string, fallback: T, args?: unknown[]): T {
  if (!state.bridgeReturns.has(path)) return fallback;
  const override = state.bridgeReturns.get(path);
  if (typeof override === 'function') {
    return (override as (...a: unknown[]) => T)(...(args ?? []));
  }
  return override as T;
}

function subscribeElectron(
  channel: string,
  cb: (payload: unknown) => void,
): () => void {
  let set = state.electronListeners.get(channel);
  if (!set) {
    set = new Set();
    state.electronListeners.set(channel, set);
  }
  set.add(cb);
  return () => {
    state.electronListeners.get(channel)?.delete(cb);
  };
}

function fireElectron(channel: string, payload: unknown): void {
  const set = state.electronListeners.get(channel);
  if (!set) return;
  for (const cb of Array.from(set)) {
    cb(payload);
  }
}

function record(channel: string, args: unknown): void {
  state.calls.push({ channel, args, at: Date.now() });
}

function emitEvent(eventName: dheeEventName, data: unknown): void {
  const event: dheeEvent = {
    eventName,
    sessionId: state.sessionId,
    data,
  };
  // Snapshot to avoid mutation-during-iteration when a listener
  // unsubscribes itself.
  for (const slot of state.listeners.slice()) {
    if (!slot.active) continue;
    if (slot.eventName === '*' || slot.eventName === eventName) {
      slot.cb(event);
    }
  }
}

function applyMatchingRules(
  channel: ScenarioChannel,
  payloadText: string,
): void {
  for (const rule of state.scenario.rules) {
    if (rule.on.channel !== channel) continue;
    if (rule.on.match && !payloadText.includes(rule.on.match)) continue;
    for (const step of rule.emit) {
      const delay = step.after ?? 0;
      const timer = setTimeout(() => {
        state.timers.delete(timer);
        emitEvent(step.event, step.data);
      }, delay);
      state.timers.add(timer);
    }
  }
}

/**
 * Returns a promise that resolves after the longest `after` delay among
 * scripted emits for any matching rule on the given channel — i.e. when
 * the last event for this turn has fired. This lets the fake `runTask`
 * stay pending for the duration of the streaming window, mirroring real
 * dhee-ink behavior so `useDheeSession.status` correctly transitions
 * idle → running → idle around the playback.
 *
 * If no rule matches, resolves immediately.
 */
function whenLastEventFires(
  channel: ScenarioChannel,
  payloadText: string,
): Promise<void> {
  let maxDelay = 0;
  let matched = false;
  for (const rule of state.scenario.rules) {
    if (rule.on.channel !== channel) continue;
    if (rule.on.match && !payloadText.includes(rule.on.match)) continue;
    matched = true;
    for (const step of rule.emit) {
      maxDelay = Math.max(maxDelay, step.after ?? 0);
    }
  }
  if (!matched) return Promise.resolve();
  return new Promise<void>((resolve) => {
    // Add a small grace so the last setTimeout in applyMatchingRules
    // fires *before* this one resolves.
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      resolve();
    }, maxDelay + 5);
    state.timers.add(timer);
  });
}

// ── Fake dhee bridge ───────────────────────────────────────────────

const fakedhee = {
  createSession(): Promise<CreateSessionResponse> {
    record('createSession', undefined);
    return Promise.resolve({ sessionId: state.sessionId });
  },
  createProject(req: CreateProjectRequest): Promise<OkResponse> {
    record('createProject', req);
    return Promise.resolve({ ok: true });
  },
  configureProject(req: ConfigureProjectRequest): Promise<OkResponse> {
    record('configureProject', req);
    return Promise.resolve({ ok: true });
  },
  async runTask(req: RunTaskRequest): Promise<OkResponse> {
    record('runTask', req);
    applyMatchingRules('runTask', req.task);
    // Stay pending until the last scripted event fires so the chat UI's
    // `isRunning` correctly reflects the streaming window.
    await whenLastEventFires('runTask', req.task);
    return { ok: true };
  },
  async sendResponse(req: SendResponseRequest): Promise<OkResponse> {
    record('sendResponse', req);
    applyMatchingRules('sendResponse', req.response);
    await whenLastEventFires('sendResponse', req.response);
    return { ok: true };
  },
  cancelTask(req: CancelTaskRequest): Promise<CancelTaskResponse> {
    record('cancelTask', req);
    return Promise.resolve({ cancelled: true });
  },
  runnerCancel(req?: RunnerCancelRequest): Promise<RunnerCancelResponse> {
    record('runnerCancel', req);
    return Promise.resolve({ cancelled: true });
  },
  runnerStatus(): Promise<RunnerStatusResponse> {
    record('runnerStatus', undefined);
    return Promise.resolve({ active: false });
  },
  redoNode(req: RedoNodeRequest): Promise<OkResponse> {
    record('redoNode', req);
    applyMatchingRules('redoNode', req.nodeId);
    return Promise.resolve({ ok: true });
  },
  focusProject(req: FocusProjectRequest): Promise<OkResponse> {
    record('focusProject', req);
    applyMatchingRules('focusProject', req.projectName);
    return Promise.resolve({ ok: true });
  },
  setAutonomous(req: SetAutonomousRequest): Promise<OkResponse> {
    record('setAutonomous', req);
    return Promise.resolve({ ok: true });
  },
  deleteSession(req: DeleteSessionRequest): Promise<OkResponse> {
    record('deleteSession', req);
    return Promise.resolve({ ok: true });
  },
  on(
    eventName: dheeEventName | '*',
    cb: (event: dheeEvent) => void,
  ): () => void {
    const slot: ListenerSlot = { eventName, cb, active: true };
    state.listeners.push(slot);
    return () => {
      slot.active = false;
    };
  },
};

// ── Minimal fake window.electron ─────────────────────────────────────
//
// We only stub the surface that the embedded chat path actually
// touches when running under TestApp. WorkspaceContext / LandingScreen
// flows are bypassed by TestApp, so most of the tree is a no-op.

function noop(): void {}
function noopAsync(): Promise<void> {
  return Promise.resolve();
}
// Most renderer-facing electron channels are stubbed with empty defaults.
// For each channel we expose two tools to tests: (1) `getCalls(name)` to
// assert the call happened with the right args, and (2) `setBridgeReturn`
// to override the default return value (e.g. seed a non-empty
// recent-projects list before LandingScreen renders).
//
// The naming convention for `record()` / `bridgeReturn()` is the dotted
// path under `window.electron`, e.g. `project.getRecent`. Tests use the
// same path with `getCalls('project.getRecent')` and
// `setBridgeReturn('project.getRecent', […])`.

const fakeElectron = {
  ipcRenderer: {
    sendMessage: noop,
    on: () => () => {},
    once: noop,
  },
  settings: {
    get: () => {
      record('settings.get', undefined);
      // Default to a full AppSettings shape so renderer code that reads
      // `settings.llmProvider` etc. on first load doesn't see undefined.
      // Tests can override per-key via `bridgeReturns: { 'settings.get': {...} }`.
      return Promise.resolve(
        bridgeReturn('settings.get', {
          themeId: 'studio-neutral',
          backendMode: 'local',
          llmBackend: 'local',
          comfyBackend: 'local',
          vlmBackend: 'local',
          comfyuiMode: 'inherit',
          comfyuiUrl: '',
          comfyCloudApiKey: '',
          comfyuiTimeout: 1800,
          llmProvider: 'openai',
          lmStudioUrl: 'http://127.0.0.1:1234',
          lmStudioModel: 'qwen3',
          googleApiKey: '',
          geminiModel: 'gemini-2.5-flash',
          openaiApiKey: '',
          openaiBaseUrl: 'https://api.openai.com/v1',
          openaiModel: 'gpt-4o',
          openRouterApiKey: '',
          openRouterModel: 'z-ai/glm-4.7-flash',
          piOversight: true,
          vlmJudge: true,
        }),
      );
    },
    update: (patch: unknown) => {
      record('settings.update', patch);
      // Mirror the patch as the next `get()` so subsequent reads see it.
      const merged = {
        ...((state.bridgeReturns.get('settings.get') as object | undefined) ??
          {}),
        ...(patch as object),
      };
      state.bridgeReturns.set('settings.get', merged);
      return Promise.resolve(bridgeReturn('settings.update', merged));
    },
    onChange: (cb: (payload: unknown) => void) =>
      subscribeElectron('settings:updated', cb),
  },
  project: {
    selectDirectory: () => {
      record('project.selectDirectory', undefined);
      return Promise.resolve(
        bridgeReturn('project.selectDirectory', state.project.directory),
      );
    },
    selectVideoFile: () => {
      record('project.selectVideoFile', undefined);
      return Promise.resolve(bridgeReturn('project.selectVideoFile', null));
    },
    selectAudioFile: () => {
      record('project.selectAudioFile', undefined);
      return Promise.resolve(bridgeReturn('project.selectAudioFile', null));
    },
    selectAttachment: (req: unknown) => {
      record('project.selectAttachment', req);
      return Promise.resolve(
        bridgeReturn('project.selectAttachment', { ok: false }, [req]),
      );
    },
    importCharacterReferences: (req: unknown) => {
      record('project.importCharacterReferences', req);
      return Promise.resolve(
        bridgeReturn('project.importCharacterReferences', {
          ok: true,
          attachments: [],
        }, [req]),
      );
    },
    importReferenceImages: (req: unknown) => {
      record('project.importReferenceImages', req);
      return Promise.resolve(
        bridgeReturn('project.importReferenceImages', {
          ok: true,
          attachments: [],
        }, [req]),
      );
    },
    getAudioDuration: () => Promise.resolve(0),
    getAudioWaveform: () => Promise.resolve({ peaks: [], duration: 0 }),
    generateWordCaptions: () => Promise.resolve({ success: false }),
    readTree: (p: string) => {
      record('project.readTree', p);
      return Promise.resolve(
        bridgeReturn(
          'project.readTree',
          {
            name: 'fake-project',
            path: state.project.directory ?? '/tmp/fake-project.dhee',
            type: 'directory' as const,
            children: [],
          },
          [p],
        ),
      );
    },
    readFile: (p: string) => {
      record('project.readFile', p);
      const fileReturns = state.scenario.fileReturns;
      if (fileReturns) {
        const normalized = p.replace(/\\/g, '/');
        for (const [pattern, content] of Object.entries(fileReturns)) {
          if (
            normalized === pattern ||
            normalized.endsWith(`/${pattern}`) ||
            normalized.includes(pattern)
          ) {
            return Promise.resolve(content);
          }
        }
      }
      return Promise.resolve(bridgeReturn('project.readFile', null, [p]));
    },
    readFileGuarded: () => Promise.resolve(''),
    readFileBufferGuarded: () => Promise.resolve(''),
    checkFileExists: (p: string) => {
      record('project.checkFileExists', p);
      return Promise.resolve(
        bridgeReturn('project.checkFileExists', true, [p]),
      );
    },
    listDirectory: () => Promise.resolve([]),
    statPath: () =>
      Promise.resolve({ isFile: false, isDirectory: true, size: 0 }),
    readAllFiles: () => Promise.resolve([]),
    readProjectSnapshot: () =>
      Promise.resolve({ files: {}, directories: [], projectRoot: '' }),
    mkdir: noopAsync,
    readFileBase64: (p: string) => {
      record('project.readFileBase64', p);
      return Promise.resolve(bridgeReturn('project.readFileBase64', null, [p]));
    },
    writeFile: (p: string, contents: unknown) => {
      record('project.writeFile', { path: p, contents });
      return Promise.resolve();
    },
    writeFileBinary: (p: string) => {
      record('project.writeFileBinary', { path: p });
      return Promise.resolve();
    },
    createFile: (p: string) => {
      record('project.createFile', p);
      return Promise.resolve(bridgeReturn('project.createFile', p));
    },
    createFolder: (parent: string, name: string, opts?: unknown) => {
      record('project.createFolder', { parent, name, opts });
      return Promise.resolve(
        bridgeReturn('project.createFolder', `${parent}/${name}`),
      );
    },
    rename: (p: string) => Promise.resolve(p),
    delete: (p: string) => {
      record('project.delete', p);
      return Promise.resolve();
    },
    move: (p: string) => Promise.resolve(p),
    copy: (p: string) => Promise.resolve(p),
    copyFileExact: noopAsync,
    revealInFinder: (p: string) => {
      record('project.revealInFinder', p);
      return Promise.resolve();
    },
    watchDirectory: (p: string) => {
      record('project.watchDirectory', p);
      return Promise.resolve();
    },
    watchManifest: noopAsync,
    watchImagePlacements: noopAsync,
    watchInfographicPlacements: noopAsync,
    refreshAssets: () => Promise.resolve({ success: true }),
    unwatchDirectory: noopAsync,
    getRecent: () => {
      record('project.getRecent', undefined);
      return Promise.resolve(bridgeReturn('project.getRecent', []));
    },
    addRecent: (p: unknown) => {
      record('project.addRecent', p);
      return Promise.resolve();
    },
    removeRecent: (p: unknown) => {
      record('project.removeRecent', p);
      return Promise.resolve();
    },
    renameProject: (oldPath: string, newName: string) => {
      record('project.renameProject', { oldPath, newName });
      return Promise.resolve(
        bridgeReturn('project.renameProject', `${oldPath}/${newName}`),
      );
    },
    deleteProject: (p: string) => {
      record('project.deleteProject', p);
      return Promise.resolve();
    },
    getResourcesPath: () => Promise.resolve(''),
    saveVideoFile: (p: unknown) => {
      record('project.saveVideoFile', p);
      return Promise.resolve(bridgeReturn('project.saveVideoFile', null));
    },
    exportChatJson: (p: unknown) => {
      record('project.exportChatJson', p);
      return Promise.resolve(
        bridgeReturn('project.exportChatJson', { ok: true }),
      );
    },
    composeTimelineVideo: (p: unknown) => {
      record('project.composeTimelineVideo', p);
      return Promise.resolve(
        bridgeReturn('project.composeTimelineVideo', { success: false }),
      );
    },
    exportCapcut: (p: unknown) => {
      record('project.exportCapcut', p);
      return Promise.resolve(
        bridgeReturn('project.exportCapcut', { success: false }),
      );
    },
    onFileChange: (cb: (payload: unknown) => void) =>
      subscribeElectron('project:file-change', cb),
    onManifestWritten: (cb: (payload: unknown) => void) =>
      subscribeElectron('project:manifest-written', cb),
  },
  remotion: {
    renderInfographics: (p: unknown) => {
      record('remotion.renderInfographics', p);
      return Promise.resolve(
        bridgeReturn('remotion.renderInfographics', { jobId: 'fake' }),
      );
    },
    cancelJob: (jobId: string) => {
      record('remotion.cancelJob', jobId);
      return Promise.resolve();
    },
    getJob: () => Promise.resolve(null),
    renderFromServerRequest: (p: unknown) => {
      record('remotion.renderFromServerRequest', p);
      return Promise.resolve(
        bridgeReturn('remotion.renderFromServerRequest', { success: false }),
      );
    },
    onProgress: (cb: (payload: unknown) => void) =>
      subscribeElectron('remotion:progress', cb),
    onJobComplete: (cb: (payload: unknown) => void) =>
      subscribeElectron('remotion:job-complete', cb),
  },
  logger: {
    init: noopAsync,
    logUserInput: noopAsync,
    logAgentText: noopAsync,
    logToolStart: noopAsync,
    logToolComplete: noopAsync,
    logQuestion: noopAsync,
    logStatusChange: noopAsync,
    logPhaseTransition: noopAsync,
    logTodoUpdate: noopAsync,
    logError: noopAsync,
    logSessionEnd: noopAsync,
    getLogPaths: () =>
      Promise.resolve({ uiLog: '', phaseLog: '', workflowLog: '' }),
  },
  updates: {
    getStatus: () => {
      record('updates.getStatus', undefined);
      return Promise.resolve(
        bridgeReturn('updates.getStatus', {
          phase: 'idle',
          checkedAt: Date.now(),
        }),
      );
    },
    checkNow: () => {
      record('updates.checkNow', undefined);
      return Promise.resolve(
        bridgeReturn('updates.checkNow', {
          phase: 'not-available',
          checkedAt: Date.now(),
        }),
      );
    },
    onStatusChange: (cb: (payload: unknown) => void) =>
      subscribeElectron('updates:status', cb),
  },
  app: {
    getVersion: () => {
      record('app.getVersion', undefined);
      return Promise.resolve(bridgeReturn('app.getVersion', '0.0.0-test'));
    },
  },
  account: {
    get: () => {
      record('account.get', undefined);
      return Promise.resolve(bridgeReturn('account.get', null));
    },
    getAuthStatus: () => {
      record('account.getAuthStatus', undefined);
      return Promise.resolve(bridgeReturn('account.getAuthStatus', 'idle'));
    },
    signIn: () => {
      record('account.signIn', undefined);
      return Promise.resolve(
        bridgeReturn('account.signIn', { opened: true, state: 'test-state' }),
      );
    },
    signOut: () => {
      record('account.signOut', undefined);
      state.bridgeReturns.set('account.get', null);
      fireElectron('account:changed', null);
      return Promise.resolve({ success: true });
    },
    refreshBalance: () => {
      record('account.refreshBalance', undefined);
      return Promise.resolve(
        bridgeReturn('account.refreshBalance', {
          status: 'ok',
          balance: 0,
        }),
      );
    },
    getBillingUrl: () => Promise.resolve('http://localhost:3000/billing'),
    openBilling: () => {
      record('account.openBilling', undefined);
      return Promise.resolve({
        opened: true,
        url: 'http://localhost:3000/billing',
      });
    },
    onAuthStatusChange: (cb: (payload: unknown) => void) =>
      subscribeElectron('account:auth-status', cb),
    onChange: (cb: (payload: unknown) => void) =>
      subscribeElectron('account:changed', cb),
  },
  onboarding: {
    getState: () => {
      record('onboarding.getState', undefined);
      return Promise.resolve(
        bridgeReturn('onboarding.getState', {
          guideVersion: 3,
          completed: false,
          completedAt: null,
          skipped: false,
        }),
      );
    },
    complete: (req?: unknown) => {
      record('onboarding.complete', req);
      const skipped =
        typeof req === 'object' &&
        req !== null &&
        (req as { skipped?: unknown }).skipped === true;
      const completedReason =
        typeof req === 'object' &&
        req !== null &&
        typeof (req as { completedReason?: unknown }).completedReason ===
          'string'
          ? (req as { completedReason: string }).completedReason
          : skipped
            ? 'skipped'
            : 'manual_finish';
      const next = {
        guideVersion: 3,
        completed: true,
        completedAt: Date.now(),
        skipped,
        completedReason,
      };
      state.bridgeReturns.set('onboarding.getState', next);
      return Promise.resolve(next);
    },
  },
  providerDiagnostics: {
    run: () => {
      record('providerDiagnostics.run', undefined);
      return Promise.resolve(
        bridgeReturn('providerDiagnostics.run', {
          checkedAt: Date.now(),
          items: [
            {
              id: 'cloud-account',
              label: 'Dhee Cloud account',
              status: 'warning',
              message: 'Sign in to use Dhee Cloud credits.',
            },
            {
              id: 'comfyui',
              label: 'ComfyUI',
              status: 'warning',
              message: 'Could not reach ComfyUI at http://127.0.0.1:8188.',
            },
            {
              id: 'llm',
              label: 'LLM',
              status: 'warning',
              message: 'OpenAI-compatible LLM needs an API key.',
            },
            {
              id: 'vlm',
              label: 'VLM judge',
              status: 'warning',
              message: 'Local VLM needs a base URL, API key, and model.',
            },
          ],
        }),
      );
    },
  },
};

// ── Test API ─────────────────────────────────────────────────────────

const testApi: dheeTestApi = {
  loadScenario(scenario: Scenario): void {
    state.scenario = scenario;
    if (scenario.project) {
      state.project = {
        name: scenario.project.name,
        directory:
          scenario.project.directory ?? `/tmp/${scenario.project.name}.dhee`,
      };
    }
    if (scenario.bridgeReturns) {
      for (const [path, value] of Object.entries(scenario.bridgeReturns)) {
        state.bridgeReturns.set(path, value);
      }
    }
  },
  loadScenarioByName(name: string): boolean {
    // eslint-disable-next-line global-require, @typescript-eslint/no-require-imports
    const { getScenarioByName } = require('./scenarioCatalog');
    const s = getScenarioByName(name);
    if (!s) return false;
    testApi.loadScenario(s);
    return true;
  },
  listScenarios(): string[] {
    // eslint-disable-next-line global-require, @typescript-eslint/no-require-imports
    const { listScenarioNames } = require('./scenarioCatalog');
    return listScenarioNames();
  },
  emit(eventName: dheeEventName, data: unknown): void {
    emitEvent(eventName, data);
  },
  getCalls(channel?: string): RecordedCall[] {
    return channel
      ? state.calls.filter((c) => c.channel === channel)
      : state.calls.slice();
  },
  getProject() {
    return { ...state.project };
  },
  getSurface(): ScenarioSurface {
    return state.scenario.surface ?? 'chat';
  },
  setBridgeReturn(path: string, value: unknown): void {
    state.bridgeReturns.set(path, value);
  },
  emitElectron(channel: string, payload: unknown): void {
    fireElectron(channel, payload);
  },
  reset(): void {
    for (const t of state.timers) clearTimeout(t);
    state.timers.clear();
    state.scenario = { rules: [] };
    state.listeners = [];
    state.calls = [];
    state.project = { name: null, directory: null };
    state.bridgeReturns.clear();
    state.electronListeners.clear();
  },
};

// ── Install ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    __dheeTest?: dheeTestApi;
  }
}

(window as unknown as Record<string, unknown>).dhee = fakedhee;
(window as unknown as Record<string, unknown>).electron = fakeElectron;
window.__dheeTest = testApi;

// Resolve scenario in priority order:
//   1. Playwright initScript pre-seed (`__pendingScenario`)
//   2. URL query param (`?scenario=NAME`) — for manual testing
//   3. Nothing — TestApp shows a picker
const pending = (window as unknown as { __pendingScenario?: Scenario })
  .__pendingScenario;
if (pending) {
  testApi.loadScenario(pending);
  // eslint-disable-next-line no-console
  console.log('[test-bridge] applied __pendingScenario');
} else {
  const params = new URLSearchParams(window.location.search);
  const scenarioName = params.get('scenario');
  if (scenarioName) {
    const ok = testApi.loadScenarioByName(scenarioName);
    // eslint-disable-next-line no-console
    console.log(
      `[test-bridge] ?scenario=${scenarioName} → ${ok ? 'loaded' : 'NOT FOUND'}`,
    );
  }
}

// eslint-disable-next-line no-console
console.log('[test-bridge] installed fake window.dhee + window.electron');
