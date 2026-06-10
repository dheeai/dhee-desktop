import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('electron-store', () => {
  return class MockStore<T extends Record<string, unknown>> {
    private data: T;

    constructor(options?: { defaults?: T }) {
      this.data = { ...(options?.defaults || ({} as T)) };
    }

    get<K extends keyof T>(key: K, fallback?: T[K]): T[K] {
      return (this.data[key] as T[K]) ?? (fallback as T[K]);
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
      this.data[key] = value;
    }
  };
});

const loadManager = async (): Promise<
  import('./fileSystemManager.js').FileSystemManager
> => {
  const mod = await import('./fileSystemManager.js');
  // NodeNext + a CJS `export default new X()` re-exports the whole
  // module namespace as `default` — cast through unknown so the test
  // can use the real instance interface without a sea of `any`s.
  return mod.default as unknown as import('./fileSystemManager.js').FileSystemManager;
};

describe('fileSystemManager project mutations', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-fs-manager-'));
    const manager = await loadManager();
    manager.getRecentProjects().forEach((project) => {
      manager.removeRecentProject(project.path);
    });
  });

  it('renames a project, updates recents, and rewrites project.json title', async () => {
    const manager = await loadManager();
    const projectPath = path.join(tempRoot, 'old-name');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'project.json'),
      JSON.stringify({ title: 'Old Name', scenes: [], characters: [] }),
      'utf-8',
    );

    manager.addRecentProject(projectPath);

    const renamedPath = await manager.renameProject(projectPath, 'new-name');
    const manifestRaw = await fs.readFile(
      path.join(renamedPath, 'project.json'),
      'utf-8',
    );
    const manifest = JSON.parse(manifestRaw) as { title?: string };

    expect(renamedPath).toBe(path.join(tempRoot, 'new-name'));
    expect(manifest.title).toBe('new-name');
    expect(manager.getRecentProjects()).toEqual([
      expect.objectContaining({
        path: path.join(tempRoot, 'new-name'),
        name: 'new-name',
      }),
    ]);
  });

  it('keeps rename safe when project.json is malformed', async () => {
    const manager = await loadManager();
    const projectPath = path.join(tempRoot, 'broken-name');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'project.json'),
      '{bad json',
      'utf-8',
    );

    manager.addRecentProject(projectPath);

    const renamedPath = await manager.renameProject(projectPath, 'renamed');

    await expect(fs.stat(renamedPath)).resolves.toBeTruthy();
    expect(manager.getRecentProjects()).toEqual([
      expect.objectContaining({
        path: path.join(tempRoot, 'renamed'),
        name: 'renamed',
      }),
    ]);
  });

  it('shows a friendly error when the target project name already exists', async () => {
    const manager = await loadManager();
    const sourcePath = path.join(tempRoot, 'source-project');
    const targetPath = path.join(tempRoot, 'new-1');
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.mkdir(targetPath, { recursive: true });

    await expect(manager.renameProject(sourcePath, 'new-1')).rejects.toThrow(
      'A project named "new-1" already exists in this location.',
    );
  });

  it('deletes a project and removes it from recents', async () => {
    const manager = await loadManager();
    const projectPath = path.join(tempRoot, 'delete-me');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, 'project.json'), '{}', 'utf-8');

    manager.addRecentProject(projectPath);
    await manager.deleteProject(projectPath);

    await expect(fs.stat(projectPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(manager.getRecentProjects()).toEqual([]);
  });

  it('keeps more than 10 recent projects', async () => {
    const manager = await loadManager();

    for (let index = 1; index <= 12; index += 1) {
      manager.addRecentProject(path.join(tempRoot, `project-${index}`));
    }

    expect(manager.getRecentProjects()).toHaveLength(12);
  });

  it('moves an existing recent project to the front without duplication', async () => {
    const manager = await loadManager();
    const nowSpy = jest.spyOn(Date, 'now');
    const firstPath = path.join(tempRoot, 'first');
    const secondPath = path.join(tempRoot, 'second');

    nowSpy.mockReturnValueOnce(1000);
    manager.addRecentProject(firstPath);
    nowSpy.mockReturnValueOnce(2000);
    manager.addRecentProject(secondPath);
    nowSpy.mockReturnValueOnce(3000);
    manager.addRecentProject(firstPath);

    expect(manager.getRecentProjects()).toEqual([
      { path: firstPath, name: 'first', lastOpened: 3000 },
      { path: secondPath, name: 'second', lastOpened: 2000 },
    ]);

    nowSpy.mockRestore();
  });
});

