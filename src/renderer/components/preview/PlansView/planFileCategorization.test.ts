/**
 * Categorization + naming for the Content tab (formerly Files).
 *
 * The Content tab groups every `.md` in the project into four
 * sections: Content (story / original input / world style), Scenes,
 * Settings, Characters. Every entry shows a proper human-readable
 * name — the path on disk doesn't show, since it's noise. This
 * helper owns the path → category + displayName mapping.
 */
import { describe, expect, it } from '@jest/globals';
import {
  categorizePlanFile,
  groupPlanFiles,
} from './planFileCategorization';

describe('categorizePlanFile', () => {
  describe('GIVEN top-level original_input.md', () => {
    it('THEN category is "content" and displayName is "Original Input"', () => {
      const file = categorizePlanFile('original_input.md');
      expect(file.category).toBe('content');
      expect(file.displayName).toBe('Original Input');
    });
  });

  describe('GIVEN plans/world_style.md', () => {
    it('THEN category is "content" and displayName is "World Style"', () => {
      const file = categorizePlanFile('plans/world_style.md');
      expect(file.category).toBe('content');
      expect(file.displayName).toBe('World Style');
    });
  });

  describe('GIVEN a chapter-level story file', () => {
    it('THEN category is "content" and displayName is "Story"', () => {
      const file = categorizePlanFile('chapters/chapter_1/plans/story.md');
      expect(file.category).toBe('content');
      expect(file.displayName).toBe('Story');
    });
  });

  describe('GIVEN a scene markdown under chapters', () => {
    it('THEN category is "scenes" and displayName is "Scene N"', () => {
      const file = categorizePlanFile('chapters/chapter_1/scenes/scene_2.md');
      expect(file.category).toBe('scenes');
      expect(file.displayName).toBe('Scene 2');
    });

    it('THEN scene 12 is parsed (multi-digit)', () => {
      const file = categorizePlanFile('chapters/chapter_3/scenes/scene_12.md');
      expect(file.category).toBe('scenes');
      expect(file.displayName).toBe('Scene 12');
    });
  });

  describe('GIVEN a settings markdown', () => {
    it('THEN category is "settings" and displayName is the slug as Title Case', () => {
      const file = categorizePlanFile('settings/forest_edge.md');
      expect(file.category).toBe('settings');
      expect(file.displayName).toBe('Forest Edge');
    });

    it('THEN single-word slugs also Title Case', () => {
      const file = categorizePlanFile('settings/forest.md');
      expect(file.category).toBe('settings');
      expect(file.displayName).toBe('Forest');
    });
  });

  describe('GIVEN a characters markdown', () => {
    it('THEN category is "characters" and displayName is the slug as Title Case', () => {
      const file = categorizePlanFile('characters/officer.md');
      expect(file.category).toBe('characters');
      expect(file.displayName).toBe('Officer');
    });

    it('THEN multi-word character slugs Title Case', () => {
      const file = categorizePlanFile('characters/sister_in_law.md');
      expect(file.category).toBe('characters');
      expect(file.displayName).toBe('Sister In Law');
    });
  });

  describe('GIVEN an unrecognized markdown path', () => {
    it('THEN category is "other" and displayName is the file slug Title Cased', () => {
      const file = categorizePlanFile('notes/random_thoughts.md');
      expect(file.category).toBe('other');
      expect(file.displayName).toBe('Random Thoughts');
    });
  });

  // Hierarchical scene-breakdown JSONs (kshana-core feat/hierarchical-shot-breakdown):
  // three layers of files under `prompts/videos/scenes/`. All land in the
  // new `breakdowns` category and sort grouped by scene number (assembled,
  // then plan, then per-shot ascending).
  describe('GIVEN the assembled scene_N.json under prompts/videos/scenes/', () => {
    it('THEN category is "breakdowns" and displayName is "Scene N — Breakdown"', () => {
      const file = categorizePlanFile('prompts/videos/scenes/scene_2.json');
      expect(file.category).toBe('breakdowns');
      expect(file.displayName).toBe('Scene 2 — Breakdown');
    });
  });

  describe('GIVEN the Stage A scene_N.plan.json', () => {
    it('THEN category is "breakdowns" and displayName is "Scene N — Shot Plan"', () => {
      const file = categorizePlanFile('prompts/videos/scenes/scene_2.plan.json');
      expect(file.category).toBe('breakdowns');
      expect(file.displayName).toBe('Scene 2 — Shot Plan');
    });
  });

  describe('GIVEN a Stage B scene_N.shots/M.json', () => {
    it('THEN category is "breakdowns" and displayName is "Scene N — Shot M"', () => {
      const file = categorizePlanFile('prompts/videos/scenes/scene_2.shots/3.json');
      expect(file.category).toBe('breakdowns');
      expect(file.displayName).toBe('Scene 2 — Shot 3');
    });

    it('THEN multi-digit scenes and shots both parse', () => {
      const file = categorizePlanFile('prompts/videos/scenes/scene_12.shots/7.json');
      expect(file.category).toBe('breakdowns');
      expect(file.displayName).toBe('Scene 12 — Shot 7');
    });
  });
});

