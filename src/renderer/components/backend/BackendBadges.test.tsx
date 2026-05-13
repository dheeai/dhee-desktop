/**
 * BackendBadges — shared cloud/local indicator pill row used in the
 * landing-screen sidebar AND the in-project StatusBar so the user
 * always knows which lane (LLM / Comfy / VLM) is hitting cloud vs
 * local without having to leave the project view to check Settings.
 *
 * Behavior under test:
 *   - Renders three badges: LLM, Comfy, VLM
 *   - A lane shows "cloud" ONLY when (a) the persisted backend is
 *     'cloud' AND (b) an account is signed in. A persisted 'cloud'
 *     value with no account is runtime-effectively local.
 *   - A lane shows "local" when the persisted backend is 'local',
 *     regardless of account state.
 *   - Reacts to live account changes pushed via the IPC
 *     `account.onChange` subscription.
 */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AppSettingsProvider } from '../../contexts/AppSettingsContext';
import BackendBadges from './BackendBadges';
import type { AppSettings, AccountInfo } from '../../../shared/settingsTypes';

const baseSettings: AppSettings = {
  backendMode: 'local',
  llmBackend: 'local',
  comfyBackend: 'local',
  vlmBackend: 'local',
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
  piOversight: true,
  vlmJudge: true,
  vlmProvider: 'openai',
  vlmBaseUrl: '',
  vlmApiKey: '',
  vlmModel: '',
  llmUseSameForAllTiers: true,
  llmTierMedium: {
    provider: 'openai',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
  },
  llmTierLight: {
    provider: 'openai',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
  },
};

const sampleAccount: AccountInfo = {
  userId: 'u-1',
  email: 'user@example.com',
  credits: 100,
  token: 't',
};

interface InstallBridgeOpts {
  settings: AppSettings;
  initialAccount?: AccountInfo | null;
}

interface InstalledBridge {
  pushAccount: (next: AccountInfo | null) => void;
}

function installElectronBridge(opts: InstallBridgeOpts): InstalledBridge {
  let accountListener: ((next: AccountInfo | null) => void) | null = null;
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      settings: {
        get: jest.fn().mockResolvedValue(opts.settings),
        update: jest.fn(),
        onChange: () => () => undefined,
      },
      account: {
        get: jest.fn().mockResolvedValue(opts.initialAccount ?? null),
        getAuthStatus: jest.fn().mockResolvedValue('idle'),
        onChange: (cb: (next: AccountInfo | null) => void) => {
          accountListener = cb;
          return () => {
            accountListener = null;
          };
        },
        onAuthStatusChange: () => () => undefined,
      },
    },
  });
  return {
    pushAccount: (next) => {
      accountListener?.(next);
    },
  };
}

describe('BackendBadges', () => {
  it('renders LLM/Comfy/VLM badges as Local when all backends are local (account irrelevant)', async () => {
    installElectronBridge({
      settings: { ...baseSettings },
      initialAccount: sampleAccount, // signed in, but backends are local
    });

    render(
      <AppSettingsProvider>
        <BackendBadges />
      </AppSettingsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('badge-llm')).toBeInTheDocument());
    expect(screen.getByTestId('badge-llm')).toHaveTextContent(/local/i);
    expect(screen.getByTestId('badge-comfy')).toHaveTextContent(/local/i);
    expect(screen.getByTestId('badge-vlm')).toHaveTextContent(/local/i);
  });

  it('shows Cloud for a lane when backend=cloud AND account is present', async () => {
    installElectronBridge({
      settings: {
        ...baseSettings,
        llmBackend: 'cloud',
        comfyBackend: 'local',
        vlmBackend: 'cloud',
      },
      initialAccount: sampleAccount,
    });

    render(
      <AppSettingsProvider>
        <BackendBadges />
      </AppSettingsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('badge-llm')).toHaveTextContent(/cloud/i));
    expect(screen.getByTestId('badge-comfy')).toHaveTextContent(/local/i);
    expect(screen.getByTestId('badge-vlm')).toHaveTextContent(/cloud/i);
  });

  it('falls back to Local when backend=cloud but no account is signed in (runtime-effective local)', async () => {
    installElectronBridge({
      settings: {
        ...baseSettings,
        llmBackend: 'cloud',
        comfyBackend: 'cloud',
        vlmBackend: 'cloud',
      },
      initialAccount: null,
    });

    render(
      <AppSettingsProvider>
        <BackendBadges />
      </AppSettingsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('badge-llm')).toBeInTheDocument());
    expect(screen.getByTestId('badge-llm')).toHaveTextContent(/local/i);
    expect(screen.getByTestId('badge-comfy')).toHaveTextContent(/local/i);
    expect(screen.getByTestId('badge-vlm')).toHaveTextContent(/local/i);
  });

  it('flips to Cloud after sign-in event arrives via account.onChange', async () => {
    const bridge = installElectronBridge({
      settings: {
        ...baseSettings,
        llmBackend: 'cloud',
        comfyBackend: 'local',
        vlmBackend: 'local',
      },
      initialAccount: null,
    });

    render(
      <AppSettingsProvider>
        <BackendBadges />
      </AppSettingsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('badge-llm')).toHaveTextContent(/local/i));

    await act(async () => {
      bridge.pushAccount(sampleAccount);
    });

    await waitFor(() => expect(screen.getByTestId('badge-llm')).toHaveTextContent(/cloud/i));
  });
});