describe('fileSystemManager readDirectory', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-fs-read-'));
  });

  it('returns an empty directory node for a non-existent path (ENOENT)', async () => {
    const manager = await loadManager();
    const missing = path.join(tempRoot, 'does-not-exist');
    const node = await manager.readDirectory(missing);
    expect(node).toMatchObject({
      name: 'does-not-exist',
      path: missing,
      type: 'directory',
      children: [],
    });
  });

  it('returns a file node (with extension) when the path is a file', async () => {
    const manager = await loadManager();
    const filePath = path.join(tempRoot, 'note.txt');
    await fs.writeFile(filePath, 'hi', 'utf-8');
    const node = await manager.readDirectory(filePath);
    expect(node).toMatchObject({
      name: 'note.txt',
      path: filePath,
      type: 'file',
      extension: '.txt',
    });
  });

  it('returns a directory node without children when depth <= 0', async () => {
    const manager = await loadManager();
    await fs.writeFile(path.join(tempRoot, 'a.txt'), 'a', 'utf-8');
    const node = await manager.readDirectory(tempRoot, 0);
    expect(node.type).toBe('directory');
    expect(node.children).toBeUndefined();
  });

  it('lists children sorted directories-first then files alphabetically', async () => {
    const manager = await loadManager();
    await fs.writeFile(path.join(tempRoot, 'zeta.txt'), '', 'utf-8');
    await fs.writeFile(path.join(tempRoot, 'alpha.txt'), '', 'utf-8');
    await fs.mkdir(path.join(tempRoot, 'beta-dir'));
    await fs.mkdir(path.join(tempRoot, 'alpha-dir'));

    const node = await manager.readDirectory(tempRoot, 1);
    const names = (node.children ?? []).map((c) => c.name);
    expect(names).toEqual(['alpha-dir', 'beta-dir', 'alpha.txt', 'zeta.txt']);
    // Directories at depth 1 are unexpanded (children undefined).
    const dirNode = node.children?.find((c) => c.name === 'alpha-dir');
    expect(dirNode?.type).toBe('directory');
    expect(dirNode?.children).toBeUndefined();
  });

  it('filters ignored patterns (node_modules, .git, .DS_Store, *.pyc)', async () => {
    const manager = await loadManager();
    await fs.mkdir(path.join(tempRoot, 'node_modules'));
    await fs.mkdir(path.join(tempRoot, '.git'));
    await fs.writeFile(path.join(tempRoot, '.DS_Store'), '', 'utf-8');
    await fs.writeFile(path.join(tempRoot, 'mod.pyc'), '', 'utf-8');
    await fs.writeFile(path.join(tempRoot, 'keep.txt'), '', 'utf-8');

    const node = await manager.readDirectory(tempRoot, 1);
    const names = (node.children ?? []).map((c) => c.name);
    expect(names).toEqual(['keep.txt']);
  });

  it('recurses into subdirectories when depth > 1', async () => {
    const manager = await loadManager();
    const sub = path.join(tempRoot, 'sub');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'inner.txt'), '', 'utf-8');

    const node = await manager.readDirectory(tempRoot, 2);
    const subNode = node.children?.find((c) => c.name === 'sub');
    expect(subNode?.type).toBe('directory');
    expect((subNode?.children ?? []).map((c) => c.name)).toEqual([
      'inner.txt',
    ]);
  });
});

