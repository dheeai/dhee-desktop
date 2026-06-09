import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { AppSettings } from '../shared/settingsTypes';
import {
  freeComfyBeforeLocalLlm,
  loadLocalLlmModelForSingleGpu,
  unloadLocalLlmBeforeLocalComfy,
} from './singleGpuCoordinator';

const baseSettings: AppSettings = {
  backendMode: 'local',
  llmBackend: 'local',
  comfyBackend: 'local',
  vlmBackend: 'local',
  comfyuiMode: 'custom',
  comfyuiUrl: 'http://100.93.149.119:8188',
  singleGpuMode: true,
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai',
  googleApiKey: '',
  geminiModel: '',
  openaiApiKey: '',
  openaiBaseUrl: 'http://100.93.149.119:8080/v1',
  openaiModel: 'qwen-loaded',
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
    openaiBaseUrl: 'http://100.93.149.119:8080/v1',
    openaiApiKey: '',
    openaiModel: 'qwen-loaded',
    googleApiKey: '',
    geminiModel: '',
  },
  llmTierLight: {
    provider: 'openai',
    openaiBaseUrl: 'http://100.93.149.119:8080/v1',
    openaiApiKey: '',
    openaiModel: 'qwen-loaded',
    googleApiKey: '',
    geminiModel: '',
  },
};

describe('singleGpuCoordinator', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('frees ComfyUI before loading a local LLM model through the manager endpoint', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await loadLocalLlmModelForSingleGpu(baseSettings, {
      model: 'qwen-next',
      baseUrl: 'http://100.93.149.119:8080/v1',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://100.93.149.119:8188/free',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://100.93.149.119:8080/models/load',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'qwen-next' }),
      }),
    );
  });

  it('unloads the configured local LLM before local ComfyUI starts', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await unloadLocalLlmBeforeLocalComfy(baseSettings);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://100.93.149.119:8080/models/unload',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'qwen-loaded' }),
      }),
    );
  });

  it('does nothing when single GPU mode is disabled', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await freeComfyBeforeLocalLlm({ ...baseSettings, singleGpuMode: false });
    await unloadLocalLlmBeforeLocalComfy({ ...baseSettings, singleGpuMode: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
