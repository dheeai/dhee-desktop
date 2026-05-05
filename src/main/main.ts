/* eslint global-require: off, no-console: off, promise/always-return: off */
import './utils/bootstrapRemotionRuntime';

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import ffmpeg from '@ts-ffmpeg/fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { normalizePathForFFmpeg } from './utils/pathNormalizer';
import {
  configureAudioWaveformExtractor,
  getAudioWaveform,
  type AudioWaveformOptions,
} from './utils/audioWaveform';
import {
  assertCanonicalProjectContainment,
  isSafeNewProjectFolderSegment,
  normalizeIncomingPath,
  ProjectFileOpGuardError,
  resolveAndValidateProjectPath,
  resolveValidationRoot,
} from './utils/projectFileOpGuard';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import backendManager from './backendManager';
import {
  AppSettings,
  getSettings,
  updateSettings,
} from './settingsManager';
import {
  shouldRestartCloudBackendForAccountChange,
  shouldStopCloudBackendOnSignOut,
} from './accountBackendSync';
import {
  getAccount,
  setAccount,
  clearAccount,
  refreshBalance,
} from './accountManager';
import { parseDesktopAuthToken } from './desktopAuthToken';
import fileSystemManager from './fileSystemManager';
import { remotionManager } from './remotionManager';
import { generateWordCaptions } from './services/wordCaptionService';
import type { FileChangeEvent } from '../shared/fileSystemTypes';
import type {
  RemotionTimelineItem,
  ParsedInfographicPlacement,
  RemotionServerRenderRequest,
  RemotionServerRenderResult,
  RemotionServerRenderProgress,
} from '../shared/remotionTypes';
import type { ChatExportPayload, ChatExportResult } from '../shared/chatTypes';
import type {
  BackendConnectionInfo,
  BackendState,
  CloudBackendRuntimeConfig,
  ServerConnectionConfig,
} from '../shared/backendTypes';
import * as desktopLogger from './services/DesktopLogger';
import { exportChatJsonWithDialog } from './services/chatExportService';
import {
  generateCapcutProject,
  type ExportTimelineItem,
  type ExportOverlayItem,
  type ExportTextOverlayCue,
  type ExportPromptOverlayCue,
} from './exporters/capcutGenerator';
import {
  buildAssFromPromptOverlayCues,
  type PromptOverlayCue,
} from './services/promptOverlayAss';

type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

interface AppUpdateStatus {
  phase: AppUpdatePhase;
  version?: string;
  progressPercent?: number;
  message?: string;
  manualCheckAvailable?: boolean;
  checkedAt: number;
}

if (app.isPackaged) {
  process.env.KSHANA_PACKAGED = '1';
}

let mainWindow: BrowserWindow | null = null;
let pendingDesktopAuthState: string | null = null;
let appUpdateStatus: AppUpdateStatus = {
  phase: 'idle',
  message: 'No update check yet',
  manualCheckAvailable: app.isPackaged && process.platform !== 'linux',
  checkedAt: Date.now(),
};

interface RuntimeConfig {
  /** Kshana website (Next.js): /auth/desktop, /api/credits/balance, etc. */
  kshanaWebsiteUrl?: string;
  /** Alias for kshanaWebsiteUrl */
  websiteUrl?: string;
  /** Authenticated proxy base URL for paid upstream calls. */
  kshanaProxyBaseUrl?: string;
  /** Alias for kshanaProxyBaseUrl */
  proxyBaseUrl?: string;
  /** Legacy hosted kshana-core URL retained for dev/fallback metadata only. */
  kshanaCoreUrl?: string;
  /** Alias for kshanaCoreUrl */
  coreUrl?: string;
  /** Legacy key from older release pipelines. */
  cloudServerUrl?: string;
}

async function readRuntimeConfig(): Promise<RuntimeConfig | null> {
  const candidatePaths = app.isPackaged
    ? [path.join(process.resourcesPath, 'assets', 'runtime-config.json')]
    : [path.join(__dirname, '../../assets/runtime-config.json')];

  const configs = await Promise.all(
    candidatePaths.map(async (configPath) => {
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as RuntimeConfig;
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        /* missing or invalid */
      }
      return null;
    }),
  );
  return configs.find((config): config is RuntimeConfig => Boolean(config)) ?? null;
}

function normalizeServerUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** Website origin for cloud sign-in and billing APIs (not the agent backend URL). */
async function resolveKshanaWebsiteUrl(): Promise<string> {
  const fromEnv = normalizeServerUrl(process.env.KSHANA_CLOUD_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig();
  const fromFile = normalizeServerUrl(
    parsed?.kshanaWebsiteUrl || parsed?.websiteUrl,
  );
  if (fromFile) return fromFile;
  return 'http://localhost:3000';
}

async function resolveKshanaProxyBaseUrl(): Promise<string> {
  const fromEnv = normalizeServerUrl(process.env.KSHANA_PROXY_BASE_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig();
  const fromFile = normalizeServerUrl(
    parsed?.kshanaProxyBaseUrl || parsed?.proxyBaseUrl,
  );
  if (fromFile) return fromFile;
  return resolveKshanaWebsiteUrl();
}

async function resolveLegacyKshanaCoreUrl(): Promise<string | undefined> {
  const fromEnv = normalizeServerUrl(process.env.KSHANA_CORE_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig();
  return normalizeServerUrl(
    parsed?.kshanaCoreUrl || parsed?.coreUrl || parsed?.cloudServerUrl,
  );
}

async function resolveKshanaWebsitePath(pathname: string): Promise<string> {
  const websiteBase = await resolveKshanaWebsiteUrl();
  return `${websiteBase}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

async function resolveCloudBackendRuntime(
  desktopToken?: string,
  proxyOverride?: string,
): Promise<CloudBackendRuntimeConfig> {
  const [websiteUrl, configuredProxyBaseUrl, legacyCoreUrl] = await Promise.all([
    resolveKshanaWebsiteUrl(),
    resolveKshanaProxyBaseUrl(),
    resolveLegacyKshanaCoreUrl(),
  ]);
  return {
    websiteUrl,
    proxyBaseUrl: normalizeServerUrl(proxyOverride) || configuredProxyBaseUrl,
    desktopToken,
    legacyCoreUrl,
  };
}

type GuardedFileOp =
  | 'project:write-file'
  | 'project:write-file-binary'
  | 'project:mkdir'
  | 'project:delete'
  | 'project:read-file-guarded'
  | 'project:read-file-buffer-guarded'
  | 'project:list-directory'
  | 'project:stat-path'
  | 'project:copy-file-exact'
  | 'project:create-file'
  | 'project:create-folder';

interface FileOpMeta {
  opId?: string | null;
  source?: 'agent_ws' | 'renderer';
  /** When set with source renderer, create-folder validates under basePath only (new project wizard). */
  intent?: 'new_project_parent';
  /** Current renderer project root for relative backend file operations before watchers are ready. */
  projectRoot?: string | null;
}

interface FileOpErrorContext {
  operation: GuardedFileOp;
  rawPath: string;
  normalizedPath?: string;
  resolvedPath?: string;
  activeProjectRoot?: string | null;
  opId?: string | null;
  error: unknown;
}

function getFileOpErrorCode(error: unknown): string {
  if (error instanceof ProjectFileOpGuardError) {
    return error.code;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }

  return 'FILE_OP_FAILED';
}

function getFileOpErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return 'File operation failed.';
}

function createIpcFileOpError(code: string, message: string): Error {
  const rendererError = new Error(`[${code}] ${message}`) as Error & {
    code?: string;
  };
  rendererError.code = code;
  return rendererError;
}

function throwFileOpError(context: FileOpErrorContext): never {
  const errorCode = getFileOpErrorCode(context.error);
  const errorMessage = getFileOpErrorMessage(context.error);
  desktopLogger.logFileOpFailure({
    operation: context.operation,
    rawPath: context.rawPath,
    normalizedPath: context.normalizedPath,
    resolvedPath: context.resolvedPath,
    activeProjectRoot: context.activeProjectRoot ?? undefined,
    errorCode,
    errorMessage,
    opId: context.opId ?? null,
    projectDirectory: context.activeProjectRoot ?? null,
    sessionId: null,
  });
  log.error(`[${context.operation}] File operation failed`, {
    operation: context.operation,
    rawPath: context.rawPath,
    normalizedPath: context.normalizedPath,
    resolvedPath: context.resolvedPath,
    activeProjectRoot: context.activeProjectRoot ?? undefined,
    errorCode,
    errorMessage,
    opId: context.opId ?? null,
  });
  throw createIpcFileOpError(errorCode, errorMessage);
}

function resolveBootstrapValidationRoot(
  activeProjectRoot: string | null,
  fallbackPath: string | null,
  meta?: FileOpMeta,
): string | null {
  return resolveValidationRoot(activeProjectRoot, fallbackPath, meta);
}

function isAgentWireSource(meta?: FileOpMeta): boolean {
  return meta?.source === 'agent_ws';
}

const broadcastAppUpdateStatus = (
  status: Omit<AppUpdateStatus, 'checkedAt'>,
) => {
  appUpdateStatus = {
    ...status,
    checkedAt: Date.now(),
  };

  if (mainWindow) {
    mainWindow.webContents.send('app-update:status', appUpdateStatus);
  }
};

backendManager.on('state', (state: BackendState) => {
  if (mainWindow) {
    mainWindow.webContents.send('backend:state', state);
  }
});

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

ipcMain.handle('backend:get-state', async (): Promise<BackendState> => {
  return backendManager.status;
});

ipcMain.handle(
  'backend:get-connection-info',
  async (): Promise<BackendConnectionInfo> => {
    const settings = getSettings();
    const cloudRuntime = await resolveCloudBackendRuntime(getAccount()?.token);
    return backendManager.getConnectionInfo(settings, cloudRuntime);
  },
);

ipcMain.handle(
  'backend:start',
  async (_event, config?: ServerConnectionConfig): Promise<BackendState> => {
    try {
      const settings = getSettings();
      const account = getAccount();
      if (settings.backendMode === 'cloud' && !account?.token) {
        return {
          status: 'error',
          mode: 'cloud',
          message: 'Sign in to Kshana Cloud before using cloud credits.',
        };
      }
      const cloudRuntime =
        settings.backendMode === 'cloud'
          ? await resolveCloudBackendRuntime(account?.token, config?.serverUrl)
          : undefined;
      return await backendManager.start(settings, cloudRuntime);
    } catch (error) {
      log.error(`Failed to start backend: ${(error as Error).message}`);
      return {
        status: 'error',
        message: (error as Error).message,
      };
    }
  },
);

ipcMain.handle(
  'backend:restart',
  async (_event, config?: ServerConnectionConfig) => {
    try {
      const settings = getSettings();
      const account = getAccount();
      if (settings.backendMode === 'cloud' && !account?.token) {
        return {
          status: 'error',
          mode: 'cloud',
          message: 'Sign in to Kshana Cloud before using cloud credits.',
        };
      }
      const cloudRuntime =
        settings.backendMode === 'cloud'
          ? await resolveCloudBackendRuntime(account?.token, config?.serverUrl)
          : undefined;
      return await backendManager.restart(settings, cloudRuntime);
    } catch (error) {
      log.error(`Failed to restart backend: ${(error as Error).message}`);
      return {
        status: 'error',
        message: (error as Error).message,
      };
    }
  },
);

ipcMain.handle('backend:stop', async () => {
  return backendManager.stop();
});

ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
  return getSettings();
});

ipcMain.handle(
  'settings:update',
  async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    const updated = updateSettings(patch);
    if (mainWindow) {
      mainWindow.webContents.send('settings:updated', updated);
    }
    return updated;
  },
);

// Project / File System IPC handlers
ipcMain.handle('project:select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    // Enable native "New Folder" / folder-creation affordances in picker.
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    title: 'Select or Create Project Directory',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('project:select-video-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Video File',
    filters: [
      {
        name: 'Video Files',
        extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('project:select-audio-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Audio File',
    filters: [
      {
        name: 'Audio Files',
        extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.warn(`[Audio Duration] Timed out getting duration for: ${audioPath}`);
      resolve(0);
    }, 10000);

    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      clearTimeout(timeout);
      if (err) {
        log.warn(`[Audio Duration] Could not get duration: ${err.message}`);
        resolve(0);
        return;
      }
      const duration = metadata?.format?.duration || 0;
      resolve(duration);
    });
  });
}

ipcMain.handle(
  'project:get-audio-waveform',
  async (
    _event,
    audioPath: string,
    options?: AudioWaveformOptions,
  ): Promise<{ peaks: number[]; duration: number }> => {
    const fullPath = path.normalize(
      path.isAbsolute(audioPath) ? audioPath : path.resolve(audioPath),
    );

    try {
      return await getAudioWaveform(fullPath, getAudioDuration, options);
    } catch (error) {
      log.warn(
        `[Audio Waveform IPC] Error getting waveform for ${audioPath}:`,
        error,
      );
      return {
        peaks: [],
        duration: await getAudioDuration(fullPath).catch(() => 0),
      };
    }
  },
);

ipcMain.handle(
  'project:get-audio-duration',
  async (_event, audioPath: string): Promise<number> => {
    try {
      // Normalize path separators for Windows and resolve to absolute
      const fullPath = path.normalize(
        path.isAbsolute(audioPath) ? audioPath : path.resolve(audioPath),
      );
      return await getAudioDuration(fullPath);
    } catch (error) {
      log.warn(
        `[Audio Duration IPC] Error getting duration for ${audioPath}:`,
        error,
      );
      return 0;
    }
  },
);

ipcMain.handle(
  'project:generate-word-captions',
  async (
    _event,
    projectDirectory: string,
    audioPath?: string,
  ): Promise<{
    success: boolean;
    outputPath?: string;
    words?: unknown[];
    error?: string;
  }> => {
    const result = await generateWordCaptions(projectDirectory, audioPath);
    if (result.success && result.outputPath) {
      fileSystemManager.emit('file-change', {
        type: 'change',
        path: result.outputPath,
      });
    }
    return result;
  },
);

ipcMain.handle(
  'project:read-tree',
  async (_event, dirPath: string, depth?: number) => {
    // Small TTL cache + in-flight de-dupe to reduce IPC churn.
    // This avoids repeated filesystem walks during file-watch bursts.
    const normalizedPath = path.isAbsolute(dirPath)
      ? path.normalize(dirPath)
      : path.resolve(dirPath);
    const cacheKey = `${normalizedPath}:${depth ?? ''}`;
    const now = Date.now();
    const ttlMs = 1000;

    const cached = (globalThis as any).__kshanaReadTreeCache?.get?.(cacheKey) as
      | { value: unknown; expiresAt: number }
      | undefined;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const inflightMap: Map<string, Promise<unknown>> =
      (globalThis as any).__kshanaReadTreeInflight ??
      ((globalThis as any).__kshanaReadTreeInflight = new Map());
    const cacheMap: Map<string, { value: unknown; expiresAt: number }> =
      (globalThis as any).__kshanaReadTreeCache ??
      ((globalThis as any).__kshanaReadTreeCache = new Map());

    const inflight = inflightMap.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const promise = fileSystemManager
      .readDirectory(normalizedPath, depth)
      .then((value) => {
        cacheMap.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
        return value;
      })
      .finally(() => {
        inflightMap.delete(cacheKey);
      });

    inflightMap.set(cacheKey, promise);
    return promise;
  },
);

ipcMain.handle('project:watch-directory', async (_event, dirPath: string) => {
  fileSystemManager.watchDirectory(dirPath);
});

ipcMain.handle(
  'project:watch-manifest',
  async (_event, manifestPath: string) => {
    await fileSystemManager.watchManifest(manifestPath);
  },
);

ipcMain.handle(
  'project:watch-image-placements',
  async (_event, imagePlacementsDir: string) => {
    await fileSystemManager.watchImagePlacements(imagePlacementsDir);
  },
);

ipcMain.handle(
  'project:watch-infographic-placements',
  async (_event, infographicPlacementsDir: string) => {
    await fileSystemManager.watchInfographicPlacements(
      infographicPlacementsDir,
    );
  },
);

ipcMain.handle(
  'project:refresh-assets',
  async (_event, projectDirectory: string) => {
    const manifestPath = path.join(
      projectDirectory,
      '.kshana',
      'agent',
      'manifest.json',
    );

    try {
      await fs.access(manifestPath);
      fileSystemManager.emit('file-change', {
        type: 'change',
        path: manifestPath,
      });
      console.log('[Main][refresh-assets] Triggered manifest refresh', {
        source: 'ipc_refresh_assets',
        manifestPath,
      });
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Manifest not found';
      console.warn(
        '[Main][refresh-assets] Failed to trigger manifest refresh',
        {
          source: 'ipc_refresh_assets',
          manifestPath,
          error: message,
        },
      );
      return { success: false, error: message };
    }
  },
);

// Listen for asset update notifications (can be called from backend or external processes)
// Note: This is optional - file watcher should handle most cases automatically
ipcMain.on(
  'project:asset-updated',
  async (
    _event,
    data: { projectDirectory: string; assetId: string; assetType: string },
  ) => {
    console.log('[Main] Asset updated notification received:', data);
    // Trigger refresh by emitting file change event
    if (data.projectDirectory) {
      const manifestPath = path.join(
        data.projectDirectory,
        '.kshana',
        'agent',
        'manifest.json',
      );
      try {
        await fs.access(manifestPath);
        fileSystemManager.emit('file-change', {
          type: 'change',
          path: manifestPath,
        });
      } catch (error) {
        console.warn('[Main][asset-updated] Manifest refresh skipped', {
          source: 'ipc_asset_updated',
          manifestPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
);

ipcMain.handle('project:unwatch-directory', async () => {
  fileSystemManager.unwatchDirectory();
});

ipcMain.handle('project:get-recent', async () => {
  return fileSystemManager.getRecentProjectsValidated();
});

ipcMain.handle('project:add-recent', async (_event, projectPath: string) => {
  fileSystemManager.addRecentProject(projectPath);
});

ipcMain.handle('project:remove-recent', async (_event, projectPath: string) => {
  fileSystemManager.removeRecentProject(projectPath);
});

ipcMain.handle(
  'project:rename-project',
  async (_event, projectPath: string, newName: string): Promise<string> => {
    return fileSystemManager.renameProject(projectPath, newName);
  },
);

ipcMain.handle(
  'project:delete-project',
  async (_event, projectPath: string): Promise<void> => {
    await fileSystemManager.deleteProject(projectPath);
  },
);

ipcMain.handle('project:get-resources-path', async () => {
  // Get the path to resources (where test_image and test_video are packaged)
  // In development: __dirname/../../ (points to kshana-desktop directory)
  // In packaged: process.resourcesPath (where extraResources are placed)
  if (app.isPackaged) {
    // In production, extraResources are placed in process.resourcesPath
    return process.resourcesPath;
  }
  // In development, __dirname is dist/main, so ../../ gives us kshana-desktop
  // test_image and test_video are in kshana-desktop directory
  const devPath = path.join(__dirname, '../../');
  return path.resolve(devPath);
});

ipcMain.handle(
  'project:read-file',
  async (_event, filePath: string): Promise<string | null> => {
    const normalizedPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(filePath);
    try {
      await fs.access(normalizedPath);
      return await fs.readFile(normalizedPath, 'utf-8');
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  },
);

ipcMain.handle(
  'project:read-file-guarded',
  async (_event, filePath: string, meta?: FileOpMeta): Promise<string> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        filePath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      return await fs.readFile(resolvedPath, 'utf-8');
    } catch (error) {
      throwFileOpError({
        operation: 'project:read-file-guarded',
        rawPath: filePath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:read-file-buffer-guarded',
  async (_event, filePath: string, meta?: FileOpMeta): Promise<string> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        filePath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      const buffer = await fs.readFile(resolvedPath);
      return buffer.toString('base64');
    } catch (error) {
      throwFileOpError({
        operation: 'project:read-file-buffer-guarded',
        rawPath: filePath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:check-file-exists',
  async (_event, filePath: string): Promise<boolean> => {
    const normalizedPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(filePath);
    const cacheKey = normalizedPath;
    const now = Date.now();
    const ttlMs = 750;

    const cacheMap: Map<string, { value: boolean; expiresAt: number }> =
      (globalThis as any).__kshanaExistsCache ??
      ((globalThis as any).__kshanaExistsCache = new Map());
    const cached = cacheMap.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      await fs.access(normalizedPath);
      cacheMap.set(cacheKey, { value: true, expiresAt: Date.now() + ttlMs });
      return true;
    } catch {
      return false;
    }
  },
);

ipcMain.handle(
  'project:read-file-base64',
  async (_event, filePath: string): Promise<string | null> => {
    const normalizedPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(filePath);
    try {
      await fs.access(normalizedPath);
      const buffer = await fs.readFile(normalizedPath);
      const base64 = buffer.toString('base64');

      const ext = path.extname(normalizedPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      return `data:${mimeType};base64,${base64}`;
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  },
);

ipcMain.handle(
  'project:read-all-files',
  async (
    _event,
    projectDir: string,
  ): Promise<Array<{ path: string; content: string; isBinary: boolean }>> => {
    const kshanaDir = path.join(projectDir, '.kshana');
    const results: Array<{ path: string; content: string; isBinary: boolean }> =
      [];
    const TEXT_EXTS = new Set([
      '.json',
      '.md',
      '.txt',
      '.yaml',
      '.yml',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.css',
      '.html',
      '.xml',
    ]);
    const SKIP_DIRS = new Set([
      'node_modules',
      '.git',
      '.cache',
      '__pycache__',
    ]);
    const MAX_TEXT_BYTES = 5 * 1024 * 1024;
    let skippedNonText = 0;
    let skippedOversized = 0;

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) {
            await walk(fullPath);
          }
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (!TEXT_EXTS.has(ext)) {
            skippedNonText += 1;
            continue;
          }

          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > MAX_TEXT_BYTES) {
              skippedOversized += 1;
              continue;
            }

            const content = await fs.readFile(fullPath, 'utf-8');
            results.push({ path: fullPath, content, isBinary: false });
          } catch {
            // Skip files that can't be read
          }
        }
      }
    }

    try {
      await walk(kshanaDir);
    } catch {
      // .kshana directory might not exist yet
    }

    log.info(
      `[project:read-all-files] Read ${results.length} text files from ${kshanaDir} ` +
        `(skipped non-text: ${skippedNonText}, skipped oversized: ${skippedOversized})`,
    );
    return results;
  },
);

ipcMain.handle(
  'project:read-project-snapshot',
  async (
    _event,
    projectDir: string,
  ): Promise<{
    files: Record<string, string>;
    directories: string[];
    projectRoot: string;
  }> => {
    const files: Record<string, string> = {};
    const directories = new Set<string>();
    const TEXT_EXTS = new Set([
      '.json',
      '.md',
      '.txt',
      '.yaml',
      '.yml',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.css',
      '.html',
      '.xml',
    ]);
    const SKIP_DIRS = new Set([
      'node_modules',
      '.git',
      '.cache',
      '__pycache__',
    ]);
    const MAX_TEXT_BYTES = 5 * 1024 * 1024;
    const normalizedRoot = path.resolve(projectDir);

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path
          .relative(normalizedRoot, fullPath)
          .split(path.sep)
          .join('/');

        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) {
            continue;
          }
          if (relativePath) {
            directories.add(relativePath);
          }
          await walk(fullPath);
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTS.has(ext)) {
          continue;
        }

        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_TEXT_BYTES) {
            continue;
          }

          files[relativePath] = await fs.readFile(fullPath, 'utf-8');
        } catch {
          // Skip unreadable files
        }
      }
    }

    await walk(normalizedRoot);

    return {
      files,
      directories: Array.from(directories).sort(),
      projectRoot: normalizedRoot,
    };
  },
);

ipcMain.handle(
  'project:list-directory',
  async (_event, dirPath: string, meta?: FileOpMeta): Promise<string[]> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        dirPath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      return await fs.readdir(resolvedPath);
    } catch (error) {
      throwFileOpError({
        operation: 'project:list-directory',
        rawPath: dirPath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:stat-path',
  async (
    _event,
    targetPath: string,
    meta?: FileOpMeta,
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        targetPath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      const stats = await fs.stat(resolvedPath);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
      };
    } catch (error) {
      throwFileOpError({
        operation: 'project:stat-path',
        rawPath: targetPath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:mkdir',
  async (_event, dirPath: string, meta?: FileOpMeta): Promise<void> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      path.isAbsolute(dirPath) ? dirPath : null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        dirPath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      await fs.mkdir(resolvedPath, { recursive: true });
    } catch (error) {
      throwFileOpError({
        operation: 'project:mkdir',
        rawPath: dirPath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:write-file',
  async (
    _event,
    filePath: string,
    content: string,
    meta?: FileOpMeta,
  ): Promise<void> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      path.isAbsolute(filePath) ? path.dirname(filePath) : null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;

    try {
      normalizedPath = normalizeIncomingPath(
        filePath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      const dirPath = path.dirname(resolvedPath);
      await fs.mkdir(dirPath, { recursive: true });
      // Atomic write: write to temp file then rename to avoid corruption.
      // Falls back to direct write if rename fails (e.g. OneDrive on Windows).
      const tmpPath = `${resolvedPath}.tmp`;
      try {
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.rename(tmpPath, resolvedPath);
      } catch {
        await fs.writeFile(resolvedPath, content, 'utf-8');
        // Clean up orphaned tmp file if it exists
        try {
          await fs.unlink(tmpPath);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      throwFileOpError({
        operation: 'project:write-file',
        rawPath: filePath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:write-file-binary',
  async (
    _event,
    filePath: string,
    base64Data: string,
    meta?: FileOpMeta,
  ): Promise<void> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      path.isAbsolute(filePath) ? path.dirname(filePath) : null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        filePath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      // Ensure directory exists before writing
      const dirPath = path.dirname(resolvedPath);
      await fs.mkdir(dirPath, { recursive: true });

      // Convert base64 string to buffer and write as binary
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(resolvedPath, buffer);
    } catch (error) {
      throwFileOpError({
        operation: 'project:write-file-binary',
        rawPath: filePath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:create-file',
  async (
    _event,
    basePath: string,
    relativePath: string,
    meta?: FileOpMeta,
  ): Promise<string | null> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      path.isAbsolute(basePath) ? basePath : null,
      meta,
    );
    const combinedPath = path.join(basePath, relativePath);
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        combinedPath,
        process.platform,
        process.cwd(),
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      const dirPath = path.dirname(resolvedPath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(resolvedPath, '', 'utf-8');
      return resolvedPath;
    } catch (error) {
      throwFileOpError({
        operation: 'project:create-file',
        rawPath: combinedPath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:create-folder',
  async (
    _event,
    basePath: string,
    relativePath: string,
    meta?: FileOpMeta,
  ): Promise<string | null> => {
    const absoluteBase = path.isAbsolute(basePath) ? path.resolve(basePath) : null;
    let activeProjectRoot: string | null;
    if (
      meta?.source === 'renderer' &&
      meta?.intent === 'new_project_parent'
    ) {
      if (!absoluteBase) {
        throw createIpcFileOpError(
          'INVALID_FILE_PATH',
          'New project creation requires an absolute parent folder path.',
        );
      }
      if (!isSafeNewProjectFolderSegment(relativePath)) {
        throw createIpcFileOpError(
          'INVALID_FILE_PATH',
          'Invalid project folder name.',
        );
      }
      activeProjectRoot = absoluteBase;
    } else {
      activeProjectRoot = resolveBootstrapValidationRoot(
        fileSystemManager.getActiveProjectRoot(),
        absoluteBase,
        meta,
      );
    }
    const combinedPath = path.join(basePath, relativePath);
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        combinedPath,
        process.platform,
        process.cwd(),
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      await fs.mkdir(resolvedPath, { recursive: true });
      return resolvedPath;
    } catch (error) {
      throwFileOpError({
        operation: 'project:create-folder',
        rawPath: combinedPath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:rename',
  async (_event, oldPath: string, newName: string): Promise<string> => {
    return fileSystemManager.rename(oldPath, newName);
  },
);

ipcMain.handle(
  'project:delete',
  async (_event, targetPath: string, meta?: FileOpMeta): Promise<void> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      null,
      meta,
    );
    let normalizedPath: string | undefined;
    let resolvedPath: string | undefined;
    try {
      normalizedPath = normalizeIncomingPath(
        targetPath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedPath = resolveAndValidateProjectPath(
        normalizedPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(resolvedPath, activeProjectRoot);
      await fileSystemManager.delete(resolvedPath);
    } catch (error) {
      throwFileOpError({
        operation: 'project:delete',
        rawPath: targetPath,
        normalizedPath,
        resolvedPath,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:move',
  async (_event, sourcePath: string, destDir: string): Promise<string> => {
    return fileSystemManager.move(sourcePath, destDir);
  },
);

ipcMain.handle(
  'project:copy',
  async (_event, sourcePath: string, destDir: string): Promise<string> => {
    return fileSystemManager.copy(sourcePath, destDir);
  },
);

ipcMain.handle(
  'project:copy-file-exact',
  async (
    _event,
    sourcePath: string,
    destinationPath: string,
    meta?: FileOpMeta,
  ): Promise<void> => {
    const activeProjectRoot = resolveBootstrapValidationRoot(
      fileSystemManager.getActiveProjectRoot(),
      null,
      meta,
    );
    let normalizedSourcePath: string | undefined;
    let resolvedSourcePath: string | undefined;
    let normalizedDestinationPath: string | undefined;
    let resolvedDestinationPath: string | undefined;
    try {
      normalizedSourcePath = normalizeIncomingPath(
        sourcePath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedSourcePath = resolveAndValidateProjectPath(
        normalizedSourcePath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(
        resolvedSourcePath,
        activeProjectRoot,
      );

      normalizedDestinationPath = normalizeIncomingPath(
        destinationPath,
        process.platform,
        process.cwd(),
        { allowAbsolute: !isAgentWireSource(meta) },
      );
      resolvedDestinationPath = resolveAndValidateProjectPath(
        normalizedDestinationPath,
        activeProjectRoot,
      );
      await assertCanonicalProjectContainment(
        resolvedDestinationPath,
        activeProjectRoot,
      );

      await fs.mkdir(path.dirname(resolvedDestinationPath), {
        recursive: true,
      });
      await fs.copyFile(resolvedSourcePath, resolvedDestinationPath);
    } catch (error) {
      throwFileOpError({
        operation: 'project:copy-file-exact',
        rawPath: `${sourcePath} -> ${destinationPath}`,
        normalizedPath:
          normalizedSourcePath && normalizedDestinationPath
            ? `${normalizedSourcePath} -> ${normalizedDestinationPath}`
            : undefined,
        resolvedPath:
          resolvedSourcePath && resolvedDestinationPath
            ? `${resolvedSourcePath} -> ${resolvedDestinationPath}`
            : undefined,
        activeProjectRoot,
        opId: meta?.opId ?? null,
        error,
      });
    }
  },
);

ipcMain.handle(
  'project:reveal-in-finder',
  async (_event, targetPath: string) => {
    return fileSystemManager.revealInFinder(targetPath);
  },
);

ipcMain.handle('project:save-video-file', async () => {
  if (!mainWindow) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Video',
    defaultPath: `kshana-timeline-${timestamp}.mp4`,
    filters: [
      {
        name: 'Video Files',
        extensions: ['mp4'],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  return result.filePath;
});

ipcMain.handle(
  'project:export-chat-json',
  async (_event, payload: ChatExportPayload): Promise<ChatExportResult> => {
    const targetWindow = mainWindow;
    if (!targetWindow) {
      return { success: false, error: 'Main window is not available' };
    }

    return exportChatJsonWithDialog(payload, {
      showSaveDialog: (options) => dialog.showSaveDialog(targetWindow, options),
      writeFile: (filePath, content, encoding) =>
        fs.writeFile(filePath, content, encoding),
    });
  },
);

// ── Export to CapCut ────────────────────────────────────────────────────────
ipcMain.handle(
  'project:export-capcut',
  async (
    _event,
    timelineItems: ExportTimelineItem[],
    projectDirectory: string,
    audioPath?: string,
    overlayItems?: ExportOverlayItem[],
    textOverlayCues?: ExportTextOverlayCue[],
    promptOverlayCues?: ExportPromptOverlayCue[],
  ): Promise<{ success: boolean; outputPath?: string; duration?: number; error?: string }> => {
    console.log('[Export:CapCut] Starting CapCut export...');
    try {
      const projectName =
        projectDirectory.split(/[/\\]/).filter(Boolean).pop() || 'Project';
      const result = await generateCapcutProject(
        projectName,
        timelineItems,
        projectDirectory,
        audioPath,
        overlayItems,
        textOverlayCues,
        promptOverlayCues,
      );

      console.log(
        '[Export:CapCut] Exported successfully to:',
        result.outputDir,
      );
      return { success: true, outputPath: result.outputDir };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Export:CapCut] Failed:', message);
      return { success: false, error: message };
    }
  },
);

// Configure ffmpeg/ffprobe to use bundled binaries
// In packaged builds, binaries are in app.asar.unpacked (not inside the read-only app.asar)
let ffmpegPath = ffmpegInstaller.path;
let ffprobePath = ffprobeInstaller.path;
if (app.isPackaged) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
}
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
configureAudioWaveformExtractor(ffmpegPath);
log.info('[FFmpeg] Paths configured:', {
  ffmpeg: ffmpegPath,
  ffprobe: ffprobePath,
});

interface TimelineItem {
  type: 'image' | 'video' | 'placeholder';
  path: string;
  duration: number;
  startTime: number;
  endTime: number;
  sourceOffsetSeconds?: number;
  label?: string;
}

interface OverlayItem {
  path: string;
  duration: number;
  startTime: number;
  endTime: number;
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

interface RenderResolution {
  width: number;
  height: number;
}

const VIDEO_WATERMARK_TEXT = 'kshana';
const VIDEO_WATERMARK_FONT_SIZE = 54;
const VIDEO_WATERMARK_MARGIN_X = 48;
const VIDEO_WATERMARK_MARGIN_Y = 28;
const SYSTEM_FONT_CANDIDATES =
  process.platform === 'win32'
    ? ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf']
    : process.platform === 'darwin'
      ? [
          '/System/Library/Fonts/Supplemental/Arial.ttf',
          '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
          '/System/Library/Fonts/Helvetica.ttc',
        ]
      : [
          '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
          '/usr/share/fonts/dejavu/DejaVuSans.ttf',
        ];

function formatAssTimestamp(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAssText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '(')
    .replace(/}/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function buildAssDialogueText(cue: TextOverlayCue): string {
  if (cue.words.length === 0) {
    return escapeAssText(cue.text);
  }

  const segments: string[] = [];
  cue.words.forEach((word, index) => {
    const safeText = escapeAssText(word.text);
    const durationCentiseconds = Math.max(
      1,
      Math.round((word.endTime - word.startTime) * 100),
    );
    const suffix = index < cue.words.length - 1 ? ' ' : '';
    segments.push(`{\\k${durationCentiseconds}}${safeText}${suffix}`);
  });
  return segments.join('');
}

async function findAvailableSystemFont(): Promise<string | null> {
  for (const candidate of SYSTEM_FONT_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function escapeDrawtextValue(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ');
}

function parseAspectRatioValue(value: unknown): RenderResolution | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) {
    return null;
  }

  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    widthRatio <= 0 ||
    heightRatio <= 0
  ) {
    return null;
  }

  if (widthRatio >= heightRatio) {
    return {
      width: 1920,
      height: Math.round((1920 * heightRatio) / widthRatio),
    };
  }

  return {
    width: Math.round((1920 * widthRatio) / heightRatio),
    height: 1920,
  };
}

type ExportAspectRatio = '16:9' | '9:16';
type ExportQuality = 'standard' | 'high';

interface ExportRenderOptions {
  aspectRatio: ExportAspectRatio;
  quality: ExportQuality;
}

function resolveExportRenderResolution(
  options: ExportRenderOptions,
): RenderResolution {
  if (options.aspectRatio === '9:16') {
    if (options.quality === 'high') {
      return { width: 1080, height: 1920 };
    }

    return { width: 720, height: 1280 };
  }

  if (options.quality === 'high') {
    return { width: 1920, height: 1080 };
  }

  return { width: 1280, height: 720 };
}

async function getProjectRenderResolution(
  projectDirectory: string,
): Promise<RenderResolution> {
  const fallback = { width: 1920, height: 1080 };
  const manifestPath = path.join(projectDirectory, 'kshana.json');

  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(manifestContent) as {
      settings?: {
        resolution?: { width?: unknown; height?: unknown };
        aspect_ratio?: unknown;
      };
    };

    const width = parsed.settings?.resolution?.width;
    const height = parsed.settings?.resolution?.height;
    if (
      typeof width === 'number' &&
      typeof height === 'number' &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return {
        width: Math.round(width),
        height: Math.round(height),
      };
    }

    const derived = parseAspectRatioValue(parsed.settings?.aspect_ratio);
    if (derived) {
      return derived;
    }
  } catch (error) {
    console.warn(
      '[VideoComposition] Failed to read project render resolution:',
      error,
    );
  }

  return fallback;
}

function buildAssFromTextOverlayCues(
  cues: TextOverlayCue[],
  resolution: RenderResolution = { width: 1920, height: 1080 },
): string {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${resolution.width}`,
    `PlayResY: ${resolution.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: WordSync,Arial,42,&H00FFFFFF,&H00FFD700,&H00000000,&HA0000000,1,0,0,0,100,100,0,0,3,2,0,2,80,80,60,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];

  const events = cues
    .filter(
      (cue) => Number.isFinite(cue.startTime) && Number.isFinite(cue.endTime),
    )
    .filter((cue) => cue.endTime > cue.startTime)
    .sort((a, b) => a.startTime - b.startTime)
    .map((cue) => {
      const start = formatAssTimestamp(cue.startTime);
      const end = formatAssTimestamp(cue.endTime);
      const text = buildAssDialogueText(cue);
      return `Dialogue: 0,${start},${end},WordSync,,0,0,0,,${text}`;
    });

  return [...header, ...events, ''].join('\n');
}

async function burnWordCaptionsIntoVideo(
  inputVideoPath: string,
  assPath: string,
  outputVideoPath: string,
): Promise<void> {
  // Validate ASS file exists
  try {
    await fs.access(assPath);
    console.log(`[VideoComposition] ASS file validated: ${assPath}`);
  } catch (error) {
    throw new Error(`ASS file not found: ${assPath}`);
  }

  // Define multiple filter strategies to try in order
  const strategies: Array<{ filter: string; description: string }> = [];

  if (process.platform === 'win32') {
    // On Windows, FFmpeg subtitle filters require heavy escaping:
    // - Backslashes must be escaped as \\\\ (four backslashes)
    // - Colons must be escaped as \\: (two backslashes + colon)

    // First, convert Windows backslashes to forward slashes
    const normalizedAssPath = assPath.replace(/\\/g, '/');

    // Then escape for FFmpeg filter syntax:
    // Escape colons: C:/path -> C\\:/path
    const escapedAssPath = normalizedAssPath.replace(/:/g, '\\\\:');

    // Verify fonts directory exists
    const fontsDir = 'C:/Windows/Fonts';
    let fontsDirExists = false;
    try {
      await fs.access(fontsDir.replace(/\//g, '\\'));
      fontsDirExists = true;
      console.log(`[VideoComposition] Fonts directory validated: ${fontsDir}`);
    } catch (error) {
      console.warn(
        `[VideoComposition] Fonts directory not accessible: ${fontsDir}`,
      );
    }

    if (fontsDirExists) {
      // Strategy 1: subtitles filter with fontsdir
      const fontsDirEscaped = 'C\\\\:/Windows/Fonts';
      strategies.push({
        filter: `subtitles=${escapedAssPath}:fontsdir=${fontsDirEscaped}`,
        description: 'subtitles filter with fontsdir',
      });
    }

    // Strategy 2: subtitles filter without fontsdir
    strategies.push({
      filter: `subtitles=${escapedAssPath}`,
      description: 'subtitles filter (default fonts)',
    });

    // Strategy 3: ass filter without fontsdir (fallback)
    strategies.push({
      filter: `ass=${escapedAssPath}`,
      description: 'ass filter (default fonts)',
    });

    // Strategy 4: Try with original Windows backslashes (heavily escaped)
    const heavyEscapedPath = assPath
      .replace(/\\/g, '\\\\\\\\') // Each backslash becomes 4 backslashes
      .replace(/:/g, '\\\\:'); // Each colon gets escaped with 2 backslashes
    strategies.push({
      filter: `subtitles=${heavyEscapedPath}`,
      description: 'subtitles filter (Windows backslash escaping)',
    });
  } else {
    // On Unix-like systems, use subtitles filter with forward slashes
    const normalizedAssPath = assPath.replace(/\\/g, '/');
    strategies.push({
      filter: `subtitles=${normalizedAssPath}`,
      description: 'subtitles filter',
    });
  }

  // Try each strategy in order until one succeeds
  let lastError: Error | null = null;

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    console.log(
      `[VideoComposition] Attempting strategy ${i + 1}/${strategies.length}: ${strategy.description}`,
    );
    console.log(`[VideoComposition] Filter string: ${strategy.filter}`);

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(inputVideoPath)
          .videoFilters(strategy.filter)
          .outputOptions([
            '-c:v libx264',
            '-crf 18',
            '-preset medium',
            '-c:a copy',
            '-pix_fmt yuv420p',
          ])
          .output(outputVideoPath)
          .on('start', (cmd) =>
            console.log(`[VideoComposition] FFmpeg command: ${cmd}`),
          )
          .on('progress', (progress) => {
            if (progress.percent != null) {
              console.log(
                `[VideoComposition] Subtitle burn progress: ${Math.round(progress.percent)}%`,
              );
            }
          })
          .on('end', () => {
            console.log(
              `[VideoComposition] Subtitle burn completed using: ${strategy.description}`,
            );
            resolve();
          })
          .on('error', (error, _stdout, stderr) => {
            console.error(
              `[VideoComposition] Strategy failed (${strategy.description}): ${error.message}`,
            );
            if (stderr) {
              console.error(
                `[VideoComposition] FFmpeg stderr: ${stderr.slice(-500)}`,
              );
            }
            reject(error);
          })
          .run();
      });

      // If we reach here, the strategy succeeded
      console.log(
        `[VideoComposition] Successfully burned captions using: ${strategy.description}`,
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[VideoComposition] Strategy ${i + 1}/${strategies.length} failed, trying next...`,
      );
    }
  }

  // All strategies failed
  throw new Error(
    `Failed to burn captions after trying ${strategies.length} strategies. Last error: ${lastError?.message}`,
  );
}

