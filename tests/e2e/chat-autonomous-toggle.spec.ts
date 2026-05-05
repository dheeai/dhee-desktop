/**
 * Wave 5 — Autonomous mode toggle in the chat panel.
 *
 * ChatPanelEmbedded now has an AUTO button (aria-pressed) that calls
 * `session.setAutonomous(enabled)` → `window.kshana.setAutonomous`.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Autonomous mode toggle', () => {
  test.describe('Given the chat panel with autonomous off', () => {
    test('When the user toggles autonomous on, Then setAutonomous is called with enabled: true', async ({
      page,
      bootInline,
    }) => {
      // Given — chat surface, autonomous starts off
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });
      await expect(
        page.getByRole('button', { name: 'AUTO' }),
      ).toHaveAttribute('aria-pressed', 'false');

      // When
      await page.getByRole('button', { name: 'AUTO' }).click();

      // Then — aria-pressed flipped
      await expect(
        page.getByRole('button', { name: 'AUTO' }),
      ).toHaveAttribute('aria-pressed', 'true');

      // And — setAutonomous recorded with enabled: true
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const calls = window.__kshanaTest!.getCalls('setAutonomous');
              return calls.map((c) => (c.args as { enabled: boolean }).enabled);
            }),
          { timeout: 5_000 },
        )
        .toContain(true);
    });

    test('When the user toggles autonomous off again, Then setAutonomous is called with enabled: false', async ({
      page,
      bootInline,
    }) => {
      // Given — toggle on first
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });
      await page.getByRole('button', { name: 'AUTO' }).click();
      await expect(
        page.getByRole('button', { name: 'AUTO' }),
      ).toHaveAttribute('aria-pressed', 'true');

      // When — toggle off
      await page.getByRole('button', { name: 'AUTO' }).click();

      // Then
      await expect(
        page.getByRole('button', { name: 'AUTO' }),
      ).toHaveAttribute('aria-pressed', 'false');

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const calls = window.__kshanaTest!.getCalls('setAutonomous');
              return calls.map((c) => (c.args as { enabled: boolean }).enabled);
            }),
          { timeout: 5_000 },
        )
        .toContain(false);
    });
  });
});
