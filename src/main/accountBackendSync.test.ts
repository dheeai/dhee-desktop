import { describe, expect, it } from '@jest/globals';
import {
  shouldRestartCloudBackendForAccountChange,
  shouldStopCloudBackendOnSignOut,
} from './accountBackendSync';
import type { AccountInfo, AppSettings } from '../shared/settingsTypes';

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

const account: AccountInfo = {
  userId: 'user-1',
  email: 'user@example.com',
  credits: 500,
  token: 'old-token',
};

describe('accountBackendSync', () => {
  it('restarts cloud backend when a signed-in cloud account token changes', () => {
    expect(
      shouldRestartCloudBackendForAccountChange(
        { ...baseSettings, backendMode: 'cloud' },
        account,
        'new-token',
      ),
    ).toBe(true);
  });

  it('does not restart for unchanged tokens or local mode', () => {
    expect(
      shouldRestartCloudBackendForAccountChange(
        { ...baseSettings, backendMode: 'cloud' },
        account,
        'old-token',
      ),
    ).toBe(false);
    expect(
      shouldRestartCloudBackendForAccountChange(
        baseSettings,
        account,
        'new-token',
      ),
    ).toBe(false);
  });

  it('stops only cloud backend on sign-out', () => {
    expect(
      shouldStopCloudBackendOnSignOut({ ...baseSettings, backendMode: 'cloud' }),
    ).toBe(true);
    expect(shouldStopCloudBackendOnSignOut(baseSettings)).toBe(false);
  });
});
