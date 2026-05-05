/**
 * Wave 2 — New project creation flow on the landing screen.
 *
 * The dialog probes existing-project state via `project.checkFileExists`
 * twice (once for the parent workspace, once for the target subdir),
 * each checking both `project.json` and `.kshana/agent/project.json`.
 * Tests seed `checkFileExists` to false by default so the create path
 * proceeds; the duplicate-name test seeds it to true.
 */
import { test, expect } from './fixtures';

async function openCreateDialog(page: import('./fixtures').Page) {
  // Sidebar "New Project" button opens the dialog.
  await page
    .getByRole('button', { name: /New Project/i })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: /Create new project/i }),
  ).toBeVisible();
}

test.describe('Feature: Create new project', () => {
  test.describe('Given the new-project dialog is open', () => {
    test('When the user fills name + picks a workspace folder + submits, Then project.createFolder is called with {parent: workspace, name: project}', async ({
      page,
      bootInline,
    }) => {
      // Given — landing surface, no recents. checkFileExists is path-aware:
      // returns false for the existing-project probes (so the dialog
      // proceeds), true for the directory existence check inside
      // openProject (so the post-create open succeeds). The function
      // override is constructed inside the page so it can be stored.
      await bootInline({
        surface: 'landing',
        bridgeReturns: { 'project.selectDirectory': '/tmp/workspace' },
        rules: [],
      });
      await page.evaluate(() => {
        window.__kshanaTest!.setBridgeReturn(
          'project.checkFileExists',
          // Path-aware: anything ending in project.json doesn't exist
          // (so the new-project probes pass); other paths do (so
          // openProject's directory existence check passes).
          ((p: string) => !p.endsWith('project.json')) as unknown,
        );
      });
      await openCreateDialog(page);

      // When — fill name, pick folder, submit.
      await page.getByLabel('Project name').fill('demo');
      await page.getByRole('button', { name: /Choose Folder/i }).click();
      await expect(page.getByText('/tmp/workspace')).toBeVisible();
      await page
        .getByRole('dialog', { name: /Create new project/i })
        .getByRole('button', { name: /^Create Project$/ })
        .click();

      // Then — createFolder is called with the workspace + name as the
      // first call (subsequent calls create subdirs under the project).
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                window.__kshanaTest!.getCalls('project.createFolder').length,
            ),
          { timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(1);

      const createFolderCalls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.createFolder'),
      );
      const firstArgs = createFolderCalls[0].args as {
        parent: string;
        name: string;
      };
      expect(firstArgs.parent).toBe('/tmp/workspace');
      expect(firstArgs.name).toBe('demo');
    });

    test('When the user submits with an empty name, Then validation copy renders and createFolder is not called', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'landing',
        bridgeReturns: {
          'project.selectDirectory': '/tmp/workspace',
          'project.checkFileExists': false,
        },
        rules: [],
      });
      await openCreateDialog(page);

      // When — leave name blank, pick folder, submit.
      await page.getByRole('button', { name: /Choose Folder/i }).click();
      await page
        .getByRole('dialog', { name: /Create new project/i })
        .getByRole('button', { name: /^Create Project$/ })
        .click();

      // Then — validation message renders.
      await expect(page.getByText('Project name is required.')).toBeVisible();

      // And — createFolder is NOT called.
      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.createFolder'),
      );
      expect(calls).toHaveLength(0);
    });

    test('When the user picks a parent that is already a Kshana project, Then the duplicate-location error renders and createFolder is not called', async ({
      page,
      bootInline,
    }) => {
      // Given — checkFileExists returns true → parent looks like an existing project.
      await bootInline({
        surface: 'landing',
        bridgeReturns: {
          'project.selectDirectory': '/tmp/already-a-project',
          'project.checkFileExists': true,
        },
        rules: [],
      });
      await openCreateDialog(page);

      // When
      await page.getByLabel('Project name').fill('demo');
      await page.getByRole('button', { name: /Choose Folder/i }).click();
      await page
        .getByRole('dialog', { name: /Create new project/i })
        .getByRole('button', { name: /^Create Project$/ })
        .click();

      // Then — the parent-is-already-a-project error renders.
      await expect(
        page.getByText(
          /Selected location is already a Kshana project\. Choose a parent folder instead\./i,
        ),
      ).toBeVisible();

      // And — createFolder is NOT called.
      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.createFolder'),
      );
      expect(calls).toHaveLength(0);
    });
  });
});
