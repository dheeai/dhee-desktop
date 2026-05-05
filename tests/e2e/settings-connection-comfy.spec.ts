/**
 * Wave 3 — ComfyUI URL configuration on the Settings → Connection tab.
 *
 * ComfyUI cloud (`comfyCloudApiKey`, `https://cloud.comfy.org`) is a
 * separate concept from kshana-core cloud (which is descoped).
 * These tests pin that ComfyUI URL handling still works.
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

test.describe('Feature: ComfyUI URL configuration', () => {
  test.describe('Given the Connection tab with no ComfyUI URL set', () => {
    test('When the user enters a URL and submits, Then settings.update carries comfyuiUrl + comfyuiMode="custom"', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });
      await openConnectionTab(page);

      // When
      await page
        .getByLabel('ComfyUI URL')
        .fill('http://my-comfy.local:8188');
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
        comfyuiUrl?: string;
        comfyuiMode?: string;
      };
      expect(patch.comfyuiUrl).toBe('http://my-comfy.local:8188');
      expect(patch.comfyuiMode).toBe('custom');
    });

    test('When the user starts with a URL and clears it, Then comfyuiMode reverts to "inherit" in the saved patch', async ({
      page,
      bootInline,
    }) => {
      // Given — settings.get returns an existing custom URL.
      await bootInline({
        surface: 'landing',
        bridgeReturns: {
          'settings.get': {
            themeId: 'studio-neutral',
            comfyuiMode: 'custom',
            comfyuiUrl: 'http://existing.local:8188',
            comfyCloudApiKey: '',
            comfyuiTimeout: 1800,
            llmProvider: 'openai',
            lmStudioUrl: 'http://127.0.0.1:1234',
            lmStudioModel: 'qwen3',
            googleApiKey: '',
            geminiModel: 'gemini-2.5-flash',
            openaiApiKey: '',
            openaiBaseUrl: 'https://api.openai.com/v1',
            openaiModel: 'gpt-4o',
            openRouterApiKey: '',
            openRouterModel: 'z-ai/glm-4.7-flash',
          },
        },
        rules: [],
      });
      await openConnectionTab(page);

      // When — clear the URL field, save.
      await page.getByLabel('ComfyUI URL').fill('');
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
        comfyuiUrl?: string;
        comfyuiMode?: string;
      };
      expect(patch.comfyuiUrl).toBe('');
      expect(patch.comfyuiMode).toBe('inherit');
    });

    test('When the user fills the Comfy Cloud API key, Then the value lands in the next settings.update payload', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });
      await openConnectionTab(page);

      // When
      await page
        .getByLabel('Comfy Cloud API Key')
        .fill('sk-comfy-test-1234');
      // ComfyUI URL must be set for comfyuiMode to be 'custom'; the key
      // is preserved either way.
      await page
        .getByLabel('ComfyUI URL')
        .fill('https://cloud.comfy.org');
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
        comfyCloudApiKey?: string;
      };
      expect(patch.comfyCloudApiKey).toBe('sk-comfy-test-1234');
    });
  });
});
