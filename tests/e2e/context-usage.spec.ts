/**
 * Wave 6 — Context-usage indicator reacts to token-usage events.
 *
 * ChatPanelEmbedded now handles `context_usage` events by updating a
 * footer indicator showing token count and percentage. When usage
 * reaches ≥ 80% the indicator turns red.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Context-usage indicator', () => {
  test.describe('Given a chat panel with no usage info', () => {
    test('When context_usage {used, limit} fires below 80%, Then a neutral indicator shows the ratio', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // When — emit context usage at 50%
      await page.evaluate(() => {
        window.__kshanaTest!.emit('context_usage', { used: 50_000, limit: 100_000 });
      });

      // Then — indicator visible with ratio and percent
      await expect(page.getByLabel('Context usage')).toBeVisible({
        timeout: 3_000,
      });
      await expect(page.getByLabel('Context usage')).toContainText('50%');
    });

    test('When usage crosses 80%, Then a warning-tone indicator appears', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // When — emit context usage at 85%
      await page.evaluate(() => {
        window.__kshanaTest!.emit('context_usage', { used: 85_000, limit: 100_000 });
      });

      // Then — indicator shows the percentage
      await expect(page.getByLabel('Context usage')).toBeVisible({
        timeout: 3_000,
      });
      await expect(page.getByLabel('Context usage')).toContainText('85%');
      // Warning color is applied inline; verify via computed style
      const color = await page
        .getByLabel('Context usage')
        .evaluate((el) => (el as HTMLElement).style.color);
      expect(color).toBe('rgb(208, 90, 90)');
    });
  });
});
