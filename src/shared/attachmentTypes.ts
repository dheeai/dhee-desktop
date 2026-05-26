/**
 * Generic file attachment system for the pi-agent chat.
 *
 * v1 implemented only `comfy_workflow` — the JSON file the user
 * uploads to add a custom ComfyUI workflow. `character_ref` is the
 * image-reference path used by the video graph's character_image nodes.
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
  | 'character_ref'
  | 'text'
  | 'image'
  | 'video'
  | 'audio';

export interface CharacterReferenceAttachmentMeta {
  purpose: 'character_ref';
  /** Project-relative durable path, e.g. assets/uploads/characters/hero.png. */
  projectRelativePath: string;
  /** Absolute path selected by the user before the desktop copied it. */
  originalPath?: string;
  /** User-selected filename before sanitization/collision handling. */
  originalFilename?: string;
  mimeType?: string;
  size?: number;
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
  meta?: Record<string, unknown> | CharacterReferenceAttachmentMeta;
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
}

export interface SelectAttachmentResponse {
  /** False when the user cancelled the dialog. */
  ok: boolean;
  attachment?: Attachment;
  error?: string;
}

/**
 * Map an AttachmentKind to a list of accepted file extensions
 * (without the leading dot). Kept here so both the main-process
 * dialog filter and the renderer's drag-drop validator agree.
 */
export const KIND_EXTENSIONS: Record<AttachmentKind, string[]> = {
  comfy_workflow: ['json'],
  character_ref: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  text: ['txt', 'md'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
};

export const KIND_DISPLAY_LABEL: Record<AttachmentKind, string> = {
  comfy_workflow: 'ComfyUI Workflow',
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
    (attachment) => attachment.kind !== 'character_ref',
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
}

export function isCharacterReferenceAttachment(
  attachment: Attachment,
): attachment is Attachment & { meta: CharacterReferenceAttachmentMeta } {
  if (attachment.kind !== 'character_ref') return false;
  const meta = attachment.meta as
    | Partial<CharacterReferenceAttachmentMeta>
    | undefined;
  return (
    typeof meta?.projectRelativePath === 'string' &&
    meta.projectRelativePath.length > 0
  );
}

export function characterReferenceImagesFromAttachments(
  attachments: Attachment[] | undefined,
): CharacterReferenceImagePayload[] {
  return (attachments ?? [])
    .filter(isCharacterReferenceAttachment)
    .map((attachment) => ({
      name: attachment.name,
      relativePath: attachment.meta.projectRelativePath,
      sourcePath: attachment.meta.originalPath ?? attachment.path,
      originalFilename: attachment.meta.originalFilename ?? attachment.name,
      mimeType: attachment.mimeType ?? attachment.meta.mimeType,
      size: attachment.size ?? attachment.meta.size,
    }));
}

export function appendCharacterReferenceImagesToTask(
  task: string,
  images: CharacterReferenceImagePayload[],
): string {
  if (images.length === 0) return task;
  const lines = [
    'Attached character reference images:',
    ...images.map((image) => `- ${image.name}: ${image.relativePath}`),
  ];
  const trimmedTask = task.trimEnd();
  return `${trimmedTask}${trimmedTask ? '\n\n' : ''}${lines.join('\n')}`;
}
