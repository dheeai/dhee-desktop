/**
 * Wave 2 — Landing screen empty state.
 */
/* eslint-disable no-underscore-dangle */
import { test, expect, type Page } from './fixtures';

async function expectTourHeading(page: Page, name: RegExp) {
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function clickNextToTourHeading(page: Page, name: RegExp) {
  await page.getByRole('button', { name: /^Next$/i }).click();
  await expectTourHeading(page, name);
}

async function expectCoachmarkRightAligned(page: Page, targetId: string) {
  await expect
    .poll(async () => {
      const placement = await page.evaluate((tourId) => {
        const dialog = document
          .querySelector<HTMLElement>('[role="dialog"]')
          ?.getBoundingClientRect();
        const target = document
          .querySelector<HTMLElement>(`[data-tour-id="${tourId}"]`)
          ?.getBoundingClientRect();

        if (!dialog || !target) return 'missing';

        const targetMidpoint = target.left + target.width / 2;
        if (dialog.left <= targetMidpoint) return 'left-of-target';
        if (dialog.right > window.innerWidth - 15) return 'overflowing';
        return 'right-aligned';
      }, targetId);

      return placement;
    })
    .toBe('right-aligned');
}

async function readCoachmarkPosition(page: Page) {
  return page.evaluate(() => {
    const dialog = document
      .querySelector<HTMLElement>('[role="dialog"]')
      ?.getBoundingClientRect();

    if (!dialog) return null;
    return { left: Math.round(dialog.left), top: Math.round(dialog.top) };
  });
}

async function readCoachmarkAndTargetPosition(page: Page, targetId: string) {
  return page.evaluate((tourId) => {
    const dialog = document
      .querySelector<HTMLElement>('[role="dialog"]')
      ?.getBoundingClientRect();
    const target = document
      .querySelector<HTMLElement>(`[data-tour-id="${tourId}"]`)
      ?.getBoundingClientRect();

    if (!dialog || !target) return null;

    return {
      dialogTop: Math.round(dialog.top),
      targetBottom: Math.round(target.bottom),
    };
  }, targetId);
}

async function expectCoachmarkBelowTarget(page: Page, targetId: string) {
  await expect
    .poll(async () => {
      const placement = await readCoachmarkAndTargetPosition(page, targetId);
      if (!placement) return 'missing';
      return placement.dialogTop >= placement.targetBottom
        ? 'below-target'
        : 'overlapping-target';
    })
    .toBe('below-target');
}

async function startLinearWalkthrough(page: Page) {
  await page.getByRole('button', { name: /^Start walkthrough$/i }).click();
  await expectTourHeading(page, /Local ComfyUI lives here/i);
}

async function advanceToProjectCreation(page: Page) {
  await startLinearWalkthrough(page);
  await clickNextToTourHeading(page, /Choose the local LLM provider/i);
  await clickNextToTourHeading(page, /Base URL comes before the model/i);
  await clickNextToTourHeading(page, /Model IDs come before the key/i);
  await clickNextToTourHeading(page, /API keys go after the model/i);
  await clickNextToTourHeading(page, /Test providers when ready/i);
  await clickNextToTourHeading(page, /Save connection changes/i);
  await clickNextToTourHeading(page, /Cloud sign-in starts here/i);
  await clickNextToTourHeading(page, /Cloud mode toggles live in Connection/i);
  await clickNextToTourHeading(page, /Create your first project/i);
}

test.describe('Feature: Landing screen, empty state', () => {
  test.describe('Given a user with no recent projects', () => {
    test('When the page boots, Then the first-run walkthrough starts with the overview', async ({
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
        page.getByRole('button', { name: /^Start walkthrough$/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Sign in to Dhee Cloud/i }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /Local setup/i }),
      ).toHaveCount(0);

      // And — both sidebar CTAs are still mounted.
      await expect(
        page.getByRole('button', { name: /New Project/i }).first(),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^Open$/i })).toBeVisible();
    });

    test('When the user skips the walkthrough, Then the regular empty state appears and skip persists', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await page.getByRole('button', { name: /^Skip$/i }).click();

      await expect(
        page.getByRole('heading', { name: /Start your first project/i }),
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

    test('When the user starts the walkthrough, Then local Connection settings opens', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await startLinearWalkthrough(page);

      await expect(
        page.getByRole('heading', { name: /Settings$/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /^Connection$/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /Local ComfyUI lives here/i }),
      ).toBeVisible();
      await expectCoachmarkRightAligned(page, 'settings-comfy-url');
      await page.getByRole('button', { name: /^Next$/i }).click();
      await expect(
        page.getByRole('heading', { name: /Choose the local LLM provider/i }),
      ).toBeVisible();
    });

    test('When the walkthrough reaches Cloud sign-in, Then sign-in is optional', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await startLinearWalkthrough(page);
      await clickNextToTourHeading(page, /Choose the local LLM provider/i);
      await clickNextToTourHeading(page, /Base URL comes before the model/i);
      await clickNextToTourHeading(page, /Model IDs come before the key/i);
      await clickNextToTourHeading(page, /API keys go after the model/i);
      await clickNextToTourHeading(page, /Test providers when ready/i);
      await clickNextToTourHeading(page, /Save connection changes/i);
      await clickNextToTourHeading(page, /Cloud sign-in starts here/i);

      const beforeSignInCalls = await page.evaluate(() =>
        window.__dheeTest!.getCalls('account.signIn'),
      );
      expect(beforeSignInCalls.length).toBe(0);

      await page
        .getByRole('button', { name: /Sign in to Dhee Cloud/i })
        .click();

      const afterSignInCalls = await page.evaluate(() =>
        window.__dheeTest!.getCalls('account.signIn'),
      );
      expect(afterSignInCalls.length).toBeGreaterThanOrEqual(1);

      await clickNextToTourHeading(
        page,
        /Cloud mode toggles live in Connection/i,
      );
      await expectCoachmarkRightAligned(page, 'settings-cloud-toggles');
      await clickNextToTourHeading(page, /Create your first project/i);
    });

    test('When the user completes setup sections, Then the walkthrough points to New Project', async ({
      page,
      bootInline,
    }) => {
      await bootInline({ surface: 'landing', rules: [] });

      await advanceToProjectCreation(page);

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

      await advanceToProjectCreation(page);
      await page
        .getByRole('button', { name: /^New Project$/i })
        .first()
        .click();
      await expect(
        page.getByRole('heading', { name: /Name the project/i }),
      ).toBeVisible();

      await page.getByLabel(/Project name/i).fill('Walkthrough Test');
      await page.getByRole('button', { name: /^Next$/i }).click();
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
      await expectCoachmarkBelowTarget(page, 'setup-story-input');
      const promptCoachmarkPosition = await readCoachmarkPosition(page);
      expect(promptCoachmarkPosition).not.toBeNull();
      await page
        .getByLabel(/Project story or idea/i)
        .fill('A concise product launch video with cinematic lighting.');
      await expect(page.getByRole('button', { name: /^Next$/i })).toBeVisible();
      await expect
        .poll(() => readCoachmarkPosition(page))
        .toEqual(promptCoachmarkPosition);
      await page.getByRole('button', { name: /^Next$/i }).click();
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
