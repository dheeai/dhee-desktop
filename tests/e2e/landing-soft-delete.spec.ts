/**
 * Wave 2 — Soft-delete (remove-from-recents) contract for a project card.
 *
 * The "Delete" action on a ProjectCard is intentionally a SOFT remove:
 * `handleConfirmDelete` in LandingScreen calls `project.removeRecent(path)`
 * (drop from the recents list only) and deliberately does NOT call
 * `project.deleteProject(path)` (which would destroy the folder on disk).
 * See the comment in LandingScreen.handleConfirmDelete: "the UI never
 * destroys user content."
 *
 * This spec locks in that contract. The pre-existing landing-delete-project
 * spec asserts the opposite (`project.deleteProject` is called on confirm),
 * which does not match the current handler — these tests document the
 * actual, intended behavior.
 *
 * Run with `npm run test:e2e` (boots the test-renderer dev server on :1212).
 * The dialog uses aria-label "Remove project from workspace" and a confirm
 * button labelled "Remove from Workspace".
 */
/* eslint-disable no-underscore-dangle */
import { test, expect } from './fixtures';

const RECENTS = [
  { name: 'noir', path: '/tmp/noir.dhee', lastOpened: 1700000000000 },
];

test.describe('Feature: Soft-delete a recent project (remove from recents)', () => {
  test.describe('Given a recent project on the landing screen', () => {
    test('When the user confirms delete, Then project.removeRecent is called with the path and project.deleteProject is NOT called', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'landing',
        bridgeReturns: { 'project.getRecent': RECENTS },
        rules: [],
      });

      // When — open the confirm dialog (delete icon is hover-only; force-click
      // bypasses the CSS visibility gate) and confirm.
      await page
        .getByRole('button', { name: /Delete noir/i })
        .click({ force: true });
      await page
        .getByRole('dialog', { name: /Remove project from workspace/i })
        .getByRole('button', { name: /^Remove from Workspace$/ })
        .click();

      // Then — the soft-remove path fires.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__dheeTest!.getCalls('project.removeRecent').length,
            ),
          { timeout: 5000 },
        )
        .toBeGreaterThanOrEqual(1);

      const removeCalls = await page.evaluate(() =>
        window.__dheeTest!.getCalls('project.removeRecent'),
      );
      expect(removeCalls[0].args).toBe('/tmp/noir.dhee');

      // And — the destructive on-disk delete is never invoked.
      const deleteCalls = await page.evaluate(() =>
        window.__dheeTest!.getCalls('project.deleteProject'),
      );
      expect(deleteCalls).toHaveLength(0);
    });

    test('When the user confirms delete, Then the recents list is refreshed and the dialog closes', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'landing',
        bridgeReturns: { 'project.getRecent': RECENTS },
        rules: [],
      });

      // When
      await page
        .getByRole('button', { name: /Delete noir/i })
        .click({ force: true });
      await page
        .getByRole('dialog', { name: /Remove project from workspace/i })
        .getByRole('button', { name: /^Remove from Workspace$/ })
        .click();

      // Then — the dialog closes after the soft-remove resolves.
      await expect(
        page.getByRole('dialog', { name: /Remove project from workspace/i }),
      ).toHaveCount(0);

      // And — refreshRecentProjects re-reads the list via project.getRecent
      // (called once on mount + at least once after the removal).
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__dheeTest!.getCalls('project.getRecent').length,
            ),
          { timeout: 5000 },
        )
        .toBeGreaterThanOrEqual(2);
    });
  });
});
