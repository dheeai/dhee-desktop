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

  it('disables both Cloud toggles when signed-out and surfaces a Sign In CTA banner', async () => {
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

    // Both cloud toggles are present but disabled (no signed-in account).
    const llmCloudCheckbox = screen.getByLabelText(
      'Use Kshana Cloud for LLM',
    ) as HTMLInputElement;
    const comfyCloudCheckbox = screen.getByLabelText(
      'Use Kshana Cloud for ComfyUI',
    ) as HTMLInputElement;
    expect(llmCloudCheckbox.disabled).toBe(true);
    expect(comfyCloudCheckbox.disabled).toBe(true);

    // Sign-in CTA banner is visible.
    expect(
      screen.getByText(/Sign in to Kshana Cloud to enable Cloud mode/i),
    ).toBeInTheDocument();
    const signInButton = screen.getByRole('button', {
      name: /Sign In to Kshana Cloud/i,
    });

    await act(async () => {
      fireEvent.click(signInButton);
    });
    expect(signIn).toHaveBeenCalledTimes(1);

    // Auth bridge reports signed-in. Banner disappears and toggles
    // become enabled. Toggles do NOT auto-flip — the user must click
    // them explicitly (matches the rest of the lane-toggle flow).
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
      screen.queryByText(/Sign in to Kshana Cloud to enable Cloud mode/i),
    ).not.toBeInTheDocument();
    expect(llmCloudCheckbox.disabled).toBe(false);
    expect(comfyCloudCheckbox.disabled).toBe(false);
    expect(llmCloudCheckbox.checked).toBe(false);
    expect(comfyCloudCheckbox.checked).toBe(false);
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

  it('hides ComfyUI URL inputs when "Use Kshana Cloud for ComfyUI" is on, reveals them when off', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={{ ...baseSettings, comfyBackend: 'cloud', backendMode: 'cloud' }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection'));

    // Cloud on → ComfyUI URL / Comfy Cloud API Key are not in the DOM.
    expect(screen.queryByLabelText('ComfyUI URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Comfy Cloud API Key')).not.toBeInTheDocument();
    // The toggle itself is still there and checked.
    const toggle = screen.getByLabelText(
      'Use Kshana Cloud for ComfyUI',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('hides ALL LLM provider inputs when "Use Kshana Cloud for LLM" is on', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={{ ...baseSettings, llmBackend: 'cloud', backendMode: 'cloud' }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection'));

    // None of the LLM provider inputs should be in the DOM —
    // not the Heavy fieldset, not Medium/Light tiers, not the
    // "use same LLM" checkbox.
    expect(screen.queryByText('Heavy LLM (primary)')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenAI-Compatible')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Use this same LLM for medium and light tasks'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Medium LLM')).not.toBeInTheDocument();
    expect(screen.queryByText('Light LLM')).not.toBeInTheDocument();
    // The toggle itself is still there and checked.
    const toggle = screen.getByLabelText(
      'Use Kshana Cloud for LLM',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
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
