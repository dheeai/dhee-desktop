/**
 * Generic file attachment system for the pi-agent chat.
 *
 * v1 implemented only `comfy_workflow` - the JSON file the user
 * uploads to add a custom ComfyUI workflow. `reference_image` is the
 * generic image-reference path used by the video graph's character_image
 * and setting_image nodes. `character_ref` remains accepted for
 * compatibility with older callers.
 *
 * The renderer collects attachments locally; the IPC bridge
 * forwards them as a structured array on `RunTaskRequest`. The
 * main process decides how to surface them to pi-agent (currently:
 * prepended as a textual hint to the task message; pi-agent's
 * skill prompts know how to read these markers and call the
 * appropriate tool).
 */

export type AttachmentKind =
  | 'comfy_workflow'
  | 'reference_image'
  | 'character_ref'
  | 'text'
  | 'image'
  | 'video'
  | 'audio';

export type ReferenceImageRole = 'auto' | 'character' | 'setting';
export type ReferenceImagePurpose =
  | 'character_ref'
  | 'setting_ref'
  | 'reference_general';

export interface ReferenceImageReplacementTarget {
  id: string;
  name: string;
}

export interface CharacterReferenceAttachmentMeta {
  purpose: 'character_ref';
  referenceRole?: 'character';
  /** Project-relative durable path, e.g. assets/uploads/characters/hero.png. */
  projectRelativePath: string;
  /** Absolute path selected by the user before the desktop copied it. */
  originalPath?: string;
  /** User-selected filename before sanitization/collision handling. */
  originalFilename?: string;
  mimeType?: string;
  size?: number;
  /** Existing project character this uploaded image should replace. */
  replacementCharacterId?: string;
  replacementCharacterName?: string;
}

export interface ReferenceImageAttachmentMeta {
  purpose: ReferenceImagePurpose;
  referenceRole: ReferenceImageRole;
  /** Project-relative durable path, e.g. assets/uploads/settings/field.png. */
  projectRelativePath: string;
  /** Absolute path selected by the user before the desktop copied it. */
  originalPath?: string;
  /** User-selected filename before sanitization/collision handling. */
  originalFilename?: string;
  mimeType?: string;
  size?: number;
  /** Existing project character this uploaded image should replace. */
  replacementCharacterId?: string;
  replacementCharacterName?: string;
}

export interface Attachment {
  /**
   * Client-generated identifier (e.g. `att_${Date.now()}_${counter}`).
   * Lets the UI key chips and reference attachments across renders
   * without depending on file paths (which can collide).
   */
  id: string;
  kind: AttachmentKind;
  /** Absolute path to the file on the user's filesystem. */
  path: string;
  /** Display name (typically `basename(path)`). */
  name: string;
  /** Optional MIME type when known. */
  mimeType?: string;
  /** File size in bytes. Used for size-cap UI hints, not enforcement. */
  size?: number;
  /** Kind-specific metadata. */
  meta?:
    | Record<string, unknown>
    | CharacterReferenceAttachmentMeta
    | ReferenceImageAttachmentMeta;
}

/**
 * What `selectAttachment(kinds)` accepts. The IPC handler resolves
 * these to file dialog filters.
 */
export interface SelectAttachmentRequest {
  /**
   * Which kinds the user is allowed to pick. The dialog filter is
   * the union of extensions for the requested kinds. v1 callers pass
   * `['comfy_workflow']`.
   */
  kinds: AttachmentKind[];
  /**
   * Optional dialog title shown to the user.
   */
  title?: string;
  /**
   * Allow selecting several files in one picker action. Existing callers
   * omit this and keep the original single-file behavior.
   */
  multiple?: boolean;
}

export interface SelectAttachmentResponse {
  /** False when the user cancelled the dialog. */
  ok: boolean;
  /** First selected attachment, kept for single-file caller compatibility. */
  attachment?: Attachment;
  /** All selected attachments when the picker was opened in multi-select mode. */
  attachments?: Attachment[];
  error?: string;
}

export interface ImportReferenceImagesRequest {
  projectDir: string;
  attachments: Attachment[];
}

export interface ImportReferenceImagesResponse {
  ok: boolean;
  attachments?: Attachment[];
  error?: string;
}

export function attachmentsFromSelectResponse(
  response: Pick<SelectAttachmentResponse, 'attachment' | 'attachments'>,
): Attachment[] {
  if (response.attachments && response.attachments.length > 0) {
    return response.attachments;
  }
  return response.attachment ? [response.attachment] : [];
}

/**
 * Map an AttachmentKind to a list of accepted file extensions
 * (without the leading dot). Kept here so both the main-process
 * dialog filter and the renderer's drag-drop validator agree.
 */
