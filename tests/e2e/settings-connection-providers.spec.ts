/**
 * Wave 3 — LLM provider switching on the Settings → Connection tab.
 */
import { test, expect } from './fixtures';

async function openConnectionTab(page: import('./fixtures').Page) {
  await page
    .getByRole('button', { name: /Settings/i, exact: false })
    .first()
    .click();
  await page.getByText(/Local backend configuration/i).click();
  await expect(
    page.getByRole('heading', { name: /Connection/, level: 3 }),
  ).toBeVisible();
}

test.describe('Feature: LLM provider switching', () => {
  test.describe('Given the LLM provider radio defaults to OpenAI-Compatible', () => {
    test('When the user switches to Gemini, Then Gemini fields become visible and OpenAI fields hide', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });
      await openConnectionTab(page);

      // OpenAI-specific fields are visible by default.
      await expect(page.getByPlaceholder('https://api.openai.com/v1')).toBeVisible();
      await expect(page.getByPlaceholder('gpt-4o')).toBeVisible();
      await expect(page.getByPlaceholder('sk-...')).toBeVisible();

      // When
      await page.getByRole('radio', { name: 'Gemini' }).check();

      // Then — Gemini fields appear, OpenAI fields disappear.
      await expect(page.getByPlaceholder('AIza...')).toBeVisible();
      await expect(page.getByPlaceholder('gemini-2.5-flash')).toBeVisible();
      await expect(page.getByPlaceholder('https://api.openai.com/v1')).toHaveCount(0);
      await expect(page.getByPlaceholder('sk-...')).toHaveCount(0);
    });

    test('When the user fills Google API key + Gemini model and submits, Then settings.update carries llmProvider="gemini" and those fields', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });
      await openConnectionTab(page);

      // When
      await page.getByRole('radio', { name: 'Gemini' }).check();
      await page.getByPlaceholder('AIza...').fill('AIza-test-key');
      await page.getByPlaceholder('gemini-2.5-flash').fill('gemini-2.5-pro');
      await page.getByRole('button', { name: /Save & Restart/i }).click();

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
      const patch = calls[calls.length - 1].args as {
        llmProvider?: string;
        googleApiKey?: string;
        geminiModel?: string;
      };
      expect(patch.llmProvider).toBe('gemini');
      expect(patch.googleApiKey).toBe('AIza-test-key');
      expect(patch.geminiModel).toBe('gemini-2.5-pro');
    });

    test('When the user switches Gemini → OpenAI mid-session, Then OpenAI fields reappear', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });
      await openConnectionTab(page);

      // When — switch to Gemini, then back to OpenAI.
      await page.getByRole('radio', { name: 'Gemini' }).check();
      await expect(page.getByPlaceholder('AIza...')).toBeVisible();

      await page.getByRole('radio', { name: 'OpenAI-Compatible' }).check();

      // Then — OpenAI fields are back, Gemini fields gone.
      await expect(page.getByPlaceholder('https://api.openai.com/v1')).toBeVisible();
      await expect(page.getByPlaceholder('gpt-4o')).toBeVisible();
      await expect(page.getByPlaceholder('sk-...')).toBeVisible();
      await expect(page.getByPlaceholder('AIza...')).toHaveCount(0);
    });
  });
});
