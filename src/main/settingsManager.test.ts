import { describe, expect, it, jest } from '@jest/globals';

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
  llmProvider: 'openai' as const,
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
};

describe('settingsManager theme normalization', () => {
  it('defaults invalid theme ids to the default theme', () => {
    expect(normalizeThemeId('nordic-night')).toBe(DEFAULT_THEME_ID);
    expect(normalizeThemeId(undefined)).toBe(DEFAULT_THEME_ID);
  });

  it('accepts the cinematic theme', () => {
    expect(normalizeThemeId('cinematic')).toBe('cinematic');
  });

  it('migrates the retired studio-neutral theme to the default (cinematic)', () => {
    expect(DEFAULT_THEME_ID).toBe('cinematic');
    expect(normalizeThemeId('studio-neutral')).toBe('cinematic');
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

  it('preserves the OpenAI-compatible endpoint settings', () => {
    const normalized = normalizeSettings({
      ...baseSettings,
      llmProvider: 'openai',
      openaiBaseUrl: 'https://openrouter.ai/api/v1',
      openaiApiKey: 'sk-or-v1-test',
      openaiModel: 'openrouter/model',
    });

    expect(normalized.llmProvider).toBe('openai');
    expect(normalized.openaiBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(normalized.openaiApiKey).toBe('sk-or-v1-test');
    expect('preferredLocalPort' in normalized).toBe(false);
  });

  it('collapses any non-gemini provider value to openai (OpenAI-compatible)', () => {
    const normalized = normalizeSettings({
      ...baseSettings,
      // legacy/unknown provider values are no longer in the type
      llmProvider: 'openrouter' as unknown as 'openai',
    });
    expect(normalized.llmProvider).toBe('openai');
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
