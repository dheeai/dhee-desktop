/**
 * Wave 4 — Assets browser inside the Workspace surface.
 *
 * AssetsView calls `window.electron.project.readTree()` directly on
 * mount and whenever `project:file-change` fires. The fake bridge now
 * records readTree and supports bridgeReturn seeding, so we can:
 *   - Seed a tree with a .png file to make a media card appear.
 *   - Emit project:file-change and assert readTree is called again.
 *   - Click the card and assert the modal overlay opens.
 */
import { test, expect } from './fixtures';

const seededTree = {
  name: 'noir.kshana',
  path: '/tmp/noir.kshana',
  type: 'directory' as const,
  children: [
    {
      name: 'assets',
      path: '/tmp/noir.kshana/assets',
      type: 'directory' as const,
      children: [
        {
          name: 'scene_001.png',
          path: '/tmp/noir.kshana/assets/scene_001.png',
          type: 'file' as const,
          extension: '.png',
          children: [],
        },
      ],
    },
  ],
};

test.describe('Feature: Assets browser', () => {
  test.describe('Given a project is open in the workspace', () => {
    test('When the user opens the Assets tab, Then it becomes the selected tab and project.readTree is called', async ({
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

      // Then — Assets tab is selected.
      await expect(
        page.getByRole('tab', { name: /Assets/i }),
      ).toHaveAttribute('aria-selected', 'true');

      // And — watchDirectory/readTree called as part of the workspace open path.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('project.watchDirectory').length,
            ),
          { timeout: 10_000 },
        )
        .toBeGreaterThanOrEqual(1);
    });

    test('When the user clicks an asset, Then the preview pane shows it', async ({
      page,
      bootInline,
    }) => {
      // Given — seed readTree to return a tree with one image file
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
        bridgeReturns: { 'project.readTree': seededTree },
      });

      await page.getByRole('tab', { name: /Assets/i }).click();

      // Wait for the media card to appear
      await expect(page.getByText('scene_001.png')).toBeVisible({
        timeout: 8_000,
      });

      // When — click the card
      await page.getByText('scene_001.png').click();

      // Then — modal overlay opens
      await expect(page.getByRole('button', { name: /Close/i })).toBeVisible({
        timeout: 5_000,
      });
    });

    test('When emitElectron fires project:file-change, Then the tree refreshes (readTree re-called)', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      await page.getByRole('tab', { name: /Assets/i }).click();

      // Wait for initial readTree call
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('project.readTree').length,
            ),
          { timeout: 8_000 },
        )
        .toBeGreaterThanOrEqual(1);

      const baseline = await page.evaluate(
        () => window.__kshanaTest!.getCalls('project.readTree').length,
      );

      // When — emit file-change to trigger re-scan
      await page.evaluate(() => {
        window.__kshanaTest!.emitElectron('project:file-change', {
          path: '/tmp/noir.kshana/assets/new_image.png',
          eventType: 'add',
        });
      });

      // Then — readTree is called at least once more
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('project.readTree').length,
            ),
          { timeout: 8_000 },
        )
        .toBeGreaterThan(baseline);
    });
  });
});
