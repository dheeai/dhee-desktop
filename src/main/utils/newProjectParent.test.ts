/**
 * TDD tests for `ensureNewProjectParentExists`.
 *
 * Failure modes enumerated up front:
 *
 *   - Parent does NOT exist (the user's actual bug 2026-05-19: default
 *     Location = `~/dhee-studios`, folder absent, create-folder IPC
 *     fails with `PROJECT_ROOT_NOT_SET` from `fs.realpath`) — must
 *     succeed by mkdir-recursive.
 *   - Parent already exists — no-op (idempotent).
 *   - Multiple intermediate parents missing (`~/a/b/c` with `~/a`
 *     absent) — must create them all.
 *   - Path is relative — must reject before touching the filesystem.
 *   - Path is empty / whitespace — must reject.
 *   - mkdir fails with permission error — must surface a typed error
 *     and not leak as `PROJECT_ROOT_NOT_SET` to the renderer.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  NewProjectParentError,
  ensureNewProjectParentExists,
} from './newProjectParent';

async function withTempDir(
  fn: (tmp: string) => Promise<void>,
): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kshana-newproj-test-'));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

describe('ensureNewProjectParentExists', () => {
  it('creates the parent directory when it does not exist (the dhee-studios case)', async () => {
    await withTempDir(async (tmp) => {
      const target = path.join(tmp, 'dhee-studios');
      await expect(fs.access(target)).rejects.toBeDefined(); // sanity: absent
      await ensureNewProjectParentExists(target);
      const stat = await fs.stat(target);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it('is a no-op when the parent already exists', async () => {
    await withTempDir(async (tmp) => {
      const target = path.join(tmp, 'already-here');
      await fs.mkdir(target);
      // No throw, no state corruption.
      await ensureNewProjectParentExists(target);
      const stat = await fs.stat(target);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it('creates multiple missing intermediate directories', async () => {
    await withTempDir(async (tmp) => {
      const target = path.join(tmp, 'a', 'b', 'c', 'dhee-studios');
      await ensureNewProjectParentExists(target);
      const stat = await fs.stat(target);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it('is idempotent across calls', async () => {
    await withTempDir(async (tmp) => {
      const target = path.join(tmp, 'dhee-studios');
      await ensureNewProjectParentExists(target);
      await ensureNewProjectParentExists(target);
      await ensureNewProjectParentExists(target);
      const stat = await fs.stat(target);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it('rejects a relative path before touching the filesystem', async () => {
    const mkdir = jest.fn<
      (dir: string, options: { recursive: true }) => Promise<string | undefined>
    >();
    await expect(
      ensureNewProjectParentExists('dhee-studios', mkdir),
    ).rejects.toBeInstanceOf(NewProjectParentError);
    await expect(
      ensureNewProjectParentExists('./dhee-studios', mkdir),
    ).rejects.toBeInstanceOf(NewProjectParentError);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('rejects an empty / whitespace path before touching the filesystem', async () => {
    const mkdir = jest.fn<
      (dir: string, options: { recursive: true }) => Promise<string | undefined>
    >();
    await expect(ensureNewProjectParentExists('', mkdir)).rejects.toBeInstanceOf(
      NewProjectParentError,
    );
    await expect(
      ensureNewProjectParentExists('   ', mkdir),
    ).rejects.toBeInstanceOf(NewProjectParentError);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('surfaces a typed MKDIR_FAILED error when the underlying mkdir throws', async () => {
    const mkdir = jest.fn<
      (dir: string, options: { recursive: true }) => Promise<string | undefined>
    >(() => {
      const e = new Error('EACCES: permission denied');
      throw e;
    });
    try {
      await ensureNewProjectParentExists('/Users/ganaraj/dhee-studios', mkdir);
      throw new Error('expected to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(NewProjectParentError);
      expect((e as NewProjectParentError).code).toBe('MKDIR_FAILED');
      expect((e as Error).message).toContain(
        '/Users/ganaraj/dhee-studios',
      );
      expect((e as Error).message).toContain('EACCES');
    }
  });

  it('throws NOT_ABSOLUTE with the offending path in the message', async () => {
    try {
      await ensureNewProjectParentExists('dhee-studios');
      throw new Error('expected to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(NewProjectParentError);
      expect((e as NewProjectParentError).code).toBe('NOT_ABSOLUTE');
      expect((e as Error).message).toContain('dhee-studios');
    }
  });
});
