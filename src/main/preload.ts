// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AccountInfo, AppSettings } from '../shared/settingsTypes';
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
import type {
  CompleteOnboardingRequest,
  OnboardingState,
} from '../shared/onboardingTypes';
import type { ProviderDiagnosticsSnapshot } from '../shared/providerDiagnosticsTypes';
import type {
  BundleRunnerReadiness,
  RunnerManifestSummary,
} from '../shared/bundleReadinessTypes';

// ─── dhee bridge — typed access to the embedded dhee-ink ──────────
// Replaces the old WebSocket-based protocol (renderer → backend) with a
// direct main-process IPC layer. Channel + payload shapes live in
// `src/shared/dheeIpc.ts`.
import {
  dhee_CHANNELS,
  dhee_EVENT_CHANNEL,
  type dheeEvent,
  type dheeEventName,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type RunnerCancelResponse,
  type RunnerStatusResponse,
  type ConfigureProjectRequest,
  type OkResponse,
  type RunTaskRequest,
  type ChatPromptRequest,
  type ChatPromptResponse,
  type SendResponseRequest,
  type CancelTaskRequest,
  type CancelTaskResponse,
  type RedoNodeRequest,
  type FocusProjectRequest,
  type SetAutonomousRequest,
  type SetPiOversightRequest,
  type SetVlmJudgeRequest,
  type DeleteSessionRequest,
  type InvalidateNodesRequest,
  type InvalidateNodesResponse,
  type ListWorkflowsRequest,
  type ListWorkflowsResponse,
  type GetWorkflowRequest,
  type GetWorkflowResponse,
  type UpdateWorkflowRequest,
  type UpdateWorkflowResponse,
  type DeleteWorkflowRequest,
  type DeleteWorkflowResponse,
  type ValidateWorkflowRequest,
  type ValidateWorkflowResponse,
  type ResolveBundleRequest,
  type ResolveBundleResponse,
  type ResolveInstanceGraphRequest,
  type ResolveInstanceGraphResponse,
  type ClearChatHistoryRequest,
  type ClearChatHistoryResponse,
  type GetHistoryRequest,
  type GetHistoryResponse,
} from '../shared/dheeIpc';

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

const onboardingBridge = {
  getState(): Promise<OnboardingState> {
    return ipcRenderer.invoke('onboarding:get-state');
  },
  complete(req?: CompleteOnboardingRequest): Promise<OnboardingState> {
    return ipcRenderer.invoke('onboarding:complete', req);
  },
};

const providerDiagnosticsBridge = {
  run(): Promise<ProviderDiagnosticsSnapshot> {
    return ipcRenderer.invoke('provider-diagnostics:run');
  },
};

