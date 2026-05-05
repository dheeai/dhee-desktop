/**
 * Wave 2 — Delete-project flow from a recent-project card.
 *
 * Each ProjectCard exposes a Trash2 icon button with
 * `aria-label="Delete <name>"`. Clicking it opens DeleteProjectDialog
 * with a Delete Project / Cancel pair.
 */
import { test, expect } from './fixtures';

const RECENTS = [
  { name: 'noir', path: '/tmp/noir.kshana', lastOpened: 1700000000000 },
];

test.describe('Feature: Delete a recent project', () => {
  test.describe('Given a recent project on the landing screen', () => {
    test('When the user clicks the Delete icon on a project card, Then a confirm dialog renders', async ({
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
      // ProjectCard's delete icon is hover-only via CSS; force-click bypasses
      // the visibility check (we only care about the wired bridge calls).
      await page
        .getByRole('button', { name: /Delete noir/i })
        .click({ force: true });

      // Then
      await expect(
        page.getByRole('dialog', { name: /Delete project/i }),
      ).toBeVisible();
      await expect(page.getByText(/This action cannot be undone\./i)).toBeVisible();
    });

    test('When the user confirms the delete, Then project.deleteProject is called with the project path', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'landing',
        bridgeReturns: { 'project.getRecent': RECENTS },
        rules: [],
      });

      // When — open dialog, click Delete Project.
      // ProjectCard's delete icon is hover-only via CSS; force-click bypasses
      // the visibility check (we only care about the wired bridge calls).
      await page
        .getByRole('button', { name: /Delete noir/i })
        .click({ force: true });
      await page
        .getByRole('dialog', { name: /Delete project/i })
        .getByRole('button', { name: /^Delete Project$/ })
        .click();

      // Then
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                window.__kshanaTest!.getCalls('project.deleteProject').length,
            ),
          { timeout: 5000 },
        )
        .toBeGreaterThanOrEqual(1);

      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.deleteProject'),
      );
      expect(calls[0].args).toBe('/tmp/noir.kshana');
    });

    test('When the user cancels the delete, Then project.deleteProject is not called and the dialog closes', async ({
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
      // ProjectCard's delete icon is hover-only via CSS; force-click bypasses
      // the visibility check (we only care about the wired bridge calls).
      await page
        .getByRole('button', { name: /Delete noir/i })
        .click({ force: true });
      await page
        .getByRole('dialog', { name: /Delete project/i })
        .getByRole('button', { name: /^Cancel$/ })
        .click();

      // Then
      await expect(
        page.getByRole('dialog', { name: /Delete project/i }),
      ).toHaveCount(0);

      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.deleteProject'),
      );
      expect(calls).toHaveLength(0);
    });
  });
});