async function burnWatermarkIntoVideo(
  inputVideoPath: string,
  outputVideoPath: string,
): Promise<void> {
  const fontPath = await findAvailableSystemFont();
  const drawtextParts = [
    `text='${escapeDrawtextValue(VIDEO_WATERMARK_TEXT)}'`,
    `fontsize=${VIDEO_WATERMARK_FONT_SIZE}`,
    'fontcolor=white@0.4',
    'shadowcolor=black@0.6',
    'shadowx=3',
    'shadowy=3',
    `x=w-tw-${VIDEO_WATERMARK_MARGIN_X}`,
    `y=h-th-${VIDEO_WATERMARK_MARGIN_Y}`,
  ];

  if (fontPath) {
    drawtextParts.unshift(`fontfile='${escapeDrawtextValue(fontPath)}'`);
  } else {
    console.warn(
      '[VideoComposition] No system font found for watermark, relying on FFmpeg defaults.',
    );
  }

  const filter = `drawtext=${drawtextParts.join(':')}`;

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(inputVideoPath)
      .videoFilters(filter)
      .outputOptions([
        '-map 0:v:0',
        '-map 0:a?',
        '-c:v libx264',
        '-crf 18',
        '-preset medium',
        '-c:a copy',
        '-pix_fmt yuv420p',
      ])
      .output(outputVideoPath)
      .on('start', (cmd) =>
        console.log(`[VideoComposition] Watermark FFmpeg command: ${cmd}`),
      )
      .on('progress', (progress) => {
        if (progress.percent != null) {
          console.log(
            `[VideoComposition] Watermark progress: ${Math.round(progress.percent)}%`,
          );
        }
      })
      .on('end', () => {
        console.log('[VideoComposition] Watermark burn completed');
        resolve();
      })
      .on('error', (error, _stdout, stderr) => {
        if (stderr) {
          console.error(
            `[VideoComposition] Watermark FFmpeg stderr: ${stderr.slice(-500)}`,
          );
        }
        reject(error);
      })
      .run();
  });
}

