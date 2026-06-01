/**
 * Pure helper for clearChatHistory's on-disk cleanup.
 *
 * Given a userData directory and a projectDir, ARCHIVES (not deletes)
 * the JSONL files under `<userData>/pi-sessions/<projectSlug>/` by
 * renaming each `<id>.jsonl` to `<id>.archived.jsonl`. The chat
 * appears empty (the snapshot reader skips `.archived.jsonl`) but
 * nothing is lost — the archives sit on disk for audit / undo /
 * future history-browser features.
 *
 * Matches the preserve-on-overwrite discipline we use for project
 * artifacts: never delete, just stop reading.
 *
 * Tested in isolation — the dheeCoreManager wrapper just passes
 * `app.getPath('userData')` and the focused projectDir.
 */
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface ClearProjectSessionsResult {
  /** Number of JSONL files archived (renamed to .archived.jsonl). */
  archived: number;
  /** Source filenames (relative to slug dir) before archiving. */
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
  if (!userDataDir || !projectDir) return { archived: 0, files: [] };
  const slug = projectSlugFromDir(projectDir);
  const slugDir = join(userDataDir, 'pi-sessions', slug);
  if (!existsSync(slugDir)) return { archived: 0, files: [] };
  let entries: string[];
  try {
    entries = readdirSync(slugDir);
  } catch {
    return { archived: 0, files: [] };
  }
  const archived: string[] = [];
  for (const name of entries) {
    // Only seal LIVE chat JSONLs. Skip files already archived so
    // repeated clears don't double-suffix to `.archived.archived.jsonl`.
    if (!name.endsWith('.jsonl')) continue;
    if (name.endsWith('.archived.jsonl')) continue;
    const full = join(slugDir, name);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      const targetName = name.replace(/\.jsonl$/, '.archived.jsonl');
      renameSync(full, join(slugDir, targetName));
      archived.push(name);
    } catch {
      // best-effort; skip unreadable / locked files.
    }
  }
  return { archived: archived.length, files: archived };
}
