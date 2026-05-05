// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  BackendConnectionInfo,
  BackendState,
  ServerConnectionConfig,
} from '../shared/backendTypes';
import type { AppSettings } from '../shared/settingsTypes';
import type {
  FileNode,
  RecentProject,
  FileChangeEvent,
} from '../shared/fileSystemTypes';
import type {
  RemotionJob,
  RemotionProgress,
  RemotionTimelineItem,
  ParsedInfographicPlacement,
  RemotionServerRenderRequest,
  RemotionServerRenderResult,
  RemotionServerRenderProgress,
} from '../shared/remotionTypes';
import type { ChatExportPayload, ChatExportResult } from '../shared/chatTypes';
import type { AccountInfo } from '../shared/settingsTypes';

interface WordTimestamp {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

interface TextOverlayWord {
  text: string;
  startTime: number;
  endTime: number;
  charStart: number;
  charEnd: number;
}

interface TextOverlayCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words: TextOverlayWord[];
}

interface PromptOverlayCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

interface FileOpMeta {
  opId?: string | null;
  source?: 'agent_ws' | 'renderer';
  intent?: 'new_project_parent';
  projectRoot?: string | null;
}

type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface AppUpdateStatus {
  phase: AppUpdatePhase;
  version?: string;
  progressPercent?: number;
  message?: string;
  manualCheckAvailable?: boolean;
  checkedAt: number;
}

export type Channels = 'ipc-example';

const backendBridge = {
  start(config?: ServerConnectionConfig): Promise<BackendState> {
    return ipcRenderer.invoke('backend:start', config);
  },
  restart(): Promise<BackendState> {
    return ipcRenderer.invoke('backend:restart');
  },
  stop(): Promise<BackendState> {
    return ipcRenderer.invoke('backend:stop');
  },
  getState(): Promise<BackendState> {
    return ipcRenderer.invoke('backend:get-state');
  },
  getConnectionInfo(): Promise<BackendConnectionInfo> {
    return ipcRenderer.invoke('backend:get-connection-info');
  },
  onStateChange(callback: (state: BackendState) => void) {
    const subscription = (_event: IpcRendererEvent, state: BackendState) => {
      callback(state);
    };
    ipcRenderer.on('backend:state', subscription);
    return () => {
      ipcRenderer.removeListener('backend:state', subscription);
    };
  },
};

const settingsBridge = {
  get(): Promise<AppSettings> {
    return ipcRenderer.invoke('settings:get');
  },
  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    return ipcRenderer.invoke('settings:update', patch);
  },
  onChange(callback: (settings: AppSettings) => void) {
    const subscription = (_event: IpcRendererEvent, settings: AppSettings) => {
      callback(settings);
    };
    ipcRenderer.on('settings:updated', subscription);
    return () => {
      ipcRenderer.removeListener('settings:updated', subscription);
    };
  },
};

