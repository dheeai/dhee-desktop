/**
 * Tests for the attachment-text transform that bridges the structured
 * IPC `Attachment[]` to a plain-text hint pi-agent's skill prompts
 * read. The format is load-bearing: the comfyui-workflow-integration
 * skill in dhee-core looks for `[attachment kind=... path="..."`]`
 * lines, so any change here must be matched by the skill.
 */

import { describe, expect, it } from '@jest/globals';
import {
  appendCharacterReferenceImagesToTask,
  appendReferenceImagesToTask,
  attachmentsFromSelectResponse,
  characterReferenceImagesFromAttachments,
  getReferenceImageReplacementTarget,
  referenceImagesFromAttachments,
  withReferenceImageReplacementTarget,
  withReferenceImageRole,
  prefixAttachmentsToTask,
  renderAttachmentHint,
  type Attachment,
} from './attachmentTypes';

const wfAttachment: Attachment = {
  id: 'att_1',
  kind: 'comfy_workflow',
  path: '/Users/x/Downloads/my-workflow.json',
  name: 'my-workflow.json',
};

describe('renderAttachmentHint', () => {
  it('renders a single line with kind, path, and name', () => {
    expect(renderAttachmentHint(wfAttachment)).toBe(
      `[attachment kind=comfy_workflow path="/Users/x/Downloads/my-workflow.json" name="my-workflow.json"]`,
    );
  });

  it('escapes double-quotes in paths so the line stays parseable', () => {
    const tricky: Attachment = {
      ...wfAttachment,
      path: '/tmp/has "quote".json',
      name: 'has "quote".json',
    };
    const rendered = renderAttachmentHint(tricky);
    expect(rendered).toContain('path="/tmp/has \\"quote\\".json"');
    expect(rendered).toContain('name="has \\"quote\\".json"');
  });
});

