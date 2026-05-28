/**
 * TDD tests for `shouldResetChatOnProjectChange`. Each `it` enumerates
 * a real lifecycle transition the New-Project flow / workspace switcher
 * must handle. The 2026-05-19 user bug ("created new project, got
 * Village chat history") corresponds to the first test in this file:
 * intent='create' from an existing project MUST trigger a reset.
 */
import { describe, expect, it } from '@jest/globals';
import { shouldResetChatOnProjectChange } from './chatResetOnProjectChange';

describe('shouldResetChatOnProjectChange', () => {
  describe("intent='create' — user just made a brand-new project", () => {
    it('resets when switching from an existing project (the active bug)', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'create',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
        }),
      ).toBe(true);
    });

    it('resets even when no project was previously open (cold-mounted dialog)', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'create',
          previousProjectDirectory: null,
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
        }),
      ).toBe(true);
    });

    it('resets even when the next path coincidentally matches the previous (paranoid)', () => {
      // create-with-same-path shouldn't happen in practice (the dialog
      // blocks duplicates), but if it does we still want fresh chat —
      // the user explicitly clicked Create.
      expect(
        shouldResetChatOnProjectChange({
          intent: 'create',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
        }),
      ).toBe(true);
    });

    it('does nothing when the destination is empty (defensive)', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'create',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
          nextProjectDirectory: '',
        }),
      ).toBe(false);
      expect(
        shouldResetChatOnProjectChange({
          intent: 'create',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
          nextProjectDirectory: null,
        }),
      ).toBe(false);
    });
  });

  describe("intent='open' — user picked an existing project", () => {
    it('resets when switching from one existing project to another', () => {
      // Chat history is project-scoped. Opening another project must not
      // leak the previous project's bubbles or LLM context into it.
      expect(
        shouldResetChatOnProjectChange({
          intent: 'open',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
        }),
      ).toBe(true);
    });

    it('does NOT reset when re-opening the same project', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'open',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
        }),
      ).toBe(false);
    });

    it('does NOT reset on first-ever open (nothing to clear)', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'open',
          previousProjectDirectory: null,
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
        }),
      ).toBe(false);
      expect(
        shouldResetChatOnProjectChange({
          intent: 'open',
          previousProjectDirectory: '',
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
        }),
      ).toBe(false);
    });

    it('does nothing when the destination is empty (defensive)', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'open',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
          nextProjectDirectory: '',
        }),
      ).toBe(false);
    });
  });

  describe('whitespace handling', () => {
    it('treats whitespace-only previous as absent', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'open',
          previousProjectDirectory: '   ',
          nextProjectDirectory: '/Users/ganaraj/dhee-studios/Soft Seinen',
        }),
      ).toBe(false);
    });

    it('treats whitespace-only next as absent', () => {
      expect(
        shouldResetChatOnProjectChange({
          intent: 'create',
          previousProjectDirectory: '/Users/ganaraj/dhee-studios/The Village',
          nextProjectDirectory: '   ',
        }),
      ).toBe(false);
    });
  });
});
