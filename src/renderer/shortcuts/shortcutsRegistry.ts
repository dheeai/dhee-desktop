/**
 * Central shortcut registry. Single source of truth — any new
 * shortcut anywhere in the app should be appended here so the
 * ShortcutsOverlay (Cmd+/) lists it without code changes.
 *
 * Per the UX critique: "Cmd+I and Ctrl+Enter work but aren't
 * documented anywhere." Centralizing the list fixes the
 * documentation problem at its root.
 */

export interface Shortcut {
  /** Display section. */
  section: 'Workspace' | 'Inspector' | 'Chat';
  /** Key combo as a list of tokens; the overlay glyphs them. */
  combo: string[];
  /** What it does, in plain English. */
  description: string;
}

export const SHORTCUTS: Shortcut[] = [
  { section: 'Workspace', combo: ['Cmd', 'I'], description: 'Toggle chat panel' },
  { section: 'Workspace', combo: ['Cmd', '/'], description: 'Show this shortcuts overlay' },
  { section: 'Workspace', combo: ['Esc'], description: 'Close any open overlay / dialog' },
  { section: 'Inspector', combo: ['Cmd', 'F'], description: 'Find node by id' },
  { section: 'Inspector', combo: ['Right-click'], description: 'Open node action menu (Regenerate, etc.)' },
  { section: 'Chat', combo: ['Cmd', 'Enter'], description: 'Send message' },
  { section: 'Chat', combo: ['Cmd', 'I'], description: 'Toggle chat panel' },
];

/**
 * Render a combo for display. macOS uses ⌘; everyone else uses
 * "Ctrl". Other modifiers (Shift, Alt) similarly platform-aware.
 */
export function glyphForKey(key: string, isMac: boolean): string {
  if (!isMac && key === 'Cmd') return 'Ctrl';
  switch (key) {
    case 'Cmd': return '⌘';
    case 'Shift': return '⇧';
    case 'Alt': return isMac ? '⌥' : 'Alt';
    case 'Enter': return isMac ? '⏎' : 'Enter';
    case 'Esc': return 'Esc';
    default: return key;
  }
}
