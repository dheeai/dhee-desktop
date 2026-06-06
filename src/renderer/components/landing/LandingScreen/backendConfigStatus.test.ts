import { describe, expect, it } from '@jest/globals';
import {
  checkLaneConfigured,
  getBackendConfigStatus,
} from './backendConfigStatus';
import type {
  AccountInfo,
  AppSettings,
} from '../../../../shared/settingsTypes';

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    backendMode: 'local',
    llmBackend: 'local',
    comfyBackend: 'local',
    vlmBackend: 'local',
    comfyuiMode: 'custom',
    comfyuiUrl: '',
    comfyCloudApiKey: '',
    comfyuiTimeout: 1800,
    llmProvider: 'openai',
    lmStudioUrl: '',
    lmStudioModel: '',
    googleApiKey: '',
    geminiModel: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    openRouterApiKey: '',
    openRouterModel: '',
    llmUseSameForAllTiers: true,
    ...overrides,
  } as AppSettings;
}

const account: AccountInfo = {
  userId: 'u1',
  email: 'demo@example.com',
  credits: 100,
  token: 'tok',
};

describe('checkLaneConfigured — LLM lane', () => {
  it('local + openai with key → configured', () => {
    expect(
      checkLaneConfigured(
        'llm',
        baseSettings({ llmProvider: 'openai', openaiApiKey: 'sk-x' }),
        null,
      ).configured,
    ).toBe(true);
  });

  it('local + openai with no key → unconfigured with reason', () => {
    const out = checkLaneConfigured(
      'llm',
      baseSettings({ llmProvider: 'openai', openaiApiKey: '' }),
      null,
    );
    expect(out.configured).toBe(false);
    expect(out.reason).toMatch(/API key/);
  });

  it('local + each provider checks its specific credential', () => {
    // OpenAI-compatible with a LOCAL base URL → no key required.
    expect(
      checkLaneConfigured(
        'llm',
        baseSettings({ llmProvider: 'openai', openaiBaseUrl: 'http://127.0.0.1:1234/v1', openaiApiKey: '' }),
        null,
      ).configured,
    ).toBe(true);
    // OpenAI-compatible REMOTE with no key → not configured.
    expect(
      checkLaneConfigured(
        'llm',
        baseSettings({ llmProvider: 'openai', openaiBaseUrl: 'https://api.openai.com/v1', openaiApiKey: '' }),
        null,
      ).configured,
    ).toBe(false);
    // Gemini needs the Google key.
    expect(
      checkLaneConfigured(
        'llm',
        baseSettings({ llmProvider: 'gemini', googleApiKey: 'g' }),
        null,
      ).configured,
    ).toBe(true);
    // OpenAI-compatible remote WITH a key → configured.
    expect(
      checkLaneConfigured(
        'llm',
        baseSettings({ llmProvider: 'openai', openaiBaseUrl: 'https://api.openai.com/v1', openaiApiKey: 'sk' }),
        null,
      ).configured,
    ).toBe(true);
  });

  it('cloud + signed in → configured; cloud without account → "Sign in"', () => {
    expect(
      checkLaneConfigured(
        'llm',
        baseSettings({ llmBackend: 'cloud' }),
        account,
      ).configured,
    ).toBe(true);
    const noAcct = checkLaneConfigured(
      'llm',
      baseSettings({ llmBackend: 'cloud' }),
      null,
    );
    expect(noAcct.configured).toBe(false);
    expect(noAcct.reason).toMatch(/Sign in/);
  });

  it('whitespace-only credentials are treated as missing', () => {
    expect(
      checkLaneConfigured(
        'llm',
        baseSettings({ llmProvider: 'openai', openaiApiKey: '   ' }),
        null,
      ).configured,
    ).toBe(false);
  });
});

describe('checkLaneConfigured — Comfy lane', () => {
  it('local + URL set → configured', () => {
    expect(
      checkLaneConfigured(
        'comfy',
        baseSettings({ comfyuiUrl: 'http://localhost:8188' }),
        null,
      ).configured,
    ).toBe(true);
  });

  it('local + no URL → unconfigured', () => {
    const out = checkLaneConfigured('comfy', baseSettings(), null);
    expect(out.configured).toBe(false);
    expect(out.reason).toMatch(/ComfyUI URL/);
  });

  it('cloud needs BOTH account AND Comfy Cloud API key', () => {
    expect(
      checkLaneConfigured(
        'comfy',
        baseSettings({ comfyBackend: 'cloud' }),
        account,
      ).configured,
    ).toBe(false);
    expect(
      checkLaneConfigured(
        'comfy',
        baseSettings({ comfyBackend: 'cloud', comfyCloudApiKey: 'cck' }),
        null,
      ).configured,
    ).toBe(false);
    expect(
      checkLaneConfigured(
        'comfy',
        baseSettings({ comfyBackend: 'cloud', comfyCloudApiKey: 'cck' }),
        account,
      ).configured,
    ).toBe(true);
  });
});

describe('checkLaneConfigured — VLM lane', () => {
  it('reuses LLM credentials when local — configured iff LLM is', () => {
    expect(
      checkLaneConfigured(
        'vlm',
        baseSettings({ llmProvider: 'openai', openaiApiKey: 'sk-x' }),
        null,
      ).configured,
    ).toBe(true);
    expect(
      checkLaneConfigured(
        'vlm',
        baseSettings({ llmProvider: 'openai' }),
        null,
      ).configured,
    ).toBe(false);
  });

  it('cloud + sign-in is sufficient', () => {
    expect(
      checkLaneConfigured(
        'vlm',
        baseSettings({ vlmBackend: 'cloud' }),
        account,
      ).configured,
    ).toBe(true);
  });
});

describe('checkLaneConfigured — null safety', () => {
  it('null/undefined settings → unconfigured with reason', () => {
    expect(checkLaneConfigured('llm', null, null).configured).toBe(false);
    expect(checkLaneConfigured('comfy', undefined, null).configured).toBe(false);
    expect(checkLaneConfigured('vlm', null, account).configured).toBe(false);
  });
});

describe('getBackendConfigStatus', () => {
  it('returns allConfigured=true only when every lane passes', () => {
    const status = getBackendConfigStatus(
      baseSettings({
        llmProvider: 'openai',
        openaiApiKey: 'sk',
        comfyuiUrl: 'http://x',
      }),
      null,
    );
    expect(status.allConfigured).toBe(true);
    expect(status.unconfiguredLanes).toEqual([]);
  });

  it('aggregates ALL unconfigured lanes (not just the first)', () => {
    const status = getBackendConfigStatus(baseSettings(), null);
    // LLM (no openai key), Comfy (no URL), VLM (no openai key) → 3 issues
    expect(status.allConfigured).toBe(false);
    expect(status.unconfiguredLanes).toHaveLength(3);
    expect(status.unconfiguredLanes.map((l) => l.lane)).toEqual([
      'llm',
      'comfy',
      'vlm',
    ]);
  });

  it('preserves display order: llm, comfy, vlm', () => {
    // Comfy configured, LLM and VLM not → only llm + vlm flagged, in that order
    const status = getBackendConfigStatus(
      baseSettings({ comfyuiUrl: 'http://x' }),
      null,
    );
    expect(status.unconfiguredLanes.map((l) => l.lane)).toEqual(['llm', 'vlm']);
  });
});
