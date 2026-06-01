import fs from 'fs/promises';
import path from 'path';
import type {
  Attachment,
  CharacterReferenceAttachmentMeta,
  ReferenceImageAttachmentMeta,
  ReferenceImagePayload,
  ReferenceImagePurpose,
  ReferenceImageRole,
} from '../shared/attachmentTypes';
import {
  characterReferenceImagesFromAttachments,
  getReferenceImageRole,
  KIND_EXTENSIONS,
  purposeForReferenceRole,
  referenceImagesFromAttachments,
} from '../shared/attachmentTypes';

const CHARACTER_UPLOAD_DIR = 'assets/uploads/characters';
const SETTING_UPLOAD_DIR = 'assets/uploads/settings';
const GENERAL_REFERENCE_UPLOAD_DIR = 'assets/uploads/references';

interface ProjectInputLike {
  id: string;
  source: {
    type: 'local_path';
    value: string;
    originalValue?: string;
  };
  mediaType: 'image';
  purpose: ReferenceImagePurpose;
  metadata: {
    originalFilename: string;
    mimeType?: string;
    fileSize?: number;
    addedAt: number;
    processedAt: number;
    referenceRole?: ReferenceImageRole;
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

function sanitizeFilename(filename: string, fallbackPrefix = 'reference'): string {
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || `${fallbackPrefix}-${Date.now()}.png`;
}

function isAllowedReferenceImage(filename: string): boolean {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return KIND_EXTENSIONS.reference_image.includes(ext);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function uniqueFilename(
  directory: string,
  filename: string,
  fallbackPrefix?: string,
): Promise<string> {
  const safe = sanitizeFilename(filename, fallbackPrefix);
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

function uploadDirForRole(role: ReferenceImageRole): string {
  if (role === 'character') return CHARACTER_UPLOAD_DIR;
  if (role === 'setting') return SETTING_UPLOAD_DIR;
  return GENERAL_REFERENCE_UPLOAD_DIR;
}

function inputIdPrefixForPurpose(purpose: ReferenceImagePurpose): string {
  if (purpose === 'character_ref') return 'character-ref';
  if (purpose === 'setting_ref') return 'setting-ref';
  return 'reference-image';
}

export async function importCharacterReferenceAttachments(args: {
  projectDir: string;
  attachments: Attachment[];
}): Promise<Attachment[]> {
  return importReferenceImageAttachments(args);
}

export async function importReferenceImageAttachments(args: {
  projectDir: string;
  attachments: Attachment[];
}): Promise<Attachment[]> {
  const projectDir = path.resolve(args.projectDir);

  const imported: Attachment[] = [];
  for (const attachment of args.attachments) {
    if (attachment.kind !== 'character_ref' && attachment.kind !== 'reference_image') {
      imported.push(attachment);
      continue;
    }

    const existingMeta = attachment.meta as
      | Partial<CharacterReferenceAttachmentMeta>
      | Partial<ReferenceImageAttachmentMeta>
      | undefined;
    if (existingMeta?.projectRelativePath) {
      imported.push(attachment);
      continue;
    }

    const referenceRole = getReferenceImageRole(attachment);
    const purpose = purposeForReferenceRole(referenceRole);
    const uploadDir = uploadDirForRole(referenceRole);
    const targetDir = path.join(projectDir, uploadDir);
    await fs.mkdir(targetDir, { recursive: true });

    const sourcePath = path.resolve(attachment.path);
    const originalFilename = attachment.name || path.basename(sourcePath);
    if (!isAllowedReferenceImage(originalFilename)) {
      throw new Error(`Unsupported reference image type: ${originalFilename}`);
    }

    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error(`Reference image is not a file: ${sourcePath}`);
    }

    const finalName = await uniqueFilename(targetDir, originalFilename, `${referenceRole}-ref`);
    const destination = path.join(targetDir, finalName);
    await fs.copyFile(sourcePath, destination);

    const relativePath = `${uploadDir}/${finalName}`;
    const meta: ReferenceImageAttachmentMeta = {
      purpose,
      referenceRole,
      projectRelativePath: relativePath,
      originalPath: sourcePath,
      originalFilename,
      mimeType: attachment.mimeType ?? mimeTypeForFilename(finalName),
      size: stat.size,
      ...(typeof existingMeta?.replacementCharacterId === 'string'
        ? { replacementCharacterId: existingMeta.replacementCharacterId }
        : {}),
      ...(typeof existingMeta?.replacementCharacterName === 'string'
        ? { replacementCharacterName: existingMeta.replacementCharacterName }
        : {}),
    };

    imported.push({
      ...attachment,
      kind: attachment.kind === 'character_ref' ? 'character_ref' : 'reference_image',
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
  image: ReferenceImagePayload,
  now: number,
  index: number,
): ProjectInputLike {
  return {
    id: `${inputIdPrefixForPurpose(image.purpose)}-${now}-${index + 1}`,
    source: {
      type: 'local_path',
      value: image.relativePath,
      ...(image.sourcePath ? { originalValue: image.sourcePath } : {}),
    },
    mediaType: 'image',
    purpose: image.purpose,
    metadata: {
      originalFilename: image.originalFilename ?? image.name,
      ...(image.mimeType ? { mimeType: image.mimeType } : {}),
      ...(image.size !== undefined ? { fileSize: image.size } : {}),
      addedAt: now,
      processedAt: now,
      referenceRole: image.referenceRole,
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
  const images = characterReferenceImagesFromAttachments(args.attachments)
    .map((image): ReferenceImagePayload => ({
      ...image,
      purpose: 'character_ref',
      referenceRole: 'character',
    }));
  return addReferenceImageInputsToProject({
    ...args,
    images,
  });
}

export async function addReferenceImageInputsToProject(args: {
  projectDir: string;
  attachments?: Attachment[];
  images?: ReferenceImagePayload[];
  now?: number;
}): Promise<ProjectInputLike[]> {
  const images = args.images ?? referenceImagesFromAttachments(args.attachments);
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
