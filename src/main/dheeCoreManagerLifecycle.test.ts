/**
 * Lifecycle tests for `dheeCoreManager` — start / stop / restart and
 * crash/zombie handling, complementing dheeCoreManager*.test.ts which
 * focus on env-var translation and event wiring.
 *
 * Areas covered (flagged as having zero direct coverage):
 *   1. restart() = stop() then start() — `started` flips correctly and
 *      a fresh start re-applies env. Plus the teardown question: does
 *      restart() leak the per-session agent sessions / hard-cancel
 *      watchdog timers it accumulated? (see the failing-by-design test).
 *   2. stop() is idempotent / safe when nothing is running.
 *   3. behavior when the manager-module loader THROWS on start().
 *
 * Strategy mirrors dheeCoreManager.test.ts: mock `electron`, stub the
 * runners loader (so the ESM dist isn't parsed by jest), and inject the
 * manager-module loader via `__setManagerLoader`. Each test that needs a
 * working start uses a passing loader; the loader-throws test swaps in a
 * rejecting loader.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import os from 'os';
import type { AppSettings } from '../shared/settingsTypes';

jest.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const {
  dheeCoreManager,
  __setManagerLoader,
  __setRunnersLoader,
} = require('./dheeCoreManager') as typeof import('./dheeCoreManager');

// Stub the runners loader — same reason as dheeCoreManager.test.ts: the
// real `dhee-core/runners` is an ESM dist jest can't parse.
__setRunnersLoader(async () => ({
  getBackgroundTaskRunner: () => ({
    cancel: () => false,
    getActive: () => null,
    isCancelling: () => false,
    dispatch: () => ({ status: 'started' as const, taskId: 't-stub' }),
    on: () => () => {},
  }),
}) as never);

const FAKE_INK_ROOT = os.homedir();
const FAKE_PROJECTS_DIR = os.tmpdir();

// A loader that resolves with the minimal host-helper surface start()
// touches (configurePostHogRuntime + loadDevEnv). Construction-count is
// tracked so we can assert how many times start() loaded the module.
const mockConfigurePostHogRuntime = jest.fn();
let loaderInvocations = 0;
const passingLoader = async () => {
  loaderInvocations += 1;
  return {
    configurePostHogRuntime: mockConfigurePostHogRuntime,
    loadDevEnv: () => ({
      loaded: false,
      path: null,
      vars: [] as string[],
      root: FAKE_INK_ROOT,
      projectsDir: FAKE_PROJECTS_DIR,
    }),
  } as never;
};

const baseSettings: AppSettings = {
  backendMode: 'local',
  llmBackend: 'local',
  comfyBackend: 'local',
  vlmBackend: 'local',
  comfyuiMode: 'inherit',
  comfyuiUrl: '',
  singleGpuMode: false,
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: 'sk-test',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
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
  loaderInvocations = 0;
  mockConfigurePostHogRuntime.mockClear();
  __setManagerLoader(passingLoader);
  delete process.env['LLM_PROVIDER'];
  delete process.env['OPENAI_API_KEY'];
});

describe('dheeCoreManager lifecycle', () => {
  // ── stop() idempotency / safe-when-not-running ───────────────────────

  it('stop() is safe to call before start() and leaves isStarted() false', () => {
    const mgr = new dheeCoreManager();
    expect(mgr.isStarted()).toBe(false);
    expect(() => mgr.stop()).not.toThrow();
    expect(mgr.isStarted()).toBe(false);
  });

  it('stop() is idempotent — repeated calls do not throw and keep isStarted() false', async () => {
    const mgr = new dheeCoreManager();
    await mgr.start(baseSettings);
    expect(mgr.isStarted()).toBe(true);
    mgr.stop();
    expect(mgr.isStarted()).toBe(false);
    expect(() => {
      mgr.stop();
      mgr.stop();
    }).not.toThrow();
    expect(mgr.isStarted()).toBe(false);
  });

  it('deleteSession() before any session exists is safe (no throw, no zombie)', () => {
    const mgr = new dheeCoreManager();
    expect(() => mgr.deleteSession('never-created')).not.toThrow();
  });

  // ── restart() ────────────────────────────────────────────────────────

  it('restart() ends with isStarted() true and re-applies the NEW settings to env', async () => {
    const mgr = new dheeCoreManager();
    await mgr.start(baseSettings);
    expect(process.env['LLM_PROVIDER']).toBe('openai');

    await mgr.restart({
      ...baseSettings,
      llmProvider: 'gemini',
      googleApiKey: 'g-key',
    });

    expect(mgr.isStarted()).toBe(true);
    expect(process.env['LLM_PROVIDER']).toBe('gemini');
  });

  it('restart() passes through stop() — there is an observable !started window inside it', async () => {
    // restart() is stop()-then-start(). We can't observe the transient
    // !started state from outside an awaited restart(), but we CAN pin
    // the contract that stop() runs first by checking restart() never
    // leaves the manager stopped on success.
    const mgr = new dheeCoreManager();
    await mgr.start(baseSettings);
    await mgr.restart(baseSettings);
    expect(mgr.isStarted()).toBe(true);
  });

  it('restart() does not re-load the manager module a second time (module is cached after first start)', async () => {
    // start() caches `managerModule` and only loads it when null. A
    // restart must reuse the cached module — re-loading on every
    // settings change would re-import the ESM bundle needlessly.
    const mgr = new dheeCoreManager();
    await mgr.start(baseSettings);
    expect(loaderInvocations).toBe(1);
    await mgr.restart(baseSettings);
    expect(loaderInvocations).toBe(1);
  });

  it('restart() disposes the old per-session agent sessions before starting fresh (no leaked sessions/zombies)', async () => {
    // EXPECTED TO FAIL until restart()/stop() tears down accumulated
    // per-session state.
    //
    // Why this is a real gap: chatPrompt lazily builds a long-lived
    // pi-agent AgentSession per chat sessionId and stashes it in the
    // private `agentSessions` map; each holds a JSONL file handle +
    // provider sockets, disposed only by deleteSession(). restart()
    // today is just stop() (sets started=false) + start() — it never
    // walks agentSessions to dispose them. So a settings-change-driven
    // restart leaks every live agent session: the dispose() handles are
    // orphaned (zombie sessions) and a new agent will be built on the
    // next chatPrompt while the old one's resources are never released.
    //
    // We seed an agent session via the test seam, record whether its
    // dispose() ran across a restart, and assert it was disposed.
    const mgr = new dheeCoreManager();
    await mgr.start(baseSettings);

    let disposed = false;
    mgr.__setAgentSessionForTesting('s-live', {
      subscribe: () => () => {},
      prompt: async () => {},
      dispose: () => {
        disposed = true;
      },
    });

    await mgr.restart(baseSettings);

    // The desired contract: a restart should not leave the previous
    // run's agent sessions alive (their sockets/JSONL handles dangling).
    expect(disposed).toBe(true);
  });

  // ── loader throws on start() ─────────────────────────────────────────

  it('start() rejects when the manager-module loader throws, and leaves isStarted() false', async () => {
    const boom = new Error('manager module failed to import');
    __setManagerLoader(async () => {
      throw boom;
    });
    const mgr = new dheeCoreManager();
    await expect(mgr.start(baseSettings)).rejects.toThrow(
      'manager module failed to import',
    );
    // A failed start must not flip the started flag — otherwise the IPC
    // bridge would treat a half-initialized manager as live.
    expect(mgr.isStarted()).toBe(false);
  });

  it('after a failed start(), a subsequent start() with a working loader recovers (no stuck managerModule)', async () => {
    // First start fails (loader throws) → managerModule stays null →
    // the retry must attempt the loader again and succeed.
    __setManagerLoader(async () => {
      throw new Error('first load fails');
    });
    const mgr = new dheeCoreManager();
    await expect(mgr.start(baseSettings)).rejects.toThrow('first load fails');
    expect(mgr.isStarted()).toBe(false);

    __setManagerLoader(passingLoader);
    await mgr.start(baseSettings);
    expect(mgr.isStarted()).toBe(true);
    expect(process.env['LLM_PROVIDER']).toBe('openai');
  });

  it('restart() rejects (and does not mark started) when the loader throws on the start half', async () => {
    // Edge: the very first start failed so managerModule is null; a
    // restart() that hits a still-broken loader must propagate the
    // rejection and not report started.
    __setManagerLoader(async () => {
      throw new Error('still broken');
    });
    const mgr = new dheeCoreManager();
    await expect(mgr.restart(baseSettings)).rejects.toThrow('still broken');
    expect(mgr.isStarted()).toBe(false);
  });
});
