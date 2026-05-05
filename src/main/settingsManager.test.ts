jest.mock('electron-store', () =>
  jest.fn().mockImplementation(() => ({
    store: {},
    set: jest.fn(),
    get: jest.fn(),
  })),
);

import {
  DEFAULT_THEME_ID,
  normalizeSettings,
  normalizeThemeId,
} from './settingsManager';

const baseSettings = {
  backendMode: 'local' as const,
  comfyuiMode: 'inherit' as const,
  comfyuiUrl: '',
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'lmstudio' as const,
  lmStudioUrl: 'http://127.0.0.1:1234',
  lmStudioModel: 'qwen3',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  openRouterApiKey: '',
  openRouterModel: 'z-ai/glm-4.7-flash',
};

describe('settingsManager theme normalization', () => {
  it('defaults invalid theme ids to studio-neutral', () => {
    expect(normalizeThemeId('nordic-night')).toBe(DEFAULT_THEME_ID);
    expect(normalizeThemeId(undefined)).toBe(DEFAULT_THEME_ID);
  });

  it('preserves a valid theme and migrates missing theme ids', () => {
    expect(
      normalizeSettings({
        ...baseSettings,
        themeId: 'deep-forest-gold',
      }).themeId,
    ).toBe('deep-forest-gold');

    expect(
      normalizeSettings({
        ...baseSettings,
        themeId: 'void-cut',
      }).themeId,
    ).toBe('void-cut');

    expect(
      normalizeSettings({
        ...baseSettings,
      }).themeId,
    ).toBe(DEFAULT_THEME_ID);
  });

  it('preserves local backend provider settings', () => {
    const normalized = normalizeSettings({
      ...baseSettings,
      llmProvider: 'openrouter',
      openRouterApiKey: 'sk-or-v1-test',
      openRouterModel: 'openrouter/model',
    });

    expect(normalized.llmProvider).toBe('openrouter');
    expect(normalized.openRouterApiKey).toBe('sk-or-v1-test');
    expect('preferredLocalPort' in normalized).toBe(false);
  });

  it('preserves the Comfy Cloud API key', () => {
    const normalized = normalizeSettings({
      ...baseSettings,
      comfyuiMode: 'custom',
      comfyuiUrl: 'https://cloud.comfy.org',
      comfyCloudApiKey: 'cloud-test-key',
    });

    expect(normalized.comfyuiUrl).toBe('https://cloud.comfy.org');
    expect(normalized.comfyCloudApiKey).toBe('cloud-test-key');
  });
});
