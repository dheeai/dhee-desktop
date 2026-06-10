import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
jest.mock('react', () => jest.requireActual('react'));
import {
  AppSettingsProvider,
  useAppSettings,
} from './AppSettingsContext';
import type { AppSettings } from '../../shared/settingsTypes';

const baseSettings: AppSettings = {
  backendMode: 'local',
  llmBackend: 'local',
  comfyBackend: 'local',
  vlmBackend: 'local' as const,
  comfyuiMode: 'inherit',
  comfyuiUrl: '',
  singleGpuMode: false,
  budgetCapUsd: 5,
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  themeId: 'studio-neutral',
  piOversight: true,
  vlmJudge: true,
  vlmProvider: 'openai' as const,
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

function TestConsumer() {
  const {
    themeId,
    isSettingsOpen,
    openSettings,
    updateTheme,
  } = useAppSettings();

  return (
    <div>
      <span data-testid="theme-id">{themeId}</span>
      <span data-testid="settings-open">
        {isSettingsOpen ? 'open' : 'closed'}
      </span>
      <button type="button" onClick={openSettings}>
        Open Settings
      </button>
      <button
        type="button"
        onClick={() => {
          void updateTheme('paper-light');
        }}
      >
        Switch Theme
      </button>
    </div>
  );
}

describe('AppSettingsProvider', () => {
  it('loads settings, applies theme, and accepts IPC updates', async () => {
    let onChange: ((settings: AppSettings) => void) | null = null;
    const get = jest.fn().mockResolvedValue(baseSettings);
    const update = jest.fn().mockImplementation(async (patch: Partial<AppSettings>) => ({
      ...baseSettings,
      ...patch,
    }));

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        settings: {
          get,
          update,
          onChange: (callback: (settings: AppSettings) => void) => {
            onChange = callback;
            return jest.fn();
          },
        },
      },
    });

    render(
      <AppSettingsProvider>
        <TestConsumer />
      </AppSettingsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('theme-id')).toHaveTextContent('studio-neutral'),
    );
    expect(document.documentElement.dataset.theme).toBe('studio-neutral');

    fireEvent.click(screen.getByText('Open Settings'));
    expect(screen.getByTestId('settings-open')).toHaveTextContent('open');

    fireEvent.click(screen.getByText('Switch Theme'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ themeId: 'paper-light' }));
    await waitFor(() =>
      expect(screen.getByTestId('theme-id')).toHaveTextContent('paper-light'),
    );

    await act(async () => {
      onChange?.({
        ...baseSettings,
        themeId: 'deep-forest-gold',
      });
    });

    expect(screen.getByTestId('theme-id')).toHaveTextContent('deep-forest-gold');
    expect(document.documentElement.dataset.theme).toBe('deep-forest-gold');
  });
});
