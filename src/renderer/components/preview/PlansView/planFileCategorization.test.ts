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
      expect(grouped.other).toEqual([]);
    });
  });

  describe('GIVEN paths that are not .md files', () => {
    it('WHEN grouped THEN only .md files appear in any category', () => {
      const grouped = groupPlanFiles([
        'original_input.md',
        'project.json',
        'characters/officer.md',
        'assets/images/foo.png',
      ]);
      expect(grouped.content.map((f) => f.path)).toEqual(['original_input.md']);
      expect(grouped.characters.map((f) => f.path)).toEqual([
        'characters/officer.md',
      ]);
      // No non-md files leaked into "other".
      expect(grouped.other).toEqual([]);
    });
  });
});