describe('prefixAttachmentsToTask', () => {
  it('returns the task unchanged when no attachments', () => {
    expect(prefixAttachmentsToTask('hello', undefined)).toBe('hello');
    expect(prefixAttachmentsToTask('hello', [])).toBe('hello');
  });

  it('prepends a single attachment hint above the task with a blank line separator', () => {
    const result = prefixAttachmentsToTask('add this workflow', [wfAttachment]);
    const lines = result.split('\n');
    expect(lines[0]).toMatch(/^\[attachment kind=comfy_workflow/);
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('add this workflow');
  });

  it('emits one hint line per attachment, in order', () => {
    const second: Attachment = { ...wfAttachment, id: 'att_2', name: 'second.json', path: '/tmp/second.json' };
    const result = prefixAttachmentsToTask('do the thing', [wfAttachment, second]);
    const lines = result.split('\n');
    expect(lines[0]).toContain('my-workflow.json');
    expect(lines[1]).toContain('second.json');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('do the thing');
  });

  it('does not render character refs as generic attachment hints', () => {
    const ref: Attachment = {
      id: 'att_ref',
      kind: 'character_ref',
      path: '/tmp/project/assets/uploads/characters/hero.png',
      name: 'hero.png',
      meta: {
        purpose: 'character_ref',
        projectRelativePath: 'assets/uploads/characters/hero.png',
      },
    };

    expect(prefixAttachmentsToTask('use this hero', [ref])).toBe('use this hero');
  });

  it('does not render generic reference images as generic attachment hints', () => {
    const ref: Attachment = {
      id: 'att_ref',
      kind: 'reference_image',
      path: '/tmp/project/assets/uploads/references/image.png',
      name: 'image.png',
      meta: {
        purpose: 'reference_general',
        referenceRole: 'auto',
        projectRelativePath: 'assets/uploads/references/image.png',
      },
    };

    expect(prefixAttachmentsToTask('use this', [ref])).toBe('use this');
  });

  it('preserves multi-line task bodies', () => {
    const multi = 'line one\nline two';
    const result = prefixAttachmentsToTask(multi, [wfAttachment]);
    expect(result.endsWith('line one\nline two')).toBe(true);
  });
});

describe('attachmentsFromSelectResponse', () => {
  it('prefers multi-select attachments over the legacy first attachment field', () => {
    const first: Attachment = {
      id: 'att_first',
      kind: 'reference_image',
      path: '/tmp/first.png',
      name: 'first.png',
    };
    const second: Attachment = {
      id: 'att_second',
      kind: 'reference_image',
      path: '/tmp/second.png',
      name: 'second.png',
    };

    expect(
      attachmentsFromSelectResponse({
        attachment: first,
        attachments: [first, second],
      }),
    ).toEqual([first, second]);
  });

  it('falls back to the single attachment field for old picker responses', () => {
    expect(attachmentsFromSelectResponse({ attachment: wfAttachment })).toEqual([
      wfAttachment,
    ]);
  });
});

describe('character reference attachment helpers', () => {
  it('extracts durable project-local payloads and appends prompt context', () => {
    const ref: Attachment = {
      id: 'att_ref',
      kind: 'character_ref',
      path: '/tmp/project/assets/uploads/characters/hero.png',
      name: 'hero.png',
      mimeType: 'image/png',
      size: 4,
      meta: {
        purpose: 'character_ref',
        projectRelativePath: 'assets/uploads/characters/hero.png',
        originalPath: '/Users/me/Desktop/hero.png',
        originalFilename: 'hero.png',
      },
    };

    const images = characterReferenceImagesFromAttachments([wfAttachment, ref]);
    expect(images).toEqual([{
      name: 'hero.png',
      relativePath: 'assets/uploads/characters/hero.png',
      sourcePath: '/Users/me/Desktop/hero.png',
      originalFilename: 'hero.png',
      mimeType: 'image/png',
      size: 4,
    }]);
    expect(appendCharacterReferenceImagesToTask('Make a film', images)).toBe(
      'Make a film\n\nAttached character reference images:\n- hero.png: assets/uploads/characters/hero.png',
    );
  });

  it('stores and clears a selected replacement character target', () => {
    const ref: Attachment = {
      id: 'att_ref',
      kind: 'reference_image',
      path: '/tmp/hero.png',
      name: 'hero.png',
      meta: {
        referenceRole: 'character',
        purpose: 'character_ref',
      },
    };

    const targeted = withReferenceImageReplacementTarget(ref, {
      id: 'emna_aoyama',
      name: 'Emna Aoyama',
    });
    expect(getReferenceImageReplacementTarget(targeted)).toEqual({
      id: 'emna_aoyama',
      name: 'Emna Aoyama',
    });

    const cleared = withReferenceImageReplacementTarget(targeted, null);
    expect(getReferenceImageReplacementTarget(cleared)).toBeNull();
    expect(cleared.meta).not.toHaveProperty('replacementCharacterId');
  });

  it('extracts generic reference payloads and appends grouped prompt context', () => {
    const autoRef = withReferenceImageRole({
      id: 'att_auto',
      kind: 'reference_image',
      path: '/tmp/project/assets/uploads/references/mood.png',
      name: 'mood.png',
      mimeType: 'image/png',
      size: 4,
      meta: {
        projectRelativePath: 'assets/uploads/references/mood.png',
        originalPath: '/Users/me/Desktop/mood.png',
        originalFilename: 'mood.png',
      },
    }, 'auto');
    const settingRef = withReferenceImageRole({
      id: 'att_setting',
      kind: 'reference_image',
      path: '/tmp/project/assets/uploads/settings/field.png',
      name: 'field.png',
      mimeType: 'image/png',
      size: 5,
      meta: {
        projectRelativePath: 'assets/uploads/settings/field.png',
        originalPath: '/Users/me/Desktop/field.png',
        originalFilename: 'field.png',
      },
    }, 'setting');

    const images = referenceImagesFromAttachments([autoRef, settingRef]);
    expect(images).toEqual([
      expect.objectContaining({
        name: 'mood.png',
        purpose: 'reference_general',
        referenceRole: 'auto',
        relativePath: 'assets/uploads/references/mood.png',
      }),
      expect.objectContaining({
        name: 'field.png',
        purpose: 'setting_ref',
        referenceRole: 'setting',
        relativePath: 'assets/uploads/settings/field.png',
      }),
    ]);
    expect(appendReferenceImagesToTask('Make a film', images)).toBe(
      [
        'Make a film',
        '',
        'Attached setting reference images:',
        '- field.png: assets/uploads/settings/field.png',
        '',
        'Attached reference images:',
        '- mood.png: assets/uploads/references/mood.png',
      ].join('\n'),
    );
  });
});
