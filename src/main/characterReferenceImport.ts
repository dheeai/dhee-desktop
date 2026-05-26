import fs from 'fs/promises';
import path from 'path';
import type {
  Attachment,
  CharacterReferenceAttachmentMeta,
  CharacterReferenceImagePayload,
} from '../shared/attachmentTypes';
import {
  characterReferenceImagesFromAttachments,
  KIND_EXTENSIONS,
} from '../shared/attachmentTypes';

const CHARACTER_UPLOAD_DIR = 'assets/uploads/characters';

interface ProjectInputLike {
  id: string;
  source: {
    type: 'local_path';
    value: string;
    originalValue?: string;
  };
  mediaType: 'image';
  purpose: 'character_ref';
  metadata: {
    originalFilename: string;
    mimeType?: string;
    fileSize?: number;
    addedAt: number;
    processedAt: number;
  };
  processing: {
    status: 'completed';
    localPath: string;
  };
  notes: string;
}

function mimeTypeForFilename(filename: string): string | undefined {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return undefined;
}

function sanitizeFilename(filename: string): string {
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || `character-ref-${Date.now()}.png`;
}

function isAllowedCharacterReference(filename: string): boolean {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return KIND_EXTENSIONS.character_ref.includes(ext);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function uniqueFilename(directory: string, filename: string): Promise<string> {
  const safe = sanitizeFilename(filename);
  const ext = path.extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  let candidate = safe;
  let counter = 2;

  while (await pathExists(path.join(directory, candidate))) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
  }

  return candidate;
}

export async function importCharacterReferenceAttachments(args: {
  projectDir: string;
  attachments: Attachment[];
}): Promise<Attachment[]> {
  const projectDir = path.resolve(args.projectDir);
  const targetDir = path.join(projectDir, CHARACTER_UPLOAD_DIR);
  await fs.mkdir(targetDir, { recursive: true });

  const imported: Attachment[] = [];
  for (const attachment of args.attachments) {
    if (attachment.kind !== 'character_ref') {
      imported.push(attachment);
      continue;
    }

    const existingMeta = attachment.meta as Partial<CharacterReferenceAttachmentMeta> | undefined;
    if (existingMeta?.projectRelativePath) {
      imported.push(attachment);
      continue;
    }

    const sourcePath = path.resolve(attachment.path);
    const originalFilename = attachment.name || path.basename(sourcePath);
    if (!isAllowedCharacterReference(originalFilename)) {
      throw new Error(`Unsupported character reference image type: ${originalFilename}`);
    }

    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error(`Character reference image is not a file: ${sourcePath}`);
    }

    const finalName = await uniqueFilename(targetDir, originalFilename);
    const destination = path.join(targetDir, finalName);
    await fs.copyFile(sourcePath, destination);

    const relativePath = `${CHARACTER_UPLOAD_DIR}/${finalName}`;
    const meta: CharacterReferenceAttachmentMeta = {
      purpose: 'character_ref',
      projectRelativePath: relativePath,
      originalPath: sourcePath,
      originalFilename,
      mimeType: attachment.mimeType ?? mimeTypeForFilename(finalName),
      size: stat.size,
    };

    imported.push({
      ...attachment,
      kind: 'character_ref',
      path: destination,
      name: finalName,
      mimeType: meta.mimeType,
      size: stat.size,
      meta,
    });
  }

  return imported;
}

function buildProjectInput(
  image: CharacterReferenceImagePayload,
  now: number,
  index: number,
): ProjectInputLike {
  return {
    id: `character-ref-${now}-${index + 1}`,
    source: {
      type: 'local_path',
      value: image.relativePath,
      ...(image.sourcePath ? { originalValue: image.sourcePath } : {}),
    },
    mediaType: 'image',
    purpose: 'character_ref',
    metadata: {
      originalFilename: image.originalFilename ?? image.name,
      ...(image.mimeType ? { mimeType: image.mimeType } : {}),
      ...(image.size !== undefined ? { fileSize: image.size } : {}),
      addedAt: now,
      processedAt: now,
    },
    processing: {
      status: 'completed',
      localPath: image.relativePath,
    },
    notes: 'Uploaded from the desktop chat.',
  };
}

export async function addCharacterReferenceInputsToProject(args: {
  projectDir: string;
  attachments: Attachment[];
  now?: number;
}): Promise<ProjectInputLike[]> {
  const images = characterReferenceImagesFromAttachments(args.attachments);
  if (images.length === 0) return [];

  const projectJsonPath = path.join(args.projectDir, 'project.json');
  const raw = await fs.readFile(projectJsonPath, 'utf-8');
  const project = JSON.parse(raw) as {
    inputs?: Array<{
      source?: { value?: string };
      processing?: { localPath?: string };
    }>;
    updatedAt?: number;
  };
  const existingInputs = Array.isArray(project.inputs) ? project.inputs : [];
  const existingPaths = new Set(
    existingInputs
      .map((input) => input.processing?.localPath ?? input.source?.value)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => value.replace(/\\/g, '/')),
  );

  const uniqueImages = images.filter((image) => !existingPaths.has(image.relativePath));
  if (uniqueImages.length === 0) return [];

  const now = args.now ?? Date.now();
  const added = uniqueImages.map((image, index) => buildProjectInput(image, now, index));
  project.inputs = [...existingInputs, ...added];
  project.updatedAt = now;
  await fs.writeFile(projectJsonPath, JSON.stringify(project, null, 2));
  return added;
}
