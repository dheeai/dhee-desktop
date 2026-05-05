import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * The chat panel renders the tool-result error glyph by colouring the
 * status span. We assert on the glyph character + that the failed tool
 * card stayed in place (NOT replaced by a new card on result).
 */
test('edit fails then retry succeeds: error renders, recovery succeeds', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('edit-error-then-retry.json');

  // Turn 1 — create.
  await send(page, 'show me s1 shot 1');
  const v1 = page.locator('img[alt*="s1_shot_1_v1.png"]');
  await expect(v1).toHaveCount(1);
  await expect(page.getByText('image_text_to_image')).toBeVisible();

  // Turn 2 — failing edit.
  await send(page, 'make it darker');

  // The failed tool card uses the error glyph (✗) and keeps the same
  // position it took at tool_call (not a new card).
  await expect(page.getByText('image_edit')).toBeVisible();
  // ✗ is the error glyph from statusGlyph(); it lives in the tool row.
  await expect(page.getByText('✗')).toBeVisible();

  // Original v1 image still in the chat history (not removed).
  await expect(v1).toHaveCount(1);

  // Notification renders as a system row prefixed with [error].
  await expect(
    page.getByText(/\[error\] ComfyUI returned 500/),
  ).toBeVisible();

  // The edit-failure assistant message renders.
  await expect(page.getByText(/Edit failed/)).toBeVisible();

  // No v2 image yet — the failed edit didn't generate media.
  await expect(page.locator('img[alt*="s1_shot_1_v2.png"]')).toHaveCount(0);

  // Turn 3 — retry succeeds.
  await send(page, 'try again with more grain');

  // A second image_edit tool card appears (the recovered one). The
  // failed one stays, so we now have TWO image_edit cards in history.
  await expect(page.getByText('image_edit')).toHaveCount(2);

  const v2 = page.locator('img[alt*="s1_shot_1_v2.png"]');
  await expect(v2).toHaveCount(1);

  // v1 still present — the chat is a true history.
  await expect(v1).toHaveCount(1);

  // Recovery acknowledgement.
  await expect(page.getByText(/Recovered/)).toBeVisible();

  // Bridge call sequence sanity.
  const calls = await page.evaluate(() =>
    window.__kshanaTest!.getCalls('runTask'),
  );
  expect(calls.map((c) => (c.args as { task: string }).task)).toEqual([
    'show me s1 shot 1',
    'make it darker',
    'try again with more grain',
  ]);
});
