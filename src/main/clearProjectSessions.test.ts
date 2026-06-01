/**
 * clearProjectSessions — TDD coverage.
 *
 * Failure modes:
 *  1. projectDir with no special chars → slug matches basename verbatim.
 *  2. projectDir basename with spaces / punctuation → underscores.
 *  3. JSONL files in the target slug dir → deleted.
 *  4. NON-jsonl files in the slug dir (e.g. .lock) → preserved.
 *  5. Missing userData dir → no-op (0 deleted, no throw).
 *  6. Missing slug dir → no-op (0 deleted).
 *  7. Empty slug dir → no-op (0 deleted).
 *  8. Multiple JSONL files → all deleted; count + names returned.
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
    expect(r.deleted).toBe(2);
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
    expect(r.deleted).toBe(1);
    expect(existsSync(join(userData, 'pi-sessions/MyProj/session.lock'))).toBe(true);
    expect(existsSync(join(userData, 'pi-sessions/MyProj/README.md'))).toBe(true);
  });

  it('5. missing userData dir → no-op', () => {
    const r = clearProjectSessions('/no/such/userdata', '/anywhere/MyProj');
    expect(r.deleted).toBe(0);
    expect(r.files).toEqual([]);
  });

  it('6. missing slug dir → no-op', () => {
    const userData = setupUserDataDir({});
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.deleted).toBe(0);
  });

  it('7. empty slug dir → no-op', () => {
    const userData = mkdtempSync(join(tmpdir(), 'cps-test-'));
    dirs.push(userData);
    mkdirSync(join(userData, 'pi-sessions/MyProj'), { recursive: true });
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.deleted).toBe(0);
  });

  it('8. multiple JSONLs → all deleted, names returned', () => {
    const userData = setupUserDataDir({
      'pi-sessions/MyProj/a.jsonl': 'a',
      'pi-sessions/MyProj/b.jsonl': 'b',
      'pi-sessions/MyProj/c.jsonl': 'c',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.deleted).toBe(3);
    expect(r.files.sort()).toEqual(['a.jsonl', 'b.jsonl', 'c.jsonl']);
  });

  it('9. subdirectories not recursed into (only top-level *.jsonl deleted)', () => {
    const userData = setupUserDataDir({
      'pi-sessions/MyProj/top.jsonl': 'top',
      'pi-sessions/MyProj/sub/nested.jsonl': 'nested',
    });
    dirs.push(userData);
    const r = clearProjectSessions(userData, '/anywhere/MyProj');
    expect(r.deleted).toBe(1);
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
    expect(r.deleted).toBe(1);
  });

  it('also: ensures we can re-init by re-reading the slug dir', () => {
    const userData = setupUserDataDir({
      'pi-sessions/Foo/x.jsonl': 'x',
    });
    dirs.push(userData);
    clearProjectSessions(userData, '/anywhere/Foo');
    // Slug dir still exists; just emptied.
    expect(existsSync(join(userData, 'pi-sessions/Foo'))).toBe(true);
    expect(readdirSync(join(userData, 'pi-sessions/Foo'))).toEqual([]);
  });
});