const projectBridge = {
  selectDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('project:select-directory');
  },
  selectVideoFile(): Promise<string | null> {
    return ipcRenderer.invoke('project:select-video-file');
  },
  selectAudioFile(): Promise<string | null> {
    return ipcRenderer.invoke('project:select-audio-file');
  },
  getAudioDuration(audioPath: string): Promise<number> {
    return ipcRenderer.invoke('project:get-audio-duration', audioPath);
  },
  getAudioWaveform(
    audioPath: string,
    options?: { sampleCount?: number },
  ): Promise<{ peaks: number[]; duration: number }> {
    return ipcRenderer.invoke('project:get-audio-waveform', audioPath, options);
  },
  generateWordCaptions(
    projectDirectory: string,
    audioPath?: string,
  ): Promise<{
    success: boolean;
    outputPath?: string;
    words?: WordTimestamp[];
    error?: string;
  }> {
    return ipcRenderer.invoke(
      'project:generate-word-captions',
      projectDirectory,
      audioPath,
    );
  },
  // extractYoutubeAudio removed - can be re-added later if needed
  readTree(dirPath: string, depth?: number): Promise<FileNode> {
    return ipcRenderer.invoke('project:read-tree', dirPath, depth);
  },
  readFile(filePath: string): Promise<string | null> {
    return ipcRenderer.invoke('project:read-file', filePath);
  },
  readFileGuarded(filePath: string, meta?: FileOpMeta): Promise<string> {
    return ipcRenderer.invoke('project:read-file-guarded', filePath, meta);
  },
  readFileBufferGuarded(
    filePath: string,
    meta?: FileOpMeta,
  ): Promise<string> {
    return ipcRenderer.invoke(
      'project:read-file-buffer-guarded',
      filePath,
      meta,
    );
  },
  checkFileExists(filePath: string): Promise<boolean> {
    return ipcRenderer.invoke('project:check-file-exists', filePath);
  },
  listDirectory(dirPath: string, meta?: FileOpMeta): Promise<string[]> {
    return ipcRenderer.invoke('project:list-directory', dirPath, meta);
  },
  statPath(
    targetPath: string,
    meta?: FileOpMeta,
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> {
    return ipcRenderer.invoke('project:stat-path', targetPath, meta);
  },
  readAllFiles(projectDir: string): Promise<Array<{ path: string; content: string; isBinary: boolean }>> {
    return ipcRenderer.invoke('project:read-all-files', projectDir);
  },
  readProjectSnapshot(projectDir: string): Promise<{
    files: Record<string, string>;
    directories: string[];
    projectRoot: string;
  }> {
    return ipcRenderer.invoke('project:read-project-snapshot', projectDir);
  },
  mkdir(dirPath: string, meta?: FileOpMeta): Promise<void> {
    return ipcRenderer.invoke('project:mkdir', dirPath, meta);
  },
  readFileBase64(filePath: string): Promise<string | null> {
    return ipcRenderer.invoke('project:read-file-base64', filePath);
  },
  writeFile(filePath: string, content: string, meta?: FileOpMeta): Promise<void> {
    return ipcRenderer.invoke('project:write-file', filePath, content, meta);
  },
  writeFileBinary(
    filePath: string,
    base64Data: string,
    meta?: FileOpMeta,
  ): Promise<void> {
    return ipcRenderer.invoke(
      'project:write-file-binary',
      filePath,
      base64Data,
      meta,
    );
  },
  createFile(
    basePath: string,
    relativePath: string,
    meta?: FileOpMeta,
  ): Promise<string | null> {
    return ipcRenderer.invoke('project:create-file', basePath, relativePath, meta);
  },
  createFolder(
    basePath: string,
    relativePath: string,
    meta?: FileOpMeta,
  ): Promise<string | null> {
    return ipcRenderer.invoke('project:create-folder', basePath, relativePath, meta);
  },
  rename(oldPath: string, newName: string): Promise<string> {
    return ipcRenderer.invoke('project:rename', oldPath, newName);
  },
  delete(targetPath: string, meta?: FileOpMeta): Promise<void> {
    return ipcRenderer.invoke('project:delete', targetPath, meta);
  },
  move(sourcePath: string, destDir: string): Promise<string> {
    return ipcRenderer.invoke('project:move', sourcePath, destDir);
  },
  copy(sourcePath: string, destDir: string): Promise<string> {
    return ipcRenderer.invoke('project:copy', sourcePath, destDir);
  },
  copyFileExact(
    sourcePath: string,
    destinationPath: string,
    meta?: FileOpMeta,
  ): Promise<void> {
    return ipcRenderer.invoke(
      'project:copy-file-exact',
      sourcePath,
      destinationPath,
      meta,
    );
  },
  revealInFinder(targetPath: string): Promise<void> {
    return ipcRenderer.invoke('project:reveal-in-finder', targetPath);
  },
  watchDirectory(dirPath: string): Promise<void> {
    return ipcRenderer.invoke('project:watch-directory', dirPath);
  },
  watchManifest(manifestPath: string): Promise<void> {
    return ipcRenderer.invoke('project:watch-manifest', manifestPath);
  },
  watchImagePlacements(imagePlacementsDir: string): Promise<void> {
    return ipcRenderer.invoke(
      'project:watch-image-placements',
      imagePlacementsDir,
    );
  },
  watchInfographicPlacements(infographicPlacementsDir: string): Promise<void> {
    return ipcRenderer.invoke(
      'project:watch-infographic-placements',
      infographicPlacementsDir,
    );
  },
  refreshAssets(
    projectDirectory: string,
  ): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('project:refresh-assets', projectDirectory);
  },
  unwatchDirectory(dirPath: string): Promise<void> {
    return ipcRenderer.invoke('project:unwatch-directory', dirPath);
  },
  getRecent(): Promise<RecentProject[]> {
    return ipcRenderer.invoke('project:get-recent');
  },
  addRecent(projectPath: string): Promise<void> {
    return ipcRenderer.invoke('project:add-recent', projectPath);
  },
  removeRecent(projectPath: string): Promise<void> {
    return ipcRenderer.invoke('project:remove-recent', projectPath);
  },
  renameProject(projectPath: string, newName: string): Promise<string> {
    return ipcRenderer.invoke('project:rename-project', projectPath, newName);
  },
  deleteProject(projectPath: string): Promise<void> {
    return ipcRenderer.invoke('project:delete-project', projectPath);
  },
  getResourcesPath(): Promise<string> {
    return ipcRenderer.invoke('project:get-resources-path');
  },
  saveVideoFile(): Promise<string | null> {
    return ipcRenderer.invoke('project:save-video-file');
  },
  exportChatJson(payload: ChatExportPayload): Promise<ChatExportResult> {
    return ipcRenderer.invoke('project:export-chat-json', payload);
  },
  composeTimelineVideo(
    timelineItems: Array<{
      type: 'image' | 'video' | 'placeholder';
      path: string;
      duration: number;
      startTime: number;
      endTime: number;
      sourceOffsetSeconds?: number;
      label?: string;
    }>,
    projectDirectory: string,
    audioPath?: string,
    overlayItems?: Array<{
      path: string;
      duration: number;
      startTime: number;
      endTime: number;
    }>,
    textOverlayCues?: TextOverlayCue[],
    promptOverlayCues?: PromptOverlayCue[],
    exportOptions?: {
      aspectRatio: '16:9' | '9:16';
      quality: 'standard' | 'high';
    },
  ): Promise<{ success: boolean; outputPath?: string; duration?: number; error?: string }> {
    return ipcRenderer.invoke(
      'project:compose-timeline-video',
      timelineItems,
      projectDirectory,
      audioPath,
      overlayItems,
      textOverlayCues,
      promptOverlayCues,
      exportOptions,
    );
  },
  exportCapcut(
    timelineItems: Array<{
      type: 'image' | 'video' | 'placeholder';
      path: string;
      duration: number;
      startTime: number;
      endTime: number;
      sourceOffsetSeconds?: number;
      label?: string;
    }>,
    projectDirectory: string,
    audioPath?: string,
    overlayItems?: Array<{
      path: string;
      duration: number;
      startTime: number;
      endTime: number;
      label?: string;
    }>,
    textOverlayCues?: TextOverlayCue[],
    promptOverlayCues?: PromptOverlayCue[],
  ): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    return ipcRenderer.invoke(
      'project:export-capcut',
      timelineItems,
      projectDirectory,
      audioPath,
      overlayItems,
      textOverlayCues,
      promptOverlayCues,
    );
  },
  onFileChange(callback: (event: FileChangeEvent) => void) {
    const subscription = (
      _event: IpcRendererEvent,
      fileEvent: FileChangeEvent,
    ) => {
      callback(fileEvent);
    };
    ipcRenderer.on('project:file-changed', subscription);
    return () => {
      ipcRenderer.removeListener('project:file-changed', subscription);
    };
  },
  onManifestWritten(callback: (event: { path: string; at: number }) => void) {
    const subscription = (
      _event: IpcRendererEvent,
      manifestEvent: { path: string; at: number },
    ) => {
      callback(manifestEvent);
    };
    ipcRenderer.on('project:manifest-written', subscription);
    return () => {
      ipcRenderer.removeListener('project:manifest-written', subscription);
    };
  },
};

