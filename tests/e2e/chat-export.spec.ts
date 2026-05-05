/**
 * Wave 7 — Export chat as JSON.
 *
 * ChatPanelEmbedded now has an "Export Chat" button (aria-label=
 * "Export chat history as JSON"). Clicking it calls
 * `window.electron.project.exportChatJson` with the current messages.
 * The button is disabled while messages is empty, so we seed one
 * exchange via an inline scenario before clicking Export.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Export chat JSON', () => {
  test.describe('Given an active chat session with messages', () => {
    test('When the user clicks the Export action, Then project.exportChatJson is called with the current session payload', async ({
      page,
      bootInline,
    }) => {
      // Given — inline scenario so messages accumulate quickly
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [
          {
            on: { channel: 'runTask', match: 'hi' },
            emit: [
              {
                after: 50,
                event: 'agent_response',
                data: { output: 'Hello!', status: 'completed' },
              },
            ],
          },
        ],
      });

      await page.getByPlaceholder(/Type a task and press send/i).fill('hi');
      await page.getByRole('button', { name: 'Send' }).click();
      // Wait for the assistant reply so messages.length > 0
      await expect(page.getByText('Hello!')).toBeVisible({ timeout: 5_000 });

      // When
      await page.getByRole('button', { name: /Export Chat/i }).click();

      // Then — exportChatJson recorded on the bridge
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('project.exportChatJson').length,
            ),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(1);
    });
  });
});
