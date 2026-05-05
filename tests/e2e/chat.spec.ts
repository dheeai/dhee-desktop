import { test, expect } from './fixtures';

test('chat: requesting s1 shot 1 renders tool card + image', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('show-s1-shot-1.json');

  // Type the prompt and send.
  const input = page.getByPlaceholder(/Type a task and press send/i);
  await input.fill('show me s1 shot 1');
  await page.getByRole('button', { name: 'Send' }).click();

  // The user bubble appears immediately.
  await expect(page.getByText('show me s1 shot 1', { exact: true })).toBeVisible();

  // The tool call card lands with the tool name (image_text_to_image).
  await expect(page.getByText('image_text_to_image')).toBeVisible();

  // The chat panel rendered the media_generated event as an <img>
  // with file:// src + alt of "<project> <path>". We assert it's
  // attached (not toBeVisible — the panel hides images whose file://
  // src can't load, which is always the case in a plain-browser test).
  const generatedImg = page.locator('img[alt*="noir"][alt*="s1_shot_1.png"]');
  await expect(generatedImg).toHaveCount(1);
  await expect(generatedImg).toHaveAttribute(
    'src',
    'file:///tmp/noir.kshana/.kshana/cache/s1_shot_1.png',
  );

  // The assistant follow-up text renders (markdown'd to <strong>).
  await expect(page.locator('strong', { hasText: 's1 shot 1' })).toBeVisible();
  await expect(page.getByText(/Here is/)).toBeVisible();

  // And runTask was actually called via the bridge.
  const runTaskCalls = await page.evaluate(() =>
    window.__kshanaTest!.getCalls('runTask'),
  );
  expect(runTaskCalls).toHaveLength(1);
  expect((runTaskCalls[0].args as { task: string }).task).toBe(
    'show me s1 shot 1',
  );
});
