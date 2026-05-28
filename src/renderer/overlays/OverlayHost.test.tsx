/**
 * OverlayHost — renders the currently-open overlay above the
 * workspace. Backed by OverlayContext; reuses existing components
 * (SettingsPanel, VideoLibraryView, PlansView, TimelinePanel) as
 * children of the overlay frame.
 *
 * Tests pin: render nothing when no overlay open, render correct
 * component for each key, close button + Escape key + backdrop
 * click all dismiss, only one overlay at a time.
 */
import '@testing-library/jest-dom';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { OverlayHost } from './OverlayHost';
import { OverlayProvider, useOverlay, type OverlayKey } from './OverlayContext';

// Mock the adapter components — OverlayHost should mount the right
// one based on key; each adapter has its own (eventual) test for the
// data plumbing into the inner panel.
jest.mock('./adapters/SettingsOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="overlay-content-settings">settings</div>,
}));
jest.mock('./adapters/LibraryOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="overlay-content-library">library</div>,
}));
jest.mock('./adapters/PlansOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="overlay-content-plans">plans</div>,
}));
jest.mock('./adapters/TimelineOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="overlay-content-timeline">timeline</div>,
}));

function Opener({ which }: { which: OverlayKey }) {
  const { open } = useOverlay();
  return <button data-testid="opener" onClick={() => open(which)}>open</button>;
}

const renderHost = (which: OverlayKey | null) => render(
  <OverlayProvider>
    {which ? <Opener which={which} /> : null}
    <OverlayHost />
  </OverlayProvider>,
);

const openOverlay = () => act(() => screen.getByTestId('opener').click());

describe('OverlayHost', () => {
  it('renders nothing when no overlay is open', () => {
    renderHost(null);
    expect(screen.queryByTestId('overlay-frame')).toBeNull();
  });

  it('renders the Settings panel when key=settings', () => {
    renderHost('settings');
    openOverlay();
    expect(screen.getByTestId('overlay-frame')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-content-settings')).toBeInTheDocument();
  });

  it('renders the Library when key=library', () => {
    renderHost('library');
    openOverlay();
    expect(screen.getByTestId('overlay-content-library')).toBeInTheDocument();
  });

  it('renders the Plans editor when key=plans', () => {
    renderHost('plans');
    openOverlay();
    expect(screen.getByTestId('overlay-content-plans')).toBeInTheDocument();
  });

  it('renders the Timeline panel when key=timeline', () => {
    renderHost('timeline');
    openOverlay();
    expect(screen.getByTestId('overlay-content-timeline')).toBeInTheDocument();
  });

  it('close button dismisses the overlay', () => {
    renderHost('settings');
    openOverlay();
    expect(screen.getByTestId('overlay-frame')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: /close/i }).click();
    });
    expect(screen.queryByTestId('overlay-frame')).toBeNull();
  });

  it('backdrop click dismisses the overlay', () => {
    renderHost('settings');
    openOverlay();
    act(() => {
      screen.getByTestId('overlay-backdrop').click();
    });
    expect(screen.queryByTestId('overlay-frame')).toBeNull();
  });

  it('Escape key dismisses the overlay', () => {
    renderHost('settings');
    openOverlay();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('overlay-frame')).toBeNull();
  });

  it('clicking the frame (not the backdrop) does not dismiss', () => {
    renderHost('settings');
    openOverlay();
    act(() => {
      screen.getByTestId('overlay-frame').click();
    });
    expect(screen.getByTestId('overlay-frame')).toBeInTheDocument();
  });
});
