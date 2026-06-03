import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import Store from 'electron-store';
import type {
  FileNode,
  RecentProject,
  FileChangeEvent,
} from '../shared/fileSystemTypes';

const IGNORED_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.DS_Store/,
  /\.cache/,
  /__pycache__/,
  /\.pyc$/,
  /\.tmp$/,
];

interface FileSystemStore {
  recentProjects: RecentProject[];
}

interface BackendProjectManifest {
  title?: string;
  [key: string]: unknown;
}

export class FileSystemManager extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private watcher: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private manifestWatcher: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private imagePlacementsWatcher: any = null;

  private store: Store<FileSystemStore>;

  // Debounced event batching
  private pendingEvents: Map<string, FileChangeEvent> = new Map();

  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly DEBOUNCE_DELAY = 200; // 200ms debounce for rapid changes

  private activeProjectRoot: string | null = null;

  constructor() {
    super();
    this.store = new Store<FileSystemStore>({
      name: 'file-system',
      defaults: {
        recentProjects: [],
      },
    });
  }

  private shouldIgnore(filePath: string): boolean {
    return IGNORED_PATTERNS.some((pattern) => pattern.test(filePath));
  }

  async readDirectory(dirPath: string, depth: number = 1): Promise<FileNode> {
    let stats;
    try {
      stats = await fs.promises.stat(dirPath);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        // Directory doesn't exist - return empty directory node
        const name = path.basename(dirPath);
        return {
          name,
          path: dirPath,
          type: 'directory',
          children: [],
        };
      }
      throw error;
    }
    const name = path.basename(dirPath);

    if (!stats.isDirectory()) {
      const ext = path.extname(name);
      return {
        name,
        path: dirPath,
        type: 'file',
        extension: ext,
      };
    }

    // If depth is 0, return directory node without reading children
    // but ensure it's marked as a directory
    if (depth <= 0) {
      return {
        name,
        path: dirPath,
        type: 'directory',
        // children undefined implies not loaded
      };
    }

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    // Process entries in parallel
    const childrenRequest = entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);

      if (this.shouldIgnore(entryPath)) return null;

      if (entry.isDirectory()) {
        // Only recurse if we have remaining depth
        if (depth > 1) {
          return this.readDirectory(entryPath, depth - 1);
        }
        // Otherwise return directory node directly (avoids redundant fs.stat)
        return {
          name: entry.name,
          path: entryPath,
          type: 'directory' as const,
          // children undefined implies not loaded
        };
      }
      const ext = path.extname(entry.name);
      // We know it's a file, no need to stat again
      return {
        name: entry.name,
        path: entryPath,
        type: 'file' as const,
        extension: ext,
      };
    });

    const results = await Promise.all(childrenRequest);

    // Filter out nulls (ignored files) and sort
    const children = results.filter((node): node is FileNode => node !== null);

    // Sort: directories first, then files, both alphabetically
    children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      name,
      path: dirPath,
      type: 'directory',
      children,
    };
  }

  /**
   * Emit change event with debounced batching for rapid changes
   */
  private emitDebouncedChange(
    type: FileChangeEvent['type'],
    filePath: string,
  ): void {
    const normalizedPath = filePath.replace(/\\/g, '/');
    // Coalesce duplicate events for the same path — the latest wins.
    this.pendingEvents.set(normalizedPath, {
      type,
      path: normalizedPath,
    } as FileChangeEvent);

    // Trailing-edge debounce with NO reset. Earlier this branch
    // `clearTimeout`-ed the existing timer on every new event, which
    // turned the 200 ms debounce into "wait until writes stop" — and
    // a dhee_run_to streams writes for 10+ minutes straight, so the
    // flush never happened during a run. The PromptsView panel
    // therefore stayed frozen for the whole pipeline. By only
    // ARMING the timer when it's not already running, we guarantee
    // a flush at most DEBOUNCE_DELAY ms after the first pending
    // event — duplicate writes during that window still coalesce
    // into the Map (latest event per path), but distinct paths
    // continue to land in the renderer in near-real time.
    if (this.debounceTimeout) return;
    this.debounceTimeout = setTimeout(() => {
      for (const event of this.pendingEvents.values()) {
        this.emit('file-change', event);
      }
      this.pendingEvents.clear();
      this.debounceTimeout = null;
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * Watch manifest.json with optimized settings for reliability
   */
  async watchManifest(manifestPath: string): Promise<void> {
    if (this.manifestWatcher) {
      this.manifestWatcher.close();
    }

    const chokidar = await import('chokidar');
    this.manifestWatcher = chokidar.watch(manifestPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms after last change
        pollInterval: 50, // Check every 50ms
      },
      usePolling: false, // Use native events when possible
    });

    const emitChange = (type: FileChangeEvent['type'], filePath: string) => {
      this.emitDebouncedChange(type, filePath);
    };

    this.manifestWatcher
      .on('change', (p: string) => {
        console.log(`[FileSystemManager] Manifest changed: ${p}`);
        emitChange('change', p);
      })
      .on('error', (error: Error) => {
        console.error('[FileSystemManager] Manifest watcher error:', error);
        // Retry watching after a delay
        setTimeout(() => {
          if (fs.existsSync(manifestPath)) {
            this.watchManifest(manifestPath).catch((err) => {
              console.error(
                '[FileSystemManager] Failed to retry manifest watch:',
                err,
              );
            });
          }
        }, 1000);
      });
  }

  /**
   * Watch image-placements directory with optimized settings
   */
  async watchImagePlacements(imagePlacementsDir: string): Promise<void> {
    if (this.imagePlacementsWatcher) {
      this.imagePlacementsWatcher.close();
    }

    // Ensure directory exists
    try {
      await fs.promises.mkdir(imagePlacementsDir, { recursive: true });
    } catch (error) {
      console.warn(
        `[FileSystemManager] Could not create image-placements directory: ${error}`,
      );
    }

    const chokidar = await import('chokidar');
    this.imagePlacementsWatcher = chokidar.watch(imagePlacementsDir, {
      ignored: IGNORED_PATTERNS,
      persistent: true,
      ignoreInitial: true,
      depth: 1, // Only watch direct children
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait 300ms after last change for image files
        pollInterval: 100,
      },
      usePolling: false,
    });

    const emitChange = (type: FileChangeEvent['type'], filePath: string) => {
      this.emitDebouncedChange(type, filePath);
    };

    this.imagePlacementsWatcher
      .on('add', (p: string) => {
        console.log(`[FileSystemManager] Image added: ${p}`);
        emitChange('add', p);
      })
      .on('change', (p: string) => {
        console.log(`[FileSystemManager] Image changed: ${p}`);
        emitChange('change', p);
      })
      .on('unlink', (p: string) => {
        console.log(`[FileSystemManager] Image removed: ${p}`);
        emitChange('unlink', p);
      })
      .on('error', (error: Error) => {
        console.error(
          '[FileSystemManager] Image placements watcher error:',
          error,
        );
        // Retry watching after a delay
        setTimeout(() => {
          if (fs.existsSync(imagePlacementsDir)) {
            this.watchImagePlacements(imagePlacementsDir).catch((err) => {
              console.error(
                '[FileSystemManager] Failed to retry image placements watch:',
                err,
              );
            });
          }
        }, 1000);
      });
  }

  async watchDirectory(dirPath: string): Promise<void> {
    const resolvedRoot = path.resolve(dirPath);
    this.activeProjectRoot = resolvedRoot;

    if (this.watcher) {
      this.watcher.close();
    }

    const chokidar = await import('chokidar');
    this.watcher = chokidar.watch(resolvedRoot, {
      ignored: IGNORED_PATTERNS,
      persistent: true,
      ignoreInitial: true,
      depth: 5, // Ensure .dhee/agent/content and .dhee/agent/{image,video}-placements are watched
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    const emitChange = (type: FileChangeEvent['type'], filePath: string) => {
      this.emitDebouncedChange(type, filePath);
    };

    this.watcher
      .on('add', (p: string) => emitChange('add', p))
      .on('change', (p: string) => emitChange('change', p))
      .on('unlink', (p: string) => emitChange('unlink', p))
      .on('addDir', (p: string) => emitChange('addDir', p))
      .on('unlinkDir', (p: string) => emitChange('unlinkDir', p))
      .on('error', (error: Error) => {
        console.error('[FileSystemManager] Directory watcher error:', error);
      });
  }

  unwatchDirectory(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.manifestWatcher) {
      this.manifestWatcher.close();
      this.manifestWatcher = null;
    }
    if (this.imagePlacementsWatcher) {
      this.imagePlacementsWatcher.close();
      this.imagePlacementsWatcher = null;
    }
    // Clear debounce timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    this.pendingEvents.clear();
    this.activeProjectRoot = null;
  }

  getActiveProjectRoot(): string | null {
    return this.activeProjectRoot;
  }

  getRecentProjects(): RecentProject[] {
    return this.store.get('recentProjects', []);
  }

  async getRecentProjectsValidated(): Promise<RecentProject[]> {
    const recentProjects = this.getRecentProjects();
    const validatedProjects = (
      await Promise.all(
        recentProjects.map(async (project) => {
          try {
            const stats = await fs.promises.stat(project.path);
            return stats.isDirectory() ? project : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((project): project is RecentProject => project !== null);

    if (validatedProjects.length !== recentProjects.length) {
      this.store.set('recentProjects', validatedProjects);
    }

    return validatedProjects;
  }

  addRecentProject(projectPath: string): void {
    const recentProjects = this.getRecentProjects();
    const name = path.basename(projectPath);
    const now = Date.now();

    // Remove if already exists
    const filtered = recentProjects.filter((p) => p.path !== projectPath);

    // Add to front
    const updated: RecentProject[] = [
      { path: projectPath, name, lastOpened: now },
      ...filtered,
    ];

    this.store.set('recentProjects', updated);
  }

  removeRecentProject(projectPath: string): void {
    const recentProjects = this.getRecentProjects();
    const filtered = recentProjects.filter(
      (project) => project.path !== projectPath,
    );
    if (filtered.length !== recentProjects.length) {
      this.store.set('recentProjects', filtered);
    }
  }

  replaceRecentProjectPath(
    oldPath: string,
    newPath: string,
    newName?: string,
  ): void {
    const recentProjects = this.getRecentProjects();
    const updated = recentProjects.map((project) =>
      project.path === oldPath
        ? {
            ...project,
            path: newPath,
            name: newName || path.basename(newPath),
          }
        : project,
    );
    this.store.set('recentProjects', updated);
  }

  async rename(oldPath: string, newName: string): Promise<string> {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    await fs.promises.rename(oldPath, newPath);
    return newPath;
  }

  async renameProject(projectPath: string, newName: string): Promise<string> {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      throw new Error('Project name is required.');
    }

    const parentDir = path.dirname(projectPath);
    const renamedPath = path.join(parentDir, trimmedName);

    if (renamedPath === projectPath) {
      await this.updateProjectManifestTitle(renamedPath, trimmedName);
      this.replaceRecentProjectPath(projectPath, renamedPath, trimmedName);
      return renamedPath;
    }

    let renamedPathExists = false;
    try {
      await fs.promises.stat(renamedPath);
      renamedPathExists = true;
    } catch (error: unknown) {
      const err = error as { code?: string };
      // Only ENOENT is recoverable. Anything else (EACCES, EIO, …)
      // bubbles so the caller sees the real reason rename can't run.
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }
    if (renamedPathExists) {
      throw new Error(
        `A project named "${trimmedName}" already exists in this location.`,
      );
    }

    await fs.promises.rename(projectPath, renamedPath);
    await this.updateProjectManifestTitle(renamedPath, trimmedName);
    this.replaceRecentProjectPath(projectPath, renamedPath, trimmedName);
    return renamedPath;
  }

  async delete(targetPath: string): Promise<void> {
    const stats = await fs.promises.stat(targetPath);
    if (stats.isDirectory()) {
      await fs.promises.rm(targetPath, { recursive: true });
    } else {
      await fs.promises.unlink(targetPath);
    }
  }

  async deleteProject(projectPath: string): Promise<void> {
    await this.delete(projectPath);
    this.removeRecentProject(projectPath);
  }

  async move(sourcePath: string, destDir: string): Promise<string> {
    const name = path.basename(sourcePath);
    const destPath = path.join(destDir, name);
    await fs.promises.rename(sourcePath, destPath);
    return destPath;
  }

  async copy(sourcePath: string, destDir: string): Promise<string> {
    const name = path.basename(sourcePath);
    const destPath = path.join(destDir, name);
    const stats = await fs.promises.stat(sourcePath);
    if (stats.isDirectory()) {
      await this.copyDir(sourcePath, destPath);
    } else {
      await fs.promises.copyFile(sourcePath, destPath);
    }
    return destPath;
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }

  private async updateProjectManifestTitle(
    projectPath: string,
    title: string,
  ): Promise<void> {
    const manifestPath = path.join(projectPath, 'project.json');
    let manifestRaw: string;
    try {
      manifestRaw = await fs.promises.readFile(manifestPath, 'utf-8');
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    let manifest: BackendProjectManifest;
    try {
      manifest = JSON.parse(manifestRaw) as BackendProjectManifest;
    } catch {
      return;
    }

    manifest.title = title;
    await fs.promises.writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8',
    );
  }

  async revealInFinder(targetPath: string): Promise<void> {
    const { shell } = await import('electron');
    shell.showItemInFolder(targetPath);
  }
}

export default new FileSystemManager();
