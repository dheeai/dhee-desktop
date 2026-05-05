import { describe, expect, it, jest } from '@jest/globals';
import { buildLocalBackendEnv } from './localBackendManager';
import type { AppSettings } from '../shared/settingsTypes';

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

const baseSettings: AppSettings = {
  backendMode: 'local',
  comfyuiMode: 'inherit',
  comfyuiUrl: '',
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'lmstudio',
  lmStudioUrl: 'http://127.0.0.1:1234',
  lmStudioModel: 'qwen3',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  openRouterApiKey: '',
  openRouterModel: 'z-ai/glm-4.7-flash',
  themeId: 'studio-neutral',
};

describe('buildLocalBackendEnv', () => {
  it('forwards COMFY_CLOUD_API_KEY for cloud.comfy.org', () => {
    const env = buildLocalBackendEnv(
      {
        ...baseSettings,
        comfyuiMode: 'custom',
        comfyuiUrl: 'https://cloud.comfy.org',
        comfyCloudApiKey: 'cloud-key',
      },
      8001,
    );

    expect(env['COMFYUI_BASE_URL']).toBe('https://cloud.comfy.org');
    expect(env['COMFY_CLOUD_API_KEY']).toBe('cloud-key');
  });

  it('does not forward COMFY_CLOUD_API_KEY for local ComfyUI urls', () => {
    const env = buildLocalBackendEnv(
      {
        ...baseSettings,
        comfyuiMode: 'custom',
        comfyuiUrl: 'http://localhost:8188',
        comfyCloudApiKey: 'cloud-key',
      },
      8001,
    );

    expect(env['COMFYUI_BASE_URL']).toBe('http://localhost:8188');
    expect(env['COMFY_CLOUD_API_KEY']).toBeUndefined();
  });

  it('configures paid providers through the authenticated proxy in cloud mode', () => {
    const env = buildLocalBackendEnv(
      {
        ...baseSettings,
        backendMode: 'cloud',
        projectDir: '/projects/demo',
        openRouterModel: 'openai/gpt-4o-mini',
      },
      8123,
      {
        websiteUrl: 'https://app.kshana.cloud',
        proxyBaseUrl: 'https://proxy.kshana.cloud/',
        desktopToken: 'desktop-jwt',
      },
    );

    expect(env['KSHANA_CLOUD']).toBe('true');
    expect(env['KSHANA_CLOUD_URL']).toBe('https://app.kshana.cloud');
    expect(env['KSHANA_PROXY_BASE_URL']).toBe('https://proxy.kshana.cloud/');
    expect(env['KSHANA_CLOUD_TOKEN']).toBe('desktop-jwt');
    expect(env['KSHANA_PROJECT_DIR']).toBe('/projects/demo');
    expect(env['COMFY_MODE']).toBe('cloud');
    expect(env['COMFY_CLOUD_URL']).toBe('https://proxy.kshana.cloud/comfy/api');
    expect(env['COMFY_CLOUD_AUTH_TOKEN']).toBe('desktop-jwt');
    expect(env['COMFY_CLOUD_API_KEY']).toBeUndefined();
    expect(env['LLM_PROVIDER']).toBe('openai');
    expect(env['OPENAI_BASE_URL']).toBe(
      'https://proxy.kshana.cloud/openai/api/v1',
    );
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['OPENAI_MODEL']).toBe('deepseek/deepseek-v4-flash');
    expect(env['OPENROUTER_BASE_URL']).toBeUndefined();
    expect(env['OPENROUTER_API_KEY']).toBeUndefined();
    expect(env['OPENROUTER_MODEL']).toBeUndefined();
  });

  it('allows the cloud proxy model to be overridden by env', () => {
    const previous = process.env['KSHANA_CLOUD_OPENAI_MODEL'];
    process.env['KSHANA_CLOUD_OPENAI_MODEL'] = 'z-ai/glm-5';
    try {
      const env = buildLocalBackendEnv(
        {
          ...baseSettings,
          backendMode: 'cloud',
        },
        8123,
        {
          websiteUrl: 'https://app.kshana.cloud',
          proxyBaseUrl: 'https://proxy.kshana.cloud/',
          desktopToken: 'desktop-jwt',
        },
      );

      expect(env['OPENAI_MODEL']).toBe('z-ai/glm-5');
    } finally {
      if (previous === undefined) delete process.env['KSHANA_CLOUD_OPENAI_MODEL'];
      else process.env['KSHANA_CLOUD_OPENAI_MODEL'] = previous;
    }
  });
});
