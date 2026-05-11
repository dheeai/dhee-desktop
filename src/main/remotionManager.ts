/**
 * RemotionManager - Orchestrates Remotion infographic rendering from the desktop app.
 * Manages per-job temp directories, spawns render.mts, tracks progress, and cleans up.
 */
import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { createRequire } from 'module';
import log from 'electron-log';
import { app } from 'electron';
import { getRemotionInfographicsDir } from './utils/remotionPath';
import { getBundledRemotionBrowserExecutable } from './utils/remotionBrowserPath';
import { bootstrapPackagedEsbuildBinaryPath } from './utils/esbuildBinaryPath';
import { classifyRemotionFailure } from './utils/remotionErrorDiagnostics';
import {
  buildRemotionPlacements,
  writeRenderConfig,
} from './remotionConfigGenerator';
import type {
  RemotionFailureDetails,
  RemotionJob,
  RemotionProgress,
  RemotionTimelineItem,
  ParsedInfographicPlacement,
  RemotionServerRenderRequest,
  RemotionServerRenderResult,
  RemotionServerRenderProgress,
} from '../shared/remotionTypes';

const JOB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RENDER_TIMEOUT_MS = 600_000; // 10 minutes
const REMOTION_CHROMIUM_OPTIONS = {
  // Force a software-backed GL renderer for headless-shell to avoid
  // intermittent WebGL context creation failures with @remotion/three.
  gl: 'swangle' as const,
};

const esbuildBootstrapResult = bootstrapPackagedEsbuildBinaryPath({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  logger: log,
});

type RemotionResolvedModulePaths = NonNullable<
  RemotionFailureDetails['resolvedModulePaths']
>;

interface RemotionRuntimeModules {
  bundler: typeof import('@remotion/bundler');
  renderer: typeof import('@remotion/renderer');
  resolvedPaths: RemotionResolvedModulePaths;
  browserExecutable: string | null;
}

class RemotionRuntimeResolutionError extends Error {
  readonly resolvedPaths: RemotionResolvedModulePaths;

  constructor(message: string, resolvedPaths: RemotionResolvedModulePaths) {
    super(message);
    this.name = 'RemotionRuntimeResolutionError';
    this.resolvedPaths = resolvedPaths;
  }
}

const remotionRuntimeModulesByRoot = new Map<
  string,
  Promise<RemotionRuntimeModules>
>();

function isReadOnlyAsarPath(filePath: string): boolean {
  return (
    /[\\/]+app\.asar([\\/]|$)/.test(filePath) &&
    !/[\\/]+app\.asar\.unpacked([\\/]|$)/.test(filePath)
  );
}

function formatResolvedModulePaths(
  resolvedPaths: RemotionResolvedModulePaths,
): string {
  return [
    `bundler=${resolvedPaths.bundler}`,
    `renderer=${resolvedPaths.renderer}`,
    `react=${resolvedPaths.react}`,
    `esbuild=${resolvedPaths.esbuild}`,
  ].join(' ');
}

async function ensureRemotionBrowser(
  renderer: typeof import('@remotion/renderer'),
): Promise<string | null> {
  const bundledBrowserPath = getBundledRemotionBrowserExecutable();
  if (bundledBrowserPath) {
    return bundledBrowserPath;
  }

  const browserStatus = await renderer.ensureBrowser({
    logLevel: 'info',
    chromeMode: 'headless-shell',
  });

  if (browserStatus.type === 'no-browser') {
    return null;
  }

  return browserStatus.path;
}

