/**
 * Wave 6 — Connection-error banner inside the chat panel.
 *
 * ChatPanelEmbedded now subscribes to `window.electron.backend.onStateChange`.
 * When status is "error" it renders a dismissible banner (role="alert").
 * When status returns to "ready" the banner clears automatically.
 */
import { test, expect } from './fixtures';

async function pushBackendState(
  page: import('./fixtures').Page,
  state: { status: string; message?: string; serverUrl?: string },
) {
  await page.evaluate((s) => {
    window.__kshanaTest!.setBridgeReturn('backend.getState', s);
    window.__kshanaTest!.emitElectron('backend:state', s);
  }, state);
}

test.describe('Feature: Connection error surfacing', () => {
  test.describe('Given backend state is "ready" inside the chat panel', () => {
    test('When backend:state {status: "error", message: "ENGINE_DOWN"} fires, Then an error banner appears with the message', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // When
      await pushBackendState(page, {
        status: 'error',
        message: 'ENGINE_DOWN',
      });

      // Then — error banner visible
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 3_000 });
      await expect(page.getByRole('alert')).toContainText('ENGINE_DOWN');
    });

    test('When state returns to "ready" afterward, Then the banner clears', async ({
      page,
      bootInline,
    }) => {
      // Given — put it in error state first
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });
      await pushBackendState(page, { status: 'error', message: 'ENGINE_DOWN' });
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 3_000 });

      // When — state recovers
      await pushBackendState(page, {
        status: 'ready',
        serverUrl: 'http://127.0.0.1:8001',
      });

      // Then — banner gone
      await expect(page.getByRole('alert')).not.toBeVisible({ timeout: 3_000 });
    });
  });
});
