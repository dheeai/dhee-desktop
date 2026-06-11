/**
 * clearProjectSessions — TDD coverage.
 *
 * Failure modes:
 *  1. projectDir with no special chars → slug starts with safe basename
 *     and ends with a stable identity hash.
 *  2. projectDir basename with spaces / punctuation → safe basename
 *     segment still uses underscores.
 *  3. JSONL files in the target slug dir → archived.
 *  4. NON-jsonl files in the slug dir (e.g. .lock) → preserved.
 *  5. Missing userData dir → no-op (0 archived, no throw).
 *  6. Missing slug dir → no-op (0 archived).
 *  7. Empty slug dir → no-op (0 archived).
 *  8. Multiple JSONL files → all archived; count + names returned.
 *  9. Subdirectories inside slug dir (shouldn't exist normally, but)
 *     are NOT recursed into. We only delete top-level *.jsonl files.
 * 10. Sibling project's JSONLs are untouched.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearProjectSessions,
  projectSlugFromDir,
} from './clearProjectSessions';

function setupUserDataDir(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cps-test-'));
  for (const [rel, content] of Object.entries(layout)) {
    const full = join(root, rel);
    const dir = full.slice(0, full.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function sessionRel(projectDir: string, file: string): string {
  return `pi-sessions/${projectSlugFromDir(projectDir)}/${file}`;
}

function sessionAbs(userData: string, projectDir: string, file: string): string {
  return join(userData, 'pi-sessions', projectSlugFromDir(projectDir), file);
}

describe('projectSlugFromDir', () => {
  it('1. simple name → safe basename plus identity hash', () => {
    expect(projectSlugFromDir('/Users/x/projects/MyProject')).toMatch(
      /^MyProject-[0-9a-f]{12}$/,
    );
  });

  it('2. spaces + punctuation → safe basename uses underscores', () => {
    expect(projectSlugFromDir('/Users/x/dhee-studios/Island Zombie Survival!')).toMatch(
      /^Island_Zombie_Survival_-[0-9a-f]{12}$/,
    );
  });

  it('different absolute paths with the same basename get different slugs', () => {
    expect(projectSlugFromDir('/Users/a/MyProj')).not.toBe(
      projectSlugFromDir('/Users/b/MyProj'),
    );
  });
});

describe('clearProjectSessions', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    }
    dirs.length = 0;
  });

  it('3. deletes JSONL files in the slug dir', () => {
    const projectDir = '/anywhere/MyProj';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'session1.jsonl')]: '{"ev":1}',
      [sessionRel(projectDir, 'session2.jsonl')]: '{"ev":2}',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, projectDir);
    expect(r.archived).toBe(2);
    expect(r.files.sort()).toEqual(['session1.jsonl', 'session2.jsonl']);
    expect(existsSync(sessionAbs(userData, projectDir, 'session1.jsonl'))).toBe(false);
    expect(existsSync(sessionAbs(userData, projectDir, 'session2.jsonl'))).toBe(false);
  });

  it('4. preserves non-jsonl files', () => {
    const projectDir = '/anywhere/MyProj';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'session.jsonl')]: '{"ev":1}',
      [sessionRel(projectDir, 'session.lock')]: 'pid=123',
      [sessionRel(projectDir, 'README.md')]: 'notes',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, projectDir);
    expect(r.archived).toBe(1);
    expect(existsSync(sessionAbs(userData, projectDir, 'session.lock'))).toBe(true);
    expect(existsSync(sessionAbs(userData, projectDir, 'README.md'))).toBe(true);
  });

  it('5. missing userData dir → no-op', () => {
    const r = clearProjectSessions('/no/such/userdata', '/anywhere/MyProj');
    expect(r.archived).toBe(0);
    expect(r.files).toEqual([]);
  });

  it('6. missing slug dir → no-op', () => {
    const userData = setupUserDataDir({});
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.archived).toBe(0);
  });

  it('7. empty slug dir → no-op', () => {
    const projectDir = '/anywhere/MyProj';
    const userData = mkdtempSync(join(tmpdir(), 'cps-test-'));
    dirs.push(userData);
    mkdirSync(join(userData, 'pi-sessions', projectSlugFromDir(projectDir)), { recursive: true });
    const r = clearProjectSessions(userData, projectDir);
    expect(r.archived).toBe(0);
  });

  it('8. multiple JSONLs → all archived, names returned', () => {
    const projectDir = '/anywhere/MyProj';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'a.jsonl')]: 'a',
      [sessionRel(projectDir, 'b.jsonl')]: 'b',
      [sessionRel(projectDir, 'c.jsonl')]: 'c',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, projectDir);
    expect(r.archived).toBe(3);
    expect(r.files.sort()).toEqual(['a.jsonl', 'b.jsonl', 'c.jsonl']);
  });

  it('9. subdirectories not recursed into (only top-level *.jsonl archived)', () => {
    const projectDir = '/anywhere/MyProj';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'top.jsonl')]: 'top',
      [sessionRel(projectDir, 'sub/nested.jsonl')]: 'nested',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, projectDir);
    expect(r.archived).toBe(1);
    expect(existsSync(sessionAbs(userData, projectDir, 'sub/nested.jsonl'))).toBe(true);
  });

  it('10. sibling project unaffected', () => {
    const projectDir = '/anywhere/MyProj';
    const siblingDir = '/anywhere/OtherProj';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'session.jsonl')]: 'mine',
      [sessionRel(siblingDir, 'session.jsonl')]: 'theirs',
    });
    dirs.push(userData);
    clearProjectSessions(userData, projectDir);
    expect(existsSync(sessionAbs(userData, projectDir, 'session.jsonl'))).toBe(false);
    expect(existsSync(sessionAbs(userData, siblingDir, 'session.jsonl'))).toBe(true);
  });

  it('also handles projectDir with trailing slash (basename normalizes)', () => {
    const projectDir = '/Users/x/Foo/';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'x.jsonl')]: 'x',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, projectDir);
    expect(r.archived).toBe(1);
  });

  it('archive-not-delete: live JSONL renamed to `.archived` (no .jsonl); preserved on disk', () => {
    const projectDir = '/anywhere/Foo';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'x.jsonl')]: 'x-content',
    });
    dirs.push(userData);
    clearProjectSessions(userData, projectDir);
    // Live JSONL is gone, archived twin (no .jsonl suffix) holds the content.
    expect(existsSync(sessionAbs(userData, projectDir, 'x.jsonl'))).toBe(false);
    expect(existsSync(sessionAbs(userData, projectDir, 'x.archived'))).toBe(true);
  });

  it('archived files use a non-.jsonl suffix so pi-coding-agent does not re-pickup them', () => {
    // The bug this guards: clearProjectSessions used to rename to
    // `.archived.jsonl`, which still ends in `.jsonl`. pi-coding-agent's
    // SessionManager.continueRecent scans for *.jsonl and picked the
    // archived file as the most recent, then continued writing to it.
    // Meanwhile getSessionHistorySnapshot's filter skipped the archived
    // file, so the UI showed blank chat even though pi was writing.
    // The fix: archives no longer end in `.jsonl`.
    const projectDir = '/anywhere/Foo';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'sess.jsonl')]: 'live',
    });
    dirs.push(userData);
    clearProjectSessions(userData, projectDir);
    const entries = readdirSync(join(userData, 'pi-sessions', projectSlugFromDir(projectDir)));
    for (const e of entries) {
      if (e === 'sess.jsonl') {
        throw new Error(`Live JSONL not renamed: ${e}`);
      }
      expect(e.endsWith('.jsonl')).toBe(false);
    }
  });

  it('repeated clears do not double-suffix (skips already-archived files)', () => {
    const projectDir = '/anywhere/Foo';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'x.archived')]: 'old',
      [sessionRel(projectDir, 'y.jsonl')]: 'new',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, projectDir);
    expect(r.archived).toBe(1);
    expect(r.files).toEqual(['y.jsonl']);
    // The pre-existing archived stays put.
    expect(existsSync(sessionAbs(userData, projectDir, 'x.archived'))).toBe(true);
    // The new one is now archived (single suffix, no .jsonl).
    expect(existsSync(sessionAbs(userData, projectDir, 'y.archived'))).toBe(true);
    expect(existsSync(sessionAbs(userData, projectDir, 'y.archived.archived'))).toBe(false);
  });

  it('migrates legacy `.archived.jsonl` files to the new `.archived` suffix on first call', () => {
    // Users upgrading from the old scheme have `.archived.jsonl` files
    // that pi-coding-agent keeps re-pickup'ing (the bug). On the next
    // clearProjectSessions call, rename them to `.archived` so the
    // problem stops perpetuating.
    const projectDir = '/anywhere/Foo';
    const userData = setupUserDataDir({
      [sessionRel(projectDir, 'old.archived.jsonl')]: 'legacy archived content',
      [sessionRel(projectDir, 'live.jsonl')]: 'current live',
    });
    dirs.push(userData);
    clearProjectSessions(userData, projectDir);
    // Legacy migrated.
    expect(existsSync(sessionAbs(userData, projectDir, 'old.archived.jsonl'))).toBe(false);
    expect(existsSync(sessionAbs(userData, projectDir, 'old.archived'))).toBe(true);
    // Current archived under the new suffix.
    expect(existsSync(sessionAbs(userData, projectDir, 'live.jsonl'))).toBe(false);
    expect(existsSync(sessionAbs(userData, projectDir, 'live.archived'))).toBe(true);
  });
});