async function getRemotionRuntimeModules(
  remotionDir: string,
): Promise<RemotionRuntimeModules> {
  const runtimeRoot = await fs.realpath(remotionDir).catch(() => remotionDir);
  const cached = remotionRuntimeModulesByRoot.get(runtimeRoot);
  if (cached) {
    return cached;
  }

  const modulePromise = (async () => {
    const runtimeRequire = createRequire(
      path.join(runtimeRoot, 'package.json'),
    );
    const appRootRequire = createRequire(
      path.join(app.getAppPath(), 'package.json'),
    );
    const resolvedViaFallback = new Set<string>();

    const resolveModulePath = (specifier: string): string => {
      try {
        return runtimeRequire.resolve(specifier);
      } catch (runtimeError) {
        if (app.isPackaged) {
          throw runtimeError;
        }
        const fallbackResolved = appRootRequire.resolve(specifier);
        resolvedViaFallback.add(specifier);
        return fallbackResolved;
      }
    };

    const requireModule = <T>(specifier: string): T => {
      try {
        return runtimeRequire(specifier) as T;
      } catch (runtimeError) {
        if (app.isPackaged) {
          throw runtimeError;
        }
        resolvedViaFallback.add(specifier);
        return appRootRequire(specifier) as T;
      }
    };

    const resolvedPaths: RemotionResolvedModulePaths = {
      bundler: resolveModulePath('@remotion/bundler'),
      renderer: resolveModulePath('@remotion/renderer'),
      react: resolveModulePath('react/package.json'),
      esbuild: resolveModulePath('esbuild/package.json'),
    };

    log.info(
      '[RemotionRuntime] Resolved modules for %s %s',
      runtimeRoot,
      formatResolvedModulePaths(resolvedPaths),
    );

    if (app.isPackaged) {
      const hasReadOnlyAsarResolution = Object.values(resolvedPaths).some(
        (value) => isReadOnlyAsarPath(value),
      );
      if (hasReadOnlyAsarResolution) {
        throw new RemotionRuntimeResolutionError(
          `Packaged runtime preflight failed: Remotion modules resolved to read-only app.asar. ${formatResolvedModulePaths(
            resolvedPaths,
          )}`,
          resolvedPaths,
        );
      }
    }

    if (resolvedViaFallback.size > 0) {
      log.info(
        '[RemotionRuntime] Development fallback resolution via app root for: %s',
        Array.from(resolvedViaFallback).join(', '),
      );
    }

    const bundler =
      requireModule<typeof import('@remotion/bundler')>('@remotion/bundler');
    const renderer =
      requireModule<typeof import('@remotion/renderer')>('@remotion/renderer');
    const browserExecutable = await ensureRemotionBrowser(renderer);
    if (browserExecutable) {
      log.info(
        '[RemotionRuntime] Using browser executable for %s at %s',
        runtimeRoot,
        browserExecutable,
      );
    }

    return {
      bundler,
      renderer,
      resolvedPaths,
      browserExecutable,
    };
  })().catch((error) => {
    remotionRuntimeModulesByRoot.delete(runtimeRoot);
    throw error;
  });

  remotionRuntimeModulesByRoot.set(runtimeRoot, modulePromise);
  return modulePromise;
}

