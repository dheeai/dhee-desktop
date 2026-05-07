/**
 * Persist a Prompts-tab edit and invalidate the dependent executor
 * node(s). The single user-visible save button lands here.
 *
 * Three-step contract, in order:
 *   1. Read the existing prompt JSON.
 *   2. Mutate the right field per `kind`, write back atomically.
 *   3. Invalidate the dependent node(s) so the next pipeline run
 *      regenerates from there.
 *
 * Rollback: if step 3 fails, step 2's write is reverted to keep the
 * project consistent (file edited but executor still 'completed' would
 * silently use stale text on the next run).
 */

export type PromptKind = 'first_frame' | 'last_frame' | 'motion' | 'negative';

export interface SavePromptEditFs {
  readFile(filePath: string): Promise<string | null>;
  writeFile(filePath: string, content: string): Promise<void>;
}

export interface InvalidateNodesResult {
  ok: boolean;
  invalidated?: string[];
  notFound?: string[];
  error?: string;
}

export interface SavePromptEditOptions {
  kind: PromptKind;
  scene: number;
  shot: number;
  newText: string;
  /** Absolute path to the JSON file holding this prompt. */
  filePath: string;
  /**
   * True when the project's executor graph has a separate
   * `shot_image_last_frame:scene_N_shot_M` node for this shot. Without
   * the split, last-frame and negative-prompt edits fall back to
   * `shot_image:scene_N_shot_M` (which regens both frames).
   */
  hasLastFrameNode: boolean;
  fs: SavePromptEditFs;
  invalidateNodes(nodeIds: string[]): Promise<InvalidateNodesResult>;
}

export interface SavePromptEditResult {
  ok: boolean;
  invalidated?: string[];
  error?: string;
}

function nodeIdsFor(opts: {
  kind: PromptKind;
  scene: number;
  shot: number;
  hasLastFrameNode: boolean;
}): string[] {
  const sId = `scene_${opts.scene}_shot_${opts.shot}`;
  switch (opts.kind) {
    case 'first_frame':
      return [`shot_image:${sId}`];
    case 'last_frame':
      return [
        opts.hasLastFrameNode
          ? `shot_image_last_frame:${sId}`
          : `shot_image:${sId}`,
      ];
    case 'motion':
      return [`shot_video:${sId}`];
    case 'negative':
      return opts.hasLastFrameNode
        ? [`shot_image:${sId}`, `shot_image_last_frame:${sId}`]
        : [`shot_image:${sId}`];
  }
}

function applyMutation(
  parsed: Record<string, unknown>,
  kind: PromptKind,
  newText: string,
): void {
  if (kind === 'first_frame' || kind === 'last_frame') {
    const frames =
      (parsed.frames as Record<string, Record<string, unknown>> | undefined) ??
      {};
    const frame = frames[kind] ?? {};
    frame.imagePrompt = newText;
    frames[kind] = frame;
    parsed.frames = frames;
    return;
  }
  if (kind === 'motion') {
    parsed.motionDirective = newText;
    return;
  }
  // negative
  parsed.negativePrompt = newText;
}

export async function savePromptEdit(
  opts: SavePromptEditOptions,
): Promise<SavePromptEditResult> {
  const original = await opts.fs.readFile(opts.filePath);
  if (original === null) {
    return { ok: false, error: `Could not read ${opts.filePath}` };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(original) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON in ${opts.filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  applyMutation(parsed, opts.kind, opts.newText);
  const newContent = JSON.stringify(parsed, null, 2);

  try {
    await opts.fs.writeFile(opts.filePath, newContent);
  } catch (err) {
    return {
      ok: false,
      error: `Could not write ${opts.filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const nodeIds = nodeIdsFor(opts);
  const invalidate = await opts.invalidateNodes(nodeIds);
  if (!invalidate.ok) {
    // Rollback: restore the original file so disk and executor stay in sync.
    try {
      await opts.fs.writeFile(opts.filePath, original);
    } catch {
      /* best-effort — disk is already in a degraded state, surface the
         original error instead of obscuring it with a rollback failure */
    }
    return {
      ok: false,
      error: invalidate.error ?? 'Could not invalidate dependent nodes',
    };
  }

  return {
    ok: true,
    invalidated: invalidate.invalidated ?? nodeIds,
  };
}
