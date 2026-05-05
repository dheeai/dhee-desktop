import { test, expect, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.getByPlaceholder(/Type a task and press send/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * Regression pin for the documented duplicate-bubble bug in
 * ChatPanelEmbedded.handleEvent:
 *
 *   stream_chunk(content)
 *   stream_chunk(content)
 *   stream_chunk("", done: true)
 *   agent_response(output: <full canonical text>)
 *
 * The agent emits the streamed text, marks it done, then re-sends the
 * canonical full text via agent_response. The fix is "do NOT clear
 * streamingMsgIdRef on done=true" — so agent_response REPLACES the
 * streamed bubble's text instead of creating a new bubble alongside.
 *
 * Failure mode if regressed: two assistant bubbles with the same text.
 */
test('streaming → done → agent_response: exactly ONE assistant bubble', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('streaming-only-reply.json');

  await send(page, 'explain s1 shot 1');

  // Wait for the run to settle (Cancel disappears once runTask resolves).
  await expect(
    page.getByRole('button', { name: 'Cancel' }),
  ).toHaveCount(0);

  // The MarkdownContent wrapper renders assistant messages inside a
  // div whose grandparent is the bubble div (alignSelf: flex-start,
  // background: rgba(255,255,255,0.04)). We can't easily target by
  // styles, so we count by markdown <p> elements inside the message
  // list — each assistant bubble's content gets exactly one <p>.
  //
  // Even simpler + more direct: count occurrences of the canonical
  // text. If the bug returns, the same text will appear in two
  // assistant bubbles → two <p> tags containing it.
  const fullText =
    'Looking at the composition — wide-angle low-key noir with a single key from frame-left.';

  // Use exact-text match on <p> nodes so partial chunk-only bubbles
  // don't false-match.
  const paragraphs = page.locator('p', { hasText: fullText });
  await expect(paragraphs).toHaveCount(1);

  // The user bubble is unaffected.
  await expect(page.getByText('explain s1 shot 1', { exact: true })).toBeVisible();

  // Exactly two messages total in the chat: 1 user + 1 assistant.
  // We approximate by counting all rendered "primary" bubbles. The
  // chat panel renders user/assistant content inside divs at the
  // .messageBubbleStyle paddings; counting whitespace-pre-wrap (user)
  // + react-markdown <p> (assistant) gives the bubble count.
  const userBubbles = page.locator('div[style*="white-space: pre-wrap"]');
  await expect(userBubbles).toHaveCount(1);

  // Total <p> elements (assistant message bodies) should be 1 — if
  // a duplicate bubble showed up, this would jump to 2.
  const allAssistantParagraphs = page.locator('p');
  await expect(allAssistantParagraphs).toHaveCount(1);
});

/**
 * Sanity counterpart: ensure the test setup itself can detect a
 * duplicate. We emit the same stream_chunk → agent_response sequence
 * but with the streaming bubble preserved BEFORE agent_response by
 * synthesizing two distinct bubbles via two separate agent_response
 * events. This proves the count assertion above isn't trivially passing.
 */
test('two distinct agent_response events DO produce two bubbles (counter-test)', async ({
  page,
  bootWithScenario,
}) => {
  await bootWithScenario('streaming-only-reply.json');
  await send(page, 'explain s1 shot 1');
  await expect(
    page.getByRole('button', { name: 'Cancel' }),
  ).toHaveCount(0);

  // Manually emit a SECOND agent_response from the test side. Because
  // streamingMsgIdRef was cleared by the first agent_response, this
  // one creates a brand-new bubble — which is the EXPECTED behavior
  // for two distinct turns of agent text.
  await page.evaluate(() => {
    window.__kshanaTest!.emit('agent_response', {
      output: 'Follow-up note: also try a longer focal length.',
      status: 'completed',
    });
  });

  await expect(
    page.getByText(/Follow-up note: also try a longer focal length/),
  ).toBeVisible();

  // Now there are 2 assistant <p> elements (original + follow-up).
  const allAssistantParagraphs = page.locator('p');
  await expect(allAssistantParagraphs).toHaveCount(2);
});
