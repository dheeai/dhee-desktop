import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * The chat panel's `handleEvent` switch handles 6 event types and falls
 * through to `default: return` for everything else. We pin that contract:
 * unhandled events MUST NOT crash, must NOT leak partial DOM, and must
 * NOT block subsequent handled events from rendering.
 */
test('unhandled event types are silently dropped, do not crash the panel', async ({
  page,
  bootWithScenario,
}) => {
  // Catch any uncaught page errors so a thrown exception in handleEvent
  // surfaces as a test failure, not a silent pass.
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await bootWithScenario('unhandled-events.json');
  await send(page, 'fire the event barrage');

  // The agent_response at the end is a *handled* event; if any of the
  // unhandled events crashed handleEvent, this would never appear.
  await expect(page.getByText('all events fired')).toBeVisible();

  // No system rows, no media bubbles, no tool cards — only the user
  // bubble + the final assistant bubble should be in the DOM.
  await expect(page.getByText(/^\[info\] /)).toHaveCount(0);
  await expect(page.locator('img')).toHaveCount(0);

  // No JS exceptions thrown during the run.
  expect(pageErrors).toEqual([]);

  // Chat input is still usable — fire a follow-up handled event and
  // verify it renders normally.
  await page.evaluate(() => {
    window.__kshanaTest!.emit('notification', {
      level: 'info',
      message: 'follow-up after barrage',
    });
  });
  await expect(page.getByText('[info] follow-up after barrage')).toBeVisible();
});

/**
 * Bogus event names (not in KshanaEventName) also fall through default.
 */
test('unknown event name falls through default without error', async ({
  page,
  bootWithScenario,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await bootWithScenario('unhandled-events.json');

  // Wait for the chat input to be ready, then fire an unknown event.
  await expect(
    page.getByPlaceholder(/Type a task and press send/i),
  ).toBeVisible();

  await page.evaluate(() => {
    window.__kshanaTest!.emit(
      'totally_made_up_event' as 'notification',
      { foo: 'bar' },
    );
  });

  // Tick a frame and assert no errors.
  await page.waitForTimeout(50);
  expect(pageErrors).toEqual([]);

  // Chat input still works — fire a real notification afterward.
  await page.evaluate(() => {
    window.__kshanaTest!.emit('notification', {
      level: 'info',
      message: 'recovered',
    });
  });
  await expect(page.getByText('[info] recovered')).toBeVisible();
});
