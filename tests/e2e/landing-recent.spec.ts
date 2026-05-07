/**
 * Wave 2 — Landing screen, recent-projects flow.
 *
 * `recentProjects` is loaded by WorkspaceContext on mount via
 * `electron.project.getRecent()`. Tests pre-seed via `bridgeReturns`
 * so the list is populated when LandingScreen mounts.
 */
import { test, expect } from './fixtures';

const RECENTS = [
  { name: 'noir', path: '/tmp/noir.kshana', lastOpened: 1700000000000 },
  { name: 'sci-fi', path: '/tmp/sci-fi.kshana', lastOpened: 1700000010000 },
];

const MANY_RECENTS = Array.from({ length: 11 }, (_, index) => {
  const projectNumber = index + 1;
  const name = `project-${projectNumber.toString().padStart(2, '0')}`;
  return {
    name,
    path: `/tmp/${name}.kshana`,
    lastOpened: 1700000000000 + projectNumber,
  };
});

test.describe('Feature: Landing screen, recent projects', () => {
  test.describe('Given two recent projects seeded into the bridge', () => {
    test('When the page boots, Then both project cards render with names + paths', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'landing',
        bridgeReturns: { 'project.getRecent': RECENTS },
        rules: [],
      });

      // Then — both names appear in the projects grid (ProjectCard).
      await expect(
        page.getByRole('heading', { name: /^noir$/, level: 3 }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /^sci-fi$/, level: 3 }),
      ).toBeVisible();

      // And — paths appear in card meta (shortened form contains the basename).
      await expect(page.getByText(/noir\.kshana/).first()).toBeVisible();
      await expect(page.getByText(/sci-fi\.kshana/).first()).toBeVisible();
    });

    test('When the user clicks a project card, Then project.watchDirectory + project.addRecent are called with that path', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'landing',
        bridgeReturns: { 'project.getRecent': RECENTS },
        rules: [],
      });

      // When — click the "noir" card. ProjectCard wraps the open action in
      // an unlabeled button; we trigger it by clicking the heading inside.
      await page.getByRole('heading', { name: /^noir$/, level: 3 }).click();

      // Then — openProject() in WorkspaceContext fires both bridge calls.
      const watchCalls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.watchDirectory'),
      );
      const addCalls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.addRecent'),
      );

      expect(watchCalls.map((c) => c.args)).toContain('/tmp/noir.kshana');
      expect(addCalls.map((c) => c.args)).toContain('/tmp/noir.kshana');
    });

    test('When the user clicks "Open Workspace", Then project.selectDirectory is called', async ({
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
      await page.getByRole('button', { name: /Open Workspace/i }).click();

      // Then
      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.selectDirectory'),
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Given more than 9 recent projects seeded into the bridge', () => {
    test('When the user pages through projects, Then older projects remain reachable', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'landing',
        bridgeReturns: { 'project.getRecent': MANY_RECENTS },
        rules: [],
      });

      // Then — page 1 shows the newest 9 and hides older projects.
      await expect(
        page.getByRole('heading', { name: /^project-11$/, level: 3 }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /^project-03$/, level: 3 }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /^project-02$/, level: 3 }),
      ).toHaveCount(0);
      await expect(page.getByText('1-9 of 11')).toBeVisible();

      // When
      await page.getByRole('button', { name: 'Next projects page' }).click();

      // Then — page 2 exposes the remaining older projects.
      await expect(
        page.getByRole('heading', { name: /^project-02$/, level: 3 }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /^project-01$/, level: 3 }),
      ).toBeVisible();
      await expect(page.getByText('10-11 of 11')).toBeVisible();
    });
  });
});
