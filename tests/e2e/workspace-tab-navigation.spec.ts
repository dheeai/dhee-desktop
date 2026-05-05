/**
 * Wave 4 — PreviewPanel tab navigation inside the Workspace surface.
 *
 * The PreviewPanel renders three tabs: Library, Assets, Files. The
 * Storyboard view is commented out in PreviewPanel.tsx — see
 * `workspace-storyboard.spec.ts` for the gap note.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Preview-panel tab navigation', () => {
  test.describe('Given a project is open in the workspace', () => {
    test('When the workspace mounts, Then the three preview tabs (Library, Assets, Files) are visible', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // Then — tab buttons rendered. Library is the default active tab.
      await expect(
        page.getByRole('tab', { name: /Library/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('tab', { name: /Assets/i }),
      ).toBeVisible();
      await expect(page.getByRole('tab', { name: /Files/i })).toBeVisible();
    });

    test('When the user clicks the Assets tab, Then it becomes the selected tab', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // When
      await page.getByRole('tab', { name: /Assets/i }).click();

      // Then
      await expect(
        page.getByRole('tab', { name: /Assets/i }),
      ).toHaveAttribute('aria-selected', 'true');
      await expect(
        page.getByRole('tab', { name: /Library/i }),
      ).toHaveAttribute('aria-selected', 'false');
    });
  });
});
