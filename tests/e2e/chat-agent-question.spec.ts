/**
 * Wave 5 — Agent-asks-user question flow.
 *
 * ChatPanelEmbedded now handles `agent_question` events:
 * the question renders as a QuestionRow with option buttons;
 * clicking an option calls `session.sendResponse(option)` and
 * marks the row as answered (buttons disabled).
 */
import { test, expect } from './fixtures';

test.describe('Feature: Agent question prompt', () => {
  test.describe('Given a scenario emits agent_question with options after runTask', () => {
    test('When the question renders, Then the question text and each option button are visible', async ({
      page,
      bootWithScenario,
    }) => {
      // Given
      await bootWithScenario('agent-question.json');

      // When — trigger the question
      await page.getByPlaceholder(/Type a task and press send/i).fill('ask me something');
      await page.getByRole('button', { name: 'Send' }).click();

      // Then — question text visible
      await expect(page.getByText('Which style do you prefer?')).toBeVisible({
        timeout: 5_000,
      });

      // And — each option button visible
      await expect(page.getByRole('button', { name: 'Noir' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cinematic' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Documentary' })).toBeVisible();
    });

    test('When the user clicks an option, Then sendResponse is called with that option text', async ({
      page,
      bootWithScenario,
    }) => {
      // Given
      await bootWithScenario('agent-question.json');
      await page.getByPlaceholder(/Type a task and press send/i).fill('ask me something');
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByText('Which style do you prefer?')).toBeVisible({
        timeout: 5_000,
      });

      // When
      await page.getByRole('button', { name: 'Cinematic' }).click();

      // Then — sendResponse recorded with the selected option
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const calls = window.__kshanaTest!.getCalls('sendResponse');
              return calls.map((c) => (c.args as { response: string }).response);
            }),
          { timeout: 5_000 },
        )
        .toContain('Cinematic');
    });
  });
});
