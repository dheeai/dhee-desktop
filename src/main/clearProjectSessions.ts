/**
 * Pure helper for clearChatHistory's on-disk cleanup.
 *
 * Given a userData directory and a projectDir, deletes the JSONL files
 * under `<userData>/pi-sessions/<projectSlug>/`. Returns the count +
 * list of files deleted (relative to the slug dir).
 *
 * Tested in isolation — the dheeCoreManager wrapper just passes
 * `app.getPath('userData')` and the focused projectDir.
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface ClearProjectSessionsResult {
  deleted: number;
  files: string[];
}

/**
 * Project slug uses the same scheme as getSessionHistorySnapshot:
 *   basename(projectDir).replace(/[^A-Za-z0-9_\-]+/g, '_')
 * Keep this in sync — if these diverge, clearChatHistory deletes a
 * different directory than the one getSessionHistorySnapshot reads.
 */
export function projectSlugFromDir(projectDir: string): string {
  return basename(projectDir).replace(/[^A-Za-z0-9_\-]+/g, '_');
}

export function clearProjectSessions(
  userDataDir: string,
  projectDir: string,
): ClearProjectSessionsResult {
  if (!userDataDir || !projectDir) return { deleted: 0, files: [] };
  const slug = projectSlugFromDir(projectDir);
  const slugDir = join(userDataDir, 'pi-sessions', slug);
  if (!existsSync(slugDir)) return { deleted: 0, files: [] };
  let entries: string[];
  try {
    entries = readdirSync(slugDir);
  } catch {
    return { deleted: 0, files: [] };
  }
  const deleted: string[] = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = join(slugDir, name);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      unlinkSync(full);
      deleted.push(name);
    } catch {
      // best-effort; skip unreadable / locked files.
    }
  }
  return { deleted: deleted.length, files: deleted };
}
