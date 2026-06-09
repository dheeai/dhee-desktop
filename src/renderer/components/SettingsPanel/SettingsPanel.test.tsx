import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import SettingsPanel from './SettingsPanel';

jest.mock('react', () => jest.requireActual('react'));

const baseSettings = {
  backendMode: 'local' as const,
  llmBackend: 'local' as const,
  comfyBackend: 'local' as const,
  vlmBackend: 'local' as const,
  comfyuiMode: 'inherit' as const,
  comfyuiUrl: '',
  singleGpuMode: false,
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
  vlmProvider: 'openai' as const,
  vlmBaseUrl: '',
  vlmApiKey: '',
  vlmModel: '',
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

  it('no longer renders the theme picker or the Appearance tab (theming disabled)', async () => {
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

    // The Appearance tab (theme grid + the dead Agent-oversight toggle)
    // was removed. No tab button, no theme cards.
    expect(screen.queryByText('Appearance')).toBeNull();
    expect(screen.queryByText('Deep Forest & Gold')).toBeNull();
  });

  it('exposes the VLM judge toggle in the Connection tab and saves on change', async () => {
    const onSaveConnection = jest.fn();
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          initialTab="connection"
          settings={baseSettings}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={onSaveConnection}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    // VLM judge was relocated here from the retired Appearance tab; it
    // saves immediately on toggle (baseSettings has it on → click turns
    // it off).
    fireEvent.click(screen.getByLabelText('Enable VLM judge'));
    expect(onSaveConnection).toHaveBeenCalledWith({ vlmJudge: false });
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
          getAuthStatus: jest.fn().mockResolvedValue('idle'),
          signIn,
          signOut: jest.fn(),
          refreshBalance: jest.fn(),
          openBilling: jest.fn(),
          onChange: (cb: (account: unknown) => void) => {
            onChangeHandler = cb;
            return () => {};
          },
          onAuthStatusChange: () => () => {},
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

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

    // Both cloud toggles are present but disabled (no signed-in account).
    const llmCloudCheckbox = screen.getByLabelText(
      'Use Dhee Cloud for LLM',
    ) as HTMLInputElement;
    const comfyCloudCheckbox = screen.getByLabelText(
      'Use Dhee Cloud for ComfyUI',
    ) as HTMLInputElement;
    expect(llmCloudCheckbox.disabled).toBe(true);
    expect(comfyCloudCheckbox.disabled).toBe(true);

    // Each lane has a "Sign In" button right next to its disabled
    // cloud checkbox — the user can sign in directly from where they
    // see the gate, no separate banner to scan for.
    // One Sign In button per cloud lane (LLM / ComfyUI / VLM) when signed-out.
    const signInButtons = screen.getAllByRole('button', { name: /^Sign In$/ });
    expect(signInButtons).toHaveLength(3);

    await act(async () => {
      fireEvent.click(signInButtons[0]);
    });
    expect(signIn).toHaveBeenCalledTimes(1);

    // Auth bridge reports signed-in on Free. LLM can use Cloud, but
    // ComfyUI stays BYO because hosted media is not in Free/Starter.
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

    expect(screen.queryAllByRole('button', { name: /^Sign In$/ })).toHaveLength(
      0,
    );
    expect(llmCloudCheckbox.disabled).toBe(false);
    expect(comfyCloudCheckbox.disabled).toBe(true);
    expect(llmCloudCheckbox.checked).toBe(false);
    expect(comfyCloudCheckbox.checked).toBe(false);
    expect(
      screen.getByText(
        /Starter and Free accounts bring their own ComfyUI endpoint/i,
      ),
    ).toBeInTheDocument();
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

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

    expect(screen.getByLabelText('ComfyUI URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Comfy Cloud API Key')).toBeInTheDocument();
    // "OpenAI-Compatible" appears in both LLM and VLM provider toggles.
    expect(screen.getAllByText('OpenAI-Compatible').length).toBeGreaterThan(0);
  });

  it('saves the single GPU mode toggle with connection settings', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          initialTab="connection"
          settings={baseSettings}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={onSave}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(
      screen.getByLabelText('Pause chat during local ComfyUI renders'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Save & Restart/i }));

    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).toMatchObject({
      singleGpuMode: true,
    });
  });

  it('orders Gemini model before API key in provider settings', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          initialTab="connection"
          settings={{ ...baseSettings, llmProvider: 'gemini' }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    const modelLabel = screen.getByText('Gemini Model ID');
    const apiKeyLabel = screen.getByText('Google API Key');

    expect(modelLabel.compareDocumentPosition(apiKeyLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('opens directly to the requested initial tab', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          initialTab="connection"
          settings={baseSettings}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    expect(screen.getByRole('heading', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByLabelText('ComfyUI URL')).toBeInTheDocument();
  });

  it('runs advisory provider diagnostics from the Connection tab', async () => {
    const run = jest.fn().mockResolvedValue({
      checkedAt: 1,
      items: [
        {
          id: 'llm',
          label: 'LLM',
          status: 'warning',
          message: 'OpenAI-compatible LLM needs an API key.',
        },
      ],
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        providerDiagnostics: { run },
      },
    });

    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          initialTab="connection"
          settings={baseSettings}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test all providers' }));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('OpenAI-compatible LLM needs an API key.'),
    ).toBeInTheDocument();
  });

  it('loads model ids for the Settings model field while preserving free text entry', async () => {
    const probeLlm = jest.fn().mockResolvedValue({
      ok: true,
      message: 'Reachable — 2 models available.',
      models: ['qwen-local-a', 'qwen-local-b'],
      modelDetails: [
        { id: 'qwen-local-a', status: 'loaded' },
        { id: 'qwen-local-b', status: 'unloaded' },
      ],
    });
    const warmLlmModel = jest.fn().mockResolvedValue({
      ok: true,
      message: 'qwen-local-b is loaded.',
    });
    const onSave = jest.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        providerDiagnostics: { probeLlm, warmLlmModel },
      },
    });

    let container!: HTMLElement;
    await act(async () => {
      const rendered = render(
        <SettingsPanel
          isOpen
          initialTab="connection"
          settings={{
            ...baseSettings,
            openaiBaseUrl: 'http://100.93.149.119:8080/v1',
            openaiApiKey: '',
            openaiModel: 'qwen-current',
          }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={onSave}
          isSavingConnection={false}
          error={null}
        />,
      );
      container = rendered.container;
    });

    const modelInput = container.querySelector(
      'input[data-tour-id="settings-llm-model"]',
    ) as HTMLInputElement;
    expect(modelInput).toBeInTheDocument();

    await act(async () => {
      fireEvent.focus(modelInput);
    });

    expect(probeLlm).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: '',
      model: 'qwen-current',
      baseUrl: 'http://100.93.149.119:8080/v1',
    });
    expect(await screen.findByText(/2 models available from endpoint/i)).toBeInTheDocument();
    const modelField = modelInput.closest('.label') as HTMLElement;
    fireEvent.click(within(modelField).getByRole('button', { name: /Show Models/i }));
    expect(within(modelField).getByRole('option', { name: /qwen-local-a.*loaded/i })).toBeInTheDocument();
    const unloadedOption = within(modelField).getByRole('option', { name: /qwen-local-b.*unloaded/i });
    expect(unloadedOption).toBeInTheDocument();
    fireEvent.click(unloadedOption);
    expect(warmLlmModel).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: '',
      model: 'qwen-local-b',
      baseUrl: 'http://100.93.149.119:8080/v1',
    });
    expect(await screen.findByText(/qwen-local-b is loaded/i)).toBeInTheDocument();

    fireEvent.change(modelInput, { target: { value: 'custom-model-id' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & Restart/i }));

    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0].openaiModel).toBe('custom-model-id');
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

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

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

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

    expect(screen.getByText('Medium LLM')).toBeInTheDocument();
    expect(screen.getByText('Light LLM')).toBeInTheDocument();
  });

  it('hides ComfyUI URL inputs when "Use Dhee Cloud for ComfyUI" is on, reveals them when off', async () => {
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={{ ...baseSettings, comfyBackend: 'cloud',
  vlmBackend: 'local' as const, backendMode: 'cloud' }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

    // Cloud on → ComfyUI URL / Comfy Cloud API Key are not in the DOM.
    expect(screen.queryByLabelText('ComfyUI URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Comfy Cloud API Key')).not.toBeInTheDocument();
    // The toggle itself is still there and checked.
    const toggle = screen.getByLabelText(
      'Use Dhee Cloud for ComfyUI',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('resets Starter accounts to BYO ComfyUI and saves ComfyUI as local', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        account: {
          get: jest.fn().mockResolvedValue({
            userId: 'user_1',
            email: 'user@example.com',
            credits: 3000,
            planId: 'starter_10',
            planLabel: 'Starter',
            subscriptionStatus: 'active',
            token: 'desktop-jwt',
          }),
          getBillingUrl: jest.fn().mockResolvedValue(''),
          getAuthStatus: jest.fn().mockResolvedValue('idle'),
          signIn: jest.fn(),
          signOut: jest.fn(),
          refreshBalance: jest.fn(),
          openBilling: jest.fn(),
          onChange: () => () => {},
          onAuthStatusChange: () => () => {},
        },
      },
    });
    const onSave = jest.fn().mockResolvedValue(true);

    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          initialTab="connection"
          settings={{
            ...baseSettings,
            comfyBackend: 'cloud',
            backendMode: 'cloud',
          }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={onSave}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    expect(
      await screen.findByText(
        /Starter and Free accounts bring their own ComfyUI endpoint/i,
      ),
    ).toBeInTheDocument();

    const comfyCloudCheckbox = screen.getByLabelText(
      'Use Dhee Cloud for ComfyUI',
    ) as HTMLInputElement;
    expect(comfyCloudCheckbox.disabled).toBe(true);
    expect(comfyCloudCheckbox.checked).toBe(false);

    const urlInput = screen.getByLabelText('ComfyUI URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'http://127.0.0.1:8188' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & Restart/i }));

    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).toMatchObject({
      backendMode: 'local',
      comfyBackend: 'local',
      comfyuiMode: 'custom',
      comfyuiUrl: 'http://127.0.0.1:8188',
    });
  });

  it('hides ALL LLM provider inputs when "Use Dhee Cloud for LLM" is on', async () => {
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

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

    // None of the LLM provider inputs should be in the DOM —
    // not the Heavy fieldset, not Medium/Light tiers, not the
    // "use same LLM" checkbox. The VLM lane is independent now,
    // so its provider radios may still be present (vlmBackend
    // defaults to 'local' in baseSettings).
    expect(screen.queryByText('Heavy LLM (primary)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Use this same LLM for medium and light tasks'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Medium LLM')).not.toBeInTheDocument();
    expect(screen.queryByText('Light LLM')).not.toBeInTheDocument();
    // The toggle itself is still there and checked.
    const toggle = screen.getByLabelText(
      'Use Dhee Cloud for LLM',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('VLM cloud lane: provider radios and the Model ID input are both hidden — cloud owns model selection', async () => {
    // Cloud VLM contract: the proxy chooses a vision model. Exposing the
    // VLM Model ID field invites users to set a value that gets ignored
    // (and historically rode through to the cloud request as a stale
    // local-mode model name). The toggle + the helper text is the whole
    // UI surface in cloud mode.
    await act(async () => {
      render(
        <SettingsPanel
          isOpen
          settings={{ ...baseSettings, vlmBackend: 'cloud', backendMode: 'cloud' }}
          onClose={jest.fn()}
          onThemeChange={jest.fn()}
          onSaveConnection={jest.fn()}
          isSavingConnection={false}
          error={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

    // VLM toggle checked.
    const vlmToggle = screen.getByLabelText(
      'Use Dhee Cloud for VLM',
    ) as HTMLInputElement;
    expect(vlmToggle.checked).toBe(true);
    // Cloud-mode helper text visible.
    expect(
      screen.getByText(/VLM routes through the Dhee Cloud proxy/i),
    ).toBeInTheDocument();
    // Model ID input MUST NOT be present — cloud owns model selection.
    expect(screen.queryByLabelText('VLM Model ID')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByText('Connection', { selector: 'span' }));

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
