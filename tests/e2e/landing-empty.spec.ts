/**
 * Wave 2 — Landing screen empty state.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Landing screen, empty state', () => {
  test.describe('Given a user with no recent projects', () => {
    test('When the page boots, Then empty-state copy + "New Project" + "Open Workspace" CTAs are visible', async ({
      page,
      bootInline,
    }) => {
      // Given — landing surface, no recents seeded.
      await bootInline({ surface: 'landing', rules: [] });

      // Then — empty-state copy.
      await expect(
        page.getByText(
          /No projects yet\. Create your first project to get started\./i,
        ),
      ).toBeVisible();

      // And — both sidebar CTAs are mounted.
      await expect(
        page.getByRole('button', { name: /New Project/i }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Open Workspace/i }),
      ).toBeVisible();

      // And — the empty-state body has its own "Create Project" CTA.
      await expect(
        page.getByRole('button', { name: /Create Project/i }),
      ).toBeVisible();
    });

    test('When the user clicks the Settings cog, Then the embedded Settings panel opens', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({ surface: 'landing', rules: [] });

      // When
      await page
        .getByRole('button', { name: /Settings/i, exact: false })
        .first()
        .click();

      // Then — the Settings panel mounts (Appearance tab is the default).
      await expect(
        page.getByRole('heading', { name: /Settings$/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/Themes and visual preferences/i),
      ).toBeVisible();
    });
  });
});
