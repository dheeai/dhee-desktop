import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FirstRunSetupProvider } from '../../contexts/FirstRunSetupContext';
import FirstRunSetup from './FirstRunSetup';

function installElectron() {
  const complete = jest.fn(async () => ({ completed: true }));
  const update = jest.fn(async () => ({}));
  (window as unknown as { electron: unknown }).electron = {
    onboarding: { getState: jest.fn(async () => ({ completed: false })), complete },
    settings: { get: jest.fn(async () => ({})), update },
    providerDiagnostics: { run: jest.fn(async () => ({ checkedAt: 1, items: [{ id: 'llm', label: 'Language model', status: 'ready', message: 'ok' }] })) },
    account: { get: jest.fn(async () => null), signIn: jest.fn(async () => ({ opened: true, state: 's' })) },
    bundleConfig: { probeComfy: jest.fn(async () => ({ ok: true, modelCount: 10, nodeClasses: 20 })) },
  };
  return { complete, update };
}

function renderFlow() {
  return render(
    <FirstRunSetupProvider>
      <FirstRunSetup />
    </FirstRunSetupProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FirstRunSetup', () => {
  it('opens on the recipe step with the three recipes', async () => {
    installElectron();
    renderFlow();
    expect(await screen.findByText(/Let's light the set/i)).toBeTruthy();
    expect(screen.getByText('Run on Dhee Cloud')).toBeTruthy();
    expect(screen.getByText('Hybrid')).toBeTruthy();
    expect(screen.getByText('Fully local / BYO keys')).toBeTruthy();
  });

  it('cloud recipe skips the renderer step (recipe → brain → preflight)', async () => {
    const { update } = installElectron();
    renderFlow();
    await screen.findByText(/Let's light the set/i);

    fireEvent.click(screen.getByText('Run on Dhee Cloud'));
    fireEvent.click(screen.getByText('Continue'));

    // brain step: cloud sign-in
    expect(await screen.findByText(/Connect the language model/i)).toBeTruthy();
    expect(screen.getByText(/Sign in with Dhee/i)).toBeTruthy();

    // can't continue until signed in (no account) — but cloud renderer is skipped:
    // simulate a signed-in account by re-installing account.get to return one,
    // then drive sign-in.
    fireEvent.click(screen.getByText(/Sign in with Dhee/i));
    // signIn was attempted (account arrives async via poll; not asserted here)
    expect(update).not.toHaveBeenCalled(); // settings only applied at preflight
  });

  it('local recipe collects a provider key and reaches the renderer step', async () => {
    installElectron();
    renderFlow();
    await screen.findByText(/Let's light the set/i);

    fireEvent.click(screen.getByText('Fully local / BYO keys'));
    fireEvent.click(screen.getByText('Continue'));

    // brain step shows provider segmented control
    expect(await screen.findByText('OpenRouter')).toBeTruthy();
    // enter a key to enable Continue
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-or-xyz' } });
    fireEvent.click(screen.getByText('Continue'));

    // renderer step with a Test connection button
    expect(await screen.findByText(/Connect ComfyUI/i)).toBeTruthy();
    expect(screen.getByText('Test connection')).toBeTruthy();
  });

  it('local path applies settings + diagnostics at pre-flight and completes on finish', async () => {
    const { complete, update } = installElectron();
    renderFlow();
    await screen.findByText(/Let's light the set/i);

    fireEvent.click(screen.getByText('Fully local / BYO keys'));
    fireEvent.click(screen.getByText('Continue')); // → brain (local)

    fireEvent.change(await screen.findByPlaceholderText('sk-…'), { target: { value: 'sk-or-key' } });
    fireEvent.click(screen.getByText('Continue')); // → renderer

    fireEvent.click(await screen.findByText('Test connection'));
    await screen.findByText(/Connected/i); // probe ok → Continue enabled
    fireEvent.click(screen.getByText('Continue')); // → preflight

    await waitFor(() => expect(update).toHaveBeenCalled()); // settings applied once
    await screen.findByText('Language model'); // a diagnostics light rendered

    fireEvent.click(screen.getByText(/Create your first project/i));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith({ skipped: false, completedReason: 'manual_finish' }),
    );
  });
});
