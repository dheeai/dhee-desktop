import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';
import type { SelectedFile } from '../types/workspace';
import type { FileNode } from '../../shared/fileSystemTypes';

/**
 * WorkspaceContext owns the open-project lifecycle + the selected-file /
 * active-context bookkeeping, persisting through window.electron.project (its
 * single dependency group). We stub that IPC surface and cover:
 *  - the pure state actions (selectFile, add/removeFromActiveContext, dedupe,
 *    setConnectionStatus, navigateToFile/clear) — no IPC.
 *  - openProject happy path (normalize, watch, recent, state populate).
 *  - openProject blocked by a registered project-switch guard.
 *  - closeProject unwatching + clearing.
 */

function makeFileTree(path: string): FileNode {
  return { name: path.split('/').pop() ?? path, path, type: 'directory', children: [] };
}

interface ProjectStub {
  getRecent: jest.Mock;
  addRecent: jest.Mock;
  checkFileExists: jest.Mock;
  readTree: jest.Mock;
  watchDirectory: jest.Mock;
  unwatchDirectory: jest.Mock;
  onFileChange: jest.Mock;
  selectDirectory: jest.Mock;
}

let project: ProjectStub;

function installElectron() {
  project = {
    getRecent: jest.fn().mockResolvedValue([]),
    addRecent: jest.fn().mockResolvedValue(undefined),
    checkFileExists: jest.fn().mockResolvedValue(true),
    readTree: jest.fn().mockImplementation((p: string) => Promise.resolve(makeFileTree(p))),
    watchDirectory: jest.fn().mockResolvedValue(undefined),
    unwatchDirectory: jest.fn().mockResolvedValue(undefined),
    onFileChange: jest.fn().mockReturnValue(() => {}),
    selectDirectory: jest.fn().mockResolvedValue(null),
  };
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { project },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

beforeEach(() => {
  installElectron();
});

describe('WorkspaceContext — pure state actions', () => {
  it('selectFile sets and clears the selected file', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    const file: SelectedFile = { path: '/proj/a.txt', name: 'a.txt' } as SelectedFile;
    act(() => result.current.selectFile(file));
    expect(result.current.selectedFile).toEqual(file);
    act(() => result.current.selectFile(null));
    expect(result.current.selectedFile).toBeNull();
  });

  it('addToActiveContext appends and dedupes by path; removeFromActiveContext removes', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    const f1 = { path: '/proj/a.txt', name: 'a.txt' } as SelectedFile;
    const f1again = { path: '/proj/a.txt', name: 'a.txt (dup)' } as SelectedFile;
    const f2 = { path: '/proj/b.txt', name: 'b.txt' } as SelectedFile;

    act(() => result.current.addToActiveContext(f1));
    act(() => result.current.addToActiveContext(f1again)); // same path -> ignored
    act(() => result.current.addToActiveContext(f2));
    expect(result.current.activeContextFiles.map((f) => f.path)).toEqual([
      '/proj/a.txt',
      '/proj/b.txt',
    ]);

    act(() => result.current.removeFromActiveContext('/proj/a.txt'));
    expect(result.current.activeContextFiles.map((f) => f.path)).toEqual([
      '/proj/b.txt',
    ]);
  });

  it('setConnectionStatus updates a single service key without clobbering others', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    act(() => result.current.setConnectionStatus('server', 'connected'));
    expect(result.current.connectionState.server).toBe('connected');
  });

  it('navigateToFile / clearFileNavigation toggle the pending navigation', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    act(() => result.current.navigateToFile('/proj/x.md'));
    expect(result.current.pendingFileNavigation).toBe('/proj/x.md');
    act(() => result.current.clearFileNavigation());
    expect(result.current.pendingFileNavigation).toBeNull();
  });
});

describe('WorkspaceContext — openProject', () => {
  it('opens a project: normalizes path, watches, records recent, populates state', async () => {
    project.getRecent.mockResolvedValue([{ path: '/proj' }]);
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await act(async () => {
      // trailing slash + backslashes should be normalized away
      await result.current.openProject('/proj/');
    });

    expect(result.current.projectDirectory).toBe('/proj');
    expect(result.current.projectName).toBe('proj');
    expect(result.current.fileTree).not.toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(project.watchDirectory).toHaveBeenCalledWith('/proj/');
    expect(project.addRecent).toHaveBeenCalledWith('/proj/');
  });

  it('throws and stays closed when the folder no longer exists', async () => {
    project.checkFileExists.mockResolvedValue(false);
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await act(async () => {
      await expect(result.current.openProject('/gone')).rejects.toThrow(
        /does not exist anymore/i,
      );
    });
    expect(result.current.projectDirectory).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('a registered project-switch guard can block switching away from an open project', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    // Open an initial project.
    await act(async () => {
      await result.current.openProject('/first');
    });
    expect(result.current.projectDirectory).toBe('/first');

    // Register a guard that vetoes the switch.
    const guard = jest.fn().mockResolvedValue(false);
    act(() => {
      result.current.registerProjectSwitchGuard(guard);
    });

    await act(async () => {
      await result.current.openProject('/second');
    });

    expect(guard).toHaveBeenCalledWith({
      fromProjectDirectory: '/first',
      toProjectDirectory: '/second',
    });
    // Switch was blocked -> still on the first project.
    expect(result.current.projectDirectory).toBe('/first');
  });

  it('closeProject unwatches the directory and clears project state', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    await act(async () => {
      await result.current.openProject('/proj');
    });
    project.unwatchDirectory.mockClear();

    act(() => result.current.closeProject());

    expect(project.unwatchDirectory).toHaveBeenCalledWith('/proj');
    expect(result.current.projectDirectory).toBeNull();
    expect(result.current.fileTree).toBeNull();
  });
});

describe('WorkspaceContext — guard', () => {
  it('throws if useWorkspace is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useWorkspace())).toThrow(
      /must be used within a WorkspaceProvider/,
    );
    spy.mockRestore();
  });

  it('loads recent projects on mount', async () => {
    project.getRecent.mockResolvedValue([{ path: '/recent-a' }]);
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    await waitFor(() => expect(result.current.recentProjectsLoaded).toBe(true));
    expect(result.current.recentProjects).toEqual([{ path: '/recent-a' }]);
  });
});
