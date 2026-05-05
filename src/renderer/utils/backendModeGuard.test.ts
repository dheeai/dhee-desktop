import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  getBackendBaseUrlForSettings,
  getBackendStateForSettings,
} from './backendModeGuard';
import type {
  BackendConnectionInfo,
  BackendState,
} from '../../shared/backendTypes';
import type { AppSettings } from '../../shared/settingsTypes';

const baseSettings: AppSettings = {
  backendMode: 'local',
  comfyuiMode: 'inherit',
  comfyuiUrl: '',
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai',
  lmStudioUrl: 'http://127.0.0.1:1234',
  lmStudioModel: 'qwen3',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'http://127.0.0.1:1234/v1',
  openaiModel: 'GLM-4.7',
  openRouterApiKey: '',
  openRouterModel: 'z-ai/glm-4.7-flash',
  themeId: 'studio-neutral',
};

describe('backendModeGuard', () => {
  const getState = jest.fn<() => Promise<BackendState>>();
  const getConnectionInfo = jest.fn<() => Promise<BackendConnectionInfo>>();
  const restart = jest.fn<() => Promise<BackendState>>();

  beforeEach(() => {
    getState.mockReset();
    getConnectionInfo.mockReset();
    restart.mockReset();
    getConnectionInfo.mockResolvedValue({
      selectedMode: 'local',
      localBackendAvailable: true,
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        backend: {
          getState,
          getConnectionInfo,
          restart,
        },
      },
    });
  });

  it('restarts when local settings see a cloud backend state', async () => {
    getState.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'https://kshana.example.com',
    });
    restart.mockResolvedValue({
      status: 'ready',
      mode: 'local',
      serverUrl: 'http://127.0.0.1:62377',
    });

    await expect(getBackendStateForSettings(baseSettings)).resolves.toEqual({
      status: 'ready',
      mode: 'local',
      serverUrl: 'http://127.0.0.1:62377',
    });
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('uses the current state when mode already matches settings', async () => {
    const localState: BackendState = {
      status: 'ready',
      mode: 'local',
      serverUrl: 'http://127.0.0.1:62377',
    };
    getState.mockResolvedValue(localState);

    await expect(getBackendStateForSettings(baseSettings)).resolves.toBe(
      localState,
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it('keeps cloud mode on the local bundled backend', async () => {
    getState.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:8000',
    });
    getConnectionInfo.mockResolvedValue({
      selectedMode: 'cloud',
      cloudServerUrl: 'http://localhost:8080',
      effectiveServerUrl: 'http://localhost:8080',
      localBackendAvailable: true,
    });
    await expect(
      getBackendStateForSettings({ ...baseSettings, backendMode: 'cloud' }),
    ).resolves.toEqual({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:8000',
    });
    expect(restart).not.toHaveBeenCalled();
  });

  it('keeps cloud mode on localhost when it matches the configured website proxy', async () => {
    const cloudState: BackendState = {
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://localhost:8080',
    };
    getState.mockResolvedValue(cloudState);
    getConnectionInfo.mockResolvedValue({
      selectedMode: 'cloud',
      cloudServerUrl: 'http://localhost:8080',
      effectiveServerUrl: 'http://localhost:8080',
      localBackendAvailable: true,
    });

    await expect(
      getBackendStateForSettings({ ...baseSettings, backendMode: 'cloud' }),
    ).resolves.toEqual(cloudState);
    expect(restart).not.toHaveBeenCalled();
  });

  it('returns the local core URL in cloud mode after restart', async () => {
    getState.mockResolvedValue({
      status: 'ready',
      mode: 'local',
      serverUrl: 'http://127.0.0.1:3000',
    });
    getConnectionInfo.mockResolvedValue({
      selectedMode: 'cloud',
      cloudServerUrl: 'http://127.0.0.1:9000',
      effectiveServerUrl: 'http://127.0.0.1:9000',
      localBackendAvailable: true,
    });
    restart.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:3000',
    });

    await expect(
      getBackendStateForSettings({ ...baseSettings, backendMode: 'cloud' }),
    ).resolves.toEqual({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:3000',
    });
  });

  it('resolves cloud base URLs from the local backend endpoint', async () => {
    getConnectionInfo.mockResolvedValue({
      selectedMode: 'cloud',
      cloudServerUrl: 'https://website.example',
      effectiveServerUrl: 'http://127.0.0.1:3000',
      proxyBaseUrl: 'https://proxy.example',
      localBackendAvailable: true,
    });

    await expect(
      getBackendBaseUrlForSettings(
        { ...baseSettings, backendMode: 'cloud' },
        {
          status: 'ready',
          mode: 'cloud',
          serverUrl: 'http://127.0.0.1:3000',
        },
      ),
    ).resolves.toBe('http://127.0.0.1:3000');
  });
});
