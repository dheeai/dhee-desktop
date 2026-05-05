import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const localStart = jest.fn<() => Promise<{ status: string; serverUrl?: string; mode?: string }>>();
const localRestart = jest.fn<() => Promise<{ status: string; serverUrl?: string; mode?: string }>>();
const localStop = jest.fn<() => Promise<{ status: string }>>();
const localIsAvailable = jest.fn<() => Promise<boolean>>();
const localGetBundledVersionInfo = jest.fn<() => Promise<Record<string, string> | undefined>>();
let mockLocalStatus: { mode: string; status?: string; serverUrl?: string } = {
  mode: 'local',
};

const cloudConnect = jest.fn<() => Promise<{ status: string; serverUrl?: string }>>();
const cloudDisconnect = jest.fn<() => Promise<{ status: string }>>();

jest.mock('./localBackendManager', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    start: localStart,
    restart: localRestart,
    stop: localStop,
    isAvailable: localIsAvailable,
    getBundledVersionInfo: localGetBundledVersionInfo,
    currentServerUrl: 'http://127.0.0.1:8001',
    get status() {
      return mockLocalStatus;
    },
  },
}));

jest.mock('./serverConnectionManager', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    connect: cloudConnect,
    disconnect: cloudDisconnect,
  },
}));

import backendManager from './backendManager';
import type { AppSettings } from '../shared/settingsTypes';

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

describe('backendManager', () => {
  beforeEach(() => {
    localStart.mockReset();
    localRestart.mockReset();
    localStop.mockReset();
    localIsAvailable.mockReset();
    localGetBundledVersionInfo.mockReset();
    cloudConnect.mockReset();
    cloudDisconnect.mockReset();
    mockLocalStatus = { mode: 'local' };
  });

  it('starts the bundled local backend when local mode is selected', async () => {
    localStart.mockResolvedValue({
      status: 'ready',
      serverUrl: 'http://127.0.0.1:8001',
    });
    cloudDisconnect.mockResolvedValue({ status: 'stopped' });

    const state = await backendManager.start(baseSettings);

    expect(localStart).toHaveBeenCalledWith(baseSettings);
    expect(cloudConnect).not.toHaveBeenCalled();
    expect(state.mode).toBe('local');
  });

  it('starts the bundled local backend with cloud runtime when cloud mode is selected', async () => {
    cloudDisconnect.mockResolvedValue({ status: 'stopped' });
    localRestart.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:8002',
    });

    const cloudRuntime = {
      websiteUrl: 'https://website.example.com',
      proxyBaseUrl: 'https://proxy.example.com',
      desktopToken: 'desktop-token',
    };
    const state = await backendManager.start(
      { ...baseSettings, backendMode: 'cloud' },
      cloudRuntime,
    );

    expect(cloudDisconnect).toHaveBeenCalled();
    expect(localRestart).toHaveBeenCalledWith(
      { ...baseSettings, backendMode: 'cloud' },
      cloudRuntime,
    );
    expect(cloudConnect).not.toHaveBeenCalled();
    expect(state.mode).toBe('cloud');
  });

  it('restarts the cloud backend when the desktop token changes', async () => {
    cloudDisconnect.mockResolvedValue({ status: 'stopped' });
    localRestart.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:8002',
    });
    localStart.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:8002',
    });

    const cloudSettings = { ...baseSettings, backendMode: 'cloud' as const };
    await backendManager.start(cloudSettings, {
      websiteUrl: 'https://website.example.com',
      proxyBaseUrl: 'https://proxy.example.com',
      desktopToken: 'old-token',
    });

    mockLocalStatus = { mode: 'cloud', status: 'ready' };
    localRestart.mockClear();
    localStart.mockClear();
    cloudDisconnect.mockClear();

    const nextRuntime = {
      websiteUrl: 'https://website.example.com',
      proxyBaseUrl: 'https://proxy.example.com',
      desktopToken: 'new-token',
    };
    const state = await backendManager.start(cloudSettings, nextRuntime);

    expect(cloudDisconnect).toHaveBeenCalled();
    expect(localRestart).toHaveBeenCalledWith(cloudSettings, nextRuntime);
    expect(localStart).not.toHaveBeenCalled();
    expect(state.mode).toBe('cloud');
  });

  it('does not restart the cloud backend when the runtime identity is unchanged', async () => {
    cloudDisconnect.mockResolvedValue({ status: 'stopped' });
    localRestart.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:8002',
    });
    localStart.mockResolvedValue({
      status: 'ready',
      mode: 'cloud',
      serverUrl: 'http://127.0.0.1:8002',
    });

    const cloudSettings = { ...baseSettings, backendMode: 'cloud' as const };
    const runtime = {
      websiteUrl: 'https://website.example.com',
      proxyBaseUrl: 'https://proxy.example.com',
      desktopToken: 'same-token',
    };

    await backendManager.start(cloudSettings, runtime);

    mockLocalStatus = { mode: 'cloud', status: 'ready' };
    localRestart.mockClear();
    localStart.mockClear();

    await backendManager.start(cloudSettings, runtime);

    expect(localRestart).not.toHaveBeenCalled();
    expect(localStart).toHaveBeenCalledWith(cloudSettings, runtime);
  });

  it('stops an existing cloud backend when cloud runtime credentials are missing', async () => {
    cloudDisconnect.mockResolvedValue({ status: 'stopped' });
    localStop.mockResolvedValue({ status: 'stopped' });
    mockLocalStatus = { mode: 'cloud', status: 'ready' };

    const state = await backendManager.start(
      { ...baseSettings, backendMode: 'cloud' },
      undefined,
    );

    expect(localStop).toHaveBeenCalled();
    expect(state.status).toBe('error');
    expect(state.mode).toBe('cloud');
  });

  it('reports the local effective endpoint when local mode is selected', async () => {
    localIsAvailable.mockResolvedValue(true);
    localGetBundledVersionInfo.mockResolvedValue({
      packageVersion: '0.1.0',
    });

    const info = await backendManager.getConnectionInfo(baseSettings, {
      websiteUrl: 'https://cloud.example.com',
      proxyBaseUrl: 'https://proxy.example.com',
    });

    expect(info.effectiveServerUrl).toBe('http://127.0.0.1:8001');
    expect(info.cloudServerUrl).toBe('https://cloud.example.com');
    expect(info.proxyBaseUrl).toBe('https://proxy.example.com');
    expect(info.selectedMode).toBe('local');
  });
});
