/**
 * BackendNotReadyBanner — non-blocking inline banner that surfaces
 * unconfigured backend lanes at the top of the landing screen.
 *
 * Replaces the old modal `BackendNotReadyDialog`, which walled off
 * the entire screen behind an alert dialog. The banner instead:
 *   - Sits inline at the top, visible from first paint
 *   - Lists which lanes need attention (LLM / ComfyUI / VLM)
 *   - Offers the same actions (Open Settings, Sign In) without
 *     trapping the user
 *   - Is dismissible per session (closes; reappears on next landing
 *     visit if still unconfigured)
 *   - Renders nothing when all lanes are configured
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { BackendNotReadyBanner } from './BackendNotReadyBanner';
import type { LaneConfigCheck } from './backendConfigStatus';

const lane = (id: string, reason: string): LaneConfigCheck => ({
  lane: id as LaneConfigCheck['lane'],
  configured: false,
  reason,
});

describe('BackendNotReadyBanner', () => {
  it('renders nothing when all lanes are configured', () => {
    const { container } = render(
      <BackendNotReadyBanner
        unconfiguredLanes={[]}
        canSignIn={true}
        onOpenSettings={() => {}}
        onSignIn={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a banner listing each unconfigured lane', () => {
    render(
      <BackendNotReadyBanner
        unconfiguredLanes={[
          lane('llm', 'no API key set'),
          lane('comfy', 'no endpoint URL'),
        ]}
        canSignIn={true}
        onOpenSettings={() => {}}
        onSignIn={() => {}}
      />,
    );
    expect(screen.getByText(/LLM/)).toBeInTheDocument();
    expect(screen.getByText(/ComfyUI/)).toBeInTheDocument();
    expect(screen.getByText(/no API key set/)).toBeInTheDocument();
    expect(screen.getByText(/no endpoint URL/)).toBeInTheDocument();
  });

  it('exposes an "Open Settings" action', () => {
    const onOpenSettings = jest.fn();
    render(
      <BackendNotReadyBanner
        unconfiguredLanes={[lane('llm', 'x')]}
        canSignIn={false}
        onOpenSettings={onOpenSettings}
        onSignIn={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /settings/i });
    act(() => btn.click());
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('exposes a "Sign in" action ONLY when canSignIn=true', () => {
    const onSignIn = jest.fn();
    const { rerender } = render(
      <BackendNotReadyBanner
        unconfiguredLanes={[lane('llm', 'x')]}
        canSignIn={true}
        onOpenSettings={() => {}}
        onSignIn={onSignIn}
      />,
    );
    const btn = screen.getByRole('button', { name: /sign in/i });
    act(() => btn.click());
    expect(onSignIn).toHaveBeenCalled();

    rerender(
      <BackendNotReadyBanner
        unconfiguredLanes={[lane('llm', 'x')]}
        canSignIn={false}
        onOpenSettings={() => {}}
        onSignIn={onSignIn}
      />,
    );
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('has a dismiss button that hides the banner', () => {
    render(
      <BackendNotReadyBanner
        unconfiguredLanes={[lane('llm', 'x')]}
        canSignIn={false}
        onOpenSettings={() => {}}
        onSignIn={() => {}}
      />,
    );
    expect(screen.getByRole('region', { name: /backends/i })).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: /dismiss/i }).click());
    expect(screen.queryByRole('region', { name: /backends/i })).toBeNull();
  });

  it('does NOT use role=dialog / role=alertdialog (must not be modal)', () => {
    const { container } = render(
      <BackendNotReadyBanner
        unconfiguredLanes={[lane('llm', 'x')]}
        canSignIn={false}
        onOpenSettings={() => {}}
        onSignIn={() => {}}
      />,
    );
    // Inline regions only — no modals.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
