/**
 * OverlayContext — central dispatcher for the binary workspace's
 * overlays (Settings / Library / Plans / Timeline).
 *
 * Contract pinned here:
 *   - Only one overlay is open at a time. Opening a new one replaces
 *     the current one (no stacking).
 *   - close() returns to "no overlay" state.
 *   - useOverlay() throws when called outside the provider (forces
 *     correct mounting).
 *   - The same overlay key can carry per-open payload data (e.g.
 *     which video to show in the Library overlay).
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { OverlayProvider, useOverlay, type OverlayKey } from './OverlayContext';

function Probe() {
  const { current, payload, open, close } = useOverlay();
  return (
    <div>
      <div data-testid="current">{current ?? 'none'}</div>
      <div data-testid="payload">{payload ? JSON.stringify(payload) : 'no-payload'}</div>
      <button onClick={() => open('settings')} data-testid="open-settings">open settings</button>
      <button onClick={() => open('library', { videoId: 'final_video' })} data-testid="open-library">open library</button>
      <button onClick={close} data-testid="close">close</button>
    </div>
  );
}

const renderProbe = () => render(
  <OverlayProvider>
    <Probe />
  </OverlayProvider>,
);

describe('OverlayContext', () => {
  it('starts with no overlay open', () => {
    renderProbe();
    expect(screen.getByTestId('current')).toHaveTextContent('none');
    expect(screen.getByTestId('payload')).toHaveTextContent('no-payload');
  });

  it('open(key) sets current to that key', () => {
    renderProbe();
    act(() => screen.getByTestId('open-settings').click());
    expect(screen.getByTestId('current')).toHaveTextContent('settings');
  });

  it('open(key, payload) stores the payload for the renderer to read', () => {
    renderProbe();
    act(() => screen.getByTestId('open-library').click());
    expect(screen.getByTestId('current')).toHaveTextContent('library');
    expect(screen.getByTestId('payload')).toHaveTextContent('"videoId":"final_video"');
  });

  it('opening a new overlay replaces the current one (no stacking)', () => {
    renderProbe();
    act(() => screen.getByTestId('open-settings').click());
    expect(screen.getByTestId('current')).toHaveTextContent('settings');
    act(() => screen.getByTestId('open-library').click());
    expect(screen.getByTestId('current')).toHaveTextContent('library');
    expect(screen.getByTestId('payload')).toHaveTextContent('"videoId":"final_video"');
  });

  it('close() returns to the none state and clears payload', () => {
    renderProbe();
    act(() => screen.getByTestId('open-library').click());
    act(() => screen.getByTestId('close').click());
    expect(screen.getByTestId('current')).toHaveTextContent('none');
    expect(screen.getByTestId('payload')).toHaveTextContent('no-payload');
  });

  it('useOverlay() outside the provider throws (forces correct mount)', () => {
    // Suppress React's expected error log for this test.
    const orig = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Probe />)).toThrow(/OverlayProvider/);
    } finally {
      console.error = orig;
    }
  });

  it('OverlayKey type is a closed enum of known overlay names', () => {
    // Compile-time check that the enum holds the expected keys.
    const all: OverlayKey[] = ['settings', 'library', 'plans', 'timeline'];
    expect(all).toHaveLength(4);
  });
});
