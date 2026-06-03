/* eslint global-require: off, no-console: off, promise/always-return: off */

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

// DESKTOP-DRIVE: when DHEE_DEBUG_PORT is set, expose Chromium's
// remote-debugging-port so a Playwright-based CLI can attach via CDP
// (see src/dev/desktopDrive.ts). MUST run before app.whenReady().
// Port stays disabled by default so packaged builds don't expose it.
const _dheeDebugPort = process.env['DHEE_DEBUG_PORT'];
if (_dheeDebugPort && /^\d+$/.test(_dheeDebugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', _dheeDebugPort);
  // Localhost-only — defense in depth on top of Electron's default.
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  // eslint-disable-next-line no-console
  console.log(`[desktop-drive] CDP enabled on http://127.0.0.1:${_dheeDebugPort}`);
}
import { autoUpdater } from 'electron-updater';
import ffmpeg from '@ts-ffmpeg/fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { normalizePathForFFmpeg } from './utils/pathNormalizer';
import { ensureNewProjectParentExists } from './utils/newProjectParent';
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
import { dheeCoreManager as DheeCoreManager } from './dheeCoreManager';
import { registerdheeIpcBridge } from './dheeIpcBridge';
import { parseDesktopAuthToken } from './desktopAuthToken';
import {
  clearAccount,
  getAccount,
  refreshBalance,
  setAccount,
} from './accountManager';
import {
  completeOnboarding,
  getOnboardingState,
} from './onboardingManager';
import { runProviderDiagnostics } from './providerDiagnostics';
import { AppSettings, getSettings, updateSettings } from './settingsManager';
import {
  captureDesktopAuthStarted,
  captureDesktopProjectCreated,
  identifyDesktopUser,
  resetDesktopAnalyticsIdentity,
  startDesktopAnalytics,
  stopDesktopAnalytics,
} from './analytics';
import {
  applyRuntimeAnalyticsConfig as applyRuntimeAnalyticsConfigFromFile,
  resolvedheeWebsiteUrl as resolveRuntimeDheeWebsiteUrl,
  type RuntimeConfigSource,
} from './cloudRuntimeConfig';
import fileSystemManager from './fileSystemManager';
import type { FileChangeEvent } from '../shared/fileSystemTypes';
import type { ChatExportPayload, ChatExportResult } from '../shared/chatTypes';
import * as desktopLogger from './services/DesktopLogger';
import { exportLogsZip, getLogsDirAbs } from './services/logsExport';
import { exportChatJsonWithDialog } from './services/chatExportService';
import {
  generateCapcutProject,
  type ExportTimelineItem,
  type ExportOverlayItem,
  type ExportPromptOverlayCue,
} from './exporters/capcutGenerator';
import {
  buildAssFromPromptOverlayCues,
  type PromptOverlayCue,
} from './services/promptOverlayAss';
import * as watermarkModule from './video/watermark';

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
  process.env.dhee_PACKAGED = '1';
}

// Point dhee-core's loggers at our app data dir so packaged users
// get logs in a real writable location (not inside the read-only .app
// bundle). DesktopLogger already writes its UI/phase/workflow logs
// here; consolidating means one folder for the user to share with
// support. getLogsDir() in dhee-core consumes this env var lazily,
// so it must be set before any logger writes — module top-level is
// safe because dhee-core isn't imported until later in this file.
if (!process.env.dhee_LOGS_DIR) {
  process.env.dhee_LOGS_DIR = path.join(app.getPath('userData'), 'logs');
}

// Point dhee-core at the bundled ffmpeg/ffprobe binaries. Packaged
// macOS GUI apps don't inherit the user's shell $PATH, and Windows
// users may not have ffmpeg installed at all — so dhee-core's
// `spawn('ffmpeg')` calls would fail with ENOENT in the wild. We set
// these env vars before dhee-core loads so its FFmpegAssembler,
// keyframeExtractor, and InputProcessor pick up the bundled binaries.
{
  let bundledFfmpeg = ffmpegInstaller.path;
  let bundledFfprobe = ffprobeInstaller.path;
  if (app.isPackaged) {
    bundledFfmpeg = bundledFfmpeg.replace('app.asar', 'app.asar.unpacked');
    bundledFfprobe = bundledFfprobe.replace('app.asar', 'app.asar.unpacked');
  }
  if (!process.env.dhee_FFMPEG_PATH) {
    process.env.dhee_FFMPEG_PATH = bundledFfmpeg;
  }
  if (!process.env.dhee_FFPROBE_PATH) {
    process.env.dhee_FFPROBE_PATH = bundledFfprobe;
  }
}

