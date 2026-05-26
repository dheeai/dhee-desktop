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
  characterReferenceImagesFromAttachments,
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

  it('preserves multi-line task bodies', () => {
    const multi = 'line one\nline two';
    const result = prefixAttachmentsToTask(multi, [wfAttachment]);
    expect(result.endsWith('line one\nline two')).toBe(true);
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
});
