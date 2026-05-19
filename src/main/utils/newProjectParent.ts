/**
 * Helper for the `project:create-folder` IPC's new-project branch:
 * make sure the parent workspace folder (e.g. the user's selected
 * `~/dhee-studios`) actually exists on disk BEFORE the canonical
 * containment validator runs `fs.realpath` on it.
 *
 * Why this exists:
 *   - The renderer now defaults the New Project dialog's "Location"
 *     field to `<home>/dhee-studios` so users don't have to click
 *     "Choose Folder" every time (see renderer/utils/workspacePathDefaults).
 *   - That default folder usually does NOT exist on a fresh install.
 *   - `assertCanonicalProjectContainment` calls `fs.realpath` on the
 *     active project root and throws PROJECT_ROOT_NOT_SET when it's
 *     missing, blocking the create flow with a confusing error.
 *   - Owning parent-creation here is safe because the IPC's
 *     `new_project_parent` branch already validates the path is
 *     absolute and the project-name segment is safe.
 *
 * Pure-ish — accepts an injectable `mkdir` for testability. Default
 * binding is `fs.promises.mkdir`.
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface MkdirFn {
  (dir: string, options: { recursive: true }): Promise<string | undefined>;
}

export class NewProjectParentError extends Error {
  constructor(
    public readonly code: 'NOT_ABSOLUTE' | 'EMPTY' | 'MKDIR_FAILED',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NewProjectParentError';
  }
}

/**
 * Ensure `absoluteBase` exists. Idempotent (mkdir recursive). Throws
 * a typed error for any class of failure the IPC handler needs to
 * surface back to the renderer.
 */
export async function ensureNewProjectParentExists(
  absoluteBase: string,
  mkdir: MkdirFn = fs.mkdir as unknown as MkdirFn,
): Promise<void> {
  if (!absoluteBase || !absoluteBase.trim()) {
    throw new NewProjectParentError(
      'EMPTY',
      'Workspace parent path is empty.',
    );
  }
  if (!path.isAbsolute(absoluteBase)) {
    throw new NewProjectParentError(
      'NOT_ABSOLUTE',
      `Workspace parent path must be absolute (got "${absoluteBase}").`,
    );
  }
  try {
    await mkdir(absoluteBase, { recursive: true });
  } catch (error) {
    throw new NewProjectParentError(
      'MKDIR_FAILED',
      `Failed to create workspace parent "${absoluteBase}": ${(error as Error).message}`,
      error,
    );
  }
}
