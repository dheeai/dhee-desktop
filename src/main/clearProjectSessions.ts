/**
 * Pure helper for clearChatHistory's on-disk cleanup.
 *
 * Given a userData directory and a projectDir, ARCHIVES (not deletes)
 * the JSONL files under `<userData>/pi-sessions/<projectSlug>/` by
 * renaming each `<id>.jsonl` to `<id>.archived` (NO `.jsonl` suffix).
 *
 * Why no `.jsonl`? pi-coding-agent's `SessionManager.continueRecent`
 * scans the directory for `*.jsonl` files and picks the newest. The
 * old scheme renamed to `<id>.archived.jsonl`, which still ends in
 * `.jsonl` — so pi kept picking up the archived file on the next
 * chatPrompt and writing new turns to it. Meanwhile the snapshot
 * reader filtered out archived files, so the UI showed blank chat
 * while pi continued writing to the soft-deleted file. Dropping the
 * `.jsonl` extension breaks pi's discovery, restoring true soft-delete
 * semantics: archives sit on disk for audit but stop being live
 * sessions.
 *
 * Migration: on every call we ALSO rename any legacy
 * `<id>.archived.jsonl` files to `<id>.archived` so an upgraded
 * project that's been stuck in the bug auto-recovers on its next
 * clear (or boot-time pre-clear).
 *
 * Matches the preserve-on-overwrite discipline we use for project
 * artifacts: never delete, just stop reading.
 */
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectSlugFromDir } from './projectSessionSlug';

export interface ClearProjectSessionsResult {
  /** Number of JSONL files archived (renamed to .archived). */
  archived: number;
  /** Source filenames (relative to slug dir) before archiving. */
  files: string[];
}

/**
 * Project slug uses the same scheme as getSessionHistorySnapshot.
 * Re-exported for legacy tests/imports.
 */
export { projectSlugFromDir };

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
    // Already on the new scheme? Skip.
    if (name.endsWith('.archived')) continue;
    const full = join(slugDir, name);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    // Legacy `.archived.jsonl` → migrate to `.archived` (drop the
    // trailing .jsonl) so pi-coding-agent's continueRecent stops
    // re-picking it up.
    if (name.endsWith('.archived.jsonl')) {
      try {
        const targetName = name.replace(/\.archived\.jsonl$/, '.archived');
        renameSync(full, join(slugDir, targetName));
      } catch {
        // best-effort migration; don't crash the clear.
      }
      continue;
    }
    // Live `<id>.jsonl` → archive.
    if (!name.endsWith('.jsonl')) continue;
    try {
      const targetName = name.replace(/\.jsonl$/, '.archived');
      renameSync(full, join(slugDir, targetName));
      archived.push(name);
    } catch {
      // best-effort; skip unreadable / locked files.
    }
  }
  return { archived: archived.length, files: archived };
}
