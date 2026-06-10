/**
 * applyEnvFromSettings — ComfyUI endpoint routing.
 *
 * Regression: dhee-core ships a dev `.env` (zrok tunnel URLs). When the
 * desktop runs in dev it symlinks that repo as `node_modules/dhee-core`
 * and `loadDevEnv()` surfaces the file's keys into `process.env` BEFORE
 * settings are applied — including `ENDPOINT_self_local=<zrok tunnel>`
 * and `COMFYUI_BASE_URL=<zrok tunnel>`.
 *
 * dhee-core's `resolveEndpointUrl()` consults `ENDPOINT_self_local`
 * BEFORE `COMFYUI_BASE_URL` in local mode, so even after the desktop
 * overwrote `COMFYUI_BASE_URL` from Settings, the stale
 * `ENDPOINT_self_local` from `.env` kept winning — the pipeline talked
 * to the (often-down) zrok tunnel instead of the box in the Settings
 * "ComfyUI URL" field. (User report: "why is it saying zrok when the
 * ComfyUI is in a diff place? Is it not honoring the settings?")
 *
 * Contract being pinned: when embedded in the desktop, **Settings is the
 * single source of truth for ComfyUI endpoint routing.** dhee-core's
 * `.env` must NOT decide where ComfyUI lives — it's only for running
 * dhee-core directly.
 *
 * These exercise the real exported `applyEnvFromSettings`, mutating and
 * asserting on `process.env` (behavioral — not a source grep).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// electron-log derives its log file path from electron's `app`, which
// doesn't exist in a bare jest/jsdom run. Stub it to no-ops so calling
// the function (which logs a summary line) doesn't blow up.
jest.mock('electron-log', () => ({
  __esModule: true,
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

import { applyEnvFromSettings } from './dheeCoreManager';

const ZROK = 'https://comfyui.share.zrok.io';
const TAILNET = 'http://100.93.149.119:8188';

const base = {
  // backend lanes — all local so no cloud auth is needed
  comfyBackend: 'local' as const,
  llmBackend: 'local' as const,
  vlmBackend: 'local' as const,
  // ComfyUI
  comfyuiMode: 'custom' as const,
  comfyuiUrl: TAILNET,
  singleGpuMode: false,
  comfyuiTimeout: 1800,
  comfyCloudApiKey: '',
  comfyEndpoints: {} as Record<string, string>,
  // LLM (kept minimal — same-for-all-tiers skips the tier block)
  llmProvider: 'openai' as const,
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  googleApiKey: '',
  geminiModel: '',
  llmUseSameForAllTiers: true,
  // VLM off → VLM block skipped
  vlmJudge: false,
  projectDir: '',
};

describe('applyEnvFromSettings — ComfyUI endpoint routing (Settings wins over .env)', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('overrides a stale .env ENDPOINT_self_local (zrok) with the Settings ComfyUI URL', () => {
    // Simulate loadDevEnv() having surfaced dhee-core/.env:
    process.env.COMFYUI_BASE_URL = ZROK;
    process.env.ENDPOINT_self_local = ZROK;

    applyEnvFromSettings({ ...base } as never);

    expect(process.env.COMFYUI_BASE_URL).toBe(TAILNET);
    // The load-bearing assertion: the canonical local endpoint that
    // resolveEndpointUrl() reads first must follow Settings, not .env.
    expect(process.env.ENDPOINT_self_local).toBe(TAILNET);
    expect(process.env.COMFY_MODE).toBe('local');
  });

  it('purges other stale .env ENDPOINT_* vars that Settings does not define', () => {
    process.env.ENDPOINT_self_local = ZROK;
    process.env.ENDPOINT_public_cloud = 'https://cloud.comfy.org/api';

    applyEnvFromSettings({ ...base } as never);

    // .env's public_cloud must not bleed into a desktop run.
    expect(process.env.ENDPOINT_public_cloud).toBeUndefined();
    expect(process.env.ENDPOINT_self_local).toBe(TAILNET);
  });

  it('sets non-self.local named endpoints from comfyEndpoints, but the ComfyUI URL field stays authoritative for self.local', () => {
    applyEnvFromSettings({
      ...base,
      comfyEndpoints: {
        'self.local': 'http://192.168.1.50:8188', // drifted from the main field
        'public.cloud': 'https://cloud.comfy.org/api',
      },
    } as never);

    // Other named endpoints come straight from comfyEndpoints.
    expect(process.env.ENDPOINT_public_cloud).toBe('https://cloud.comfy.org/api');
    // self.local is owned by the prominent "ComfyUI URL" field — a
    // comfyEndpoints['self.local'] that drifted from it must NOT win.
    expect(process.env.ENDPOINT_self_local).toBe(TAILNET);
  });

  it('THE BUG: a stale comfyEndpoints {self.local, public.cloud}=zrok does not override the ComfyUI URL field', () => {
    // Exact reproduction of the live settings: comfyuiUrl points at the
    // reachable tailnet box, but the advanced endpoints list still has
    // self.local + public.cloud pointing at the dead zrok tunnel. In
    // local mode resolveEndpointUrl() forces self.local, so this is what
    // decided where comfy.image ran — and it was hitting zrok → 502.
    const result = applyEnvFromSettings({
      ...base,
      comfyuiUrl: TAILNET,
      comfyEndpoints: {
        'public.cloud': ZROK,
        'self.local': ZROK,
      },
    } as never);
    expect(result).toBeUndefined(); // returns void; just exercising it
    expect(process.env.ENDPOINT_self_local).toBe(TAILNET);
    expect(process.env.COMFYUI_BASE_URL).toBe(TAILNET);
  });

  it('does not let a stale .env COMFYUI_BASE_URL survive for a custom Settings URL', () => {
    process.env.COMFYUI_BASE_URL = ZROK;

    applyEnvFromSettings({ ...base, comfyuiUrl: 'http://127.0.0.1:9999' } as never);

    expect(process.env.COMFYUI_BASE_URL).toBe('http://127.0.0.1:9999');
    expect(process.env.ENDPOINT_self_local).toBe('http://127.0.0.1:9999');
  });
});
