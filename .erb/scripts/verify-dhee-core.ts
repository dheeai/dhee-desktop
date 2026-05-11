/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import webpackPaths from '../configs/webpack.paths';

interface VersionMetadata {
  packageVersion?: string;
  gitBranch?: string;
  gitCommit?: string;
  commitDate?: string;
}

function resolvedheeCorePath(): string {
  const configured = process.env['dhee_CORE_PATH'] ?? process.env['dhee_INK_PATH'];
  if (configured && configured.trim()) {
    return path.resolve(configured);
  }

  return path.resolve(webpackPaths.rootPath, '../dhee-core');
}

function runGit(repoPath: string, command: string): string | undefined {
  try {
    const value = execSync(command, {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();

    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function verifydheeCore(): void {
  const dheeCorePath = resolvedheeCorePath();
  const packageJsonPath = path.join(dheeCorePath, 'package.json');
  const serverCliPath = path.join(dheeCorePath, 'dist', 'server', 'cli.cjs');
  const releaseAppPath = webpackPaths.appPath;
  const metadataPath = path.join(releaseAppPath, '.dhee-core-version.json');

  if (!fs.existsSync(dheeCorePath)) {
    throw new Error(`dhee-core repo not found at ${dheeCorePath}`);
  }

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`dhee-core package.json not found at ${packageJsonPath}`);
  }

  if (!fs.existsSync(serverCliPath)) {
    throw new Error(
      `dhee-core build output missing at ${serverCliPath}. Run a build in ../dhee-core first.`,
    );
  }

  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf-8'),
  ) as { version?: string };

  const metadata: VersionMetadata = {
    packageVersion: packageJson.version,
    gitBranch: runGit(dheeCorePath, 'git rev-parse --abbrev-ref HEAD'),
    gitCommit: runGit(dheeCorePath, 'git rev-parse HEAD'),
    commitDate: runGit(dheeCorePath, 'git log -1 --format=%cI'),
  };

  fs.mkdirSync(releaseAppPath, { recursive: true });
  fs.writeFileSync(`${metadataPath}`, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`✓ Verified dhee-core at ${dheeCorePath}`);
  console.log(`✓ Wrote bundled version metadata to ${metadataPath}`);
}

try {
  verifydheeCore();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Failed to verify dhee-core',
  );
  process.exit(1);
}

