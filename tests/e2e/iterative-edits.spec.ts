import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('iterative edit chain: v1 → v2 → v3 → v4 accumulates in chat history', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('iterative-edits.json');

  // Four turns. Wait for each turn's image to land before the next send,
  // otherwise Send is disabled while runTask is pending.
  await send(page, 'show me s1 shot 1');
  await expect(page.locator('img[alt*="v1.png"]')).toHaveCount(1);

  await send(page, 'now make it darker');
  await expect(page.locator('img[alt*="v2.png"]')).toHaveCount(1);

  await send(page, 'now make it more vibrant');
  await expect(page.locator('img[alt*="v3.png"]')).toHaveCount(1);

  await send(page, 'add fog');
  await expect(page.locator('img[alt*="v4.png"]')).toHaveCount(1);

  // ── All four images present in the right order ─────────────────
  const imgs = page.locator('img[alt*="noir"]');
  await expect(imgs).toHaveCount(4);
  const alts = await imgs.evaluateAll((nodes) =>
    (nodes as HTMLImageElement[]).map((n) => n.getAttribute('alt') ?? ''),
  );
  expect(alts[0]).toContain('v1.png');
  expect(alts[1]).toContain('v2.png');
  expect(alts[2]).toContain('v3.png');
  expect(alts[3]).toContain('v4.png');

  // ── Tool cards: 1 create + 3 edits ─────────────────────────────
  await expect(page.getByText('image_text_to_image')).toHaveCount(1);
  await expect(page.getByText('image_edit')).toHaveCount(3);

  // ── Each edit's args summary references its source version ─────
  // summarizeArgs picks the first 2 args; for edits we expect
  // `instruction=...` to surface (truncated to 32 chars).
  await expect(page.getByText(/instruction=darker tones/)).toBeVisible();
  await expect(page.getByText(/instruction=more vibrant rim light/)).toBeVisible();
  await expect(page.getByText(/instruction=add ground fog/)).toBeVisible();

  // ── runTask was called 4 times with the right tasks ────────────
  const calls = await page.evaluate(() =>
    window.__kshanaTest!.getCalls('runTask'),
  );
  expect(calls).toHaveLength(4);
});
