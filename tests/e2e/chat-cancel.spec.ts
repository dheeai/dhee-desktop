/**
 * Wave 5 — Cancel a running task mid-flight.
 *
 * ChatPanelEmbedded shows a Cancel button whenever `session.status
 * === 'running'` (i.e. `isRunning` is true). Clicking it calls
 * `session.cancel()` → `window.kshana.cancelTask`. The fake bridge
 * records the call and returns `{ cancelled: true }`.
 *
 * The test uses `cancel-test.json` whose last scripted event fires at
 * 8 000 ms, giving ample window to click Cancel before the task
 * naturally completes.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Cancel running task', () => {
  test.describe('Given a long-running task is in progress', () => {
    test('When the user clicks Cancel mid-flight, Then cancelTask is called', async ({
      page,
      bootWithScenario,
    }) => {
      // Given
      await bootWithScenario('cancel-test.json');

      // When — send the task; isRunning becomes true immediately,
      // Cancel button renders.
      await page.getByPlaceholder(/Type a task and press send/i).fill('start long task');
      await page.getByRole('button', { name: 'Send' }).click();

      // Then — Cancel button appears once the task is running.
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({
        timeout: 3_000,
      });

      // When — user clicks Cancel.
      await page.getByRole('button', { name: 'Cancel' }).click();

      // Then — cancelTask is recorded on the bridge.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('cancelTask').length,
            ),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(1);
    });
  });
});
