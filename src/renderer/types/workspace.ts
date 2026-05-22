import type {
  FileNode,
  RecentProject,
  FileType,
} from '../../shared/fileSystemTypes';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export interface ConnectionState {
  server: ConnectionStatus;
}

export interface SelectedFile {
  path: string;
  name: string;
  type: FileType;
}

export interface WorkspaceState {
  projectDirectory: string | null;
  projectName: string | null;
  fileTree: FileNode | null;
  selectedFile: SelectedFile | null;
  activeContextFiles: SelectedFile[];
  recentProjects: RecentProject[];
  recentProjectsLoaded: boolean;
  connectionState: ConnectionState;
  isLoading: boolean;
  pendingFileNavigation: string | null;
}

export interface ProjectSwitchGuardContext {
  fromProjectDirectory: string | null;
  toProjectDirectory: string;
}

export type ProjectSwitchGuard = (
  context: ProjectSwitchGuardContext,
) => boolean | Promise<boolean>;

export interface WorkspaceActions {
  openProject: (path: string) => Promise<void>;
  refreshRecentProjects: () => Promise<void>;
  registerProjectSwitchGuard: (guard: ProjectSwitchGuard) => () => void;
  closeProject: () => void;
  selectFile: (file: SelectedFile | null) => void;
  addToActiveContext: (file: SelectedFile) => void;
  removeFromActiveContext: (path: string) => void;
  refreshFileTree: () => Promise<void>;
  setConnectionStatus: (
    service: keyof ConnectionState,
    status: ConnectionStatus,
  ) => void;
  loadDirectory: (path: string) => Promise<void>;
  navigateToFile: (filePath: string) => void;
  clearFileNavigation: () => void;
}

export type WorkspaceContextType = WorkspaceState & WorkspaceActions;
