/**
 * Workspace-path defaults + persistence for the New Project dialog.
 *
 * Two responsibilities:
 *   1. Decide what folder the dialog's "Location" field should show
 *      when the user opens it (default behavior — they shouldn't have
 *      to click "Choose Folder" every single time).
 *   2. Persist whatever they pick across desktop launches so the next
 *      open offers the same folder again.
 *
 * Pure module — no DOM, no Electron. Storage is injected (the dialog
 * passes `window.localStorage`), so this file is fully unit-testable
 * against an in-memory `Storage` stub.
 */

export const WORKSPACE_PATH_STORAGE_KEY = 'kshana.workspacePath';
export const DEFAULT_WORKSPACE_FOLDER_NAME = 'dhee-studios';

/**
 * Normalize a filesystem path to forward-slash form with no trailing
 * separator. Mirrors `NewProjectDialog.normalizePathValue` so paths
 * round-trip cleanly between picker → storage → resolver.
 */
export function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Compute the suggested default workspace folder when the user has
 * NEVER picked one (or the persisted value is unreadable). Returns
 * `<homeDir>/dhee-studios`. If `homeDir` is empty/null, returns a bare
 * `dhee-studios` so the dialog still shows *something* sensible — the
 * subsequent file picker / createFolder call will surface the real
 * failure to the user.
 */
export function buildDefaultWorkspaceFolder(homeDir: string | null | undefined): string {
  const trimmedHome = (homeDir ?? '').trim();
  if (!trimmedHome) return DEFAULT_WORKSPACE_FOLDER_NAME;
  return `${normalizeWorkspacePath(trimmedHome)}/${DEFAULT_WORKSPACE_FOLDER_NAME}`;
}

/**
 * Decide the initial value for the "Location" field given (a) the
 * value last persisted by this user and (b) the platform default.
 * Persisted wins when non-empty. Both inputs are normalized.
 */
export function resolveDefaultWorkspacePath(opts: {
  storedPath: string | null | undefined;
  fallbackDefault: string;
}): string {
  const stored = (opts.storedPath ?? '').trim();
  if (stored) return normalizeWorkspacePath(stored);
  return normalizeWorkspacePath((opts.fallbackDefault ?? '').trim());
}

/**
 * Minimal Storage interface — matches the relevant subset of the DOM
 * `Storage` interface so callers can pass `window.localStorage`
 * directly. Tests inject an in-memory fake.
 */
export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the persisted workspace path. Returns `null` when the key is
 * absent, the value is empty/whitespace, or the storage layer throws
 * (private-browsing, disabled storage). Never throws — the dialog
 * needs to keep working even if persistence is dead.
 */
export function readPersistedWorkspacePath(
  storage: Pick<WorkspaceStorage, 'getItem'>,
): string | null {
  try {
    const raw = storage.getItem(WORKSPACE_PATH_STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return normalizeWorkspacePath(trimmed);
  } catch {
    return null;
  }
}

/**
 * Persist the workspace path. Skips empty/whitespace inputs to avoid
 * polluting storage with garbage. Swallows storage exceptions so a
 * failed write never blocks project creation.
 */
export function writePersistedWorkspacePath(
  storage: Pick<WorkspaceStorage, 'setItem'>,
  path: string,
): void {
  const normalized = normalizeWorkspacePath((path ?? '').trim());
  if (!normalized) return;
  try {
    storage.setItem(WORKSPACE_PATH_STORAGE_KEY, normalized);
  } catch {
    // localStorage disabled or quota exceeded — silent fallback.
  }
}