function generateJobId(): string {
  return `remotion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return (
      (parseInt(parts[0], 10) || 0) * 3600 +
      (parseInt(parts[1], 10) || 0) * 60 +
      (parseInt(parts[2], 10) || 0)
    );
  }
  if (parts.length === 2) {
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }
  return parseInt(timeStr, 10) || 5;
}

function toManifestInfographicPath(fileName: string): string {
  return `agent/infographic-placements/${fileName}`.replace(/\\/g, '/');
}

async function copyRemotionWorkspaceTemplate(
  remotionDir: string,
  workspaceDir: string,
): Promise<void> {
  const entriesToCopy = ['package.json', 'tsconfig.json', 'src', 'public'];

  for (const entry of entriesToCopy) {
    const sourcePath = path.join(remotionDir, entry);
    const destinationPath = path.join(workspaceDir, entry);
    const sourceExists = await fs
      .access(sourcePath)
      .then(() => true)
      .catch(() => false);

    if (!sourceExists) {
      continue;
    }

    const sourceStat = await fs.stat(sourcePath);
    if (sourceStat.isDirectory()) {
      await fs.cp(sourcePath, destinationPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

class RemotionManager extends EventEmitter {
  private jobs = new Map<string, RemotionJob>();
  private processes = new Map<string, ChildProcess>();

  /**
   * Create and start a render job.
   */
  async startRender(
    projectDirectory: string,
    timelineItems: RemotionTimelineItem[],
    infographicPlacements: ParsedInfographicPlacement[],
  ): Promise<{ jobId: string; error?: string }> {
    const remotionDir = getRemotionInfographicsDir();
    const buildDir = path.join(remotionDir, 'build');
    const buildIndex = path.join(buildDir, 'index.html');

    try {
      await fs.access(buildIndex);
    } catch {
      if (app.isPackaged) {
        try {
          const entryPoint = path.join(remotionDir, 'src', 'index.tsx');
          const runtimeModules = await getRemotionRuntimeModules(remotionDir);
          const { bundle } = runtimeModules.bundler;
          await bundle({
            entryPoint,
            outDir: buildDir,
            enableCaching: true,
            publicPath: '/',
          });
        } catch (error) {
          return {
            jobId: '',
            error: `Remotion bundle not found and auto-bundle failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      } else {
        return {
          jobId: '',
          error:
            'Remotion bundle not found. Run "pnpm run build" in dhee-core/remotion-infographics first.',
        };
      }
    }

    const placements = buildRemotionPlacements(
      timelineItems,
      infographicPlacements,
    );
    if (placements.length === 0) {
      return {
        jobId: '',
        error: 'No infographic placements to render.',
      };
    }

    const jobId = generateJobId();
    const tempDir = path.join(
      projectDirectory,
      '.dhee',
      'temp',
      'remotion',
      jobId,
    );

    await fs.mkdir(path.join(tempDir, 'input'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'output'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'logs'), { recursive: true });

    const outDir = path.join(tempDir, 'output');

    const job: RemotionJob = {
      id: jobId,
      projectDirectory,
      status: 'running',
      startTime: Date.now(),
      outputFiles: [],
      tempDir,
    };
    this.jobs.set(jobId, job);

    if (app.isPackaged) {
      this.executeRenderProgrammatic(
        jobId,
        remotionDir,
        buildDir,
        placements,
        outDir,
        tempDir,
      ).catch((error) => {
        log.error(`[RemotionManager] Job ${jobId} failed:`, error);
        const job = this.jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.endTime = Date.now();
          job.error = error instanceof Error ? error.message : String(error);
          this.emit('job-complete', job);
        }
      });
      return { jobId };
    }

    const configPath = await writeRenderConfig(tempDir, placements);
    const outputJsonPath = path.join(outDir, '_render_output.json');
    const logPath = path.join(tempDir, 'logs', 'render.log');
    const logStream = createWriteStream(logPath);

    // Clear NODE_OPTIONS to avoid inheriting ts-node/register from Electron dev env
    const remotionEnv = {
      ...process.env,
      NODE_ENV: 'production',
      NODE_OPTIONS: '',
    };
    const proc = spawn(
      'pnpm',
      [
        'run',
        'render',
        '--',
        '--input',
        configPath,
        '--outDir',
        outDir,
        '--output',
        outputJsonPath,
      ],
      {
        cwd: remotionDir,
        env: remotionEnv,
        shell: process.platform === 'win32',
      },
    );

    this.processes.set(jobId, proc);

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      logStream.write(output);

      const match = output.match(/REMOTION_PROGRESS:(.+)/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]) as {
            placementIndex?: number;
            totalPlacements?: number;
            progress?: number;
            stage?: string;
          };
          const progress: RemotionProgress = {
            jobId,
            placementIndex: parsed.placementIndex ?? 0,
            totalPlacements: parsed.totalPlacements ?? placements.length,
            progress: parsed.progress ?? 0,
            stage: (parsed.stage as RemotionProgress['stage']) ?? 'rendering',
          };
          this.emit('progress', progress);
        } catch (e) {
          log.warn('[RemotionManager] Failed to parse progress:', e);
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      logStream.write(`[STDERR] ${data}`);
    });

    const timeout = setTimeout(() => {
      if (proc.kill('SIGTERM')) {
        log.warn(
          `[RemotionManager] Job ${jobId} timed out after ${RENDER_TIMEOUT_MS / 1000}s`,
        );
      }
    }, RENDER_TIMEOUT_MS);

    proc.on('close', async (code) => {
      clearTimeout(timeout);
      logStream.end();
      this.processes.delete(jobId);

      const updatedJob = this.jobs.get(jobId);
      if (!updatedJob) return;

      if (code === 0) {
        updatedJob.status = 'completed';
        updatedJob.endTime = Date.now();

        try {
          const content = await fs.readFile(outputJsonPath, 'utf-8');
          const { outputs } = JSON.parse(content) as { outputs?: string[] };
          const rawOutputs = outputs ?? [];

          const destDir = path.join(
            updatedJob.projectDirectory,
            '.dhee',
            'agent',
            'infographic-placements',
          );
          await fs.mkdir(destDir, { recursive: true });

          const manifestPaths: string[] = [];
          for (const srcPath of rawOutputs) {
            const basename = path.basename(srcPath);
            const destPath = path.join(destDir, basename);
            await fs.copyFile(srcPath, destPath);
            manifestPaths.push(`agent/infographic-placements/${basename}`);
          }
          updatedJob.outputFiles = manifestPaths;

          await this.cleanupJobTempDir(jobId);
        } catch (err) {
          log.error(
            '[RemotionManager] Failed to read or copy render output:',
            err,
          );
          updatedJob.status = 'failed';
          updatedJob.error = 'Render completed but failed to copy output';
        }
      } else {
        updatedJob.status = 'failed';
        updatedJob.endTime = Date.now();
        updatedJob.error = `Render process exited with code ${code}`;

        try {
          await fs.writeFile(
            path.join(tempDir, 'logs', 'error.json'),
            JSON.stringify(
              { jobId, error: updatedJob.error, timestamp: Date.now() },
              null,
              2,
            ),
          );
        } catch {
          // ignore
        }
      }

      this.emit('job-complete', updatedJob);
    });

    return { jobId };
  }

  async renderFromServerRequest(
    projectDirectory: string,
    request: RemotionServerRenderRequest,
    onProgress?: (progress: RemotionServerRenderProgress) => void,
  ): Promise<RemotionServerRenderResult> {
    const requestId = request.requestId?.trim();
    if (!requestId) {
      return {
        requestId: '',
        status: 'failed',
        error: 'Missing requestId for server Remotion render.',
      };
    }

    const placements = request.placements ?? [];
    if (placements.length === 0) {
      return {
        requestId,
        status: 'failed',
        error: 'No placements provided for server Remotion render.',
      };
    }

    const remotionDir = getRemotionInfographicsDir();
    const debugComponentsDir = path.join(
      projectDirectory,
      '.dhee',
      'agent',
      'infographic-components',
    );
    const debugIndexPath = path.join(debugComponentsDir, 'index.tsx');
    const debugRequestPath = path.join(
      debugComponentsDir,
      'render-request.json',
    );

    const tempDir = path.join(
      projectDirectory,
      '.dhee',
      'temp',
      'remotion',
      `server-${requestId}`,
    );
    const workspaceDir = path.join(tempDir, 'workspace');
    const workspaceSrcDir = path.join(workspaceDir, 'src');
    const workspaceComponentsDir = path.join(workspaceSrcDir, 'components');
    const workspaceIndexPath = path.join(workspaceSrcDir, 'index.tsx');
    const workspaceBuildDir = path.join(workspaceDir, 'build');
    const workspaceEntryPoint = workspaceIndexPath;
    const outDir = path.join(tempDir, 'output');
    const destDir = path.join(
      projectDirectory,
      '.dhee',
      'agent',
      'infographic-placements',
    );
    let failureStage: RemotionFailureDetails['stage'] = 'unknown';
    let resolvedModulePaths: RemotionFailureDetails['resolvedModulePaths'];
    let renderSource: 'user_space' | 'legacy_runtime' = 'legacy_runtime';
    let selectedComponentsDir = workspaceComponentsDir;
    let selectedIndexPath = workspaceIndexPath;

    const emitProgress = (
      progress: number,
      stage: RemotionServerRenderProgress['stage'],
      placementIndex?: number,
      totalPlacements?: number,
      message?: string,
    ) => {
      if (!onProgress) return;
      onProgress({
        requestId,
        progress,
        stage,
        placementIndex,
        totalPlacements,
        message,
      });
    };

    const resolveProjectdheePath = (relativePath: string): string => {
      const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
      const withoutPrefix = normalized.startsWith('.dhee/')
        ? normalized.slice('.dhee/'.length)
        : normalized;
      return path.join(projectDirectory, '.dhee', withoutPrefix);
    };

    try {
      await fs.mkdir(tempDir, { recursive: true });
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(destDir, { recursive: true });
      await fs.mkdir(debugComponentsDir, { recursive: true });
      await fs.mkdir(workspaceBuildDir, { recursive: true });

      await copyRemotionWorkspaceTemplate(remotionDir, workspaceDir);

      const runtimeNodeModules = path.join(remotionDir, 'node_modules');
      const workspaceNodeModules = path.join(workspaceDir, 'node_modules');
      try {
        await fs.symlink(
          runtimeNodeModules,
          workspaceNodeModules,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'EEXIST') {
          throw error;
        }
      }

      const requestedSource = request.componentSource;
      const hasRequestedUserSpaceSource =
        requestedSource?.mode === 'user_space' &&
        typeof requestedSource.componentsDir === 'string' &&
        requestedSource.componentsDir.trim().length > 0 &&
        typeof requestedSource.indexPath === 'string' &&
        requestedSource.indexPath.trim().length > 0;

      let userSpaceComponentsDir = '';
      let userSpaceIndexPath = '';
      if (hasRequestedUserSpaceSource) {
        userSpaceComponentsDir = resolveProjectdheePath(
          requestedSource.componentsDir,
        );
        userSpaceIndexPath = resolveProjectdheePath(
          requestedSource.indexPath,
        );
        const hasComponentsDir = await fs
          .access(userSpaceComponentsDir)
          .then(() => true)
          .catch(() => false);
        const hasIndexFile = await fs
          .access(userSpaceIndexPath)
          .then(() => true)
          .catch(() => false);

        if (hasComponentsDir && hasIndexFile) {
          renderSource = 'user_space';
          selectedComponentsDir = userSpaceComponentsDir;
          selectedIndexPath = userSpaceIndexPath;
        } else {
          log.warn(
            '[RemotionManager] Requested user-space component source is missing, falling back to legacy runtime payload. componentsDir=%s exists=%s indexPath=%s exists=%s',
            userSpaceComponentsDir,
            hasComponentsDir,
            userSpaceIndexPath,
            hasIndexFile,
          );
        }
      }

      if (renderSource === 'user_space') {
        await fs.rm(workspaceComponentsDir, { recursive: true, force: true });
        await fs.mkdir(workspaceComponentsDir, { recursive: true });
        await fs.cp(selectedComponentsDir, workspaceComponentsDir, {
          recursive: true,
        });
        await fs.copyFile(selectedIndexPath, workspaceIndexPath);
      } else {
        const fallbackComponents = request.components ?? [];
        const fallbackIndexContent = request.indexContent ?? '';
        if (
          fallbackComponents.length === 0 ||
          fallbackIndexContent.trim().length === 0
        ) {
          return {
            requestId,
            status: 'failed',
            error:
              'User-space infographic component source is missing and no legacy fallback payload was provided.',
            details: {
              code: 'infographic_component_missing',
              stage: 'bundling',
              packaged: app.isPackaged,
              remotionDir,
              hint: 'Expected .dhee/agent/infographic-components/{Infographic*.tsx,index.tsx} to exist before desktop render.',
            },
          };
        }

        await fs.rm(workspaceComponentsDir, { recursive: true, force: true });
        await fs.mkdir(workspaceComponentsDir, { recursive: true });
        for (const component of fallbackComponents) {
          const componentName = component.componentName?.trim();
          if (!componentName) continue;
          await fs.writeFile(
            path.join(workspaceComponentsDir, `${componentName}.tsx`),
            component.componentCode ?? '',
            'utf-8',
          );
          await fs.writeFile(
            path.join(debugComponentsDir, `${componentName}.tsx`),
            component.componentCode ?? '',
            'utf-8',
          );
        }
        await fs.writeFile(workspaceIndexPath, fallbackIndexContent, 'utf-8');
        await fs.writeFile(debugIndexPath, fallbackIndexContent, 'utf-8');
      }

      if (renderSource === 'user_space') {
        await fs.writeFile(
          debugRequestPath,
          JSON.stringify(
            {
              requestId,
              placements: request.placements ?? [],
              componentCount: (request.components ?? []).length,
              renderSource,
              componentSource: request.componentSource,
            },
            null,
            2,
          ),
          'utf-8',
        );
      } else if (!hasRequestedUserSpaceSource) {
        await fs.writeFile(
          debugRequestPath,
          JSON.stringify(
            {
              requestId,
              placements: request.placements ?? [],
              componentCount: (request.components ?? []).length,
              renderSource,
            },
            null,
            2,
          ),
          'utf-8',
        );
      }

      log.info(
        '[RemotionManager] render_source=%s component_dir=%s entry_point=%s',
        renderSource,
        selectedComponentsDir,
        workspaceEntryPoint,
      );

      failureStage = 'bundling';
      emitProgress(
        5,
        'bundling',
        undefined,
        placements.length,
        'Bundling components',
      );
      const runtimeModules = await getRemotionRuntimeModules(remotionDir);
      resolvedModulePaths = runtimeModules.resolvedPaths;
      const { bundle } = runtimeModules.bundler;
      await bundle({
        entryPoint: workspaceEntryPoint,
        outDir: workspaceBuildDir,
        enableCaching: true,
        publicPath: '/',
        onProgress: (progress) => {
          const pct = Math.round(Math.max(0, Math.min(1, progress)) * 30);
          emitProgress(
            Math.min(35, 5 + pct),
            'bundling',
            undefined,
            placements.length,
            `Bundling ${pct}%`,
          );
        },
      });

      const outputs: string[] = [];
      const fps = 24;
      const total = placements.length;
      const { selectComposition, renderMedia } = runtimeModules.renderer;

      for (let i = 0; i < placements.length; i++) {
        const placement = placements[i]!;
        failureStage = 'rendering';
        emitProgress(
          Math.round(35 + (i / Math.max(1, total)) * 60),
          'rendering',
          i,
          total,
          `Rendering placement ${i + 1}/${total}`,
        );

        const durationSeconds = Math.max(
          1,
          timeToSeconds(placement.endTime) - timeToSeconds(placement.startTime),
        );
        const durationInFrames = Math.round(durationSeconds * fps);
        const inputProps = {
          prompt: placement.prompt,
          infographicType: placement.infographicType,
          data: placement.data ?? {},
        };

        const composition = await selectComposition({
          serveUrl: workspaceBuildDir,
          id: placement.componentName,
          inputProps,
          browserExecutable: runtimeModules.browserExecutable,
          chromiumOptions: REMOTION_CHROMIUM_OPTIONS,
        });
        composition.durationInFrames = durationInFrames;

        const baseName = `info${placement.placementNumber}_${Date.now().toString(36)}_${i}`;
        const outputFile = path.join(outDir, `${baseName}.webm`);

        await renderMedia({
          composition,
          serveUrl: workspaceBuildDir,
          codec: 'vp9',
          outputLocation: outputFile,
          inputProps,
          logLevel: 'error',
          pixelFormat: 'yuva420p',
          imageFormat: 'png',
          browserExecutable: runtimeModules.browserExecutable,
          chromiumOptions: REMOTION_CHROMIUM_OPTIONS,
        });

        const destPath = path.join(destDir, `${baseName}.webm`);
        await fs.copyFile(outputFile, destPath);
        outputs.push(toManifestInfographicPath(path.basename(destPath)));
      }

      failureStage = 'finalizing';
      emitProgress(100, 'finalizing', total, total, 'Render completed');

      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        log.warn(
          '[RemotionManager] Failed to cleanup server render temp dir:',
          cleanupError,
        );
      }

      return {
        requestId,
        status: 'completed',
        outputs,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorDiagnosticText =
        error instanceof Error
          ? [error.message, error.stack].filter(Boolean).join('\n')
          : String(error);
      const resolvedPathsFromError =
        error instanceof RemotionRuntimeResolutionError
          ? error.resolvedPaths
          : resolvedModulePaths;
      const details = classifyRemotionFailure({
        errorMessage: errorDiagnosticText,
        stage: failureStage,
        packaged: app.isPackaged,
        remotionDir,
        esbuildBinaryPath:
          esbuildBootstrapResult.binaryPath ??
          process.env['ESBUILD_BINARY_PATH'],
        resolvedModulePaths: resolvedPathsFromError,
      });
      if (
        renderSource === 'user_space' &&
        details.code === 'remotion_render_failed'
      ) {
        details.code = 'desktop_remotion_user_space_render_failed';
        details.hint =
          `${details.hint ? `${details.hint} ` : ''}` +
          'Render source was project user-space infographic components.';
      }
      log.error('[RemotionManager] Server render request failed:', {
        requestId,
        error: errorMessage,
        details,
        renderSource,
        componentDir: selectedComponentsDir,
        entryPoint: workspaceEntryPoint,
      });
      return {
        requestId,
        status: 'failed',
        error: errorMessage,
        details,
      };
    }
  }

  private async executeRenderProgrammatic(
    jobId: string,
    remotionDir: string,
    buildDir: string,
    placements: Array<{
      placementNumber: number;
      startTime: string;
      endTime: string;
      infographicType: string;
      prompt: string;
      data?: Record<string, unknown>;
      componentName: string;
    }>,
    outDir: string,
    tempDir: string,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const buildIndex = path.join(buildDir, 'index.html');
    try {
      await fs.access(buildIndex);
    } catch {
      throw new Error(
        'Remotion bundle not found. Run "generate_all_infographics" to build components first.',
      );
    }

    const fps = 24;
    const outputs: string[] = [];
    const total = placements.length;
    const runtimeModules = await getRemotionRuntimeModules(remotionDir);
    const { selectComposition, renderMedia } = runtimeModules.renderer;

    try {
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i]!;

        this.emit('progress', {
          jobId,
          placementIndex: i,
          totalPlacements: total,
          progress: (i / total) * 100,
          stage: 'rendering',
        });

        const durationSeconds = Math.max(
          1,
          timeToSeconds(p.endTime) - timeToSeconds(p.startTime),
        );
        const durationInFrames = Math.round(durationSeconds * fps);
        const inputProps = {
          prompt: p.prompt,
          infographicType: p.infographicType,
          data: p.data ?? {},
        };

        const composition = await selectComposition({
          serveUrl: buildDir,
          id: p.componentName,
          inputProps,
          browserExecutable: runtimeModules.browserExecutable,
          chromiumOptions: REMOTION_CHROMIUM_OPTIONS,
        });
        composition.durationInFrames = durationInFrames;

        const baseName = `info${p.placementNumber}_${Date.now().toString(36)}`;
        const outFilePath = path.join(outDir, `${baseName}.webm`);

        await renderMedia({
          composition,
          serveUrl: buildDir,
          codec: 'vp9',
          outputLocation: outFilePath,
          inputProps,
          logLevel: 'error',
          pixelFormat: 'yuva420p',
          imageFormat: 'png',
          browserExecutable: runtimeModules.browserExecutable,
          chromiumOptions: REMOTION_CHROMIUM_OPTIONS,
        });

        outputs.push(outFilePath);

        this.emit('progress', {
          jobId,
          placementIndex: i,
          totalPlacements: total,
          progress: ((i + 1) / total) * 100,
          stage: 'rendering',
        });
      }

      job.status = 'completed';
      job.endTime = Date.now();

      const destDir = path.join(
        job.projectDirectory,
        '.dhee',
        'agent',
        'infographic-placements',
      );
      await fs.mkdir(destDir, { recursive: true });

      const manifestPaths: string[] = [];
      for (const srcPath of outputs) {
        const basename = path.basename(srcPath);
        const destPath = path.join(destDir, basename);
        await fs.copyFile(srcPath, destPath);
        manifestPaths.push(`agent/infographic-placements/${basename}`);
      }
      job.outputFiles = manifestPaths;

      await this.cleanupJobTempDir(jobId);

      this.emit('job-complete', job);
    } catch (error) {
      job.status = 'failed';
      job.endTime = Date.now();
      job.error = error instanceof Error ? error.message : String(error);

      try {
        await fs.writeFile(
          path.join(tempDir, 'logs', 'error.json'),
          JSON.stringify(
            { jobId, error: job.error, timestamp: Date.now() },
            null,
            2,
          ),
        );
      } catch {
        // ignore
      }

      this.emit('job-complete', job);
      throw error;
    }
  }

  cancelJob(jobId: string): void {
    const proc = this.processes.get(jobId);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(jobId);
    }
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'cancelled';
      job.endTime = Date.now();
      this.emit('job-complete', job);
    }
  }

  getJob(jobId: string): RemotionJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  private async cleanupJobTempDir(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job?.tempDir) return;
    try {
      await fs.rm(job.tempDir, { recursive: true, force: true });
    } catch (err) {
      log.error(
        `[RemotionManager] Failed to cleanup temp for job ${jobId}:`,
        err,
      );
    }
  }

  /**
   * Clean up old temp directories on app startup.
   */
  async cleanupOnStartup(projectDirectory?: string): Promise<void> {
    const baseDir = projectDirectory
      ? path.join(projectDirectory, '.dhee', 'temp', 'remotion')
      : null;

    if (baseDir) {
      try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        const now = Date.now();
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const jobPath = path.join(baseDir, ent.name);
          const stat = await fs.stat(jobPath);
          if (now - stat.mtimeMs > JOB_MAX_AGE_MS) {
            await fs.rm(jobPath, { recursive: true, force: true });
            log.info(`[RemotionManager] Cleaned up old job temp: ${ent.name}`);
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.warn('[RemotionManager] Cleanup error:', err);
        }
      }
    }

    for (const [jobId, job] of this.jobs) {
      if (job.status === 'running') {
        const age = Date.now() - job.startTime;
        if (age > 24 * 60 * 60 * 1000) {
          job.status = 'failed';
          job.endTime = Date.now();
          job.error = 'Job was interrupted (app crashed or closed)';
          this.emit('job-complete', job);
        }
      }
    }
  }
}

export const remotionManager = new RemotionManager();
export const __private__ = {
  copyRemotionWorkspaceTemplate,
  ensureRemotionBrowser,
  REMOTION_CHROMIUM_OPTIONS,
};
