import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { rimrafSync } from 'rimraf';
import webpackPaths from '../configs/webpack.paths';

interface PackResult {
  filename: string;
}

function getNpmEnv(): NodeJS.ProcessEnv {
  const cachePath = path.join(webpackPaths.rootPath, '.npm-cache');
  fs.mkdirSync(cachePath, { recursive: true });

  return {
    ...process.env,
    npm_config_cache: cachePath,
  };
}

function runNpm(
  args: string[],
  options: {
    cwd: string;
    stdio: 'inherit' | ['ignore', 'pipe', 'inherit'];
  },
): Buffer {
  const npmExecPath = process.env['npm_execpath'];
  if (npmExecPath && npmExecPath.trim().length > 0) {
    return execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd: options.cwd,
      env: getNpmEnv(),
      stdio: options.stdio,
    });
  }

  return execFileSync('npm', args, {
    cwd: options.cwd,
    env: getNpmEnv(),
    stdio: options.stdio,
  });
}

function resolveKshanaInkPath(): string {
  const configured = process.env['KSHANA_INK_PATH'];
  if (configured && configured.trim()) {
    return path.resolve(configured);
  }

  return path.resolve(webpackPaths.rootPath, '../kshana-core');
}

function syncReleaseAppPackage(mainPackagePath: string, tarballRelativePath: string) {
  const mainPackage = JSON.parse(
    fs.readFileSync(mainPackagePath, 'utf-8'),
  ) as {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: Record<string, string>;
  };

  const appPackage = {
    name: mainPackage.name || 'kshana-desktop',
    version: mainPackage.version || '1.0.0',
    description: mainPackage.description || '',
    main: './dist/main/main.js',
    dependencies: {
      ...(mainPackage.dependencies || {}),
      'kshana-core': `file:${tarballRelativePath}`,
    },
  };

  fs.mkdirSync(webpackPaths.appPath, { recursive: true });
  fs.writeFileSync(
    webpackPaths.appPackagePath,
    `${JSON.stringify(appPackage, null, 2)}\n`,
  );
}

function packKshanaInk(kshanaInkPath: string): string {
  const vendorPath = path.join(webpackPaths.appPath, 'vendor');
  fs.rmSync(vendorPath, { recursive: true, force: true });
  fs.mkdirSync(vendorPath, { recursive: true });

  const rawOutput = runNpm(
    ['pack', '--json', '--pack-destination', vendorPath],
    {
      cwd: kshanaInkPath,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
    .toString()
    .trim();

  const [result] = JSON.parse(rawOutput) as PackResult[];
  if (!result?.filename) {
    throw new Error('npm pack did not return a tarball filename for kshana-core');
  }

  return path.join(vendorPath, result.filename);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeDirectoryForFreshInstall(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;

  const errors: string[] = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      rimrafSync(dirPath);
      if (!fs.existsSync(dirPath)) return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    sleepSync(250 * attempt);
  }

  const stalePath = `${dirPath}.deleting-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(dirPath, stalePath);
    try {
      rimrafSync(stalePath);
    } catch (error) {
      console.warn(
        `Warning: moved stale generated dependencies to ${stalePath}, but could not fully remove them: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  throw new Error(
    `Could not remove generated app dependencies at ${dirPath}. Quit Kshana, IDEs, and terminals using release/app, then retry.${
      errors.length ? ` Last cleanup errors: ${errors.slice(-3).join(' | ')}` : ''
    }`,
  );
}

function installAppDeps(): void {
  const kshanaInkPath = resolveKshanaInkPath();
  const mainPackagePath = path.join(webpackPaths.rootPath, 'package.json');

  if (!fs.existsSync(mainPackagePath)) {
    throw new Error(`Main package.json not found at ${mainPackagePath}`);
  }

  if (!fs.existsSync(kshanaInkPath)) {
    throw new Error(`kshana-core repo not found at ${kshanaInkPath}`);
  }

  const tarballPath = packKshanaInk(kshanaInkPath);
  const tarballRelativePath = path.relative(webpackPaths.appPath, tarballPath);
  syncReleaseAppPackage(mainPackagePath, tarballRelativePath);

  removeDirectoryForFreshInstall(webpackPaths.appNodeModulesPath);

  const lockfilePath = path.join(webpackPaths.appPath, 'package-lock.json');
  fs.rmSync(lockfilePath, { force: true });

  // Fresh lockfile: `npm pack` produces a new tarball bytes each run; restoring an old
  // lockfile reintroduces stale `integrity` for `file:vendor/*.tgz` and breaks install.
  runNpm(['install', '--omit=dev'], {
    cwd: webpackPaths.appPath,
    stdio: 'inherit',
  });

  const installedServerCliPath = path.join(
    webpackPaths.appNodeModulesPath,
    'kshana-core',
    'dist',
    'server',
    'cli.cjs',
  );

  if (!fs.existsSync(installedServerCliPath)) {
    throw new Error(
      `Installed kshana-core server entry not found at ${installedServerCliPath}`,
    );
  }

  console.log(`✓ Installed app dependencies with bundled kshana-core`);
  console.log(`✓ Verified bundled server entry at ${installedServerCliPath}`);
}

try {
  installAppDeps();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Failed to install app dependencies',
  );
  process.exit(1);
}
