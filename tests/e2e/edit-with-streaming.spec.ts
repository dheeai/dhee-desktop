import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * Streaming edit flow:
 *   - stream_chunk events build up a partial assistant bubble
 *   - tool_call fires → streamingMsgIdRef is cleared (per ChatPanelEmbedded
 *     comment), so the partial-reasoning bubble becomes static
 *   - agent_response after the tool creates a SEPARATE final-response
 *     bubble (does not reuse the partial-reasoning one)
 *
 * Targets the design point handleEvent's streamingMsgIdRef rules document.
 */
test('streaming reasoning during edit: partial bubble persists, final response is separate', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('edit-with-streaming.json');

  // Turn 1 — create v1 (warm up the chat).
  await send(page, 'show me s1 shot 1');
  await expect(page.locator('img[alt*="v1.png"]')).toHaveCount(1);

  // Turn 2 — streaming edit.
  await send(page, 'make it more dramatic');

  // During streaming (before tool_call lands at +200ms), the assistant
  // bubble accumulates text from each stream_chunk. We deliberately
  // assert on the *concatenated* substring; whether all chunks have
  // landed when this fires is timing-dependent, but Playwright will
  // retry until the full string is visible.
  await expect(
    page.getByText(/Analyzing the source frame.*looking at composition/),
  ).toBeVisible();

  // After the chain completes: the edit tool card landed.
  await expect(page.getByText('image_edit')).toBeVisible();

  // The new image appeared.
  await expect(page.locator('img[alt*="v2_dramatic.png"]')).toHaveCount(1);

  // The final agent response is a SEPARATE bubble (not the streaming
  // one). We verify by asserting the final text is visible AND the
  // partial-reasoning text is *also still* visible — they coexist.
  await expect(page.getByText(/Pushed contrast/)).toBeVisible();
  await expect(
    page.getByText(/Analyzing the source frame.*key light placement/),
  ).toBeVisible();

  // Wait for runTask to fully settle (status returns to idle). Cancel
  // disappears once isRunning flips back to false. (Send is a separate
  // signal — it stays disabled after submit because the input is empty,
  // which is correct production behavior.)
  await expect(
    page.getByRole('button', { name: 'Cancel' }),
  ).toHaveCount(0);

  // Bridge call shape.
  const calls = await page.evaluate(() =>
    window.__kshanaTest!.getCalls('runTask'),
  );
  expect(calls).toHaveLength(2);
  expect((calls[1].args as { task: string }).task).toBe(
    'make it more dramatic',
  );
});

/**
 * While runTask is pending (events still streaming), the chat panel
 * disables Send and shows Cancel. Once the last event fires, runTask
 * resolves and the panel returns to idle.
 */
test('isRunning lifecycle: Send disabled + Cancel visible during streaming', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('edit-with-streaming.json');

  // Warm up.
  await send(page, 'show me s1 shot 1');
  await expect(page.locator('img[alt*="v1.png"]')).toHaveCount(1);

  // Fill + send (don't await assertions immediately so we can probe
  // the in-flight state).
  await page.getByPlaceholder(/Type a task and press send/i).fill(
    'make it more dramatic',
  );
  await page.getByRole('button', { name: 'Send' }).click();

  // While the second turn is in flight, Cancel button shows up and
  // Send is disabled.
  await expect(
    page.getByRole('button', { name: 'Cancel' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Send' }),
  ).toBeDisabled();

  // Wait for completion: agent_response (last scripted event) ends the
  // turn. Cancel disappears, and Send becomes re-enabled once the user
  // types again (Send disabled-while-empty is intentional production
  // behavior, not an isRunning signal).
  await expect(page.getByText(/Pushed contrast/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel' }),
  ).toHaveCount(0);
  await page.getByPlaceholder(/Type a task and press send/i).fill(
    'one more thing',
  );
  await expect(
    page.getByRole('button', { name: 'Send' }),
  ).toBeEnabled();
});
