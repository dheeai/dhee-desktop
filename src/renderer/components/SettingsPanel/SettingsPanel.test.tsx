import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
jest.mock('react', () => jest.requireActual('react'));
import SettingsPanel from './SettingsPanel';

const baseSettings = {
  backendMode: 'local' as const,
  llmBackend: 'local' as const,
  comfyBackend: 'local' as const,
  comfyuiMode: 'inherit' as const,
  comfyuiUrl: '',
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai' as const,
  lmStudioUrl: 'http://127.0.0.1:1234',
  lmStudioModel: 'qwen3',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  openRouterApiKey: '',
  openRouterModel: 'z-ai/glm-4.7-flash',
  themeId: 'studio-neutral' as const,
  piOversight: true,
  vlmJudge: true,
  llmUseSameForAllTiers: true,
  llmTierMedium: {
    provider: 'openai' as const,
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
  },
  llmTierLight: {
    provider: 'openai' as const,
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
  },
};

describe('SettingsPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {},
    });
  });

  it('calls onThemeChange when a theme card is selected', async () => {
    const onThemeChange = jest.fn();

    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={baseSettings}
          onClose={jest.fn()}
          onThemeChange={onThemeChange}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Deep Forest & Gold'));
    expect(onThemeChange).toHaveBeenCalledWith('deep-forest-gold');
  });

  it('renders an inline Sign In button when user clicks Cloud while signed-out', async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    let onChangeHandler: ((account: unknown) => void) | null = null;
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        account: {
          get: jest.fn().mockResolvedValue(null),
          getBillingUrl: jest.fn().mockResolvedValue(''),
          signIn,
          signOut: jest.fn(),
          refreshBalance: jest.fn(),
          openBilling: jest.fn(),
          onChange: (cb: (account: unknown) => void) => {
            onChangeHandler = cb;
            return () => {};
          },
        },
      },
    });

    const onSaveConnection = jest.fn();
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={baseSettings}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={onSaveConnection}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection'));
    // Two "Cloud" radios now (one per backend lane). Pick the LLM
    // lane via its name attribute.
    const llmCloudRadio = document.querySelector(
      'input[name="llm-backend"][value="cloud"]',
    ) as HTMLInputElement;
    expect(llmCloudRadio).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(llmCloudRadio);
    });

    expect(
      screen.getByText('Sign in to Kshana Cloud to switch to Cloud mode.'),
    ).toBeInTheDocument();
    const signInButton = screen.getByRole('button', {
      name: /Sign In to Kshana Cloud/i,
    });

    await act(async () => {
      fireEvent.click(signInButton);
    });
    expect(signIn).toHaveBeenCalledTimes(1);

    // Simulate the auth bridge reporting a signed-in account; the panel
    // should clear the warning and auto-apply the pending Cloud switch
    // to BOTH lanes (matching the deep-link sign-in path's symmetry).
    await act(async () => {
      onChangeHandler?.({
        email: 'user@example.com',
        name: 'User',
        credits: 100,
        planId: 'free',
        planLabel: 'Free',
        subscriptionStatus: 'active',
      });
    });

    expect(
      screen.queryByText('Sign in to Kshana Cloud to switch to Cloud mode.'),
    ).not.toBeInTheDocument();
    expect(llmCloudRadio.checked).toBe(true);
    const comfyCloudRadio = document.querySelector(
      'input[name="comfy-backend"][value="cloud"]',
    ) as HTMLInputElement;
    expect(comfyCloudRadio.checked).toBe(true);
  });

  it('shows ComfyUI and provider settings on the Connection tab', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={baseSettings}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection'));

    expect(screen.getByLabelText('ComfyUI URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Comfy Cloud API Key')).toBeInTheDocument();
    expect(screen.getByText('OpenAI-Compatible')).toBeInTheDocument();
  });

  it('hides Medium and Light tier sections when "use same LLM for all tasks" is checked', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={{ ...baseSettings, llmUseSameForAllTiers: true }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection'));

    expect(screen.queryByText('Medium LLM')).not.toBeInTheDocument();
    expect(screen.queryByText('Light LLM')).not.toBeInTheDocument();
  });

  it('reveals Medium and Light tier sections when the toggle is unchecked', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={{ ...baseSettings, llmUseSameForAllTiers: false }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection'));

    expect(screen.getByText('Medium LLM')).toBeInTheDocument();
    expect(screen.getByText('Light LLM')).toBeInTheDocument();
  });

  it('saves Medium tier edits through onSaveConnection when the toggle is off', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={{ ...baseSettings, llmUseSameForAllTiers: false }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={onSave}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection'));

    // Medium tier defaults to provider=openai per the fixture, so the Base URL
    // input renders. Edit the Model ID under "Medium LLM" — there are multiple
    // "Model ID" labels (Heavy, Medium, Light), so target via fieldset role.
    const mediumFieldset = screen.getByText('Medium LLM').closest('fieldset');
    expect(mediumFieldset).not.toBeNull();
    const modelInput = mediumFieldset!.querySelector(
      'input[placeholder="gpt-4o"]',
    ) as HTMLInputElement;
    expect(modelInput).toBeInTheDocument();

    fireEvent.change(modelInput, { target: { value: 'edited-medium-model' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & Restart/i }));

    expect(onSave).toHaveBeenCalled();
    const payload = onSave.mock.calls[0][0];
    expect(payload.llmUseSameForAllTiers).toBe(false);
    expect(payload.llmTierMedium.openaiModel).toBe('edited-medium-model');
  });
});
