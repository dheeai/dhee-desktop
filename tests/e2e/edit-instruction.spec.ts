import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('edit instruction renders second tool card + new image alongside the original', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('edit-shot-1.json');

  // ── Turn 1: create the image ────────────────────────────────────
  await send(page, 'show me s1 shot 1');

  await expect(page.getByText('image_text_to_image')).toBeVisible();
  const v1 = page.locator('img[alt*="s1_shot_1_v1.png"]');
  await expect(v1).toHaveCount(1);
  await expect(v1).toHaveAttribute(
    'src',
    'file:///tmp/noir.kshana/.kshana/cache/s1_shot_1_v1.png',
  );
  await expect(page.getByText(/Here is/)).toBeVisible();

  // ── Turn 2: edit ────────────────────────────────────────────────
  await send(page, 'make it darker and more cinematic');

  // The edit tool card lands as a SECOND, distinct card.
  await expect(page.getByText('image_edit')).toBeVisible();
  await expect(page.getByText('image_text_to_image')).toBeVisible(); // first one still there

  // The new image lands. The original is still in the chat history.
  const v2 = page.locator('img[alt*="s1_shot_1_v2.png"]');
  await expect(v2).toHaveCount(1);
  await expect(v1).toHaveCount(1); // original NOT replaced

  // Both images appear in the right vertical order: v1 above v2.
  const allImgs = page.locator('img[alt*="noir"]');
  await expect(allImgs).toHaveCount(2);
  const altsInOrder = await allImgs.evaluateAll((nodes) =>
    (nodes as HTMLImageElement[]).map((n) => n.getAttribute('alt') ?? ''),
  );
  expect(altsInOrder[0]).toContain('v1.png');
  expect(altsInOrder[1]).toContain('v2.png');

  // Edit acknowledgement assistant text.
  await expect(page.getByText(/Updated/)).toBeVisible();

  // ── Bridge call shape ───────────────────────────────────────────
  const calls = await page.evaluate(() =>
    window.__kshanaTest!.getCalls('runTask'),
  );
  expect(calls).toHaveLength(2);
  expect((calls[0].args as { task: string }).task).toBe('show me s1 shot 1');
  expect((calls[1].args as { task: string }).task).toBe(
    'make it darker and more cinematic',
  );
});

test('edit instruction tool card shows the edit args summary', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('edit-shot-1.json');
  await send(page, 'show me s1 shot 1');
  await expect(page.locator('img[alt*="s1_shot_1_v1.png"]')).toHaveCount(1);

  await send(page, 'make it darker and more cinematic');

  // The tool card's args summary uses summarizeArgs(): "key=value key=value"
  // truncated to 32 chars per value. Confirm the instruction shows up so
  // a user can verify the agent received the right edit intent.
  await expect(
    page.getByText(/instruction=make it darker/i).first(),
  ).toBeVisible();
});
