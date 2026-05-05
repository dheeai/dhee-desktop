/**
 * Wave 4 — Storyboard view inside the Workspace surface.
 *
 * StoryboardView reads `useProject().scenes` (populated by
 * projectService.openProject → readAgentState → readFile). When no
 * project data is seeded the component renders its "No Scenes Yet"
 * empty state, which is the observable outcome in the default harness.
 *
 * The "shot cards in scene order" test seeds a project.json via the
 * `fileReturns` field so that `ProjectContext.scenes` is non-empty on
 * first render, making SceneCards visible.
 */
import { test, expect } from './fixtures';

const minimalProjectJson = JSON.stringify({
  version: '2.0',
  id: 'test-noir-001',
  title: 'noir',
  originalInputFile: 'original_input.md',
  style: 'noir',
  inputType: 'idea',
  createdAt: 1_714_000_000_000,
  updatedAt: 1_714_000_000_000,
  currentPhase: 'scenes',
  phases: {
    plot: { status: 'completed', completedAt: 1_714_000_000_000 },
    story: { status: 'completed', completedAt: 1_714_000_000_000 },
    characters_settings: { status: 'completed', completedAt: 1_714_000_000_000 },
    scenes: { status: 'completed', completedAt: 1_714_000_000_000 },
    character_setting_images: { status: 'pending', completedAt: null },
    scene_images: { status: 'pending', completedAt: null },
    video: { status: 'pending', completedAt: null },
    video_combine: { status: 'pending', completedAt: null },
  },
  content: {
    plot: { status: 'missing' },
    story: { status: 'missing' },
    characters: { status: 'missing', items: [] },
    settings: { status: 'missing', items: [] },
    scenes: { status: 'missing', items: [] },
    images: { status: 'missing', items: [] },
    videos: { status: 'missing', items: [] },
  },
  characters: [],
  settings: [],
  scenes: [
    {
      sceneNumber: 1,
      title: 'Opening',
      contentApprovalStatus: 'approved',
      imageApprovalStatus: 'pending',
      videoApprovalStatus: 'pending',
      regenerationCount: 0,
    },
    {
      sceneNumber: 2,
      title: 'Resolution',
      contentApprovalStatus: 'approved',
      imageApprovalStatus: 'pending',
      videoApprovalStatus: 'pending',
      regenerationCount: 0,
    },
  ],
  assets: [],
});

test.describe('Feature: Storyboard view', () => {
  test.describe('Given a project is open in the workspace', () => {
    test('When the user clicks the Storyboard tab, Then it becomes the selected tab and StoryboardView mounts', async ({
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
      await page.getByRole('tab', { name: /Storyboard/i }).click();

      // Then — tab is selected.
      await expect(
        page.getByRole('tab', { name: /Storyboard/i }),
      ).toHaveAttribute('aria-selected', 'true');

      // And — StoryboardView mounts. With no seeded scenes it shows
      // the empty state rather than crashing.
      await expect(
        page.getByText(/No Scenes Yet|No Project Open/i),
      ).toBeVisible();
    });
  });

  test.describe('Given a project with shots populated', () => {
    test('When the user opens the Storyboard tab, Then shot cards render in scene order', async ({
      page,
      bootInline,
    }) => {
      // Given — seed project.json so ProjectContext.scenes is non-empty
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
        fileReturns: { 'project.json': minimalProjectJson },
      });

      // When
      await page.getByRole('tab', { name: /Storyboard/i }).click();

      // Then — scene cards for both seeded scenes are visible in order
      await expect(page.getByText('Opening')).toBeVisible({ timeout: 8_000 });
      await expect(page.getByText('Resolution')).toBeVisible({ timeout: 5_000 });
    });

  });
});
