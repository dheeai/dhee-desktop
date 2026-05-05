import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * The chat panel renders notification events as a system row prefixed
 * with `[level]`. We've covered `error` elsewhere — pin info + warning,
 * plus the missing-message + missing-level fall-through paths.
 */
test('info-level notification renders with [info] prefix', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('notifications.json');
  await send(page, 'trigger info notification');
  await expect(
    page.getByText('[info] Cache primed for scene 1.'),
  ).toBeVisible();
});

test('warning-level notification renders with [warning] prefix', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('notifications.json');
  await send(page, 'trigger warning notification');
  await expect(
    page.getByText('[warning] ComfyUI queue depth: 12 — generation may be slow.'),
  ).toBeVisible();
});

/**
 * handleEvent's notification branch:
 *   - missing message → returns early, no DOM
 *   - missing level → defaults to 'info' in the prefix
 */
test('notification with missing message is silently dropped; missing level defaults to [info]', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('notifications.json');
  await send(page, 'trigger empty notifications');

  // The first event has level=info but no message → must NOT render.
  // We verify by counting system rows: only the second event (missing
  // level, has message) should render with the default [info] prefix.
  await expect(page.getByText('[info] no level field')).toBeVisible();

  // Tighten: there should be no system row for the missing-message case.
  // The text "Cache primed" is unique to the other scenario, but we can
  // assert that no [info]-prefixed text *other than* the known one
  // appears. Easier: assert exactly one [info] system row, even though
  // we fired two notifications.
  const infoRows = page.getByText(/^\[info\] /);
  await expect(infoRows).toHaveCount(1);
});