const projectBridge = {
  selectDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('project:select-directory');
  },
  /**
   * Suggested default workspace folder for a new project when the user
   * has not yet picked one. Returns `<home>/dhee-studios`. Pair with
   * `renderer/utils/workspacePathDefaults.readPersistedWorkspacePath` —
   * stored choice wins over this default on subsequent opens.
   */
  getDefaultWorkspacePath(): Promise<string> {
    return ipcRenderer.invoke('project:get-default-workspace-path');
  },
  selectVideoFile(): Promise<string | null> {
    return ipcRenderer.invoke('project:select-video-file');
  },
  selectAudioFile(): Promise<string | null> {
    return ipcRenderer.invoke('project:select-audio-file');
  },
  /**
   * Generic chat-attachment file picker. Caller passes the kinds it
   * accepts (currently only 'comfy_workflow'). Returns the picked
   * attachment shape, or `{ ok: false }` on cancel/error.
   */
  selectAttachment(req: {
    kinds: Array<'comfy_workflow' | 'text' | 'image' | 'video' | 'audio'>;
    title?: string;
  }): Promise<{
    ok: boolean;
    attachment?: {
      id: string;
      kind: 'comfy_workflow' | 'text' | 'image' | 'video' | 'audio';
      path: string;
      name: string;
      size?: number;
    };
    error?: string;
  }> {
    return ipcRenderer.invoke('project:select-attachment', req);
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
  readFileBufferGuarded(filePath: string, meta?: FileOpMeta): Promise<string> {
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
  readAllFiles(
    projectDir: string,
  ): Promise<Array<{ path: string; content: string; isBinary: boolean }>> {
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
  writeFile(
    filePath: string,
    content: string,
    meta?: FileOpMeta,
  ): Promise<void> {
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
    return ipcRenderer.invoke(
      'project:create-file',
      basePath,
      relativePath,
      meta,
    );
  },
  createFolder(
    basePath: string,
    relativePath: string,
    meta?: FileOpMeta,
  ): Promise<string | null> {
    return ipcRenderer.invoke(
      'project:create-folder',
      basePath,
      relativePath,
      meta,
    );
  },
  /**
   * Populate a freshly-created project folder with a complete project.json
   * (bundle bound + caller-supplied inputs applied). Called by the
   * Production Slate screen on submit; the agent then enters a fully-
   * configured project, no chat-time setup.
   */
  initialize(payload: {
    projectDir: string;
    name: string;
    bundleId: string;
    bundleSource?: string;
    description?: string;
    inputs?: Record<string, unknown>;
  }): Promise<{ ok: true; projectDir: string } | { ok: false; error: string }> {
    return ipcRenderer.invoke('project:initialize', payload);
  },
  installBundlePackage(payload: {
    packageSpec: string;
    registryUrl?: string;
  }): Promise<
    | {
        ok: true;
        packageName: string;
        version: string;
        bundleId: string;
        bundleDir: string;
        runnerDirs: string[];
        runners: RunnerManifestSummary[];
        readiness: BundleRunnerReadiness;
      }
    | { ok: false; error: string }
  > {
    return ipcRenderer.invoke('bundle:install-npm', payload);
  },
  checkBundleReadiness(payload: {
    bundleSource: string;
  }): Promise<BundleRunnerReadiness> {
    return ipcRenderer.invoke('bundle:readiness', payload);
  },
  /**
   * Enumerate every available bundle's metadata for the Production
   * Slate's bundle picker. Pre-agent, pure read of bundle.json files
   * across the search-root chain.
   */
  listBundles(): Promise<
    Array<{
      id: string;
      version: string;
      bundleSource: string;
      sourceScheme: 'built-in' | 'user';
      displayName: string;
      summary: string;
      techLine?: string;
      description?: string;
      inputs?: unknown[];
    }>
  > {
    return ipcRenderer.invoke('bundle:list');
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
  ): Promise<{
    success: boolean;
    outputPath?: string;
    duration?: number;
    error?: string;
  }> {
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
  async renderFromServerRequest(
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

    try {
      return await ipcRenderer.invoke(
        'remotion:render-from-server-request',
        projectDirectory,
        request,
      );
    } finally {
      if (onProgress) {
        ipcRenderer.removeListener('remotion:server-progress', subscription);
      }
    }
  },
  onProgress(callback: (progress: RemotionProgress) => void) {
    const subscription = (
      _event: IpcRendererEvent,
      progress: RemotionProgress,
    ) => callback(progress);
    ipcRenderer.on('remotion:progress', subscription);
    return () => ipcRenderer.removeListener('remotion:progress', subscription);
  },
  onJobComplete(callback: (job: RemotionJob) => void) {
    const subscription = (_event: IpcRendererEvent, job: RemotionJob) =>
      callback(job);
    ipcRenderer.on('remotion:job-complete', subscription);
    return () =>
      ipcRenderer.removeListener('remotion:job-complete', subscription);
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
    const subscription = (
      _event: IpcRendererEvent,
      status: AppUpdateStatus,
    ) => {
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
  getAuthStatus(): Promise<'idle' | 'waiting' | 'expired' | 'error'> {
    return ipcRenderer.invoke('account:get-auth-status');
  },
  signIn(): Promise<{ opened: boolean; state: string }> {
    return ipcRenderer.invoke('account:sign-in');
  },
  signOut(): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('account:sign-out');
  },
  refreshBalance(): Promise<{
    status: 'ok' | 'expired' | 'error';
    balance: number | null;
    httpStatus?: number;
    errorMessage?: string;
  }> {
    return ipcRenderer.invoke('account:refresh-balance');
  },
  getBillingUrl(): Promise<string> {
    return ipcRenderer.invoke('account:get-billing-url');
  },
  openBilling(): Promise<{ opened: boolean; url: string }> {
    return ipcRenderer.invoke('account:open-billing');
  },
  onAuthStatusChange(
    callback: (status: 'idle' | 'waiting' | 'expired' | 'error') => void,
  ) {
    const subscription = (
      _event: IpcRendererEvent,
      status: 'idle' | 'waiting' | 'expired' | 'error',
    ) => {
      callback(status);
    };
    ipcRenderer.on('account:auth-status', subscription);
    return () => {
      ipcRenderer.removeListener('account:auth-status', subscription);
    };
  },
  onChange(callback: (account: AccountInfo | null) => void) {
    const subscription = () => {
      ipcRenderer
        .invoke('account:get')
        .then(callback)
        .catch(() => {});
    };
    ipcRenderer.on('account:changed', subscription);
    return () => {
      ipcRenderer.removeListener('account:changed', subscription);
    };
  },
};

const dheeBridge = {
  createSession(req?: CreateSessionRequest): Promise<CreateSessionResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.CREATE_SESSION, req);
  },
  configureProject(req: ConfigureProjectRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.CONFIGURE_PROJECT, req);
  },
  runTask(req: RunTaskRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.RUN_TASK, req);
  },
  chatPrompt(req: ChatPromptRequest): Promise<ChatPromptResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.CHAT_PROMPT, req);
  },
  sendResponse(req: SendResponseRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.SEND_RESPONSE, req);
  },
  cancelTask(req: CancelTaskRequest): Promise<CancelTaskResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.CANCEL_TASK, req);
  },
  redoNode(req: RedoNodeRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.REDO_NODE, req);
  },
  focusProject(req: FocusProjectRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.FOCUS_PROJECT, req);
  },
  setAutonomous(req: SetAutonomousRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.SET_AUTONOMOUS, req);
  },
  setPiOversight(req: SetPiOversightRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.SET_PI_OVERSIGHT, req);
  },
  setVlmJudge(req: SetVlmJudgeRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.SET_VLM_JUDGE, req);
  },
  deleteSession(req: DeleteSessionRequest): Promise<OkResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.DELETE_SESSION, req);
  },
  clearChatHistory(
    req: ClearChatHistoryRequest,
  ): Promise<ClearChatHistoryResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.CLEAR_CHAT_HISTORY, req);
  },
  getHistory(req: GetHistoryRequest): Promise<GetHistoryResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.GET_HISTORY, req);
  },
  runnerCancel(): Promise<RunnerCancelResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.RUNNER_CANCEL);
  },
  runnerStatus(): Promise<RunnerStatusResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.RUNNER_STATUS);
  },
  invalidateNodes(
    req: InvalidateNodesRequest,
  ): Promise<InvalidateNodesResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.INVALIDATE_NODES, req);
  },
  /**
   * Custom ComfyUI workflow management. Talks directly to dhee-core's
   * WorkflowModeRegistry via IPC handlers — no HTTP server involved.
   * The conversational add-a-workflow flow goes through pi-agent
   * tools instead; these are for the Settings → Workflows tab.
   */
  workflows: {
    list(req?: ListWorkflowsRequest): Promise<ListWorkflowsResponse> {
      return ipcRenderer.invoke(dhee_CHANNELS.LIST_WORKFLOWS, req);
    },
    get(req: GetWorkflowRequest): Promise<GetWorkflowResponse> {
      return ipcRenderer.invoke(dhee_CHANNELS.GET_WORKFLOW, req);
    },
    update(req: UpdateWorkflowRequest): Promise<UpdateWorkflowResponse> {
      return ipcRenderer.invoke(dhee_CHANNELS.UPDATE_WORKFLOW, req);
    },
    delete(req: DeleteWorkflowRequest): Promise<DeleteWorkflowResponse> {
      return ipcRenderer.invoke(dhee_CHANNELS.DELETE_WORKFLOW, req);
    },
    validate(req: ValidateWorkflowRequest): Promise<ValidateWorkflowResponse> {
      return ipcRenderer.invoke(dhee_CHANNELS.VALIDATE_WORKFLOW, req);
    },
  },
  /**
   * Resolve a project.json `bundleSource` value (e.g.
   * 'built-in:narrative_qwen_chain_relay') to its parsed bundle
   * definition. Desktop views use the returned bundle's per-node
   * `displayCapability` tags to discover what artifacts exist —
   * see docs/display-capabilities.md in dhee-core.
   */
  resolveBundle(req: ResolveBundleRequest): Promise<ResolveBundleResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.RESOLVE_BUNDLE, req);
  },
  /**
   * Resolve the per-instance dependency graph projection from the
   * project's event log (.dhee/events.jsonl). Returns
   * { instances[], edges[] } folded via dhee-core's
   * `projectInstanceGraph`. Inspector Cards view's source of truth.
   */
  resolveInstanceGraph(req: ResolveInstanceGraphRequest): Promise<ResolveInstanceGraphResponse> {
    return ipcRenderer.invoke(dhee_CHANNELS.RESOLVE_INSTANCE_GRAPH, req);
  },
  /**
   * Subscribe to streaming events from the embedded ConversationManager.
   * Filter by eventName ('tool_call', 'media_generated', etc) — handlers
   * only fire for matching events. Returns an unsubscribe function.
   */
  on(
    eventName: dheeEventName | '*',
    cb: (event: dheeEvent) => void,
  ): () => void {
    const listener = (_event: IpcRendererEvent, payload: dheeEvent) => {
      if (eventName === '*' || payload.eventName === eventName) {
        cb(payload);
      }
    };
    ipcRenderer.on(dhee_EVENT_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(dhee_EVENT_CHANNEL, listener);
    };
  },
};

contextBridge.exposeInMainWorld('dhee', dheeBridge);
export type dheeBridge = typeof dheeBridge;

// Diagnostics bridge — surfaced as window.electron.logs in the
// renderer. Reveal opens the platform file browser at the active log
// dir; exportZip bundles every log file into a zip in Downloads and
// returns the resulting path so the UI can show "Saved to ...".
const logsBridge = {
  getDir(): Promise<string> {
    return ipcRenderer.invoke('logs:get-dir');
  },
  reveal(): Promise<
    { ok: true; path: string } | { ok: false; error: string }
  > {
    return ipcRenderer.invoke('logs:reveal');
  },
  exportZip(): Promise<
    | { ok: true; path: string; bytes: number; fileCount: number }
    | { ok: false; error: string }
  > {
    return ipcRenderer.invoke('logs:export-zip');
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
  settings: settingsBridge,
  onboarding: onboardingBridge,
  providerDiagnostics: providerDiagnosticsBridge,
  project: projectBridge,
  remotion: remotionBridge,
  logger: loggerBridge,
  logs: logsBridge,
  updates: updateBridge,
  app: appBridge,
  account: accountBridge,
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
