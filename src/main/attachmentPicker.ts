import fs from 'fs/promises';
import path from 'path';
import type { OpenDialogOptions } from 'electron';
import {
  KIND_DISPLAY_LABEL,
  KIND_EXTENSIONS,
  type Attachment,
  type AttachmentKind,
  type SelectAttachmentRequest,
  type SelectAttachmentResponse,
} from '../shared/attachmentTypes';

export function buildAttachmentPickerDialogOptions(
  req: SelectAttachmentRequest,
): Pick<OpenDialogOptions, 'properties' | 'title' | 'filters'> {
  const filters = req.kinds.map((kind) => ({
    name: KIND_DISPLAY_LABEL[kind] ?? kind,
    extensions: KIND_EXTENSIONS[kind] ?? ['*'],
  }));
  filters.push({ name: 'All Files', extensions: ['*'] });

  return {
    properties: req.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    title: req.title ?? 'Select an attachment',
    filters,
  };
}

export function inferAttachmentKindForPath(
  filePath: string,
  kinds: AttachmentKind[],
): AttachmentKind {
  if (kinds.length === 0) {
    throw new Error('No attachment kinds specified');
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const pickedKind = kinds.find((kind) =>
    (KIND_EXTENSIONS[kind] ?? []).includes(ext),
  );
  return pickedKind ?? kinds[0]!;
}

function imageMimeTypeForExtension(ext: string): string {
  if (ext === 'jpg') return 'image/jpeg';
  return `image/${ext}`;
}

export async function createPickedAttachment(
  filePath: string,
  kinds: AttachmentKind[],
  index = 0,
): Promise<Attachment> {
  const kind = inferAttachmentKindForPath(filePath, kinds);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  let size: number | undefined;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    size = undefined;
  }

  return {
    id: `att_${Date.now()}_${index}_${Math.floor(Math.random() * 10000).toString(36)}`,
    kind,
    path: filePath,
    name: path.basename(filePath),
    ...(kind === 'character_ref' || kind === 'reference_image'
      ? {
          mimeType: imageMimeTypeForExtension(ext),
          meta: {
            referenceRole: kind === 'character_ref' ? 'character' : 'auto',
            purpose:
              kind === 'character_ref' ? 'character_ref' : 'reference_general',
          },
        }
      : {}),
    size,
  };
}

export async function createPickedAttachments(
  filePaths: string[],
  kinds: AttachmentKind[],
): Promise<Attachment[]> {
  return Promise.all(
    filePaths.map((filePath, index) =>
      createPickedAttachment(filePath, kinds, index),
    ),
  );
}

export function buildSelectAttachmentResponse(
  attachments: Attachment[],
  includeAttachments = false,
): SelectAttachmentResponse {
  if (attachments.length === 0) {
    return { ok: false, error: 'No file selected' };
  }
  return {
    ok: true,
    attachment: attachments[0],
    ...(includeAttachments || attachments.length > 1 ? { attachments } : {}),
  };
}