describe('fileSystemManager move / copy', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-fs-movecopy-'));
  });

  it('moves a file into a destination directory, preserving its name', async () => {
    const manager = await loadManager();
    const src = path.join(tempRoot, 'doc.txt');
    const destDir = path.join(tempRoot, 'dest');
    await fs.writeFile(src, 'body', 'utf-8');
    await fs.mkdir(destDir);

    const destPath = await manager.move(src, destDir);

    expect(destPath).toBe(path.join(destDir, 'doc.txt'));
    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('body');
    await expect(fs.stat(src)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('copies a file into a destination directory (source remains)', async () => {
    const manager = await loadManager();
    const src = path.join(tempRoot, 'orig.txt');
    const destDir = path.join(tempRoot, 'copies');
    await fs.writeFile(src, 'content', 'utf-8');
    await fs.mkdir(destDir);

    const destPath = await manager.copy(src, destDir);

    expect(destPath).toBe(path.join(destDir, 'orig.txt'));
    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('content');
    // Original is untouched by a copy.
    await expect(fs.readFile(src, 'utf-8')).resolves.toBe('content');
  });

  it('copies a directory tree recursively', async () => {
    const manager = await loadManager();
    const srcDir = path.join(tempRoot, 'tree');
    const nested = path.join(srcDir, 'nested');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'root.txt'), 'r', 'utf-8');
    await fs.writeFile(path.join(nested, 'leaf.txt'), 'l', 'utf-8');
    const destDir = path.join(tempRoot, 'out');
    await fs.mkdir(destDir);

    const destPath = await manager.copy(srcDir, destDir);

    expect(destPath).toBe(path.join(destDir, 'tree'));
    await expect(
      fs.readFile(path.join(destPath, 'root.txt'), 'utf-8'),
    ).resolves.toBe('r');
    await expect(
      fs.readFile(path.join(destPath, 'nested', 'leaf.txt'), 'utf-8'),
    ).resolves.toBe('l');
  });

  it('renames a file in place via rename()', async () => {
    const manager = await loadManager();
    const src = path.join(tempRoot, 'before.txt');
    await fs.writeFile(src, 'x', 'utf-8');

    const newPath = await manager.rename(src, 'after.txt');

    expect(newPath).toBe(path.join(tempRoot, 'after.txt'));
    await expect(fs.readFile(newPath, 'utf-8')).resolves.toBe('x');
  });

  it('deletes a single file via delete()', async () => {
    const manager = await loadManager();
    const filePath = path.join(tempRoot, 'gone.txt');
    await fs.writeFile(filePath, '', 'utf-8');

    await manager.delete(filePath);

    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deletes a directory recursively via delete()', async () => {
    const manager = await loadManager();
    const dir = path.join(tempRoot, 'dir');
    await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(dir, 'sub', 'f.txt'), '', 'utf-8');

    await manager.delete(dir);

    await expect(fs.stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('fileSystemManager recents validation + active root', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-fs-recents-'));
    const manager = await loadManager();
    manager.getRecentProjects().forEach((project) => {
      manager.removeRecentProject(project.path);
    });
  });

  it('drops recents whose directory no longer exists and persists the trim', async () => {
    const manager = await loadManager();
    const liveDir = path.join(tempRoot, 'live');
    await fs.mkdir(liveDir);
    const deadDir = path.join(tempRoot, 'dead'); // never created

    manager.addRecentProject(deadDir);
    manager.addRecentProject(liveDir);

    const validated = await manager.getRecentProjectsValidated();

    expect(validated.map((p) => p.path)).toEqual([liveDir]);
    // The trimmed list is written back to the store.
    expect(manager.getRecentProjects().map((p) => p.path)).toEqual([liveDir]);
  });

  it('treats a recent entry pointing at a FILE (not a dir) as invalid', async () => {
    const manager = await loadManager();
    const filePath = path.join(tempRoot, 'a-file.txt');
    await fs.writeFile(filePath, '', 'utf-8');

    manager.addRecentProject(filePath);
    const validated = await manager.getRecentProjectsValidated();

    expect(validated).toEqual([]);
  });

  it('removeRecentProject removes only the matching entry', async () => {
    const manager = await loadManager();
    const a = path.join(tempRoot, 'a');
    const b = path.join(tempRoot, 'b');
    manager.addRecentProject(a);
    manager.addRecentProject(b);

    manager.removeRecentProject(a);

    expect(manager.getRecentProjects().map((p) => p.path)).toEqual([b]);
  });

  it('replaceRecentProjectPath rewrites path and derives a name when none given', async () => {
    const manager = await loadManager();
    const oldPath = path.join(tempRoot, 'old');
    manager.addRecentProject(oldPath);

    const newPath = path.join(tempRoot, 'renamed-folder');
    manager.replaceRecentProjectPath(oldPath, newPath);

    expect(manager.getRecentProjects()).toEqual([
      expect.objectContaining({ path: newPath, name: 'renamed-folder' }),
    ]);
  });

  it('getActiveProjectRoot is null before any watch and after unwatch', async () => {
    const manager = await loadManager();
    // No watch has been started in this describe block.
    manager.unwatchDirectory();
    expect(manager.getActiveProjectRoot()).toBeNull();
  });
});

describe('fileSystemManager confinement boundary (documentation)', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-fs-guard-'));
  });

  // FileSystemManager itself performs NO project-root confinement. By design
  // the traversal/symlink-escape guard lives in
  // src/main/utils/projectFileOpGuard.ts (separately tested) and is applied at
  // the IPC bridge layer BEFORE these methods are called. These tests document
  // that boundary so a future refactor that moves the guard inward (or removes
  // the bridge check) is caught: if FileSystemManager ever starts rejecting
  // out-of-root operations, these assertions will flip and must be revisited.
  it('delete() will operate on a path outside any project root (guard is upstream)', async () => {
    const manager = await loadManager();
    // Confirm the manager has no active root configured...
    manager.unwatchDirectory();
    expect(manager.getActiveProjectRoot()).toBeNull();

    // ...yet it still deletes a path that no confinement check vetted.
    const outside = path.join(tempRoot, 'unguarded.txt');
    await fs.writeFile(outside, '', 'utf-8');
    await expect(manager.delete(outside)).resolves.toBeUndefined();
    await expect(fs.stat(outside)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('copy() accepts a "../"-bearing destination without rejection', async () => {
    const manager = await loadManager();
    const src = path.join(tempRoot, 'src.txt');
    await fs.writeFile(src, 'data', 'utf-8');
    const sibling = path.join(tempRoot, 'sub', '..'); // resolves back to tempRoot
    await fs.mkdir(path.join(tempRoot, 'sub'));

    // No ProjectFileOpGuardError is thrown here — confinement is enforced
    // upstream, not inside FileSystemManager.
    const dest = await manager.copy(src, sibling);
    await expect(fs.readFile(dest, 'utf-8')).resolves.toBe('data');
  });
});
