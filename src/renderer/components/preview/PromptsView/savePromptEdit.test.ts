/**
 * `savePromptEdit` — the unit-testable core of the Prompts-tab edit
 * flow. Given a kind ('first_frame' | 'last_frame' | 'motion' |
 * 'negative'), a shot identity, and the new text, it:
 *   1. Reads the prompt JSON file.
 *   2. Mutates the right field per kind.
 *   3. Writes the file back.
 *   4. Asks the embedded core to invalidate the dependent executor
 *      node(s) so the next pipeline run regenerates from there.
 *
 * Filesystem and IPC are injected so tests can pin behavior without
 * touching disk or Electron. The rollback contract (if invalidation
 * fails, restore the original file) is tested explicitly — that's
 * the one place where partial-failure would corrupt the user's
 * project.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { savePromptEdit } from './savePromptEdit';

interface FakeFs {
  readFile: jest.Mock<(p: string) => Promise<string | null>>;
  writeFile: jest.Mock<(p: string, c: string) => Promise<void>>;
  files: Map<string, string>;
}

function makeFs(seed: Record<string, string>): FakeFs {
  const files = new Map(Object.entries(seed));
  const readFile = jest.fn<(p: string) => Promise<string | null>>(
    async (p: string) => files.get(p) ?? null,
  );
  const writeFile = jest.fn<(p: string, c: string) => Promise<void>>(
    async (p: string, c: string) => {
      files.set(p, c);
    },
  );
  return { readFile, writeFile, files };
}

const SHOT_PROMPT_PATH =
  '/proj/prompts/images/shots/scene-1-shot-2.json';
const MOTION_PATH = '/proj/prompts/motion/scene_1_shot_2.json';

const BASE_SHOT_JSON = {
  shotNumber: 2,
  frames: {
    first_frame: { imagePrompt: 'old first frame text' },
    last_frame: { imagePrompt: 'old last frame text' },
  },
  negativePrompt: 'old negative text',
};

const BASE_MOTION_JSON = { motionDirective: 'old motion text' };

describe('savePromptEdit', () => {
  describe('first_frame edits', () => {
    it('mutates frames.first_frame.imagePrompt and invalidates shot_image:*', async () => {
      const fs = makeFs({
        [SHOT_PROMPT_PATH]: JSON.stringify(BASE_SHOT_JSON),
      });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{
          ok: boolean;
          invalidated?: string[];
          notFound?: string[];
          error?: string;
        }>
      >(async (ids: string[]) => ({ ok: true, invalidated: ids }));

      const result = await savePromptEdit({
        kind: 'first_frame',
        scene: 1,
        shot: 2,
        newText: 'new first frame text',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: true,
        fs,
        invalidateNodes: invalidate,
      });

      expect(result.ok).toBe(true);
      expect(result.invalidated).toEqual(['shot_image:scene_1_shot_2']);
      expect(invalidate).toHaveBeenCalledWith(['shot_image:scene_1_shot_2']);

      const written = JSON.parse(fs.files.get(SHOT_PROMPT_PATH)!);
      expect(written.frames.first_frame.imagePrompt).toBe(
        'new first frame text',
      );
      // Sibling fields untouched.
      expect(written.frames.last_frame.imagePrompt).toBe('old last frame text');
      expect(written.negativePrompt).toBe('old negative text');
    });
  });

  describe('last_frame edits', () => {
    it('uses shot_image_last_frame:* when the split node exists', async () => {
      const fs = makeFs({
        [SHOT_PROMPT_PATH]: JSON.stringify(BASE_SHOT_JSON),
      });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{
          ok: boolean;
          invalidated?: string[];
          notFound?: string[];
          error?: string;
        }>
      >(async (ids: string[]) => ({ ok: true, invalidated: ids }));

      const result = await savePromptEdit({
        kind: 'last_frame',
        scene: 1,
        shot: 2,
        newText: 'new last frame text',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: true,
        fs,
        invalidateNodes: invalidate,
      });

      expect(result.ok).toBe(true);
      expect(invalidate).toHaveBeenCalledWith([
        'shot_image_last_frame:scene_1_shot_2',
      ]);
      const written = JSON.parse(fs.files.get(SHOT_PROMPT_PATH)!);
      expect(written.frames.last_frame.imagePrompt).toBe('new last frame text');
    });

    it('falls back to shot_image:* when no split node exists (regens both frames)', async () => {
      const fs = makeFs({
        [SHOT_PROMPT_PATH]: JSON.stringify(BASE_SHOT_JSON),
      });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{
          ok: boolean;
          invalidated?: string[];
          notFound?: string[];
          error?: string;
        }>
      >(async (ids: string[]) => ({ ok: true, invalidated: ids }));

      await savePromptEdit({
        kind: 'last_frame',
        scene: 1,
        shot: 2,
        newText: 'x',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: false,
        fs,
        invalidateNodes: invalidate,
      });

      expect(invalidate).toHaveBeenCalledWith(['shot_image:scene_1_shot_2']);
    });
  });

  describe('motion edits', () => {
    it('mutates motionDirective in the motion file and invalidates shot_video:*', async () => {
      const fs = makeFs({ [MOTION_PATH]: JSON.stringify(BASE_MOTION_JSON) });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{
          ok: boolean;
          invalidated?: string[];
          notFound?: string[];
          error?: string;
        }>
      >(async (ids: string[]) => ({ ok: true, invalidated: ids }));

      await savePromptEdit({
        kind: 'motion',
        scene: 1,
        shot: 2,
        newText: 'new motion',
        filePath: MOTION_PATH,
        hasLastFrameNode: true,
        fs,
        invalidateNodes: invalidate,
      });

      expect(invalidate).toHaveBeenCalledWith(['shot_video:scene_1_shot_2']);
      const written = JSON.parse(fs.files.get(MOTION_PATH)!);
      expect(written.motionDirective).toBe('new motion');
    });
  });

  describe('negative-prompt edits', () => {
    it('with split node: invalidates BOTH image and last-frame nodes', async () => {
      const fs = makeFs({
        [SHOT_PROMPT_PATH]: JSON.stringify(BASE_SHOT_JSON),
      });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{
          ok: boolean;
          invalidated?: string[];
          notFound?: string[];
          error?: string;
        }>
      >(async (ids: string[]) => ({ ok: true, invalidated: ids }));

      await savePromptEdit({
        kind: 'negative',
        scene: 1,
        shot: 2,
        newText: 'new negative',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: true,
        fs,
        invalidateNodes: invalidate,
      });

      expect(invalidate).toHaveBeenCalledWith([
        'shot_image:scene_1_shot_2',
        'shot_image_last_frame:scene_1_shot_2',
      ]);
      const written = JSON.parse(fs.files.get(SHOT_PROMPT_PATH)!);
      expect(written.negativePrompt).toBe('new negative');
    });

    it('without split node: only the combined image node', async () => {
      const fs = makeFs({
        [SHOT_PROMPT_PATH]: JSON.stringify(BASE_SHOT_JSON),
      });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{
          ok: boolean;
          invalidated?: string[];
          notFound?: string[];
          error?: string;
        }>
      >(async (ids: string[]) => ({ ok: true, invalidated: ids }));

      await savePromptEdit({
        kind: 'negative',
        scene: 1,
        shot: 2,
        newText: 'x',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: false,
        fs,
        invalidateNodes: invalidate,
      });

      expect(invalidate).toHaveBeenCalledWith(['shot_image:scene_1_shot_2']);
    });
  });

  describe('failure modes', () => {
    it('returns an error when the source file cannot be read', async () => {
      const fs = makeFs({});
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{ ok: boolean }>
      >();

      const result = await savePromptEdit({
        kind: 'first_frame',
        scene: 1,
        shot: 2,
        newText: 'x',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: true,
        fs,
        invalidateNodes: invalidate,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/read/i);
      expect(invalidate).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rolls back the file when invalidation fails', async () => {
      const original = JSON.stringify(BASE_SHOT_JSON);
      const fs = makeFs({ [SHOT_PROMPT_PATH]: original });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{ ok: boolean; error?: string }>
      >(async () => ({ ok: false, error: 'core unreachable' }));

      const result = await savePromptEdit({
        kind: 'first_frame',
        scene: 1,
        shot: 2,
        newText: 'this should be reverted',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: true,
        fs,
        invalidateNodes: invalidate,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/core unreachable/i);
      // File restored to its original contents.
      expect(fs.files.get(SHOT_PROMPT_PATH)).toBe(original);
      // Two writes were attempted: forward + rollback.
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('surfaces a parse error without writing or invalidating', async () => {
      const fs = makeFs({ [SHOT_PROMPT_PATH]: '{ not json' });
      const invalidate = jest.fn<
        (ids: string[]) => Promise<{ ok: boolean }>
      >();

      const result = await savePromptEdit({
        kind: 'first_frame',
        scene: 1,
        shot: 2,
        newText: 'x',
        filePath: SHOT_PROMPT_PATH,
        hasLastFrameNode: true,
        fs,
        invalidateNodes: invalidate,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/json|parse/i);
      expect(invalidate).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
