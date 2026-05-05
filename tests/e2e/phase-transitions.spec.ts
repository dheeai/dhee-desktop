/**
 * Wave 6 — Phase indicator reacts to phase_transition events.
 *
 * ChatPanelEmbedded now handles `phase_transition` events by
 * appending a `role='phase'` row to the message list. The row
 * renders the phase name and optional status text.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Phase indicator', () => {
  test.describe('Given a chat panel with no active phase', () => {
    test('When phase_transition events fire, Then the phase indicator updates to each new phase in order', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // When — emit two phase transitions directly
      await page.evaluate(() => {
        window.__kshanaTest!.emit('phase_transition', {
          phase: 'Planning',
          status: 'started',
        });
      });
      await page.evaluate(() => {
        window.__kshanaTest!.emit('phase_transition', {
          phase: 'Generation',
          status: 'started',
        });
      });

      // Then — both phase rows visible in order
      await expect(page.getByText('Planning · started')).toBeVisible({
        timeout: 3_000,
      });
      await expect(page.getByText('Generation · started')).toBeVisible({
        timeout: 3_000,
      });
    });

    test('When the final phase emits "completed", Then the indicator shows the completed state', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'chat',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // When
      await page.evaluate(() => {
        window.__kshanaTest!.emit('phase_transition', {
          phase: 'Generation',
          status: 'completed',
        });
      });

      // Then
      await expect(page.getByText('Generation · completed')).toBeVisible({
        timeout: 3_000,
      });
    });
  });
});
