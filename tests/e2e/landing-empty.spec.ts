/**
 * Wave 2 — Landing screen empty state.
 */
/* eslint-disable no-underscore-dangle */
import { test, expect } from './fixtures';

test.describe('Feature: Landing screen, empty state', () => {
  test.describe('Given a user with no recent projects', () => {
    test('When the page boots, Then the first-run walkthrough starts with Cloud and local choices', async ({
      page,
      bootInline,
    }) => {
      // Given — landing surface, no recents seeded.
      await bootInline({ surface: 'landing', rules: [] });

      // Then — first-run walkthrough opens automatically.
      await expect(
        page.getByRole('heading', { name: /Choose how Dhee runs/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/Dhee can use Dhee Cloud credits/i),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Sign in to Dhee Cloud/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Local setup/i }),
      ).toBeVisible();

      // And — both sidebar CTAs are still mounted.
      await expect(
        page.getByRole('button', { name: /New Project/i }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Open Workspace/i }),
      ).toBeVisible();
    });

    test('When the user skips the walkthrough, Then the regular empty state appears and skip persists', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await page.getByRole('button', { name: /^Skip$/i }).click();

      await expect(
        page.getByText(
          /No projects yet\. Create your first project to get started\./i,
        ),
      ).toBeVisible();

      const calls = await page.evaluate(() =>
        window.__dheeTest!.getCalls('onboarding.complete'),
      );
      expect(calls[calls.length - 1].args).toMatchObject({
        skipped: true,
        completedReason: 'skipped',
      });
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

    test('When the user chooses local setup from the walkthrough, Then Connection settings opens', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await page.getByRole('button', { name: /Local setup/i }).click();

      await expect(
        page.getByRole('heading', { name: /Settings$/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /^Connection$/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /Local ComfyUI lives here/i }),
      ).toBeVisible();
      await page.getByRole('button', { name: /^Next$/i }).click();
      await expect(
        page.getByRole('heading', { name: /Choose the local LLM provider/i }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: /Continue without setup/i })
        .click();
      await expect(
        page.getByRole('heading', { name: /Create your first project/i }),
      ).toBeVisible();
    });

    test('When the user starts Cloud sign-in, Then the tour shows Cloud settings without blocking', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await page
        .getByRole('button', { name: /Sign in to Dhee Cloud/i })
        .click();

      await expect(
        page.getByRole('heading', { name: /Cloud sign-in starts here/i }),
      ).toBeVisible();
      const calls = await page.evaluate(() =>
        window.__dheeTest!.getCalls('account.signIn'),
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);

      await page
        .getByRole('button', { name: /Continue without setup/i })
        .click();
      await expect(
        page.getByRole('heading', { name: /Create your first project/i }),
      ).toBeVisible();
    });

    test('When the user continues from provider choice, Then the walkthrough points to New Project', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await page
        .getByRole('button', { name: /^Continue without setup$/i })
        .click();

      await expect(
        page.getByRole('heading', { name: /Create your first project/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/Click New Project to continue/i),
      ).toBeVisible();
    });

    test('When the user creates a project, Then the walkthrough reaches the first setup prompt', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await page.evaluate(() => {
        window.__dheeTest!.setBridgeReturn(
          'project.checkFileExists',
          (p: string) =>
            !p.endsWith('/project.json') &&
            !p.endsWith('/.dhee/agent/project.json'),
        );
      });

      await page
        .getByRole('button', { name: /^Continue without setup$/i })
        .click();
      await page.getByRole('button', { name: /^New Project$/i }).click();
      await expect(
        page.getByRole('heading', { name: /Name the project/i }),
      ).toBeVisible();

      await page.getByLabel(/Project name/i).fill('Walkthrough Test');
      await expect(
        page.getByRole('heading', { name: /Confirm the project location/i }),
      ).toBeVisible();
      await page.getByRole('button', { name: /Use this location/i }).click();
      await expect(
        page.getByRole('heading', { name: /Create the project folder/i }),
      ).toBeVisible();
      await page
        .getByLabel('Create new project')
        .getByRole('button', { name: /^Create Project$/i })
        .click();

      await expect(
        page.getByRole('heading', { name: /Chat drives the workflow/i }),
      ).toBeVisible();
      await expect(page.getByText(/This is where you describe/i)).toBeVisible();

      await page.getByRole('button', { name: /^Next$/i }).click();
      await expect(
        page.getByRole('heading', { name: /Pick a visual style/i }),
      ).toBeVisible();
      await page
        .locator('[data-tour-id="setup-style-options"] button')
        .first()
        .click();

      await expect(
        page.getByRole('heading', { name: /Choose the duration/i }),
      ).toBeVisible();
      await page
        .locator('[data-tour-id="setup-duration-options"] button')
        .first()
        .click();

      await expect(
        page.getByRole('heading', { name: /Enter the first prompt/i }),
      ).toBeVisible();
      await page
        .getByLabel(/Project story or idea/i)
        .fill('A concise product launch video with cinematic lighting.');
      await expect(
        page.getByRole('heading', { name: /Send the setup prompt/i }),
      ).toBeVisible();
      await page.locator('[data-tour-id="setup-story-continue"]').click();

      await expect(
        page.getByRole('heading', {
          name: /Outputs appear in the preview area/i,
        }),
      ).toBeVisible();

      const calls = await page.evaluate(() =>
        window.__dheeTest!.getCalls('onboarding.complete'),
      );
      expect(
        calls.some((call) =>
          Boolean(
            call.args &&
              typeof call.args === 'object' &&
              (call.args as { completedReason?: unknown }).completedReason ===
                'first_prompt_submitted',
          ),
        ),
      ).toBe(true);
    });
  });
});
