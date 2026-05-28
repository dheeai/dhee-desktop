/**
 * ShortcutsOverlay — Cmd+/ opens a panel listing every active
 * shortcut by section.
 *
 * Per UX critique: "Cmd+I and Ctrl+Enter work but aren't documented
 * anywhere." Fixed: every shortcut lives in a central registry and
 * the overlay reads from it, so new shortcuts auto-appear.
 */
import '@testing-library/jest-dom';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ShortcutsOverlay } from './ShortcutsOverlay';

describe('ShortcutsOverlay', () => {
  it('is hidden by default', () => {
    render(<ShortcutsOverlay />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on Cmd+/ (or Ctrl+/)', () => {
    render(<ShortcutsOverlay />);
    act(() => {
      fireEvent.keyDown(document, { key: '/', metaKey: true });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<ShortcutsOverlay />);
    act(() => {
      fireEvent.keyDown(document, { key: '/', metaKey: true });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('groups shortcuts by section heading', () => {
    render(<ShortcutsOverlay />);
    act(() => {
      fireEvent.keyDown(document, { key: '/', metaKey: true });
    });
    expect(screen.getByText(/workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/inspector/i)).toBeInTheDocument();
  });

  it('lists the known shortcuts (Cmd+I toggle chat, Cmd+F find node, Esc close, Cmd+/ this overlay)', () => {
    render(<ShortcutsOverlay />);
    act(() => {
      fireEvent.keyDown(document, { key: '/', metaKey: true });
    });
    // Each shortcut shows its key combo and a description.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/toggle chat/i);
    expect(dialog).toHaveTextContent(/find/i);
    expect(dialog).toHaveTextContent(/close|dismiss/i);
    expect(dialog).toHaveTextContent(/shortcuts/i);
  });

  it('renders modifier key glyphs (⌘ on Mac, Ctrl on others)', () => {
    render(<ShortcutsOverlay />);
    act(() => {
      fireEvent.keyDown(document, { key: '/', metaKey: true });
    });
    const dialog = screen.getByRole('dialog');
    // Either form is acceptable depending on the platform; the
    // overlay must show at least one of them so the user knows
    // the modifier.
    expect(dialog.textContent ?? '').toMatch(/⌘|Ctrl/);
  });

  it('backdrop click closes', () => {
    render(<ShortcutsOverlay />);
    act(() => {
      fireEvent.keyDown(document, { key: '/', metaKey: true });
    });
    act(() => {
      screen.getByTestId('shortcuts-backdrop').click();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
