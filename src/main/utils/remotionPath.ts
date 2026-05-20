/**
 * Resolves the path to remotion-infographics directory.
 * Used by RemotionManager for dev vs packaged environments.
 */
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { app } from 'electron';
import log from 'electron-log';

const REMOTION_VERSION = '2.0.1';
const REQUIRED_REMOTION_PACKAGES = [
  'react/package.json',
  'react-dom/package.json',
  'remotion/package.json',
  '@remotion/bundler/package.json',
];

interface ResolvedModulePaths {
  bundler: string;
  renderer: string;
  react: string;
  esbuild: string;
}

export interface RemotionRuntimePreflightResult {
  ok: boolean;
  resolvedModulePaths: ResolvedModulePaths;
  error?: string;
}

export function getRemotionInfographicsDir(): string {
  if (app.isPackaged) {
    return getProductionRemotionDir();
  }
  return getDevelopmentRemotionDir();
}

function getProductionRemotionDir(): string {
  const userDataPath = app.getPath('userData');
  const userRemotionDir = path.join(userDataPath, 'remotion-infographics');
  const versionFile = path.join(userRemotionDir, '.version');

  let needsInit = false;

  if (!fs.existsSync(userRemotionDir)) {
    needsInit = true;
    log.info('[RemotionPath] User remotion directory not found - first launch');
  } else if (!fs.existsSync(path.join(userRemotionDir, 'package.json'))) {
    needsInit = true;
    log.warn('[RemotionPath] Incomplete remotion directory - reinitializing');
  } else if (fs.existsSync(versionFile)) {
    const installedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    if (installedVersion !== REMOTION_VERSION) {
      needsInit = true;
      log.info(
        `[RemotionPath] Remotion template outdated (${installedVersion} -> ${REMOTION_VERSION}) - updating`,
      );
    }
  } else {
    needsInit = true;
    log.info('[RemotionPath] No version file - reinitializing');
  }

  if (needsInit) {
    initializeRemotionInUserData(userRemotionDir);
  }

  ensureRuntimeNodeModulesLink(userRemotionDir);
  const nodeModulesDir = path.join(userRemotionDir, 'node_modules');
  const packageCheck = checkRequiredRemotionPackages(nodeModulesDir);
  if (!packageCheck.ok) {
    throw new Error(
      `Remotion runtime dependencies are unavailable in packaged app. Missing: ${packageCheck.missing.join(', ')}. Install a freshly packaged desktop build and retry.`,
    );
  }
  const preflightResult = verifyPackagedRemotionRuntimeResolution(
    userRemotionDir,
  );
  if (!preflightResult.ok) {
    throw new Error(
      `Remotion runtime preflight failed: ${preflightResult.error}. Resolved paths: ${formatResolvedPaths(
        preflightResult.resolvedModulePaths,
      )}`,
    );
  }
  log.info(
    '[RemotionPath] Runtime preflight passed: %s',
    formatResolvedPaths(preflightResult.resolvedModulePaths),
  );

  return userRemotionDir;
}

function getDevelopmentRemotionDir(): string {
  const cwdRemotionPath = path.resolve(process.cwd(), '..', 'dhee-core', 'remotion-infographics');
  const devPaths = [
    cwdRemotionPath,
    path.join(__dirname, '../../node_modules/dhee-core/remotion-infographics'),
    path.join(__dirname, '../../dhee-core/remotion-infographics'),
    path.join(__dirname, '../../../remotion-infographics'),
  ];

  for (const devPath of devPaths) {
    if (fs.existsSync(devPath) && fs.existsSync(path.join(devPath, 'package.json'))) {
      return path.resolve(devPath);
    }
  }

  throw new Error(
    'remotion-infographics not found in development. Ensure dhee-core is installed and remotion-infographics exists.',
  );
}

