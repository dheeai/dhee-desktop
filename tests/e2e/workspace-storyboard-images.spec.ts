/**
 * Storyboard image thumbnails — TDD (Red → Green).
 *
 * StoryboardView derives scenes from TimelineDataContext when
 * project.json has no scene data. Each scene card should show an
 * <img> thumbnail when the timeline item has an imagePath, and a
 * placeholder (no broken img) when only a videoPath is present.
 *
 * Pipeline for images in the test harness:
 *   timeline.json → useTimelineData → TimelineItem.imagePath
 *   → StoryboardView artifactsByScene → SceneCard
 *   → resolveAssetPathForDisplay → shouldUseBase64 → imageToBase64
 *   → window.electron.project.readFileBase64 (seedable via bridgeReturns)
 *   → <img src="data:image/png;base64,...">
 */
import { test, expect } from './fixtures';

// Minimal 1×1 transparent PNG data URI
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// project.json — minimal valid BackendProjectFile (no scenes) so isLoaded=true
const minimalProject = JSON.stringify({
  version: '2.0',
  id: 'test-img-001',
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
  scenes: [],
  assets: [],
});

// timeline.json — one image segment and one video-only segment
const timelineWithImages = JSON.stringify({
  version: '1.0',
  totalDuration: 10,
  segments: [
    {
      id: 'segment_0_shot_1',
      label: 'Shot 1: shot_1',
      startTime: 0,
      endTime: 5,
      duration: 5,
      fillStatus: 'filled',
      layers: [
        {
          type: 'visual',
          filePath: '/tmp/noir.kshana/assets/scene-001.png',
          artifactId: 'scene-001-image',
        },
      ],
    },
    {
      id: 'segment_1_shot_1',
      label: 'Shot 1: shot_1',
      startTime: 5,
      endTime: 10,
      duration: 5,
      fillStatus: 'filled',
      layers: [
        {
          type: 'visual',
          filePath: '/tmp/noir.kshana/assets/scene-002.mp4',
          artifactId: 'scene-002-video',
        },
      ],
    },
  ],
});

test.describe('Feature: Storyboard image thumbnails', () => {
  test.describe('Given a project with timeline items', () => {
    test('When a timeline item has an imagePath, Then the scene card shows an <img> with a data URI src', async ({
      page,
      bootInline,
    }) => {
      // Given — seed project.json (isLoaded=true) + timeline.json with image segment
      // + readFileBase64 returning a tiny PNG for the image path
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
        fileReturns: {
          'project.json': minimalProject,
          'timeline.json': timelineWithImages,
        },
        bridgeReturns: {
          'project.readFileBase64': TINY_PNG,
        },
      });

      // When
      await page.getByRole('tab', { name: /Storyboard/i }).click();

      // Then — at least one scene card renders an <img> with a data URI
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const imgs = Array.from(document.querySelectorAll('img'));
              return imgs.some((img) => img.src.startsWith('data:image'));
            }),
          { timeout: 8_000 },
        )
        .toBe(true);
    });

    test('When a timeline item has only a videoPath, Then no broken <img> is rendered for that scene', async ({
      page,
      bootInline,
    }) => {
      // Given — only the video segment seeded
      const videoOnlyTimeline = JSON.stringify({
        version: '1.0',
        totalDuration: 5,
        segments: [
          {
            id: 'segment_0_shot_1',
            label: 'Shot 1: shot_1',
            startTime: 0,
            endTime: 5,
            duration: 5,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                filePath: '/tmp/noir.kshana/assets/scene-001.mp4',
                artifactId: 'scene-001-video',
              },
            ],
          },
        ],
      });

      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
        fileReturns: {
          'project.json': minimalProject,
          'timeline.json': videoOnlyTimeline,
        },
      });

      await page.getByRole('tab', { name: /Storyboard/i }).click();

      // Scene 1 card should be visible (derived from timeline); heading is h3 in SceneCard
      await expect(
        page.getByRole('heading', { name: 'Scene 1' }),
      ).toBeVisible({ timeout: 8_000 });

      // But no broken img (naturalWidth === 0 means failed to load)
      const brokenImages = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.filter(
          (img) => img.complete && img.naturalWidth === 0 && img.src !== '',
        ).length;
      });
      expect(brokenImages).toBe(0);
    });
  });
});
