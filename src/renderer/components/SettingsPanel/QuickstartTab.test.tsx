/**
 * QuickstartTab — single-field LLM setup for the 90% case.
 *
 * UX critique: the Connection tab is a wall of inputs (provider
 * dropdowns, per-tier toggles, base URLs, ComfyUI mode). For a
 * first-time user who just wants to get going, this is hostile.
 * Quickstart is the new first tab: paste an OpenRouter API key,
 * click Save, you're configured.
 *
 * The tab calls onSave with a patch that:
 *   - sets llmProvider = 'openrouter'
 *   - sets openRouterApiKey = <user input>
 *   - keeps llmUseSameForAllTiers = true (so all 3 tiers use it)
 */
import '@testing-library/jest-dom';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { QuickstartTab } from './QuickstartTab';

describe('QuickstartTab', () => {
  it('renders the OpenRouter API key input', () => {
    render(<QuickstartTab onSave={() => Promise.resolve(true)} isSaving={false} />);
    expect(
      screen.getByLabelText(/openrouter api key/i),
    ).toBeInTheDocument();
  });

  it('Save is disabled when the key field is empty', () => {
    render(<QuickstartTab onSave={() => Promise.resolve(true)} isSaving={false} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('Save fires onSave with the right patch when the user submits a key', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    render(<QuickstartTab onSave={onSave} isSaving={false} />);
    const input = screen.getByLabelText(/openrouter api key/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'sk-or-test-key' } });
    });
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).not.toBeDisabled();
    await act(async () => { save.click(); });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        llmProvider: 'openrouter',
        openRouterApiKey: 'sk-or-test-key',
        llmUseSameForAllTiers: true,
      }),
    );
  });

  it('shows the saving state while onSave is in flight', () => {
    render(<QuickstartTab onSave={() => Promise.resolve(true)} isSaving={true} />);
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  it('hides the API key value behind type=password by default', () => {
    render(<QuickstartTab onSave={() => Promise.resolve(true)} isSaving={false} />);
    const input = screen.getByLabelText(/openrouter api key/i) as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('has a "show key" toggle that reveals the value as plain text', () => {
    render(<QuickstartTab onSave={() => Promise.resolve(true)} isSaving={false} />);
    const input = screen.getByLabelText(/openrouter api key/i) as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: /show|reveal/i });
    expect(input.type).toBe('password');
    act(() => { toggle.click(); });
    expect(input.type).toBe('text');
  });

  it('links the user to openrouter.ai for getting a key', () => {
    render(<QuickstartTab onSave={() => Promise.resolve(true)} isSaving={false} />);
    const link = screen.getByRole('link', { name: /openrouter/i });
    expect(link).toHaveAttribute('href');
    expect(link.getAttribute('href')).toMatch(/openrouter\.ai/);
  });

  it('offers a "Run the guided setup" entry when one is provided, and fires it', () => {
    const onRunGuidedSetup = jest.fn();
    render(
      <QuickstartTab onSave={() => Promise.resolve(true)} isSaving={false} onRunGuidedSetup={onRunGuidedSetup} />,
    );
    const btn = screen.getByRole('button', { name: /run the guided setup/i });
    act(() => {
      btn.click();
    });
    expect(onRunGuidedSetup).toHaveBeenCalledTimes(1);
  });

  it('omits the guided-setup entry when no handler is provided', () => {
    render(<QuickstartTab onSave={() => Promise.resolve(true)} isSaving={false} />);
    expect(screen.queryByRole('button', { name: /run the guided setup/i })).toBeNull();
  });
});