let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;
let pendingDesktopAuthState: string | null = null;
let dheeCoreManager: DheeCoreManager;
let lastAccountAuthStatus: 'idle' | 'waiting' | 'expired' | 'error' = 'idle';
let appUpdateStatus: AppUpdateStatus = {
  phase: 'idle',
  message: 'No update check yet',
  manualCheckAvailable: app.isPackaged && process.platform !== 'linux',
  checkedAt: Date.now(),
};

function runtimeConfigSource(): RuntimeConfigSource {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    dirname: __dirname,
    env: process.env,
  };
}

async function resolvedheeWebsiteUrl(): Promise<string> {
  return resolveRuntimeDheeWebsiteUrl(runtimeConfigSource());
}

async function applyRuntimeAnalyticsConfig(): Promise<void> {
  await applyRuntimeAnalyticsConfigFromFile(runtimeConfigSource());
}

async function resolvedheeWebsitePath(pathname: string): Promise<string> {
  const websiteBase = await resolvedheeWebsiteUrl();
  return `${websiteBase}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

async function getCloudAuthRuntime(settings: AppSettings) {
  // Cloud auth surfaces if ANY backend lane wants cloud — the token
  // + website URL are shared between LLM / ComfyUI / VLM proxy
  // routing. applyEnvFromSettings then gates per-lane on
  // settings.llmBackend / .comfyBackend / .vlmBackend.
  if (
    settings.llmBackend !== 'cloud' &&
    settings.comfyBackend !== 'cloud' &&
    settings.vlmBackend !== 'cloud'
  ) {
    return null;
  }
  const account = getAccount();
  if (!account?.token) return null;
  if (!parseDesktopAuthToken(account.token)) return null;
  return {
    websiteUrl: await resolvedheeWebsiteUrl(),
    desktopToken: account.token,
  };
}

function broadcastAccountChanged(): void {
  mainWindow?.webContents.send('account:changed');
  mainWindow?.webContents.send('account:auth-status', lastAccountAuthStatus);
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

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
  return getSettings();
});

ipcMain.handle(
  'settings:update',
  async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    const updated = updateSettings(patch);
    try {
      await dheeCoreManager.restart(
        updated,
        await getCloudAuthRuntime(updated),
      );
      if (mainWindow) {
        registerdheeIpcBridge(dheeCoreManager, mainWindow);
      }
    } catch (error) {
      log.error(
        `Failed to restart embedded engine after settings update: ${(error as Error).message}`,
      );
    }
    if (mainWindow) {
      mainWindow.webContents.send('settings:updated', updated);
    }
    // Push oversight changes into core's process-wide `oversightState`.
    // Both the SettingsPanel and the chat-header quick-toggles flow
    // through here, so this is the single fan-out point for the two
    // global flags. The dheeCoreManager wrappers no-op if core
    // isn't started yet (lifecycle race during boot).
    if (typeof patch.piOversight === 'boolean') {
      dheeCoreManager.setPiOversight('', patch.piOversight);
    }
    if (typeof patch.vlmJudge === 'boolean') {
      dheeCoreManager.setVlmJudge('', patch.vlmJudge);
    }
    return updated;
  },
);

ipcMain.handle('onboarding:get-state', () => {
  return getOnboardingState();
});

ipcMain.handle(
  'onboarding:complete',
  (_event, req?: { skipped?: boolean }) => {
    return completeOnboarding(req ?? {});
  },
);

ipcMain.handle('provider-diagnostics:run', async () => {
  return runProviderDiagnostics(getSettings(), getAccount());
});

// Project / File System IPC handlers
// New-Project default-workspace handler.
//
// Returns `<home>/dhee-studios` — the suggested parent folder for new
// projects when the user has not yet picked one. The renderer pairs
// this with its own localStorage-backed remembrance of the last
// chosen folder (see `renderer/utils/workspacePathDefaults.ts`); this
// IPC is consulted only on first-ever open, or when the persisted
// value is unreadable. Does not create the folder — the existing
// `project:create-folder` IPC mkdirs recursively on submit.
ipcMain.handle('project:get-default-workspace-path', async () => {
  return path.join(app.getPath('home'), 'dhee-studios');
});

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

// Generic chat-attachment file picker. v1 supports `comfy_workflow`
// only; the contract accepts a list of kinds so future text/image/
// video/audio picks reuse the same handler.
ipcMain.handle(
  'project:select-attachment',
  async (
    _event,
    req: {
      kinds: Array<'comfy_workflow' | 'text' | 'image' | 'video' | 'audio'>;
      title?: string;
    },
  ): Promise<{
    ok: boolean;
    attachment?: {
      id: string;
      kind: string;
      path: string;
      name: string;
      size?: number;
    };
    error?: string;
  }> => {
    if (!mainWindow) return { ok: false, error: 'Main window unavailable' };
    if (!req?.kinds || req.kinds.length === 0) {
      return { ok: false, error: 'No attachment kinds specified' };
    }

    const KIND_EXTENSIONS: Record<string, string[]> = {
      comfy_workflow: ['json'],
      text: ['txt', 'md'],
      image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
      video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
      audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
    };
    const KIND_LABEL: Record<string, string> = {
      comfy_workflow: 'ComfyUI Workflow',
      text: 'Text File',
      image: 'Image',
      video: 'Video',
      audio: 'Audio',
    };

    // Build one filter per kind so the dialog shows them as separate
    // groups; final "All Files" entry as escape hatch.
    const filters = req.kinds.map(k => ({
      name: KIND_LABEL[k] ?? k,
      extensions: KIND_EXTENSIONS[k] ?? ['*'],
    }));
    filters.push({ name: 'All Files', extensions: ['*'] });

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: req.title ?? 'Select an attachment',
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false };
    }

    const filePath = result.filePaths[0];
    if (!filePath) {
      return { ok: false, error: 'No file selected' };
    }

    // Pick the kind by extension match. If multiple kinds were
    // requested and the extension matches more than one, prefer the
    // first listed kind (callers control priority).
    const ext = path.extname(filePath).slice(1).toLowerCase();
    let pickedKind: string | undefined;
    for (const k of req.kinds) {
      if ((KIND_EXTENSIONS[k] ?? []).includes(ext)) {
        pickedKind = k;
        break;
      }
    }
    if (!pickedKind) pickedKind = req.kinds[0]; // fallback — user picked an unrecognized ext via "All Files"

    let size: number | undefined;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      size = undefined;
    }

    return {
      ok: true,
      attachment: {
        id: `att_${Date.now()}_${Math.floor(Math.random() * 10000).toString(36)}`,
        kind: pickedKind,
        path: filePath,
        name: path.basename(filePath),
        size,
      },
    };
  },
);

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

    const cached = (globalThis as any).__dheeReadTreeCache?.get?.(
      cacheKey,
    ) as { value: unknown; expiresAt: number } | undefined;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const inflightMap: Map<string, Promise<unknown>> = (globalThis as any)
      .__dheeReadTreeInflight ??
    ((globalThis as any).__dheeReadTreeInflight = new Map());
    const cacheMap: Map<string, { value: unknown; expiresAt: number }> =
      (globalThis as any).__dheeReadTreeCache ??
      ((globalThis as any).__dheeReadTreeCache = new Map());

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
  'project:refresh-assets',
  async (_event, projectDirectory: string) => {
    const manifestPath = path.join(
      projectDirectory,
      '.dhee',
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
        '.dhee',
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
  // In development: __dirname/../../ (points to dhee-desktop directory)
  // In packaged: process.resourcesPath (where extraResources are placed)
  if (app.isPackaged) {
    // In production, extraResources are placed in process.resourcesPath
    return process.resourcesPath;
  }
  // In development, __dirname is dist/main, so ../../ gives us dhee-desktop
  // test_image and test_video are in dhee-desktop directory
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
      (globalThis as any).__dheeExistsCache ??
      ((globalThis as any).__dheeExistsCache = new Map());
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
    const dheeDir = path.join(projectDir, '.dhee');
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
      await walk(dheeDir);
    } catch {
      // .dhee directory might not exist yet
    }

    log.info(
      `[project:read-all-files] Read ${results.length} text files from ${dheeDir} ` +
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
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }
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
    const absoluteBase = path.isAbsolute(basePath)
      ? path.resolve(basePath)
      : null;
    const isNewProjectCreate =
      meta?.source === 'renderer' && meta?.intent === 'new_project_parent';
    let activeProjectRoot: string | null;
    if (isNewProjectCreate) {
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
      // The renderer now defaults the Location field to
      // `<home>/dhee-studios`, which usually does NOT exist yet on a
      // fresh install. `assertCanonicalProjectContainment` (below) calls
      // `fs.realpath` on the active project root and throws
      // `PROJECT_ROOT_NOT_SET` when it's missing — blocking the create
      // with a confusing error. Mkdir-ing the parent here is safe:
      // we've already verified `absoluteBase` is absolute and
      // `relativePath` is a safe single segment, so the renderer
      // can't trick us into materializing arbitrary paths.
      await ensureNewProjectParentExists(absoluteBase);
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
      if (isNewProjectCreate) {
        captureDesktopProjectCreated(dheeCoreManager, {
          projectName: relativePath,
        });
      }
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

/**
 * project:initialize — populate a freshly-created project folder with a
 * fully-formed project.json (bundle bound + caller-supplied inputs
 * applied) BEFORE the chat / agent loads.
 *
 * Called by the renderer's "Production Slate" screen on click of ROLL.
 * The renderer has already created the empty folder via
 * `project:create-folder`; this handler resolves the bundle, writes
 * `inputs/story.md` (and any other file-kind inputs), populates
 * project-kind fields, and writes `project.json`.
 *
 * Returns `{ ok: true, projectDir }` on success or
 * `{ ok: false, error }` on validation / disk failure. The renderer
 * surfaces the error inline on the slate.
 */
type ProjectInitModule = {
  initializeProject: (params: {
    projectDir: string;
    name: string;
    bundleId: string;
    description?: string;
    inputs?: Record<string, unknown>;
  }) =>
    | { ok: true; projectDir: string }
    | { ok: false; error: string };
  listBundles: () => Array<{
    id: string;
    version: string;
    displayName: string;
    summary: string;
    techLine?: string;
    description?: string;
    inputs?: unknown[];
  }>;
};

ipcMain.handle(
  'bundle:list',
  async (): Promise<
    Array<{
      id: string;
      version: string;
      displayName: string;
      summary: string;
      techLine?: string;
      description?: string;
      inputs?: unknown[];
    }>
  > => {
    try {
      const dagModulePath = 'dhee-core/dag';
      const mod = (await import(/* webpackIgnore: true */ dagModulePath)) as ProjectInitModule;
      return mod.listBundles();
    } catch {
      return [];
    }
  },
);

ipcMain.handle(
  'project:initialize',
  async (
    _event,
    payload: {
      projectDir: string;
      name: string;
      bundleId: string;
      description?: string;
      inputs?: Record<string, unknown>;
    },
  ): Promise<{ ok: true; projectDir: string } | { ok: false; error: string }> => {
    try {
      // Indirect the module path through a variable so the TS compiler
      // doesn't try to resolve types statically — kshana-core's dist
      // ships without .d.ts (tsup `dts: false`). Same pattern as
      // dheeCoreManager.ts's `loadDagModule`.
      const dagModulePath = 'dhee-core/dag';
      const mod = (await import(/* webpackIgnore: true */ dagModulePath)) as ProjectInitModule;
      return mod.initializeProject(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
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

// ─── Diagnostics: logs reveal + zip export ───────────────────────────
// Lets a user emailing support open or bundle the dhee-core +
// DesktopLogger output. Both target the dir set by dhee_LOGS_DIR
// (see top of file).
ipcMain.handle('logs:get-dir', async (): Promise<string> => {
  return getLogsDirAbs();
});

ipcMain.handle(
  'logs:reveal',
  async (): Promise<{ ok: true; path: string } | { ok: false; error: string }> => {
    try {
      const dir = getLogsDirAbs();
      // Ensure the dir exists so the shell open call doesn't ENOENT on
      // a fresh install where nothing has logged yet.
      await fs.mkdir(dir, { recursive: true });
      const result = await shell.openPath(dir);
      if (result) {
        // openPath returns a non-empty string on failure.
        return { ok: false, error: result };
      }
      return { ok: true, path: dir };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.handle(
  'logs:export-zip',
  async (): Promise<
    | { ok: true; path: string; bytes: number; fileCount: number }
    | { ok: false; error: string }
  > => {
    try {
      const result = await exportLogsZip();
      // Highlight the freshly-written zip in Finder/Explorer so the
      // user can drag it into an email immediately.
      shell.showItemInFolder(result.zipPath);
      return {
        ok: true,
        path: result.zipPath,
        bytes: result.bytes,
        fileCount: result.fileCount,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.handle('project:save-video-file', async () => {
  if (!mainWindow) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Video',
    defaultPath: `dhee-timeline-${timestamp}.mp4`,
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
    promptOverlayCues?: ExportPromptOverlayCue[],
  ): Promise<{
    success: boolean;
    outputPath?: string;
    duration?: number;
    error?: string;
  }> => {
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
        undefined,
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
  dheeCoreFfmpeg: process.env.dhee_FFMPEG_PATH,
  dheeCoreFfprobe: process.env.dhee_FFPROBE_PATH,
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

interface RenderResolution {
  width: number;
  height: number;
}

// Watermark constants (text, size, margins) live in
// src/main/video/watermark.ts where the filter is built. Single
// source of truth for the mandatory watermark — see UX-1.
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
  const manifestPath = path.join(projectDirectory, 'dhee.json');

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

/**
 * Mandatory watermark — every export path MUST call this before
 * returning a file path. See src/main/video/watermark.ts for the
 * implementation and src/main/video/watermarkGuard.test.ts for the
 * static-source enforcement that catches new export paths that
 * forget to apply it.
 */
async function burnWatermarkIntoVideo(
  inputVideoPath: string,
  outputVideoPath: string,
): Promise<void> {
  return watermarkModule.burnWatermarkIntoVideo(
    inputVideoPath,
    outputVideoPath,
    findAvailableSystemFont,
    console,
  );
}

ipcMain.handle(
  'project:compose-timeline-video',
  async (
    _event,
    timelineItems: TimelineItem[],
    projectDirectory: string,
    audioPath?: string,
    overlayItems?: OverlayItem[],
    promptOverlayCues?: PromptOverlayCue[],
    exportOptions?: ExportRenderOptions,
  ): Promise<{
    success: boolean;
    outputPath?: string;
    duration?: number;
    error?: string;
  }> => {
    console.log('[VideoComposition] Starting video composition...');
    console.log('[VideoComposition] Timeline items:', timelineItems.length);

    if (!timelineItems || timelineItems.length === 0) {
      console.error('[VideoComposition] No timeline items to compose');
      return { success: false, error: 'No timeline items to compose' };
    }

    const tempDir = path.join(projectDirectory, '.dhee', 'temp');
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
        duration: timelineItems.reduce(
          (sum, item) => sum + (item.duration || 0),
          0,
        ),
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

  if (normalizedPath.endsWith('.dhee/agent/manifest.json')) {
    mainWindow.webContents.send('project:manifest-written', {
      path: normalizedPath,
      at: Date.now(),
    });
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
  // Install reload + inspect-element keyboard shortcuts, but DON'T
  // auto-open DevTools on every BrowserWindow. Devs can still toggle
  // them with Cmd+Opt+I / Ctrl+Shift+I when they want.
  require('electron-debug').default({ showDevTools: false });
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

  const getWindowIconPath = (): string => {
    // Use 512px PNG for HiDPI taskbar/titlebar; icon.ico (also 512-capable) is for installers/shortcuts.
    if (process.platform === 'win32' || process.platform === 'linux') {
      return getAssetPath('icons', '512x512.png');
    }
    return getAssetPath('icon.png');
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getWindowIconPath(),
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
  log.info(`Main process cwd: ${process.cwd()}`);
  log.info(`Main process NODE_PATH: ${process.env.NODE_PATH || '(unset)'}`);
  log.info(
    `Preload script: ${
      app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js')
    }`,
  );

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
    (_event, errorCode, errorDescription, validatedURL) => {
      log.error(`Failed to load: ${errorCode} - ${errorDescription}`);
      log.error(`URL: ${validatedURL || htmlPath}`);
    },
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone:', details);
  });

  mainWindow.webContents.on('console-message', (details) => {
    log.info(
      `[RendererConsole:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`,
    );
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error(
      `[Preload] Failed to load ${preloadPath}: ${error.message}\n${error.stack}`,
    );
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

// Embedded dhee-ink runtime — replaces the spawn+WS local backend.
// Renderer talks to this via window.dhee (registerdheeIpcBridge
// below registers the ipcMain handlers + sets up event forwarding).
dheeCoreManager = new DheeCoreManager();

app.on('before-quit', () => {
  desktopLogger.logSessionEnd();
  stopDesktopAnalytics(dheeCoreManager, { flush: false });
  try {
    dheeCoreManager.stop();
  } catch (error) {
    log.error(`Failed to stop embedded engine: ${(error as Error).message}`);
  } finally {
    dheeCoreManager.flushAnalytics().catch(() => undefined);
  }
});

const bootstrapBackend = async () => {
  try {
    await applyRuntimeAnalyticsConfig();
    const settings = getSettings();
    log.info(
      `[EmbeddedDhee] Bootstrap starting packaged=${app.isPackaged} cwd=${process.cwd()}`,
    );
    log.info(
      `[EmbeddedDhee] Settings provider=${settings.llmProvider} backendMode=${settings.backendMode} projectDir=${settings.projectDir || '(unset)'}`,
    );
    // Tell dhee-ink we're inside the packaged Electron build so its
    // path defaults flip from REPO_ROOT (dev) to ~/dhee (user data
    // dir). Must be set BEFORE dheeCoreManager.start, which calls
    // loadDevEnv → getProjectsDir() to decide where to chdir.
    if (app.isPackaged) {
      process.env.dhee_PACKAGED = '1';
      log.info('[EmbeddedDhee] Set dhee_PACKAGED=1');
    }
    // Embedded dhee-ink — the only backend path. Starts synchronously
    // (in-process), so the IPC bridge can register immediately and the
    // renderer's window.dhee.* calls can land.
    await dheeCoreManager.start(
      settings,
      await getCloudAuthRuntime(settings),
    );
    log.info('[EmbeddedDhee] Manager started');
    const analyticsHost = process.env.POSTHOG_HOST || '(default)';
    const analyticsSaltState = process.env.ANALYTICS_SALT ? 'set' : 'unset';
    log.info(
      `[EmbeddedDhee] Analytics ${dheeCoreManager.isAnalyticsEnabled() ? 'enabled' : 'disabled'} posthogHost=${analyticsHost} analyticsSalt=${analyticsSaltState}`,
    );
    startDesktopAnalytics({
      manager: dheeCoreManager,
      account: getAccount(),
    });
    if (mainWindow) {
      registerdheeIpcBridge(dheeCoreManager, mainWindow);
      log.info('[EmbeddedDhee] IPC bridge registered');
    } else {
      log.warn('[EmbeddedDhee] Manager started but mainWindow is missing');
    }
  } catch (error) {
    log.error(
      `Failed to start embedded engine: ${(error as Error).message}\n${
        (error as Error).stack
      }`,
    );
  }
};

const handleBackendStartup = (error: Error) => {
  log.error(
    `Background backend startup failed: ${error.message}\n${error.stack}`,
  );
};

const startBackendInBackground = () => {
  const backendPromise = bootstrapBackend();
  backendPromise.catch(handleBackendStartup);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find(
      (arg) => arg.startsWith('dhee://') || arg.startsWith('dhee://'),
    );
    if (deepLink) {
      handleDeepLink(deepLink);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

if (!app.isDefaultProtocolClient('dhee')) {
  app.setAsDefaultProtocolClient('dhee');
}
if (!app.isDefaultProtocolClient('dhee')) {
  app.setAsDefaultProtocolClient('dhee');
}

async function restartEmbeddedAfterAccountChange(
  reason: string,
): Promise<void> {
  try {
    const settings = getSettings();
    await dheeCoreManager.restart(
      settings,
      await getCloudAuthRuntime(settings),
    );
    if (mainWindow) {
      registerdheeIpcBridge(dheeCoreManager, mainWindow);
    }
  } catch (error) {
    log.error(
      `[Account] Embedded dhee restart failed after ${reason}: ${(error as Error).message}`,
    );
  }
}

async function validateStoredDesktopAccountOnStartup(): Promise<void> {
  const account = getAccount();
  if (!account) {
    lastAccountAuthStatus = 'idle';
    return;
  }

  if (!parseDesktopAuthToken(account.token)) {
    clearAccount();
    updateSettings({ backendMode: 'local', llmBackend: 'local', comfyBackend: 'local', vlmBackend: 'local' });
    lastAccountAuthStatus = 'expired';
    mainWindow?.webContents.send('settings:updated', getSettings());
    broadcastAccountChanged();
    return;
  }

  // Don't force backendMode='cloud' here — that would override the
  // user's persisted choice on every restart. Sign-in deep-link sets
  // cloud once on first sign-in; if the user later flips to local in
  // Settings, that choice should survive subsequent launches.
  const result = await refreshBalance(await resolvedheeWebsiteUrl());
  if (result.status === 'expired') {
    updateSettings({ backendMode: 'local', llmBackend: 'local', comfyBackend: 'local', vlmBackend: 'local' });
    lastAccountAuthStatus = 'expired';
    mainWindow?.webContents.send('settings:updated', getSettings());
  } else if (result.status === 'error') {
    lastAccountAuthStatus = 'error';
  } else {
    lastAccountAuthStatus = 'idle';
  }
  mainWindow?.webContents.send('settings:updated', getSettings());
  broadcastAccountChanged();
}

function restoreStoredDesktopAccountBeforeBackend(): void {
  const account = getAccount();
  if (!account) {
    lastAccountAuthStatus = 'idle';
    return;
  }

  if (!parseDesktopAuthToken(account.token)) {
    clearAccount();
    updateSettings({ backendMode: 'local', llmBackend: 'local', comfyBackend: 'local', vlmBackend: 'local' });
    lastAccountAuthStatus = 'expired';
    return;
  }

  // Don't force backendMode here — see validateStoredDesktopAccountOnStartup.
  // The persisted setting is the authoritative source; sign-in flips to
  // cloud on first sign-in (handleDeepLink) and the user can override
  // it from the Settings panel.
  lastAccountAuthStatus = 'idle';
}

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
    lastAccountAuthStatus = 'idle';
    setAccount({
      userId: payload.sub,
      email: payload.email,
      name: payload.name ?? null,
      credits: 0,
      token,
    });
    identifyDesktopUser(dheeCoreManager, payload.sub);

    await refreshBalance(await resolvedheeWebsiteUrl());
    // First sign-in defaults BOTH lanes to cloud — matches the
    // pre-split single-toggle behavior. Users can flip ComfyUI back
    // to local in Settings without affecting LLM (or vice versa);
    // those choices persist across restarts.
    updateSettings({
      backendMode: 'cloud',
      llmBackend: 'cloud',
      comfyBackend: 'cloud',
      vlmBackend: 'cloud',
    });
    await restartEmbeddedAfterAccountChange('sign-in');
    mainWindow?.webContents.send('settings:updated', getSettings());
    broadcastAccountChanged();
    log.info('[Account] Desktop sign-in complete:', payload.email);
  } catch (error) {
    lastAccountAuthStatus = 'error';
    broadcastAccountChanged();
    log.error('[Account] Failed to handle deep link:', error);
  }
}

async function openDesktopAuthWindow(url: string): Promise<void> {
  if (authWindow) {
    try {
      authWindow.focus();
      await authWindow.loadURL(url);
      return;
    } catch {
      authWindow.close();
      authWindow = null;
    }
  }

  authWindow = new BrowserWindow({
    show: false,
    width: 540,
    height: 720,
    resizable: true,
    minimizable: true,
    maximizable: false,
    title: 'Sign in to Dhee Studio',
    backgroundColor: '#030508',
    webPreferences: {
      sandbox: false,
    },
  });

  authWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl.startsWith('dhee://') || navigationUrl.startsWith('dhee://')) {
      event.preventDefault();
      handleDeepLink(navigationUrl);
      authWindow?.close();
    }
  });

  authWindow.webContents.setWindowOpenHandler((edata) => {
    // Keep OAuth flows inside the window when possible.
    if (edata.url.startsWith('dhee://') || edata.url.startsWith('dhee://')) {
      handleDeepLink(edata.url);
      authWindow?.close();
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  authWindow.on('closed', () => {
    authWindow = null;
  });

  await authWindow.loadURL(url);
  authWindow.once('ready-to-show', () => {
    authWindow?.show();
    authWindow?.focus();
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

ipcMain.handle('account:get', () => {
  return getAccount();
});

ipcMain.handle('account:get-auth-status', () => {
  return lastAccountAuthStatus;
});

ipcMain.handle('account:sign-in', async () => {
  const state = randomUUID();
  pendingDesktopAuthState = state;
  lastAccountAuthStatus = 'waiting';
  captureDesktopAuthStarted(dheeCoreManager);
  const url = await resolvedheeWebsitePath(
    `/auth/desktop?state=${encodeURIComponent(state)}`,
  );
  // Prefer system browser for desktop deep-link prompt UX.
  // Fall back to the embedded auth window if the OS browser open fails.
  try {
    await shell.openExternal(url);
  } catch (error) {
    log.warn('[Account] Failed to open system browser, falling back to embedded auth window:', error);
    await openDesktopAuthWindow(url);
  }
  broadcastAccountChanged();
  return { opened: true, state };
});

ipcMain.handle('account:sign-out', async () => {
  clearAccount();
  updateSettings({ backendMode: 'local', llmBackend: 'local', comfyBackend: 'local', vlmBackend: 'local' });
  pendingDesktopAuthState = null;
  lastAccountAuthStatus = 'idle';
  resetDesktopAnalyticsIdentity(dheeCoreManager);
  await restartEmbeddedAfterAccountChange('sign-out');
  mainWindow?.webContents.send('settings:updated', getSettings());
  broadcastAccountChanged();
  return { success: true };
});

ipcMain.handle('account:refresh-balance', async () => {
  const result = await refreshBalance(await resolvedheeWebsiteUrl());
  if (result.status === 'expired') {
    updateSettings({ backendMode: 'local', llmBackend: 'local', comfyBackend: 'local', vlmBackend: 'local' });
    lastAccountAuthStatus = 'expired';
    mainWindow?.webContents.send('settings:updated', getSettings());
  } else if (result.status === 'ok') {
    lastAccountAuthStatus = 'idle';
  } else {
    lastAccountAuthStatus = 'error';
  }
  broadcastAccountChanged();
  return result;
});

ipcMain.handle('account:get-billing-url', async () => {
  return resolvedheeWebsitePath('/billing');
});

ipcMain.handle('account:open-billing', async () => {
  const url = await resolvedheeWebsitePath('/billing');
  await shell.openExternal(url);
  return { opened: true, url };
});

app
  .whenReady()
  .then(async () => {
    // Initialize logger for this session
    desktopLogger.initUILog();

    // Create window first so UI appears immediately
    await createWindow();

    setupAutoUpdater();
    checkForAppUpdates();
    restoreStoredDesktopAccountBeforeBackend();
    mainWindow?.webContents.send('settings:updated', getSettings());
    broadcastAccountChanged();
    validateStoredDesktopAccountOnStartup().catch((error) => {
      log.warn('[Account] Stored account validation failed:', error);
    });

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
