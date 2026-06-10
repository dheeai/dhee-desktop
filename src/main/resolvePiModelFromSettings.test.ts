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
  it('returns the Dhee Cloud proxy triple when llmBackend is cloud and cloud auth is present', () => {
    const result = resolvePiModelFromSettings(
      {
        ...base,
        llmBackend: 'cloud',
        llmProvider: 'openai',
        openaiApiKey: '',
      } as never,
      {
        websiteUrl: 'https://desktop.example.test/',
        desktopToken: 'desktop-jwt',
      },
    );
    expect(result).toEqual({
      provider: 'cloud',
      apiKey: 'desktop-jwt',
      baseUrl: 'https://desktop.example.test/openai/api/v1',
    });
  });

  it('returns null for cloud LLM when cloud auth is missing', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      llmBackend: 'cloud',
      llmProvider: 'openai',
      openaiApiKey: 'sk-local-ignored',
    } as never);
    expect(result).toBeNull();
  });

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
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('returns a config for a LOCAL OpenAI-compatible base url with no key', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      llmProvider: 'openai',
      openaiApiKey: '',
      openaiBaseUrl: 'http://127.0.0.1:1234/v1',
      openaiModel: 'qwen3',
    } as never);
    expect(result).toEqual({
      provider: 'openai',
      modelId: 'qwen3',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:1234/v1',
    });
  });

  it('routes an OpenRouter key (sk-or-…) to OpenRouter when the base url is left blank', () => {
    // Regression: an sk-or-v1 key is unambiguously an OpenRouter credential.
    // When the user pastes one but leaves openaiBaseUrl empty, the old code
    // defaulted to https://api.openai.com/v1 → provider 'openai' → every
    // request 401s ("Incorrect API key provided") and the agent silently
    // dies, so the desktop "Resume" button appears to do nothing.
    const result = resolvePiModelFromSettings({
      ...base,
      llmProvider: 'openai',
      openaiApiKey: 'sk-or-v1-abc123',
      openaiBaseUrl: '', // blank — must NOT default to OpenAI for an OpenRouter key
      openaiModel: 'inclusionai/ring-2.6-1t',
    } as never);
    expect(result).toEqual({
      provider: 'openrouter',
      modelId: 'inclusionai/ring-2.6-1t',
      apiKey: 'sk-or-v1-abc123',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('respects an explicit non-OpenRouter base url even with an sk-or key (explicit wins over the key-based default)', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      llmProvider: 'openai',
      openaiApiKey: 'sk-or-v1-abc123',
      openaiBaseUrl: 'http://127.0.0.1:1234/v1', // explicit local proxy
      openaiModel: 'qwen3',
    } as never);
    expect(result).toMatchObject({
      provider: 'openai',
      baseUrl: 'http://127.0.0.1:1234/v1',
    });
  });

  it('still defaults a non-OpenRouter (sk-…) key to OpenAI when the base url is blank', () => {
    const result = resolvePiModelFromSettings({
      ...base,
      llmProvider: 'openai',
      openaiApiKey: 'sk-real-openai-key',
      openaiBaseUrl: '',
      openaiModel: 'gpt-4o',
    } as never);
    expect(result).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
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
      baseUrl: 'https://api.openai.com/v1',
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
