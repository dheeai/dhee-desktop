import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { ReferenceImagePayload } from '../shared/attachmentTypes';
import type { HistoryAttachmentPreview } from '../shared/dheeIpc';
import {
  projectSessionsDirFromDir,
  writeProjectSessionMeta,
} from './projectSessionSlug';

function messageRecord(
  role: 'user' | 'assistant',
  content: string,
  timestamp: number,
  attachments: HistoryAttachmentPreview[] = [],
): string {
  return JSON.stringify({
    type: 'message',
    id: `initial-${role}-${timestamp}-${randomUUID()}`,
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role,
      content,
      timestamp,
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  });
}

function attachmentPreviewsFromReferenceImages(
  images: ReferenceImagePayload[] | undefined,
): HistoryAttachmentPreview[] {
  return (images ?? []).map((image, index) => ({
    id: `initial-reference-${index}-${image.name}`,
    kind: 'reference_image',
    name: image.name,
    path: image.relativePath,
    ...(image.mimeType ? { mimeType: image.mimeType } : {}),
    ...(image.referenceRole ? { role: image.referenceRole } : {}),
    ...(image.purpose ? { purpose: image.purpose } : {}),
    ...(image.replacementCharacterId
      ? { replacementTargetId: image.replacementCharacterId }
      : {}),
    ...(image.replacementCharacterName
      ? { replacementTargetName: image.replacementCharacterName }
      : {}),
  }));
}

export async function seedInitialProjectChatHistory(params: {
  userDataDir: string;
  projectDir: string;
  story: unknown;
  bundleId: string;
  referenceImages?: ReferenceImagePayload[];
}): Promise<void> {
  const story = typeof params.story === 'string' ? params.story.trim() : '';
  if (!story) return;

  const sessionsDir = projectSessionsDirFromDir(
    params.userDataDir,
    params.projectDir,
  );
  await fs.mkdir(sessionsDir, { recursive: true });
  writeProjectSessionMeta(sessionsDir, params.projectDir);
  const now = Date.now();
  const sessionFile = path.join(
    sessionsDir,
    `initial-${now}-${randomUUID()}.jsonl`,
  );
  const receipt =
    `Project created with ${params.bundleId}. ` +
    'Ready to continue generation from this story.';
  const attachments = attachmentPreviewsFromReferenceImages(
    params.referenceImages,
  );
  await fs.writeFile(
    sessionFile,
    [
      messageRecord('user', story, now, attachments),
      messageRecord('assistant', receipt, now + 1),
    ].join('\n') + '\n',
    'utf8',
  );
}