function initializeRemotionInUserData(targetDir: string): void {
  log.info('[RemotionPath] Initializing remotion-infographics in user data');
  log.info('[RemotionPath] Target:', targetDir);

  try {
    const templateDir = getBundledRemotionTemplate();
    log.info('[RemotionPath] Template source:', templateDir);

    if (fs.existsSync(targetDir)) {
      log.info('[RemotionPath] Removing old version...');
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    log.info('[RemotionPath] Copying template...');
    copyRemotionTemplate(templateDir, targetDir);

    fs.writeFileSync(path.join(targetDir, '.version'), REMOTION_VERSION, 'utf-8');
    log.info('[RemotionPath] ✓ Remotion template initialized successfully');
  } catch (error) {
    log.error('[RemotionPath] Failed to initialize:', error);
    throw new Error(
      `Failed to initialize remotion-infographics: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function getBundledRemotionTemplate(): string {
  const paths = [
    path.join(
      process.resourcesPath,
      'assets',
      'remotion-infographics-template',
    ),
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'dhee-core',
      'remotion-infographics',
    ),
    path.join(process.resourcesPath, 'remotion-infographics'),
    path.join(process.resourcesPath, 'assets', 'remotion-infographics'),
  ];

  for (const templatePath of paths) {
    if (fs.existsSync(templatePath) && fs.existsSync(path.join(templatePath, 'package.json'))) {
      return templatePath;
    }
  }

  throw new Error(
    'Remotion template not found in app bundle. Paths checked:\n' +
      paths.map((p) => `  - ${p}`).join('\n'),
  );
}

function normalizeAbsolutePath(candidate: string): string {
  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  const cwdRoot = path.parse(process.cwd()).root || path.sep;
  return path.resolve(cwdRoot, candidate);
}

function checkRequiredRemotionPackages(
  nodeModulesDir: string,
): { ok: boolean; missing: string[] } {
  const missing = REQUIRED_REMOTION_PACKAGES.filter(
    (relativePath) => !fs.existsSync(path.join(nodeModulesDir, relativePath)),
  );
  return {
    ok: missing.length === 0,
    missing,
  };
}

function isAsarNodeModulesPath(nodeModulesDir: string): boolean {
  return nodeModulesDir.includes(`${path.sep}app.asar${path.sep}`);
}

function isReadOnlyAsarPath(filePath: string): boolean {
  return (
    /[\\/]+app\.asar([\\/]|$)/.test(filePath) &&
    !/[\\/]+app\.asar\.unpacked([\\/]|$)/.test(filePath)
  );
}

function formatResolvedPaths(resolvedModulePaths: ResolvedModulePaths): string {
  return [
    `bundler=${resolvedModulePaths.bundler}`,
    `renderer=${resolvedModulePaths.renderer}`,
    `react=${resolvedModulePaths.react}`,
    `esbuild=${resolvedModulePaths.esbuild}`,
  ].join(' ');
}

export function verifyPackagedRemotionRuntimeResolution(
  remotionDir: string,
): RemotionRuntimePreflightResult {
  const resolvedModulePaths: ResolvedModulePaths = {
    bundler: '',
    renderer: '',
    react: '',
    esbuild: '',
  };
  try {
    const runtimeRequire = createRequire(path.join(remotionDir, 'package.json'));
    resolvedModulePaths.bundler = runtimeRequire.resolve('@remotion/bundler');
    resolvedModulePaths.renderer = runtimeRequire.resolve('@remotion/renderer');
    resolvedModulePaths.react = runtimeRequire.resolve('react/package.json');
    resolvedModulePaths.esbuild = runtimeRequire.resolve('esbuild/package.json');
  } catch (error) {
    return {
      ok: false,
      resolvedModulePaths,
      error: `Unable to resolve runtime Remotion dependencies: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const hasReadOnlyAsarResolution = Object.values(resolvedModulePaths).some(
    (value) => isReadOnlyAsarPath(value),
  );
  if (hasReadOnlyAsarResolution) {
    return {
      ok: false,
      resolvedModulePaths,
      error:
        'Resolved module paths still point to read-only app.asar. Expected app.asar.unpacked runtime dependencies.',
    };
  }

  return { ok: true, resolvedModulePaths };
}

function resolveRuntimeNodeModulesDir(): string | null {
  if (app.isPackaged) {
    const packagedCandidates = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'),
      path.join(process.resourcesPath, 'node_modules'),
    ];
    for (const rawCandidate of packagedCandidates) {
      const candidate = normalizeAbsolutePath(rawCandidate);
      if (!fs.existsSync(candidate)) {
        continue;
      }

      if (isAsarNodeModulesPath(candidate)) {
        continue;
      }

      const packageCheck = checkRequiredRemotionPackages(candidate);
      if (packageCheck.ok) {
        return candidate;
      }

      log.warn(
        '[RemotionPath] Runtime node_modules candidate missing required packages (%s): %s',
        candidate,
        packageCheck.missing.join(', '),
      );
    }
    return null;
  }

  const devCandidates = [
    path.resolve(process.cwd(), 'node_modules'),
    path.resolve(process.cwd(), '..', 'dhee-desktop', 'node_modules'),
  ];
  for (const candidate of devCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function ensureRuntimeNodeModulesLink(remotionDir: string): void {
  const targetNodeModules = path.join(remotionDir, 'node_modules');
  if (fs.existsSync(targetNodeModules)) {
    try {
      const stat = fs.lstatSync(targetNodeModules);
      if (stat.isSymbolicLink()) {
        const rawLinkTarget = fs.readlinkSync(targetNodeModules);
        const resolvedLinkTarget = path.isAbsolute(rawLinkTarget)
          ? rawLinkTarget
          : path.resolve(path.dirname(targetNodeModules), rawLinkTarget);
        const packageCheck = checkRequiredRemotionPackages(resolvedLinkTarget);
        if (
          !packageCheck.ok ||
          isAsarNodeModulesPath(resolvedLinkTarget)
        ) {
          log.warn(
            '[RemotionPath] Replacing stale node_modules symlink (%s). Missing: %s',
            resolvedLinkTarget,
            packageCheck.missing.join(', '),
          );
          fs.rmSync(targetNodeModules, { recursive: true, force: true });
        } else {
          return;
        }
      } else {
        const packageCheck = checkRequiredRemotionPackages(targetNodeModules);
        if (packageCheck.ok) {
          return;
        }
        log.warn(
          '[RemotionPath] Replacing stale node_modules directory. Missing: %s',
          packageCheck.missing.join(', '),
        );
        fs.rmSync(targetNodeModules, { recursive: true, force: true });
      }
    } catch (error) {
      log.warn(
        '[RemotionPath] Failed validating existing node_modules. Recreating: %s',
        error instanceof Error ? error.message : String(error),
      );
      fs.rmSync(targetNodeModules, { recursive: true, force: true });
    }
  }

  const runtimeNodeModules = resolveRuntimeNodeModulesDir();
  if (!runtimeNodeModules) {
    log.error(
      '[RemotionPath] Could not find runtime node_modules with remotion dependencies in packaged app',
    );
    return;
  }

  try {
    fs.symlinkSync(
      runtimeNodeModules,
      targetNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    log.info(
      `[RemotionPath] Linked remotion node_modules -> ${runtimeNodeModules}`,
    );
  } catch (error) {
    log.warn('[RemotionPath] Failed to create node_modules link:', error);
  }
}

function copyRemotionTemplate(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        continue;
      }
      if (entry.name === 'build') {
        fs.mkdirSync(destPath, { recursive: true });
        continue;
      }
      copyRemotionTemplate(srcPath, destPath);
      continue;
    }

    fs.copyFileSync(srcPath, destPath);
  }

  fs.mkdirSync(path.join(dest, 'src', 'components'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'build'), { recursive: true });
}
