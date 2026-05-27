import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildAttachmentPickerDialogOptions,
  buildSelectAttachmentResponse,
  createPickedAttachments,
} from './attachmentPicker';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dhee-attachment-picker-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('attachmentPicker', () => {
  it('uses multiSelections when multiple is requested', () => {
    const options = buildAttachmentPickerDialogOptions({
      kinds: ['reference_image'],
      title: 'Select Reference Images',
      multiple: true,
    });

    expect(options.properties).toEqual(['openFile', 'multiSelections']);
    expect(options.title).toBe('Select Reference Images');
  });

  it('keeps the single-file dialog behavior when multiple is omitted', () => {
    const options = buildAttachmentPickerDialogOptions({
      kinds: ['comfy_workflow'],
    });

    expect(options.properties).toEqual(['openFile']);
  });

  it('builds one reference attachment per selected image', async () => {
    const pngPath = join(tempDir, 'hero.png');
    const jpgPath = join(tempDir, 'field.jpg');
    writeFileSync(pngPath, 'png');
    writeFileSync(jpgPath, 'jpg');

    const attachments = await createPickedAttachments(
      [pngPath, jpgPath],
      ['reference_image'],
    );

    expect(attachments).toEqual([
      expect.objectContaining({
        kind: 'reference_image',
        path: pngPath,
        name: 'hero.png',
        mimeType: 'image/png',
        size: 3,
        meta: expect.objectContaining({
          referenceRole: 'auto',
          purpose: 'reference_general',
        }),
      }),
      expect.objectContaining({
        kind: 'reference_image',
        path: jpgPath,
        name: 'field.jpg',
        mimeType: 'image/jpeg',
        size: 3,
      }),
    ]);
    expect(attachments[0].id).not.toBe(attachments[1].id);
  });

  it('keeps attachment for single-selection callers and adds attachments for multi-select callers', () => {
    const attachment = {
      id: 'att_wf',
      kind: 'comfy_workflow' as const,
      path: '/tmp/workflow.json',
      name: 'workflow.json',
    };

    expect(buildSelectAttachmentResponse([attachment], false)).toEqual({
      ok: true,
      attachment,
    });
    expect(buildSelectAttachmentResponse([attachment], true)).toEqual({
      ok: true,
      attachment,
      attachments: [attachment],
    });
  });
});
