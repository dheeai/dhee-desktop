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
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kshana-fs-manager-'));
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
