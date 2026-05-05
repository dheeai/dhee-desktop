/**
 * Wave 3 — Theme switching on the Settings → Appearance tab.
 *
 * Each theme card click calls `onThemeChange(themeId)` which fires
 * `settings.update({ themeId })` immediately (no Save button needed
 * for theme changes).
 */
import { test, expect } from './fixtures';

async function openSettings(page: import('./fixtures').Page) {
  await page
    .getByRole('button', { name: /Settings/i, exact: false })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: /Settings$/ }),
  ).toBeVisible();
}

test.describe('Feature: Theme switching', () => {
  test.describe('Given the Settings panel is open on the Appearance tab', () => {
    test('When the user clicks a theme card, Then settings.update is called with that themeId', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });
      await openSettings(page);

      // When — click "Deep Forest & Gold".
      await page.getByText('Deep Forest & Gold').click();

      // Then
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('settings.update').length,
            ),
          { timeout: 5000 },
        )
        .toBeGreaterThanOrEqual(1);

      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('settings.update'),
      );
      const lastPatch = calls[calls.length - 1].args as { themeId?: string };
      expect(lastPatch.themeId).toBe('deep-forest-gold');
    });

    test('When the user picks two themes in succession, Then both updates fire and the latest theme id is the most recent patch', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });
      await openSettings(page);

      // When — pick two themes.
      await page.getByText('Petroleum & Clay').click();
      await page.getByText('Void Cut').click();

      // Then
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('settings.update').length,
            ),
          { timeout: 5000 },
        )
        .toBeGreaterThanOrEqual(2);

      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('settings.update'),
      );
      const themeIds = calls.map(
        (c) => (c.args as { themeId?: string }).themeId,
      );
      expect(themeIds).toContain('petroleum-clay');
      expect(themeIds).toContain('void-cut');
      expect(themeIds[themeIds.length - 1]).toBe('void-cut');
    });
  });
});