ipcMain.handle(
  'project:compose-timeline-video',
  async (
    _event,
    timelineItems: TimelineItem[],
    projectDirectory: string,
    audioPath?: string,
    overlayItems?: OverlayItem[],
    textOverlayCues?: TextOverlayCue[],
    promptOverlayCues?: PromptOverlayCue[],
    exportOptions?: ExportRenderOptions,
  ): Promise<{ success: boolean; outputPath?: string; duration?: number; error?: string }> => {
    console.log('[VideoComposition] Starting video composition...');
    console.log('[VideoComposition] Timeline items:', timelineItems.length);

    if (!timelineItems || timelineItems.length === 0) {
      console.error('[VideoComposition] No timeline items to compose');
      return { success: false, error: 'No timeline items to compose' };
    }

    const tempDir = path.join(projectDirectory, '.kshana', 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    console.log('[VideoComposition] Temp directory:', tempDir);
    const renderResolution = exportOptions
      ? resolveExportRenderResolution(exportOptions)
      : await getProjectRenderResolution(projectDirectory);
    const { width: outputWidth, height: outputHeight } = renderResolution;
    const scaleAndPadFilter = `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2`;
    console.log(
      '[VideoComposition] Using render resolution:',
      renderResolution,
    );

    const segmentFiles: string[] = [];
    const cleanupFiles: string[] = [];
    const normalizedOverlayItems: Array<
      OverlayItem & { absolutePath: string }
    > = [];
    const placeholderFontPath = await findAvailableSystemFont();

    if (!placeholderFontPath) {
      console.warn(
        '[VideoComposition] No system font found for placeholder labels; rendering plain placeholders.',
      );
    }

    const createPlaceholderSegment = async (
      segmentPath: string,
      duration: number,
      segmentNumber: number,
      label?: string,
    ): Promise<void> => {
      const fallbackLabel = `placeholder-${segmentNumber}`;
      const placementLabel =
        typeof label === 'string' && label.trim().length > 0
          ? label.trim()
          : fallbackLabel;
      const safePlacementLabel =
        placementLabel.length > 64
          ? `${placementLabel.slice(0, 61)}...`
          : placementLabel;
      const escapedPlacementLabel = safePlacementLabel
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'")
        .replace(/[\r\n]+/g, ' ');
      const escapedFontPath = placeholderFontPath
        ? placeholderFontPath
            .replace(/\\/g, '/')
            .replace(/:/g, '\\:')
            .replace(/'/g, "\\'")
        : null;
      const drawTextFilter = escapedFontPath
        ? `drawtext=` +
          `fontfile='${escapedFontPath}':` +
          `text='${escapedPlacementLabel}':` +
          `fontcolor=white:` +
          `fontsize=48:` +
          `box=1:` +
          `boxcolor=black@0.6:` +
          `boxborderw=20:` +
          `x=(w-text_w)/2:` +
          `y=(h-text_h)/2`
        : null;
      const buildBaseOutputOptions = () => [
        '-c:v libx264',
        '-preset medium',
        '-crf 23',
        '-pix_fmt yuv420p',
      ];

      const renderPlaceholderWithOptions = async (
        outputOptions: string[],
      ): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(
              `color=c=black:s=${outputWidth}x${outputHeight}:d=${duration}`,
            )
            .inputOptions(['-f lavfi'])
            .outputOptions(outputOptions)
            .output(segmentPath)
            .on('start', (commandLine) => {
              console.log(
                `[VideoComposition] Placeholder FFmpeg command (${segmentNumber}, ${placementLabel}): ${commandLine}`,
              );
            })
            .on('end', () => {
              console.log(
                `[VideoComposition] Placeholder segment ${segmentNumber} completed`,
              );
              resolve();
            })
            .on('error', (err) => {
              reject(err);
            })
            .run();
        });

      try {
        const outputOptions = buildBaseOutputOptions();
        if (drawTextFilter) {
          outputOptions.push('-vf', drawTextFilter);
        }
        await renderPlaceholderWithOptions(outputOptions);
      } catch (err) {
        if (!drawTextFilter) {
          throw err;
        }
        console.warn(
          `[VideoComposition] Placeholder drawtext failed for segment ${segmentNumber}. Retrying without label overlay.`,
          err,
        );
        const fallbackOutputOptions = buildBaseOutputOptions();
        await renderPlaceholderWithOptions(fallbackOutputOptions);
      }
    };

    if (overlayItems && overlayItems.length > 0) {
      for (const overlay of overlayItems) {
        const absolutePath = await normalizePathForFFmpeg(
          overlay.path,
          projectDirectory,
        );

        if (!absolutePath) {
          console.warn('[VideoComposition] Skipping overlay: empty path');
          continue;
        }

        try {
          const stats = await fs.stat(absolutePath);
          if (stats.isDirectory()) {
            console.warn(
              `[VideoComposition] Skipping overlay: path is a directory: ${absolutePath}`,
            );
            continue;
          }
        } catch (error) {
          console.warn(
            `[VideoComposition] Skipping overlay: file not found: ${absolutePath}`,
            error,
          );
          continue;
        }

        normalizedOverlayItems.push({ ...overlay, absolutePath });
      }
    }

    try {
      // Process each timeline item
      for (let i = 0; i < timelineItems.length; i++) {
        const item = timelineItems[i]!;
        const segmentPath = path.join(tempDir, `segment-${i}.mp4`);
        console.log(
          `[VideoComposition] Processing segment ${i + 1}/${timelineItems.length}: ${item.type} (${item.duration}s)`,
        );

        if (item.type === 'video') {
          // For video segments, use the full video file
          // The timeline startTime/endTime are for positioning, not extraction
          const absolutePath = await normalizePathForFFmpeg(
            item.path,
            projectDirectory,
          );

          // Missing media should preserve timing, so emit a black placeholder.
          if (!absolutePath) {
            console.warn(
              `[VideoComposition] Missing video path for segment ${i + 1}, creating placeholder`,
            );
            await createPlaceholderSegment(
              segmentPath,
              item.duration,
              i + 1,
              item.label,
            );
            segmentFiles.push(segmentPath);
            cleanupFiles.push(segmentPath);
            continue;
          }

          console.log(
            `[VideoComposition] Video segment ${i + 1}: ${absolutePath}`,
          );

          // Check if path exists and is a file (not a directory)
          try {
            const stats = await fs.stat(absolutePath);
            if (stats.isDirectory()) {
              console.warn(
                `[VideoComposition] Video segment ${i + 1} path is a directory (${absolutePath}), creating placeholder`,
              );
              await createPlaceholderSegment(
                segmentPath,
                item.duration,
                i + 1,
                item.label,
              );
              segmentFiles.push(segmentPath);
              cleanupFiles.push(segmentPath);
              continue;
            }
            console.log(
              `[VideoComposition] Video file exists: ${absolutePath}`,
            );
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes('is a directory')
            ) {
              console.warn(
                `[VideoComposition] Video segment ${i + 1} path resolved as directory, creating placeholder`,
              );
              await createPlaceholderSegment(
                segmentPath,
                item.duration,
                i + 1,
                item.label,
              );
              segmentFiles.push(segmentPath);
              cleanupFiles.push(segmentPath);
              continue;
            }
            console.warn(
              `[VideoComposition] Video segment ${i + 1} missing file (${absolutePath}), creating placeholder`,
            );
            await createPlaceholderSegment(
              segmentPath,
              item.duration,
              i + 1,
              item.label,
            );
            segmentFiles.push(segmentPath);
            cleanupFiles.push(segmentPath);
            continue;
          }

          console.log(
            `[VideoComposition] Converting video segment ${i + 1}...`,
          );
          await new Promise<void>((resolve, reject) => {
            const command = ffmpeg(absolutePath);
            if (
              typeof item.sourceOffsetSeconds === 'number' &&
              item.sourceOffsetSeconds > 0
            ) {
              command.inputOptions([`-ss ${item.sourceOffsetSeconds}`]);
            }

            command
              .outputOptions([
                '-c:v libx264',
                '-c:a aac',
                '-preset medium',
                '-crf 23',
                '-pix_fmt yuv420p',
                '-vf',
                scaleAndPadFilter,
                '-t',
                item.duration.toString(), // Limit to segment duration
              ])
              .output(segmentPath)
              .on('start', (commandLine) => {
                console.log(
                  `[VideoComposition] FFmpeg command: ${commandLine}`,
                );
              })
              .on('progress', (progress) => {
                if (progress.percent) {
                  console.log(
                    `[VideoComposition] Video segment ${i + 1} progress: ${Math.round(progress.percent)}%`,
                  );
                }
              })
              .on('end', () => {
                console.log(
                  `[VideoComposition] Video segment ${i + 1} completed`,
                );
                resolve();
              })
              .on('error', (err) => {
                console.error(
                  `[VideoComposition] Video segment ${i + 1} error:`,
                  err,
                );
                reject(err);
              })
              .run();
          });

          segmentFiles.push(segmentPath);
          cleanupFiles.push(segmentPath);
        } else if (item.type === 'image') {
          // Convert image to video
          const absolutePath = await normalizePathForFFmpeg(
            item.path,
            projectDirectory,
          );

          // Missing media should preserve timing, so emit a black placeholder.
          if (!absolutePath) {
            console.warn(
              `[VideoComposition] Missing image path for segment ${i + 1}, creating placeholder`,
            );
            await createPlaceholderSegment(
              segmentPath,
              item.duration,
              i + 1,
              item.label,
            );
            segmentFiles.push(segmentPath);
            cleanupFiles.push(segmentPath);
            continue;
          }

          console.log(
            `[VideoComposition] Image segment ${i + 1}: ${absolutePath}`,
          );

          // Check if file exists
          try {
            await fs.access(absolutePath);
            console.log(
              `[VideoComposition] Image file exists: ${absolutePath}`,
            );
          } catch {
            console.warn(
              `[VideoComposition] Image segment ${i + 1} missing file (${absolutePath}), creating placeholder`,
            );
            await createPlaceholderSegment(
              segmentPath,
              item.duration,
              i + 1,
              item.label,
            );
            segmentFiles.push(segmentPath);
            cleanupFiles.push(segmentPath);
            continue;
          }

          console.log(
            `[VideoComposition] Converting image segment ${i + 1} to video (${item.duration}s)...`,
          );
          await new Promise<void>((resolve, reject) => {
            ffmpeg(absolutePath)
              .inputOptions(['-loop 1'])
              .outputOptions([
                '-t',
                item.duration.toString(),
                '-c:v libx264',
                '-preset medium',
                '-crf 23',
                '-pix_fmt yuv420p',
                '-vf',
                scaleAndPadFilter,
              ])
              .output(segmentPath)
              .on('start', (commandLine) => {
                console.log(
                  `[VideoComposition] FFmpeg command: ${commandLine}`,
                );
              })
              .on('progress', (progress) => {
                if (progress.percent) {
                  console.log(
                    `[VideoComposition] Image segment ${i + 1} progress: ${Math.round(progress.percent)}%`,
                  );
                }
              })
              .on('end', () => {
                console.log(
                  `[VideoComposition] Image segment ${i + 1} completed`,
                );
                resolve();
              })
              .on('error', (err) => {
                console.error(
                  `[VideoComposition] Image segment ${i + 1} error:`,
                  err,
                );
                reject(err);
              })
              .run();
          });

          let finalSegmentPath = segmentPath;
          cleanupFiles.push(segmentPath);

          if (normalizedOverlayItems.length > 0) {
            const overlaysForItem = normalizedOverlayItems.filter(
              (overlay) =>
                overlay.startTime >= item.startTime &&
                overlay.endTime <= item.endTime,
            );
            const orderedOverlays = overlaysForItem.sort(
              (a, b) => a.startTime - b.startTime,
            );

            if (orderedOverlays.length > 0) {
              const overlaySegmentPath = path.join(
                tempDir,
                `segment-${i}-overlays.mp4`,
              );
              const filterParts: string[] = ['[0:v]setpts=PTS-STARTPTS[base0]'];
              let currentBase = 'base0';

              console.log(
                `[VideoComposition] Applying ${orderedOverlays.length} overlay(s) to image segment ${i + 1}`,
                orderedOverlays.map((overlay) => ({
                  startTime: overlay.startTime,
                  endTime: overlay.endTime,
                  path: overlay.absolutePath,
                })),
              );

              orderedOverlays.forEach((overlay, overlayIndex) => {
                const overlayOffset = Math.max(
                  0,
                  overlay.startTime - item.startTime,
                );
                const inputIndex = overlayIndex + 1;
                const overlayLabel = `ov${overlayIndex}`;
                const nextBase = `base${overlayIndex + 1}`;

                filterParts.push(
                  `[${inputIndex}:v]format=rgba,setpts=PTS-STARTPTS+${overlayOffset}/TB[${overlayLabel}]`,
                );
                filterParts.push(
                  `[${currentBase}][${overlayLabel}]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=pass[${nextBase}]`,
                );
                currentBase = nextBase;
              });

              await new Promise<void>((resolve, reject) => {
                const command = ffmpeg(segmentPath);
                orderedOverlays.forEach((overlay) => {
                  command
                    .input(overlay.absolutePath)
                    .inputOptions(['-c:v', 'libvpx-vp9']);
                });

                command
                  .complexFilter(filterParts.join(';'))
                  .outputOptions([
                    '-map',
                    `[${currentBase}]`,
                    '-c:v libx264',
                    '-preset medium',
                    '-crf 23',
                    '-pix_fmt yuv420p',
                    '-an',
                    '-t',
                    item.duration.toString(),
                  ])
                  .output(overlaySegmentPath)
                  .on('start', (cmd) => {
                    console.log(
                      `[VideoComposition] Overlay FFmpeg command for segment ${i + 1}: ${cmd}`,
                    );
                  })
                  .on('end', () => {
                    console.log(
                      `[VideoComposition] Overlay chain applied for segment ${i + 1}`,
                    );
                    resolve();
                  })
                  .on('error', (err) => {
                    console.error(
                      `[VideoComposition] Overlay error for segment ${i + 1}:`,
                      err,
                    );
                    reject(err);
                  })
                  .run();
              });

              finalSegmentPath = overlaySegmentPath;
              cleanupFiles.push(overlaySegmentPath);
            }
          }

          segmentFiles.push(finalSegmentPath);
        } else if (item.type === 'placeholder') {
          // Create black video frames
          console.log(
            `[VideoComposition] Creating placeholder segment ${i + 1} (${item.duration}s)...`,
          );
          await createPlaceholderSegment(
            segmentPath,
            item.duration,
            i + 1,
            item.label,
          );

          segmentFiles.push(segmentPath);
          cleanupFiles.push(segmentPath);
        }
      }

      // Check if we have any valid segments
      if (segmentFiles.length === 0) {
        console.error(
          '[VideoComposition] No valid segments to compose. All timeline items were skipped.',
        );
        return {
          success: false,
          error:
            'No valid segments found. All timeline items were skipped due to missing or invalid file paths.',
        };
      }

      console.log(
        `[VideoComposition] All ${segmentFiles.length} segments processed. Creating concat list...`,
      );

      // Create concat file list
      const concatListPath = path.join(tempDir, 'concat-list.txt');
      const concatList = segmentFiles
        .map((file) => `file '${file.replace(/'/g, "'\\''")}'`)
        .join('\n');
      await fs.writeFile(concatListPath, concatList, 'utf-8');
      cleanupFiles.push(concatListPath);
      console.log(
        `[VideoComposition] Concat list created with ${segmentFiles.length} files`,
      );

      // Step 1: Concatenate all video segments
      const concatenatedVideoPath = path.join(
        tempDir,
        'concatenated-video.mp4',
      );
      console.log(
        `[VideoComposition] Concatenating segments into video: ${concatenatedVideoPath}`,
      );
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions([
            '-c copy', // Copy streams without re-encoding for speed
          ])
          .output(concatenatedVideoPath)
          .on('start', (commandLine) => {
            console.log(
              `[VideoComposition] FFmpeg concat command: ${commandLine}`,
            );
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(
                `[VideoComposition] Concatenation progress: ${Math.round(progress.percent)}%`,
              );
            }
          })
          .on('end', () => {
            console.log(`[VideoComposition] Concatenation completed`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[VideoComposition] Concatenation error:`, err);
            reject(err);
          })
          .run();
      });

      // Step 2: Mix audio if provided
      const baseOutputPath = path.join(tempDir, 'composed-video.mp4');
      if (audioPath) {
        // Normalize audio path (strips file://, resolves relative paths)
        const normalizedAudioPath = await normalizePathForFFmpeg(
          audioPath,
          projectDirectory,
        );

        if (!normalizedAudioPath) {
          console.warn(
            '[VideoComposition] Audio path is empty after normalization',
          );
          await fs.copyFile(concatenatedVideoPath, baseOutputPath);
          console.log(
            '[VideoComposition] No audio track provided, using video only',
          );
        } else {
          // Check if audio file exists
          try {
            await fs.access(normalizedAudioPath);
            console.log(
              `[VideoComposition] Mixing audio track: ${normalizedAudioPath}`,
            );

            await new Promise<void>((resolve, reject) => {
              ffmpeg()
                .input(concatenatedVideoPath)
                .input(normalizedAudioPath)
                .outputOptions([
                  '-c:v copy', // Copy video stream (no re-encoding)
                  '-c:a aac', // Encode audio to AAC format
                  '-map 0:v:0', // Use video from first input (concatenated video)
                  '-map 1:a:0', // Use audio from second input (audio file)
                  '-shortest', // End when shortest stream ends (prevents length mismatch)
                ])
                .output(baseOutputPath)
                .on('start', (commandLine) => {
                  console.log(
                    `[VideoComposition] FFmpeg audio mix command: ${commandLine}`,
                  );
                })
                .on('progress', (progress) => {
                  if (progress.percent) {
                    console.log(
                      `[VideoComposition] Audio mixing progress: ${Math.round(progress.percent)}%`,
                    );
                  }
                })
                .on('end', () => {
                  console.log(`[VideoComposition] Audio mixing completed`);
                  resolve();
                })
                .on('error', (err) => {
                  console.error(`[VideoComposition] Audio mixing error:`, err);
                  // Fall back to video-only if audio mixing fails
                  console.warn(
                    '[VideoComposition] Falling back to video-only output',
                  );
                  fs.copyFile(concatenatedVideoPath, baseOutputPath)
                    .then(() => resolve())
                    .catch((copyErr) => {
                      console.error(
                        '[VideoComposition] Failed to copy video-only output:',
                        copyErr,
                      );
                      reject(err);
                    });
                })
                .run();
            });
          } catch (error) {
            // Audio file doesn't exist - use video only
            console.warn(
              `[VideoComposition] Audio file not found: ${normalizedAudioPath}, using video only`,
            );
            await fs.copyFile(concatenatedVideoPath, baseOutputPath);
          }
        }
      } else {
        // No audio provided - just use concatenated video
        console.log(
          '[VideoComposition] No audio track provided, using video only',
        );
        await fs.copyFile(concatenatedVideoPath, baseOutputPath);
      }

      let overlayedOutputPath = baseOutputPath;

      if (promptOverlayCues && promptOverlayCues.length > 0) {
        const promptAssPath = path.join(tempDir, 'prompt-overlays.ass');
        const promptOverlayOutputPath = path.join(
          tempDir,
          'composed-video-prompts.mp4',
        );
        const assContent = buildAssFromPromptOverlayCues(
          promptOverlayCues,
          renderResolution,
        );
        await fs.writeFile(promptAssPath, assContent, 'utf-8');
        cleanupFiles.push(promptAssPath);

        try {
          await burnWordCaptionsIntoVideo(
            baseOutputPath,
            promptAssPath,
            promptOverlayOutputPath,
          );
          cleanupFiles.push(promptOverlayOutputPath);
          overlayedOutputPath = promptOverlayOutputPath;
        } catch (error) {
          console.warn(
            `[VideoComposition] Prompt overlay burn failed, proceeding without prompt overlays: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      }

      let finalOutputPath = overlayedOutputPath;

      if (textOverlayCues && textOverlayCues.length > 0) {
        const assPath = path.join(tempDir, 'word-captions.ass');
        const captionedOutputPath = path.join(
          tempDir,
          'composed-video-captions.mp4',
        );
        const assContent = buildAssFromTextOverlayCues(
          textOverlayCues,
          renderResolution,
        );
        await fs.writeFile(assPath, assContent, 'utf-8');
        cleanupFiles.push(assPath);

        try {
          await burnWordCaptionsIntoVideo(
            overlayedOutputPath,
            assPath,
            captionedOutputPath,
          );
          cleanupFiles.push(captionedOutputPath);
          finalOutputPath = captionedOutputPath;
        } catch (error) {
          console.warn(
            `[VideoComposition] Word caption burn failed, proceeding without captions: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      }

      const watermarkedOutputPath = path.join(
        tempDir,
        'composed-video-watermarked.mp4',
      );
      await burnWatermarkIntoVideo(finalOutputPath, watermarkedOutputPath);
      cleanupFiles.push(watermarkedOutputPath);
      finalOutputPath = watermarkedOutputPath;

      // Verify output file exists
      try {
        const stats = await fs.stat(finalOutputPath);
        console.log(
          `[VideoComposition] Output file created: ${finalOutputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
        );
      } catch {
        console.error(
          `[VideoComposition] Output file not found: ${finalOutputPath}`,
        );
        throw new Error('Composed video file was not created');
      }

      console.log(
        '[VideoComposition] Video composition completed successfully!',
      );
      return {
        success: true,
        outputPath: finalOutputPath,
        duration: timelineItems.reduce((sum, item) => sum + (item.duration || 0), 0),
      };
    } catch (error) {
      console.error('[VideoComposition] Error during composition:', error);
      // Clean up temporary files on error
      console.log(
        `[VideoComposition] Cleaning up ${cleanupFiles.length} temporary files...`,
      );
      for (const file of cleanupFiles) {
        try {
          await fs.unlink(file);
        } catch {
          // Ignore cleanup errors
        }
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(`[VideoComposition] Composition failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  },
);

// Forward file change events to renderer
fileSystemManager.on('file-change', (event: FileChangeEvent) => {
  if (!mainWindow) return;

  // Normalize path to forward slashes before forwarding to renderer
  const normalizedPath = event.path.replace(/\\/g, '/');
  const normalizedEvent: FileChangeEvent = { ...event, path: normalizedPath };

  mainWindow.webContents.send('project:file-changed', normalizedEvent);

  if (normalizedPath.endsWith('.kshana/agent/manifest.json')) {
    mainWindow.webContents.send('project:manifest-written', {
      path: normalizedPath,
      at: Date.now(),
    });
  }
});

// Remotion IPC handlers
ipcMain.handle(
  'remotion:render-infographics',
  async (
    _event,
    projectDirectory: string,
    timelineItems: RemotionTimelineItem[],
    infographicPlacements: ParsedInfographicPlacement[],
  ) => {
    return remotionManager.startRender(
      projectDirectory,
      timelineItems,
      infographicPlacements,
    );
  },
);

ipcMain.handle('remotion:cancel-job', async (_event, jobId: string) => {
  remotionManager.cancelJob(jobId);
});

ipcMain.handle('remotion:get-job', async (_event, jobId: string) => {
  return remotionManager.getJob(jobId);
});

ipcMain.handle(
  'remotion:render-from-server-request',
  async (
    _event,
    projectDirectory: string,
    request: RemotionServerRenderRequest,
  ): Promise<RemotionServerRenderResult> => {
    return remotionManager.renderFromServerRequest(
      projectDirectory,
      request,
      (progress: RemotionServerRenderProgress) => {
        if (mainWindow) {
          mainWindow.webContents.send('remotion:server-progress', progress);
        }
      },
    );
  },
);

remotionManager.on('progress', (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('remotion:progress', progress);
  }
});

remotionManager.on('job-complete', (job) => {
  if (mainWindow) {
    mainWindow.webContents.send('remotion:job-complete', job);
  }
});

// Logger IPC handlers
ipcMain.handle('logger:init', () => {
  desktopLogger.initUILog();
});

ipcMain.handle('logger:user-input', (_event, content: string) => {
  desktopLogger.logUserInput(content);
});

ipcMain.handle(
  'logger:agent-text',
  (_event, text: string, agentName?: string) => {
    desktopLogger.logAgentText(text, agentName);
  },
);

ipcMain.handle(
  'logger:tool-start',
  (_event, toolName: string, args?: Record<string, unknown>) => {
    desktopLogger.logToolStart(toolName, args);
  },
);

ipcMain.handle(
  'logger:tool-complete',
  (
    _event,
    toolName: string,
    result: unknown,
    duration?: number,
    isError?: boolean,
  ) => {
    desktopLogger.logToolComplete(toolName, result, duration, isError);
  },
);

ipcMain.handle(
  'logger:question',
  (
    _event,
    question: string,
    options?: Array<{ label: string; description?: string }>,
    isConfirmation?: boolean,
    autoApproveTimeoutMs?: number,
  ) => {
    desktopLogger.logQuestion(
      question,
      options,
      isConfirmation,
      autoApproveTimeoutMs,
    );
  },
);

ipcMain.handle(
  'logger:status-change',
  (_event, status: string, agentName?: string, message?: string) => {
    desktopLogger.logStatusChange(status, agentName, message);
  },
);

ipcMain.handle(
  'logger:phase-transition',
  (
    _event,
    fromPhase: string,
    toPhase: string,
    success: boolean,
    reason?: string,
  ) => {
    desktopLogger.logPhaseTransition(fromPhase, toPhase, success, reason);
  },
);

ipcMain.handle(
  'logger:todo-update',
  (_event, todos: Array<{ content: string; status: string }>) => {
    desktopLogger.logTodoUpdate(todos);
  },
);

ipcMain.handle(
  'logger:error',
  (_event, error: string, context?: Record<string, unknown>) => {
    desktopLogger.logError(error, context);
  },
);

ipcMain.handle('logger:session-end', () => {
  desktopLogger.logSessionEnd();
});

ipcMain.handle('logger:get-paths', () => {
  return desktopLogger.getLogPaths();
});

ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

ipcMain.handle('app-update:get-status', async () => {
  return appUpdateStatus;
});

ipcMain.handle('app-update:check-now', async () => {
  await checkForAppUpdates();
  return appUpdateStatus;
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const setupAutoUpdater = () => {
  if (!app.isPackaged) {
    log.info('[AutoUpdater] Skipping update checks in development mode');
    broadcastAppUpdateStatus({
      phase: 'idle',
      manualCheckAvailable: false,
    });
    return;
  }

  if (process.platform === 'linux') {
    log.info('[AutoUpdater] Skipping update checks on Linux');
    broadcastAppUpdateStatus({
      phase: 'idle',
      message: 'Updates are not configured on Linux',
      manualCheckAvailable: false,
    });
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdater] Checking for updates...');
    broadcastAppUpdateStatus({
      phase: 'checking',
      message: 'Checking for updates...',
    });
  });

  autoUpdater.on('update-available', (info) => {
    log.info(`[AutoUpdater] Update available: ${info.version}`);
    broadcastAppUpdateStatus({
      phase: 'available',
      version: info.version,
      message: `Update ${info.version} is available`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info(`[AutoUpdater] No updates. Current latest: ${info.version}`);
    broadcastAppUpdateStatus({
      phase: 'not-available',
      version: info.version,
      message: `You're on the latest version (${info.version})`,
    });
  });

  autoUpdater.on('error', (error) => {
    log.error('[AutoUpdater] Update check failed:', error);
    broadcastAppUpdateStatus({
      phase: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Update check failed unexpectedly',
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    log.info(
      `[AutoUpdater] Download progress: ${Math.round(progressObj.percent)}%`,
    );
    broadcastAppUpdateStatus({
      phase: 'downloading',
      progressPercent: Math.round(progressObj.percent),
      message: 'Downloading update...',
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log.info(`[AutoUpdater] Update downloaded: ${info.version}`);
    broadcastAppUpdateStatus({
      phase: 'downloaded',
      version: info.version,
      progressPercent: 100,
      message: `Update ${info.version} is ready to install`,
    });

    if (!mainWindow) return;

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: 'A new version has been downloaded.',
      detail: 'Restart the app now to install the update.',
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
};

const checkForAppUpdates = async () => {
  if (!app.isPackaged || process.platform === 'linux') {
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error('[AutoUpdater] checkForUpdates failed:', error);
    broadcastAppUpdateStatus({
      phase: 'error',
      message:
        error instanceof Error ? error.message : 'Unable to check for updates',
    });
  }
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
      sandbox: false,
      webSecurity: false, // Allow file:// protocol for media preview
    },
  });

  const htmlPath = resolveHtmlPath('index.html');
  log.info(`Loading HTML from: ${htmlPath}`);
  log.info(`App is packaged: ${app.isPackaged}`);
  log.info(`Main process __dirname: ${__dirname}`);

  // In development, wait for dev server to be ready
  if (isDebug && htmlPath.startsWith('http://')) {
    const checkDevServer = async () => {
      const maxAttempts = 30;
      // eslint-disable-next-line no-plusplus
      for (let i = 0; i < maxAttempts; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const response = await fetch(htmlPath, { method: 'HEAD' });
          if (response.ok) {
            log.info('Dev server is ready');
            mainWindow?.loadURL(htmlPath);
            return;
          }
        } catch {
          // Dev server not ready yet
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 1000);
        });
      }
      log.warn('Dev server not ready after 30 seconds, loading anyway');
      mainWindow?.loadURL(htmlPath);
    };
    checkDevServer();
  } else {
    mainWindow.loadURL(htmlPath);
  }

  // Add error handlers for debugging
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      log.error(`Failed to load: ${errorCode} - ${errorDescription}`);
      log.error(`URL: ${validatedURL || htmlPath}`);
    },
  );

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error(`Renderer process gone: ${details.reason}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('Page finished loading');
  });

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    log.info('Window ready to show');
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

/**
 * Add event listeners...
 */

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  desktopLogger.logSessionEnd();
  backendManager.stop().catch((error) => {
    log.error(`Failed to stop backend: ${(error as Error).message}`);
  });
});

const bootstrapBackend = async () => {
  try {
    const settings = getSettings();
    const cloudRuntime =
      settings.backendMode === 'cloud'
        ? await resolveCloudBackendRuntime(getAccount()?.token)
        : undefined;
    await backendManager.start(settings, cloudRuntime);
  } catch (error) {
    log.error(`Failed to start backend: ${(error as Error).message}`);
  }
};

const handleBackendStartup = (error: Error) => {
  log.error(`Background backend startup failed: ${error.message}`);
};

const startBackendInBackground = () => {
  const backendPromise = bootstrapBackend();
  backendPromise.catch(handleBackendStartup);
};

// ─── Kshana Cloud deep-link protocol ─────────────────────────────────────────

// Register kshana:// as the custom URL scheme
if (!app.isDefaultProtocolClient('kshana')) {
  app.setAsDefaultProtocolClient('kshana');
}

/** Parses kshana://auth?token=xxx&state=xxx and stores the account. */
async function handleDeepLink(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'auth') return;

    const token = parsed.searchParams.get('token');
    const state = parsed.searchParams.get('state');
    if (!token) return;
    if (!state || state !== pendingDesktopAuthState) {
      log.warn('[Account] Rejected desktop sign-in with invalid state');
      return;
    }

    const payload = parseDesktopAuthToken(token);
    if (!payload) {
      log.warn('[Account] Rejected malformed or expired desktop token');
      return;
    }

    pendingDesktopAuthState = null;
    const previousAccount = getAccount();

    setAccount({
      userId: payload.sub ?? '',
      email: payload.email ?? '',
      name: payload.name ?? null,
      credits: 0,
      token,
    });

    // Fetch balance immediately so the Account tab shows it
    const websiteBase = await resolveKshanaWebsiteUrl();
    await refreshBalance(websiteBase);

    const settings = getSettings();
    if (
      shouldRestartCloudBackendForAccountChange(
        settings,
        previousAccount,
        token,
      )
    ) {
      try {
        const cloudRuntime = await resolveCloudBackendRuntime(token);
        const state = await backendManager.restart(settings, cloudRuntime);
        if (state.status === 'error') {
          log.error(
            `[Account] Cloud backend restart failed after sign-in: ${state.message ?? 'unknown error'}`,
          );
        }
      } catch (error) {
        log.error(
          `[Account] Cloud backend restart failed after sign-in: ${(error as Error).message}`,
        );
      }
    }

    // Notify renderer that account changed
    mainWindow?.webContents.send('account:changed');
    log.info('[Account] Desktop sign-in complete:', payload.email);
  } catch (err) {
    log.error('[Account] Failed to handle deep link:', err);
  }
}

// macOS: app is already running, open-url fires
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows / Linux: second-instance argv carries the URL
app.on('second-instance', (_event, argv) => {
  const deepLink = argv.find((arg) => arg.startsWith('kshana://'));
  if (deepLink) handleDeepLink(deepLink);
  // Focus the existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ─── Account IPC handlers ──────────────────────────────────────────────────

ipcMain.handle('account:get', () => {
  return getAccount();
});

ipcMain.handle('account:sign-in', async () => {
  // Generate a random state token for CSRF protection
  const state = randomUUID();
  pendingDesktopAuthState = state;
  const websiteBase = await resolveKshanaWebsiteUrl();
  const url = `${websiteBase}/auth/desktop?state=${encodeURIComponent(state)}`;
  await shell.openExternal(url);
  return { opened: true };
});

ipcMain.handle('account:sign-out', async () => {
  const settings = getSettings();
  clearAccount();
  if (shouldStopCloudBackendOnSignOut(settings)) {
    try {
      const state = await backendManager.stop();
      if (state.status === 'error') {
        log.error(
          `[Account] Cloud backend stop failed after sign-out: ${state.message ?? 'unknown error'}`,
        );
      }
    } catch (error) {
      log.error(
        `[Account] Cloud backend stop failed after sign-out: ${(error as Error).message}`,
      );
    }
  }
  mainWindow?.webContents.send('account:changed');
  return { success: true };
});

ipcMain.handle('account:refresh-balance', async () => {
  const websiteBase = await resolveKshanaWebsiteUrl();
  const balance = await refreshBalance(websiteBase);
  mainWindow?.webContents.send('account:changed');
  return { balance };
});

ipcMain.handle('account:get-billing-url', async () => {
  return resolveKshanaWebsitePath('/billing');
});

ipcMain.handle('account:open-billing', async () => {
  const url = await resolveKshanaWebsitePath('/billing');
  await shell.openExternal(url);
  return { opened: true, url };
});

// ─────────────────────────────────────────────────────────────────────────────

app
  .whenReady()
  .then(async () => {
    // Initialize logger for this session
    desktopLogger.initUILog();

    // Clean up stale Remotion temp jobs from previous sessions
    remotionManager.cleanupOnStartup().catch((err) => {
      log.warn('[RemotionManager] Startup cleanup error:', err);
    });

    // Create window first so UI appears immediately
    await createWindow();

    setupAutoUpdater();
    checkForAppUpdates();

    // Start backend in background (non-blocking)
    // UI will show loading state while backend starts
    startBackendInBackground();

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
