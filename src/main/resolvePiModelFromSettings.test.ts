/**
 * resolvePiModelFromSettings — Phase 6.5b.
 *
 * Pure function, no electron mock needed. Each settings shape maps to
 * a {provider, modelId, apiKey} triple (or null) the chatPrompt
 * path passes through to pi-agent's buildPiSession.
 */
import { describe, expect, it } from '@jest/globals';
import { resolvePiModelFromSettings } from './dheeCoreManager';

const base = {
  llmProvider: 'openai' as const,
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: '',
  googleApiKey: '',
  geminiModel: '',
};

describe('resolvePiModelFromSettings', () => {
  it('returns the openrouter triple when openaiBaseUrl points at openrouter.ai', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      openaiApiKey: 'or-secret',
      openaiBaseUrl: 'https://openrouter.ai/api/v1',
      openaiModel: 'deepseek/deepseek-v4-flash',
    } as never);
    expect(result).toEqual({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      apiKey: 'or-secret',
    });
  });

  it('returns the openai triple for standard openai.com base url', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      openaiApiKey: 'sk-real',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiModel: 'gpt-4o',
    } as never);
    expect(result).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
      apiKey: 'sk-real',
    });
  });

  it('returns the google triple when llmProvider is gemini', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      llmProvider: 'gemini',
      googleApiKey: 'g-secret',
      geminiModel: 'gemini-2.5-flash',
    } as never);
    expect(result).toEqual({
      provider: 'google',
      modelId: 'gemini-2.5-flash',
      apiKey: 'g-secret',
    });
  });

  it('returns null when no API key is configured for the selected provider', () => {
    expect(
      resolvePiModelFromSettings({
        ...base,
        llmProvider: 'openai',
        openaiApiKey: '   ', // whitespace = empty
        openaiModel: 'gpt-4o',
      } as never),
    ).toBeNull();
    expect(
      resolvePiModelFromSettings({
        ...base,
        llmProvider: 'gemini',
        googleApiKey: '',
        geminiModel: 'gemini-2.5-flash',
      } as never),
    ).toBeNull();
  });

  it('case-insensitive openrouter base-url match (openrouter.ai vs OpenRouter.AI)', () => {
    expect(
      resolvePiModelFromSettings({
        ...base,
        openaiApiKey: 'k',
        openaiBaseUrl: 'https://OPENROUTER.AI/api/v1',
        openaiModel: 'x/y',
      } as never),
    ).toMatchObject({ provider: 'openrouter' });
  });

  it('defaults geminiModel to gemini-2.5-flash when empty', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      llmProvider: 'gemini',
      googleApiKey: 'g',
      geminiModel: '',
    } as never);
    expect(result?.modelId).toBe('gemini-2.5-flash');
  });
});
