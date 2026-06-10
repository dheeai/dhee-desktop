import { describe, expect, it } from '@jest/globals';
import { recipeLanePatch, llmProviderPatch, buildSetupPatch } from './recipePresets';

describe('recipeLanePatch', () => {
  it('cloud routes all three lanes to cloud', () => {
    expect(recipeLanePatch('cloud')).toEqual({ llmBackend: 'cloud', comfyBackend: 'cloud', vlmBackend: 'cloud' });
  });
  it('hybrid keeps LLM/VLM cloud but ComfyUI local+custom', () => {
    expect(recipeLanePatch('hybrid')).toEqual({
      llmBackend: 'cloud',
      comfyBackend: 'local',
      vlmBackend: 'cloud',
      comfyuiMode: 'custom',
    });
  });
  it('local routes everything local + custom comfy', () => {
    expect(recipeLanePatch('local')).toEqual({
      llmBackend: 'local',
      comfyBackend: 'local',
      vlmBackend: 'local',
      comfyuiMode: 'custom',
    });
  });
});

describe('llmProviderPatch', () => {
  it('openai (OpenAI-compatible) includes base url + model defaults', () => {
    expect(llmProviderPatch({ provider: 'openai', openaiApiKey: 'sk' })).toEqual({
      llmProvider: 'openai',
      openaiApiKey: 'sk',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiModel: 'gpt-4o',
    });
  });
  it('openai with a custom (local) base url and no key', () => {
    expect(
      llmProviderPatch({
        provider: 'openai',
        openaiBaseUrl: 'http://127.0.0.1:1234/v1',
        openaiModel: 'qwen3',
      }),
    ).toEqual({
      llmProvider: 'openai',
      openaiApiKey: '',
      openaiBaseUrl: 'http://127.0.0.1:1234/v1',
      openaiModel: 'qwen3',
    });
  });
  it('gemini uses the google key + model defaults', () => {
    expect(llmProviderPatch({ provider: 'gemini', googleApiKey: 'g' })).toEqual({
      llmProvider: 'gemini',
      googleApiKey: 'g',
      geminiModel: 'gemini-2.5-flash',
    });
  });
});

describe('buildSetupPatch', () => {
  it('cloud → lanes only (no comfy url, no provider keys)', () => {
    expect(buildSetupPatch({ recipe: 'cloud' })).toEqual({
      llmBackend: 'cloud',
      comfyBackend: 'cloud',
      vlmBackend: 'cloud',
    });
  });

  it('hybrid → cloud brain + local comfy url, no local provider keys', () => {
    const patch = buildSetupPatch({ recipe: 'hybrid', comfyuiUrl: 'http://192.168.1.9:8188' });
    expect(patch.llmBackend).toBe('cloud');
    expect(patch.comfyBackend).toBe('local');
    expect(patch.comfyuiUrl).toBe('http://192.168.1.9:8188');
    expect(patch).not.toHaveProperty('openRouterApiKey');
  });

  it('local → comfy url + provider keys', () => {
    const patch = buildSetupPatch({
      recipe: 'local',
      comfyuiUrl: 'http://127.0.0.1:8188',
      llm: { provider: 'gemini', googleApiKey: 'AIza' },
    });
    expect(patch).toMatchObject({
      llmBackend: 'local',
      comfyBackend: 'local',
      comfyuiMode: 'custom',
      comfyuiUrl: 'http://127.0.0.1:8188',
      llmProvider: 'gemini',
      googleApiKey: 'AIza',
      geminiModel: 'gemini-2.5-flash',
    });
  });
});
