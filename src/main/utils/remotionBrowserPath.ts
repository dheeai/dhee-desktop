import fs from 'fs';
import path from 'path';

interface BundledBrowserManifest {
  chromeMode?: string;
  platform?: string;
  executableRelativePath?: string;
}

function getPlatformDirName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  switch (platform) {
    case 'darwin':
      return arch === 'arm64' ? 'mac-arm64' : null;
    case 'linux':
      return arch === 'arm64' ? 'linux-arm64' : 'linux64';
    case 'win32':
      return 'win64';
    default:
      return null;
  }
}

export function getBundledRemotionBrowserExecutable(options?: {
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  existsSync?: (filePath: string) => boolean;
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string;
}): string | null {
  const {
    resourcesPath = process.resourcesPath,
    platform = process.platform,
    arch = process.arch,
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
  } = options ?? {};

  if (!resourcesPath) {
    return null;
  }

  const platformDir = getPlatformDirName(platform, arch);
  if (!platformDir) {
    return null;
  }

  const bundledPlatformDir = path.join(
    resourcesPath,
    'assets',
    'remotion-browser',
    'chrome-headless-shell',
    platformDir,
  );
  const manifestPath = path.join(bundledPlatformDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    ) as BundledBrowserManifest;
    const relativeExecutablePath = manifest.executableRelativePath?.trim();
    if (!relativeExecutablePath) {
      return null;
    }

    const executablePath = path.join(
      bundledPlatformDir,
      relativeExecutablePath,
    );
    return existsSync(executablePath) ? executablePath : null;
  } catch {
    return null;
  }
}
