import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  WorkspaceContextType,
  WorkspaceState,
  SelectedFile,
  ConnectionStatus,
  ConnectionState,
  ProjectSwitchGuard,
} from '../types/workspace';
import type { FileNode } from '../../shared/fileSystemTypes';
import { runProjectSwitchGuards } from './workspaceGuards';

// Helper to find and update a node in the tree
const updateNodeInTree = (
  root: FileNode,
  path: string,
  children: FileNode[],
): FileNode => {
  if (root.path === path) {
    return { ...root, children, type: 'directory' };
  }
  if (root.children) {
    return {
      ...root,
      children: root.children.map((child) =>
        updateNodeInTree(child, path, children),
      ),
    };
  }
  return root;
};

const initialState: WorkspaceState = {
  projectDirectory: null,
  projectName: null,
  fileTree: null,
  selectedFile: null,
  activeContextFiles: [],
  recentProjects: [],
  recentProjectsLoaded: false,
  connectionState: {
    server: 'disconnected',
  },
  isLoading: false,
  pendingFileNavigation: null,
};

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
}

function normalizeProjectPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const [state, setState] = useState<WorkspaceState>(initialState);
  const projectSwitchGuardsRef = useRef<Set<ProjectSwitchGuard>>(new Set());
  const currentProjectDirectoryRef = useRef<string | null>(null);
  const fileTreeRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const refreshRecentProjects = useCallback(async () => {
    try {
      const recent = await window.electron.project.getRecent();
      setState((prev) => ({
        ...prev,
        recentProjects: recent,
        recentProjectsLoaded: true,
      }));
    } catch {
      setState((prev) => ({ ...prev, recentProjectsLoaded: true }));
    }
  }, []);

  useEffect(() => {
    currentProjectDirectoryRef.current = state.projectDirectory;
  }, [state.projectDirectory]);

  // Load recent projects on mount
  useEffect(() => {
    refreshRecentProjects();
  }, [refreshRecentProjects]);

  // Subscribe to file changes
  useEffect(() => {
    if (!state.projectDirectory) return undefined;

    const projectRoot = normalizeProjectPath(state.projectDirectory);

    const unsubscribe = window.electron.project.onFileChange((event) => {
      const eventPath = event?.path ? event.path.replace(/\\/g, '/') : '';
      if (eventPath && !eventPath.startsWith(`${projectRoot}/`)) {
        return;
      }

      if (
        eventPath.endsWith('/.DS_Store') ||
        eventPath.includes('/.git/') ||
        eventPath.includes('/node_modules/')
      ) {
        return;
      }

      if (fileTreeRefreshDebounceRef.current) {
        clearTimeout(fileTreeRefreshDebounceRef.current);
      }

      fileTreeRefreshDebounceRef.current = setTimeout(() => {
        fileTreeRefreshDebounceRef.current = null;

        const start =
          process.env.NODE_ENV === 'development' ? performance.now() : 0;

        window.electron.project
          .readTree(projectRoot, 1)
          .then((tree: FileNode) => {
            if (process.env.NODE_ENV === 'development') {
              // eslint-disable-next-line no-console
              console.debug(
                `[perf][WorkspaceContext] readTree(root,1) ${(performance.now() - start).toFixed(1)}ms`,
              );
            }
            setState((prev) => ({ ...prev, fileTree: tree }));
            return tree;
          })
          .catch(() => {});
      }, 500);
    });

    return () => {
      unsubscribe();
      if (fileTreeRefreshDebounceRef.current) {
        clearTimeout(fileTreeRefreshDebounceRef.current);
        fileTreeRefreshDebounceRef.current = null;
      }
    };
  }, [state.projectDirectory]);

  const registerProjectSwitchGuard = useCallback(
    (guard: ProjectSwitchGuard) => {
      projectSwitchGuardsRef.current.add(guard);
      return () => {
        projectSwitchGuardsRef.current.delete(guard);
      };
    },
    [],
  );

  const openProject = useCallback(
    async (path: string) => {
      const normalizedPath = normalizeProjectPath(path);
      const previousProjectDirectory = currentProjectDirectoryRef.current;

      if (
        previousProjectDirectory &&
        previousProjectDirectory !== normalizedPath
      ) {
        try {
          const shouldProceed = await runProjectSwitchGuards(
            projectSwitchGuardsRef.current,
            {
              fromProjectDirectory: previousProjectDirectory,
              toProjectDirectory: normalizedPath,
            },
          );
          if (!shouldProceed) {
            return;
          }
        } catch (error) {
          console.error(
            '[WorkspaceContext] Project switch guard failed, blocking switch:',
            error,
          );
          return;
        }
      }

      setState((prev) => ({ ...prev, isLoading: true }));
      let directoryWatchStarted: string | null = null;
      try {
        const exists = await window.electron.project.checkFileExists(path);
        if (!exists) {
          await refreshRecentProjects();
          throw new Error('Selected project folder does not exist anymore.');
        }

        // A folder without project.json is no longer an error: the
        // wizard panel will fire for first-time setup and the agent's
        // dhee_new tool will write project.json. The renderer never
        // writes project.json directly (System-B was removed; dhee_new
        // is the sole writer).
        const hasRootProjectFile =
          await window.electron.project.checkFileExists(
            `${normalizedPath}/project.json`,
          );
        const hasLegacyAgentProjectFile =
          await window.electron.project.checkFileExists(
            `${normalizedPath}/.dhee/agent/project.json`,
          );
        if (!hasRootProjectFile && !hasLegacyAgentProjectFile) {
          console.info(
            '[WorkspaceContext] Opening uninitialized folder (no project.json yet) — the wizard will collect setup and dhee_new will populate it.',
          );
        }

        // Read only first level to prevent freeze
        const tree = await window.electron.project.readTree(path, 1);
        const projectName = (normalizedPath.split('/').pop() || path).replace(
          /\.dhee$/i,
          '',
        );

        if (
          previousProjectDirectory &&
          previousProjectDirectory !== normalizedPath
        ) {
          await window.electron.project
            .unwatchDirectory(previousProjectDirectory)
            .catch(() => undefined);
        }

        // Start watching the directory
        await window.electron.project.watchDirectory(path);
        directoryWatchStarted = path;

        // Add to recent projects
        await window.electron.project.addRecent(path);
        const recent = await window.electron.project.getRecent();

        setState((prev) => ({
          ...prev,
          projectDirectory: normalizedPath,
          projectName,
          fileTree: tree,
          recentProjects: recent,
          recentProjectsLoaded: true,
          isLoading: false,
          selectedFile: null,
          activeContextFiles: [],
        }));

        console.log('[WorkspaceContext] Project opened:', {
          projectDirectory: normalizedPath,
          projectName,
        });
      } catch (error) {
        if (directoryWatchStarted) {
          await window.electron.project
            .unwatchDirectory(directoryWatchStarted)
            .catch(() => undefined);
        }
        setState((prev) => ({ ...prev, isLoading: false }));
        throw error;
      }
    },
    [refreshRecentProjects],
  );

  const closeProject = useCallback(() => {
    if (state.projectDirectory) {
      window.electron.project.unwatchDirectory(state.projectDirectory);
    }
    setState((prev) => ({
      ...prev,
      projectDirectory: null,
      projectName: null,
      fileTree: null,
      selectedFile: null,
      activeContextFiles: [],
    }));
  }, [state.projectDirectory]);

  const selectFile = useCallback((file: SelectedFile | null) => {
    setState((prev) => ({ ...prev, selectedFile: file }));
  }, []);

  const addToActiveContext = useCallback((file: SelectedFile) => {
    setState((prev) => {
      const exists = prev.activeContextFiles.some((f) => f.path === file.path);
      if (exists) return prev;
      return {
        ...prev,
        activeContextFiles: [...prev.activeContextFiles, file],
      };
    });
  }, []);

  const removeFromActiveContext = useCallback((path: string) => {
    setState((prev) => ({
      ...prev,
      activeContextFiles: prev.activeContextFiles.filter(
        (f) => f.path !== path,
      ),
    }));
  }, []);

  const refreshFileTree = useCallback(async () => {
    if (!state.projectDirectory) return;
    try {
      const tree = await window.electron.project.readTree(
        state.projectDirectory,
        1,
      );
      setState((prev) => ({ ...prev, fileTree: tree }));
    } catch {
      // Failed to refresh file tree
    }
  }, [state.projectDirectory]);

  const setConnectionStatus = useCallback(
    (service: keyof ConnectionState, status: ConnectionStatus) => {
      setState((prev) => ({
        ...prev,
        connectionState: {
          ...prev.connectionState,
          [service]: status,
        },
      }));
    },
    [],
  );

  const openFolderDialog = useCallback(async () => {
    const path = await window.electron.project.selectDirectory();
    if (path) {
      await openProject(path);
    }
  }, [openProject]);

  const loadDirectory = useCallback(async (path: string) => {
    try {
      // Read specific directory (depth 1)
      const node = await window.electron.project.readTree(path, 1);

      setState((prev) => {
        if (!prev.fileTree) return prev;

        // If we loaded the root (unlikely via this method), just replace
        if (prev.fileTree.path === path) {
          return { ...prev, fileTree: node };
        }

        // Otherwise graft the new children into the existing tree
        const newTree = updateNodeInTree(
          prev.fileTree,
          path,
          node.children || [],
        );
        return { ...prev, fileTree: newTree };
      });
    } catch (err) {
      console.error('Failed to load directory:', err);
    }
  }, []);

  const navigateToFile = useCallback((filePath: string) => {
    setState((prev) => ({ ...prev, pendingFileNavigation: filePath }));
  }, []);

  const clearFileNavigation = useCallback(() => {
    setState((prev) => ({ ...prev, pendingFileNavigation: null }));
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === 'o' && !e.shiftKey) {
        e.preventDefault();
        openFolderDialog();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openFolderDialog]);

  const value = useMemo<WorkspaceContextType>(
    () => ({
      ...state,
      openProject,
      refreshRecentProjects,
      registerProjectSwitchGuard,
      closeProject,
      selectFile,
      addToActiveContext,
      removeFromActiveContext,
      refreshFileTree,
      setConnectionStatus,
      loadDirectory,
      navigateToFile,
      clearFileNavigation,
    }),
    [
      state,
      openProject,
      refreshRecentProjects,
      registerProjectSwitchGuard,
      closeProject,
      selectFile,
      addToActiveContext,
      removeFromActiveContext,
      refreshFileTree,
      setConnectionStatus,
      loadDirectory,
      navigateToFile,
      clearFileNavigation,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextType {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