describe('groupPlanFiles', () => {
  describe('GIVEN a mixed list of project markdown paths', () => {
    it('WHEN grouped THEN each section contains its own files in display-name order', () => {
      const grouped = groupPlanFiles([
        'characters/officer.md',
        'settings/forest_edge.md',
        'characters/mc.md',
        'plans/world_style.md',
        'original_input.md',
        'chapters/chapter_1/scenes/scene_2.md',
        'chapters/chapter_1/scenes/scene_1.md',
        'chapters/chapter_1/plans/story.md',
        'settings/forest.md',
      ]);

      // Content section: Original Input + Story + World Style
      expect(grouped.content.map((f) => f.displayName)).toEqual([
        'Story',
        'Original Input',
        'World Style',
      ]);
      // Scenes section: ordered by scene number, not alphabetical
      expect(grouped.scenes.map((f) => f.displayName)).toEqual([
        'Scene 1',
        'Scene 2',
      ]);
      // Settings: alphabetical by display name
      expect(grouped.settings.map((f) => f.displayName)).toEqual([
        'Forest',
        'Forest Edge',
      ]);
      // Characters: alphabetical by display name
      expect(grouped.characters.map((f) => f.displayName)).toEqual([
        'Mc',
        'Officer',
      ]);
    });
  });

  describe('GIVEN a list with no scenes/settings/characters', () => {
    it('THEN those category keys are empty arrays (always present, never missing)', () => {
      const grouped = groupPlanFiles(['original_input.md']);
      expect(grouped.content.map((f) => f.displayName)).toEqual([
        'Original Input',
      ]);
      expect(grouped.scenes).toEqual([]);
      expect(grouped.settings).toEqual([]);
      expect(grouped.characters).toEqual([]);
      expect(grouped.breakdowns).toEqual([]);
      expect(grouped.other).toEqual([]);
    });
  });

  describe('GIVEN paths that are not .md and not scene-breakdown JSONs', () => {
    it('WHEN grouped THEN unrelated config / binary files stay out of every category', () => {
      // The breakdown JSONs under `prompts/videos/scenes/` ARE allowed
      // through (see the breakdowns-specific tests below); this case
      // covers everything ELSE — project state, binary media, etc.
      const grouped = groupPlanFiles([
        'original_input.md',
        'project.json',
        'characters/officer.md',
        'assets/images/foo.png',
        'prompts/images/characters/officer.json',
        'prompts/motion/scene_1_shot_1.json',
      ]);
      expect(grouped.content.map((f) => f.path)).toEqual(['original_input.md']);
      expect(grouped.characters.map((f) => f.path)).toEqual([
        'characters/officer.md',
      ]);
      // No unrelated JSONs / images leaked into any bucket.
      expect(grouped.other).toEqual([]);
      expect(grouped.breakdowns).toEqual([]);
    });
  });

  describe('GIVEN .failed sidecars from kshana-core validation rejections', () => {
    it('categorises a shot-image-prompt failure as "failures" with a scene/shot-aware label', () => {
      const grouped = groupPlanFiles([
        'prompts/images/shots/scene-1-shot-3.json.failed',
      ]);
      expect(grouped.failures.map((f) => f.displayName)).toEqual([
        'Shot Composition — Scene 1 Shot 3 (failed)',
      ]);
    });

    it('categorises an assembled-scene failure as "failures" with a Scene Breakdown label', () => {
      const grouped = groupPlanFiles([
        'prompts/videos/scenes/scene_2.json.failed',
      ]);
      expect(grouped.failures.map((f) => f.displayName)).toEqual([
        'Scene Breakdown — Scene 2 (failed)',
      ]);
    });

    it('categorises a stage-A plan failure with a "Shot Plan" label', () => {
      const grouped = groupPlanFiles([
        'prompts/videos/scenes/scene_1.plan.json.failed',
      ]);
      expect(grouped.failures.map((f) => f.displayName)).toEqual([
        'Shot Plan — Scene 1 (failed)',
      ]);
    });

    it('categorises a stage-B per-shot breakdown failure with a Scene/Shot label', () => {
      const grouped = groupPlanFiles([
        'prompts/videos/scenes/scene_1.shots/4.json.failed',
      ]);
      expect(grouped.failures.map((f) => f.displayName)).toEqual([
        'Shot Breakdown — Scene 1 Shot 4 (failed)',
      ]);
    });

    it('does NOT surface the `.failed.error` companion as its own entry (folded into the .failed view)', () => {
      const grouped = groupPlanFiles([
        'prompts/images/shots/scene-1-shot-3.json.failed',
        'prompts/images/shots/scene-1-shot-3.json.failed.error',
      ]);
      // One failures entry only — the .error is co-read at view time.
      expect(grouped.failures).toHaveLength(1);
    });

    it('sorts failures with scene-major ordering', () => {
      const grouped = groupPlanFiles([
        'prompts/images/shots/scene-2-shot-1.json.failed',
        'prompts/images/shots/scene-1-shot-5.json.failed',
        'prompts/images/shots/scene-1-shot-1.json.failed',
      ]);
      expect(grouped.failures.map((f) => f.displayName)).toEqual([
        'Shot Composition — Scene 1 Shot 1 (failed)',
        'Shot Composition — Scene 1 Shot 5 (failed)',
        'Shot Composition — Scene 2 Shot 1 (failed)',
      ]);
    });
  });

  describe('GIVEN a project with the three scene-breakdown layers on disk', () => {
    it('groups assembled + plan + per-shot under "breakdowns", sorted by scene then layer', () => {
      const grouped = groupPlanFiles([
        'prompts/videos/scenes/scene_1.shots/2.json',
        'prompts/videos/scenes/scene_2.json',
        'prompts/videos/scenes/scene_1.plan.json',
        'prompts/videos/scenes/scene_1.shots/1.json',
        'prompts/videos/scenes/scene_1.json',
        'prompts/videos/scenes/scene_2.plan.json',
        'prompts/videos/scenes/scene_2.shots/1.json',
      ]);
      // Scene 1's three files come first (assembled, plan, shot 1, shot 2),
      // then Scene 2's three. Locks in the cross-scene + within-scene
      // ordering: assembled outputs first, plan second, per-shot ascending.
      expect(grouped.breakdowns.map((f) => f.displayName)).toEqual([
        'Scene 1 — Breakdown',
        'Scene 1 — Shot Plan',
        'Scene 1 — Shot 1',
        'Scene 1 — Shot 2',
        'Scene 2 — Breakdown',
        'Scene 2 — Shot Plan',
        'Scene 2 — Shot 1',
      ]);
    });
  });
});