const remotionBridge = {
  renderInfographics(
    projectDirectory: string,
    timelineItems: RemotionTimelineItem[],
    infographicPlacements: ParsedInfographicPlacement[],
  ): Promise<{ jobId: string; error?: string }> {
    return ipcRenderer.invoke(
      'remotion:render-infographics',
      projectDirectory,
      timelineItems,
      infographicPlacements,
    );
  },
  cancelJob(jobId: string): Promise<void> {
    return ipcRenderer.invoke('remotion:cancel-job', jobId);
  },
  getJob(jobId: string): Promise<RemotionJob | null> {
    return ipcRenderer.invoke('remotion:get-job', jobId);
  },
  renderFromServerRequest(
    projectDirectory: string,
    request: RemotionServerRenderRequest,
    onProgress?: (progress: RemotionServerRenderProgress) => void,
  ): Promise<RemotionServerRenderResult> {
    const subscription = (
      _event: IpcRendererEvent,
      progress: RemotionServerRenderProgress,
    ) => {
      if (!onProgress) {
        return;
      }
      if (progress.requestId !== request.requestId) {
        return;
      }
      onProgress(progress);
    };
    if (onProgress) {
      ipcRenderer.on('remotion:server-progress', subscription);
    }

    return ipcRenderer
      .invoke(
        'remotion:render-from-server-request',
        projectDirectory,
        request,
      )
      .finally(() => {
        if (onProgress) {
          ipcRenderer.removeListener('remotion:server-progress', subscription);
        }
      });
  },
  onProgress(callback: (progress: RemotionProgress) => void) {
    const subscription = (_event: IpcRendererEvent, progress: RemotionProgress) =>
      callback(progress);
    ipcRenderer.on('remotion:progress', subscription);
    return () => ipcRenderer.removeListener('remotion:progress', subscription);
  },
  onJobComplete(callback: (job: RemotionJob) => void) {
    const subscription = (_event: IpcRendererEvent, job: RemotionJob) =>
      callback(job);
    ipcRenderer.on('remotion:job-complete', subscription);
    return () => ipcRenderer.removeListener('remotion:job-complete', subscription);
  },
};

