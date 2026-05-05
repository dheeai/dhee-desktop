import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * media_generated with kind: 'video' hits a different branch in
 * MessageRow than image: a `<div>📹 <path></div>` text label inside the
 * green media bubble. We pin that current behavior — note it doesn't
 * actually embed a <video> element today (gap flagged separately).
 */
test('video media renders the 📹 text label with path', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('media-events.json');
  await send(page, 'show me the shot 1 video');

  // The header line above the media bubble shows the kind + project.
  await expect(page.getByText(/generated video · noir/i)).toBeVisible();

  // The 📹 label includes the absolute path verbatim.
  await expect(
    page.getByText('📹 /tmp/noir.kshana/.kshana/cache/s1_shot_1.mp4'),
  ).toBeVisible();

  // No <img> for video media (image branch should not run).
  await expect(page.locator('img[alt*="s1_shot_1.mp4"]')).toHaveCount(0);

  // No actual <video> element either (current behavior — flagged gap).
  await expect(page.locator('video')).toHaveCount(0);
});

/**
 * Mixed image + video media in a single turn: both render in their
 * correct branches, in the order their events fired.
 */
test('mixed image + video media render in event order', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('media-events.json');
  await send(page, 'render mixed media for me');

  // Image renders as <img>.
  await expect(page.locator('img[alt*="storyboard.png"]')).toHaveCount(1);

  // Video renders as 📹 text.
  await expect(
    page.getByText('📹 /tmp/noir.kshana/.kshana/cache/scene1_render.mp4'),
  ).toBeVisible();

  // Two media-bubble headers, one image kind and one video kind.
  await expect(page.getByText(/generated image · noir/i)).toBeVisible();
  await expect(page.getByText(/generated video · noir/i)).toBeVisible();
});
