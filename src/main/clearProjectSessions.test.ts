/**
 * clearProjectSessions — TDD coverage.
 *
 * Failure modes:
 *  1. projectDir with no special chars → slug matches basename verbatim.
 *  2. projectDir basename with spaces / punctuation → underscores.
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

describe('projectSlugFromDir', () => {
  it('1. simple name → matches basename', () => {
    expect(projectSlugFromDir('/Users/x/projects/MyProject')).toBe('MyProject');
  });

  it('2. spaces + punctuation → underscores', () => {
    expect(projectSlugFromDir('/Users/x/dhee-studios/Island Zombie Survival!')).toBe(
      'Island_Zombie_Survival_',
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
    const userData = setupUserDataDir({
      'pi-sessions/MyProj/session1.jsonl': '{"ev":1}',
      'pi-sessions/MyProj/session2.jsonl': '{"ev":2}',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.archived).toBe(2);
    expect(r.files.sort()).toEqual(['session1.jsonl', 'session2.jsonl']);
    expect(existsSync(join(userData, 'pi-sessions/MyProj/session1.jsonl'))).toBe(false);
    expect(existsSync(join(userData, 'pi-sessions/MyProj/session2.jsonl'))).toBe(false);
  });

  it('4. preserves non-jsonl files', () => {
    const userData = setupUserDataDir({
      'pi-sessions/MyProj/session.jsonl': '{"ev":1}',
      'pi-sessions/MyProj/session.lock': 'pid=123',
      'pi-sessions/MyProj/README.md': 'notes',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.archived).toBe(1);
    expect(existsSync(join(userData, 'pi-sessions/MyProj/session.lock'))).toBe(true);
    expect(existsSync(join(userData, 'pi-sessions/MyProj/README.md'))).toBe(true);
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
    const userData = mkdtempSync(join(tmpdir(), 'cps-test-'));
    dirs.push(userData);
    mkdirSync(join(userData, 'pi-sessions/MyProj'), { recursive: true });
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.archived).toBe(0);
  });

  it('8. multiple JSONLs → all archived, names returned', () => {
    const userData = setupUserDataDir({
      'pi-sessions/MyProj/a.jsonl': 'a',
      'pi-sessions/MyProj/b.jsonl': 'b',
      'pi-sessions/MyProj/c.jsonl': 'c',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.archived).toBe(3);
    expect(r.files.sort()).toEqual(['a.jsonl', 'b.jsonl', 'c.jsonl']);
  });

  it('9. subdirectories not recursed into (only top-level *.jsonl archived)', () => {
    const userData = setupUserDataDir({
      'pi-sessions/MyProj/top.jsonl': 'top',
      'pi-sessions/MyProj/sub/nested.jsonl': 'nested',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.archived).toBe(1);
    expect(existsSync(join(userData, 'pi-sessions/MyProj/sub/nested.jsonl'))).toBe(true);
  });

  it('10. sibling project unaffected', () => {
    const userData = setupUserDataDir({
      'pi-sessions/MyProj/session.jsonl': 'mine',
      'pi-sessions/OtherProj/session.jsonl': 'theirs',
    });
    dirs.push(userData);
    clearProjectSessions(userData, '/anywhere/MyProj');
    expect(existsSync(join(userData, 'pi-sessions/MyProj/session.jsonl'))).toBe(false);
    expect(existsSync(join(userData, 'pi-sessions/OtherProj/session.jsonl'))).toBe(true);
  });

  it('also handles projectDir with trailing slash (basename normalizes)', () => {
    const userData = setupUserDataDir({
      'pi-sessions/Foo/x.jsonl': 'x',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/Users/x/Foo/');
    expect(r.archived).toBe(1);
  });

  it('archive-not-delete: live JSONL renamed to `.archived` (no .jsonl); preserved on disk', () => {
    const userData = setupUserDataDir({
      'pi-sessions/Foo/x.jsonl': 'x-content',
    });
    dirs.push(userData);
    clearProjectSessions(userData, '/anywhere/Foo');
    // Live JSONL is gone, archived twin (no .jsonl suffix) holds the content.
    expect(existsSync(join(userData, 'pi-sessions/Foo/x.jsonl'))).toBe(false);
    expect(existsSync(join(userData, 'pi-sessions/Foo/x.archived'))).toBe(true);
  });

  it('archived files use a non-.jsonl suffix so pi-coding-agent does not re-pickup them', () => {
    // The bug this guards: clearProjectSessions used to rename to
    // `.archived.jsonl`, which still ends in `.jsonl`. pi-coding-agent's
    // SessionManager.continueRecent scans for *.jsonl and picked the
    // archived file as the most recent, then continued writing to it.
    // Meanwhile getSessionHistorySnapshot's filter skipped the archived
    // file, so the UI showed blank chat even though pi was writing.
    // The fix: archives no longer end in `.jsonl`.
    const userData = setupUserDataDir({
      'pi-sessions/Foo/sess.jsonl': 'live',
    });
    dirs.push(userData);
    clearProjectSessions(userData, '/anywhere/Foo');
    const entries = readdirSync(join(userData, 'pi-sessions/Foo'));
    for (const e of entries) {
      if (e === 'sess.jsonl') {
        throw new Error(`Live JSONL not renamed: ${e}`);
      }
      expect(e.endsWith('.jsonl')).toBe(false);
    }
  });

  it('repeated clears do not double-suffix (skips already-archived files)', () => {
    const userData = setupUserDataDir({
      'pi-sessions/Foo/x.archived': 'old',
      'pi-sessions/Foo/y.jsonl': 'new',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/Foo');
    expect(r.archived).toBe(1);
    expect(r.files).toEqual(['y.jsonl']);
    // The pre-existing archived stays put.
    expect(existsSync(join(userData, 'pi-sessions/Foo/x.archived'))).toBe(true);
    // The new one is now archived (single suffix, no .jsonl).
    expect(existsSync(join(userData, 'pi-sessions/Foo/y.archived'))).toBe(true);
    expect(existsSync(join(userData, 'pi-sessions/Foo/y.archived.archived'))).toBe(false);
  });

  it('migrates legacy `.archived.jsonl` files to the new `.archived` suffix on first call', () => {
    // Users upgrading from the old scheme have `.archived.jsonl` files
    // that pi-coding-agent keeps re-pickup'ing (the bug). On the next
    // clearProjectSessions call, rename them to `.archived` so the
    // problem stops perpetuating.
    const userData = setupUserDataDir({
      'pi-sessions/Foo/old.archived.jsonl': 'legacy archived content',
      'pi-sessions/Foo/live.jsonl': 'current live',
    });
    dirs.push(userData);
    clearProjectSessions(userData, '/anywhere/Foo');
    // Legacy migrated.
    expect(existsSync(join(userData, 'pi-sessions/Foo/old.archived.jsonl'))).toBe(false);
    expect(existsSync(join(userData, 'pi-sessions/Foo/old.archived'))).toBe(true);
    // Current archived under the new suffix.
    expect(existsSync(join(userData, 'pi-sessions/Foo/live.jsonl'))).toBe(false);
    expect(existsSync(join(userData, 'pi-sessions/Foo/live.archived'))).toBe(true);
  });
});