const loggerBridge = {
  init(): Promise<void> {
    return ipcRenderer.invoke('logger:init');
  },
  logUserInput(content: string): Promise<void> {
    return ipcRenderer.invoke('logger:user-input', content);
  },
  logAgentText(text: string, agentName?: string): Promise<void> {
    return ipcRenderer.invoke('logger:agent-text', text, agentName);
  },
  logToolStart(
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    return ipcRenderer.invoke('logger:tool-start', toolName, args);
  },
  logToolComplete(
    toolName: string,
    result: unknown,
    duration?: number,
    isError?: boolean,
  ): Promise<void> {
    return ipcRenderer.invoke(
      'logger:tool-complete',
      toolName,
      result,
      duration,
      isError,
    );
  },
  logQuestion(
    question: string,
    options?: Array<{ label: string; description?: string }>,
    isConfirmation?: boolean,
    autoApproveTimeoutMs?: number,
  ): Promise<void> {
    return ipcRenderer.invoke(
      'logger:question',
      question,
      options,
      isConfirmation,
      autoApproveTimeoutMs,
    );
  },
  logStatusChange(
    status: string,
    agentName?: string,
    message?: string,
  ): Promise<void> {
    return ipcRenderer.invoke(
      'logger:status-change',
      status,
      agentName,
      message,
    );
  },
  logPhaseTransition(
    fromPhase: string,
    toPhase: string,
    success: boolean,
    reason?: string,
  ): Promise<void> {
    return ipcRenderer.invoke(
      'logger:phase-transition',
      fromPhase,
      toPhase,
      success,
      reason,
    );
  },
  logTodoUpdate(
    todos: Array<{ content: string; status: string }>,
  ): Promise<void> {
    return ipcRenderer.invoke('logger:todo-update', todos);
  },
  logError(error: string, context?: Record<string, unknown>): Promise<void> {
    return ipcRenderer.invoke('logger:error', error, context);
  },
  logSessionEnd(): Promise<void> {
    return ipcRenderer.invoke('logger:session-end');
  },
  getLogPaths(): Promise<{
    uiLog: string;
    phaseLog: string;
    workflowLog: string;
  }> {
    return ipcRenderer.invoke('logger:get-paths');
  },
};

const updateBridge = {
  getStatus(): Promise<AppUpdateStatus> {
    return ipcRenderer.invoke('app-update:get-status');
  },
  checkNow(): Promise<AppUpdateStatus> {
    return ipcRenderer.invoke('app-update:check-now');
  },
  onStatusChange(callback: (status: AppUpdateStatus) => void) {
    const subscription = (_event: IpcRendererEvent, status: AppUpdateStatus) => {
      callback(status);
    };
    ipcRenderer.on('app-update:status', subscription);
    return () => {
      ipcRenderer.removeListener('app-update:status', subscription);
    };
  },
};

const appBridge = {
  getVersion(): Promise<string> {
    return ipcRenderer.invoke('app:get-version');
  },
};

const accountBridge = {
  get(): Promise<AccountInfo | null> {
    return ipcRenderer.invoke('account:get');
  },
  signIn(): Promise<{ opened: boolean }> {
    return ipcRenderer.invoke('account:sign-in');
  },
  signOut(): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('account:sign-out');
  },
  refreshBalance(): Promise<{ balance: number | null }> {
    return ipcRenderer.invoke('account:refresh-balance');
  },
  getBillingUrl(): Promise<string> {
    return ipcRenderer.invoke('account:get-billing-url');
  },
  openBilling(): Promise<{ opened: boolean; url: string }> {
    return ipcRenderer.invoke('account:open-billing');
  },
  onChange(callback: (account: AccountInfo | null) => void) {
    const subscription = () => {
      ipcRenderer.invoke('account:get').then(callback).catch(() => {});
    };
    ipcRenderer.on('account:changed', subscription);
    return () => {
      ipcRenderer.removeListener('account:changed', subscription);
    };
  },
};

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...ipcArgs: unknown[]) =>
        func(...ipcArgs);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...ipcArgs) => func(...ipcArgs));
    },
  },
  backend: backendBridge,
  settings: settingsBridge,
  project: projectBridge,
  remotion: remotionBridge,
  logger: loggerBridge,
  updates: updateBridge,
  app: appBridge,
  account: accountBridge,
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