export const KIND_EXTENSIONS: Record<AttachmentKind, string[]> = {
  comfy_workflow: ['json'],
  reference_image: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  character_ref: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  text: ['txt', 'md'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
};

export const KIND_DISPLAY_LABEL: Record<AttachmentKind, string> = {
  comfy_workflow: 'ComfyUI Workflow',
  reference_image: 'Reference Image',
  character_ref: 'Character Reference',
  text: 'Text File',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
};

/**
 * Render a textual hint pi-agent's skill prompts can recognize. The
 * format is intentionally machine-friendly (one line per attachment,
 * fixed prefix) so the skill can extract paths reliably without an
 * LLM parse step.
 *
 * Example:
 *   [attachment kind=comfy_workflow path="/Users/x/wf.json" name="wf.json"]
 */
export function renderAttachmentHint(attachment: Attachment): string {
  // Escape double-quotes in path/name so the line is parseable. Paths
  // with `"` are rare but possible on macOS.
  const esc = (s: string) => s.replace(/"/g, '\\"');
  return `[attachment kind=${attachment.kind} path="${esc(attachment.path)}" name="${esc(attachment.name)}"]`;
}

/**
 * Prepend attachment hints to the user's task message. Empty input or
 * empty attachment array → return unchanged.
 */
export function prefixAttachmentsToTask(
  task: string,
  attachments: Attachment[] | undefined,
): string {
  const hintAttachments = (attachments ?? []).filter(
    (attachment) => !isReferenceImageLikeAttachment(attachment),
  );
  if (hintAttachments.length === 0) return task;
  const hints = hintAttachments.map(renderAttachmentHint).join('\n');
  return `${hints}\n\n${task}`;
}

export interface CharacterReferenceImagePayload {
  name: string;
  relativePath: string;
  sourcePath?: string;
  originalFilename?: string;
  mimeType?: string;
  size?: number;
  replacementCharacterId?: string;
  replacementCharacterName?: string;
}

export interface ReferenceImagePayload {
  name: string;
  relativePath: string;
  purpose: ReferenceImagePurpose;
  referenceRole: ReferenceImageRole;
  sourcePath?: string;
  originalFilename?: string;
  mimeType?: string;
  size?: number;
  replacementCharacterId?: string;
  replacementCharacterName?: string;
}

export function isReferenceImageKind(kind: AttachmentKind): boolean {
  return kind === 'reference_image' || kind === 'character_ref';
}

export function isReferenceImageLikeAttachment(
  attachment: Attachment,
): boolean {
  return isReferenceImageKind(attachment.kind);
}

export function purposeForReferenceRole(
  role: ReferenceImageRole,
): ReferenceImagePurpose {
  if (role === 'character') return 'character_ref';
  if (role === 'setting') return 'setting_ref';
  return 'reference_general';
}

export function roleForReferencePurpose(
  purpose: ReferenceImagePurpose | undefined,
): ReferenceImageRole {
  if (purpose === 'character_ref') return 'character';
  if (purpose === 'setting_ref') return 'setting';
  return 'auto';
}

function isReferenceImagePurpose(value: unknown): value is ReferenceImagePurpose {
  return (
    value === 'character_ref' ||
    value === 'setting_ref' ||
    value === 'reference_general'
  );
}

function isReferenceImageRole(value: unknown): value is ReferenceImageRole {
  return value === 'auto' || value === 'character' || value === 'setting';
}

export function getReferenceImageRole(
  attachment: Attachment,
): ReferenceImageRole {
  const meta = attachment.meta as
    | Partial<ReferenceImageAttachmentMeta>
    | Partial<CharacterReferenceAttachmentMeta>
    | undefined;
  if (isReferenceImageRole(meta?.referenceRole)) return meta.referenceRole;
  if (attachment.kind === 'character_ref') return 'character';
  if (isReferenceImagePurpose(meta?.purpose)) {
    return roleForReferencePurpose(meta.purpose);
  }
  return 'auto';
}

export function withReferenceImageRole(
  attachment: Attachment,
  referenceRole: ReferenceImageRole,
): Attachment {
  if (!isReferenceImageLikeAttachment(attachment)) return attachment;
  const existingMeta = attachment.meta as Record<string, unknown> | undefined;
  return {
    ...attachment,
    kind: attachment.kind === 'character_ref' ? 'character_ref' : 'reference_image',
    meta: {
      ...(existingMeta ?? {}),
      referenceRole,
      purpose: purposeForReferenceRole(referenceRole),
    },
  };
}

export function getReferenceImageReplacementTarget(
  attachment: Attachment,
): ReferenceImageReplacementTarget | null {
  if (!isReferenceImageLikeAttachment(attachment)) return null;
  const meta = attachment.meta as Record<string, unknown> | undefined;
  const id = meta?.replacementCharacterId;
  const name = meta?.replacementCharacterName;
  if (typeof id !== 'string' || id.trim().length === 0) return null;
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { id, name: id };
  }
  return { id, name };
}

export function withReferenceImageReplacementTarget(
  attachment: Attachment,
  target: ReferenceImageReplacementTarget | null,
): Attachment {
  if (!isReferenceImageLikeAttachment(attachment)) return attachment;
  const existingMeta = attachment.meta as Record<string, unknown> | undefined;
  const meta = { ...(existingMeta ?? {}) };
  delete meta.replacementCharacterId;
  delete meta.replacementCharacterName;
  if (target) {
    meta.replacementCharacterId = target.id;
    meta.replacementCharacterName = target.name;
  }
  return {
    ...attachment,
    meta,
  };
}

export function referenceImagesFromAttachments(
  attachments: Attachment[] | undefined,
): ReferenceImagePayload[] {
  return (attachments ?? [])
    .filter(isReferenceImageLikeAttachment)
    .flatMap((attachment) => {
      const meta = attachment.meta as
        | Partial<ReferenceImageAttachmentMeta>
        | Partial<CharacterReferenceAttachmentMeta>
        | undefined;
      if (
        typeof meta?.projectRelativePath !== 'string' ||
        meta.projectRelativePath.length === 0
      ) {
        return [];
      }
      const purpose = isReferenceImagePurpose(meta.purpose)
        ? meta.purpose
        : purposeForReferenceRole(getReferenceImageRole(attachment));
      const referenceRole = isReferenceImageRole(meta.referenceRole)
        ? meta.referenceRole
        : roleForReferencePurpose(purpose);
      return [{
        name: attachment.name,
        relativePath: meta.projectRelativePath,
        purpose,
        referenceRole,
        sourcePath: meta.originalPath ?? attachment.path,
        originalFilename: meta.originalFilename ?? attachment.name,
        mimeType: attachment.mimeType ?? meta.mimeType,
        size: attachment.size ?? meta.size,
        replacementCharacterId:
          typeof meta.replacementCharacterId === 'string'
            ? meta.replacementCharacterId
            : undefined,
        replacementCharacterName:
          typeof meta.replacementCharacterName === 'string'
            ? meta.replacementCharacterName
            : undefined,
      }];
    });
}

export function isCharacterReferenceAttachment(
  attachment: Attachment,
): attachment is Attachment & { meta: CharacterReferenceAttachmentMeta } {
  if (!isReferenceImageLikeAttachment(attachment)) return false;
  const meta = attachment.meta as
    | Partial<CharacterReferenceAttachmentMeta>
    | undefined;
  return (
    typeof meta?.projectRelativePath === 'string' &&
    meta.projectRelativePath.length > 0 &&
    (meta.purpose === undefined || meta.purpose === 'character_ref')
  );
}

export function characterReferenceImagesFromAttachments(
  attachments: Attachment[] | undefined,
): CharacterReferenceImagePayload[] {
  return referenceImagesFromAttachments(attachments)
    .filter((image) => image.purpose === 'character_ref')
    .map((image) => ({
      name: image.name,
      relativePath: image.relativePath,
      sourcePath: image.sourcePath,
      originalFilename: image.originalFilename,
      mimeType: image.mimeType,
      size: image.size,
      replacementCharacterId: image.replacementCharacterId,
      replacementCharacterName: image.replacementCharacterName,
    }));
}

function sectionForPurpose(purpose: ReferenceImagePurpose): string {
  if (purpose === 'character_ref') return 'Attached character reference images:';
  if (purpose === 'setting_ref') return 'Attached setting reference images:';
  return 'Attached reference images:';
}

export function appendReferenceImagesToTask(
  task: string,
  images: ReferenceImagePayload[],
): string {
  if (images.length === 0) return task;

  const sections: string[] = [];
  const orderedPurposes: ReferenceImagePurpose[] = [
    'character_ref',
    'setting_ref',
    'reference_general',
  ];
  for (const purpose of orderedPurposes) {
    const purposeImages = images.filter((image) => image.purpose === purpose);
    if (purposeImages.length === 0) continue;
    sections.push([
      sectionForPurpose(purpose),
      ...purposeImages.map((image) => `- ${image.name}: ${image.relativePath}`),
    ].join('\n'));
  }

  const trimmedTask = task.trimEnd();
  return `${trimmedTask}${trimmedTask ? '\n\n' : ''}${sections.join('\n\n')}`;
}

export function appendCharacterReferenceImagesToTask(
  task: string,
  images: CharacterReferenceImagePayload[],
): string {
  return appendReferenceImagesToTask(
    task,
    images.map((image) => ({
      name: image.name,
      relativePath: image.relativePath,
      purpose: 'character_ref',
      referenceRole: 'character',
      sourcePath: image.sourcePath,
      originalFilename: image.originalFilename,
      mimeType: image.mimeType,
      size: image.size,
      replacementCharacterId: image.replacementCharacterId,
      replacementCharacterName: image.replacementCharacterName,
    })),
  );
}
