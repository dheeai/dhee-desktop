const fs = require('fs');
const path = require('path');

const rootPath = path.resolve(__dirname, '../..');
const chromeMode = 'headless-shell';

function getPlatformDirName() {
  switch (process.platform) {
    case 'darwin':
      if (process.arch !== 'arm64') {
        throw new Error(`Unsupported macOS architecture: ${process.arch}`);
      }
      return 'mac-arm64';
    case 'linux':
      return process.arch === 'arm64' ? 'linux-arm64' : 'linux64';
    case 'win32':
      return 'win64';
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getSourcePlatformDir(platformDir) {
  return path.join(
    rootPath,
    'node_modules',
    '.remotion',
    'chrome-headless-shell',
    platformDir,
  );
}

function getDestinationPlatformDir(platformDir) {
  return path.join(
    rootPath,
    'assets',
    'remotion-browser',
    'chrome-headless-shell',
    platformDir,
  );
}

async function main() {
  const renderer = require('@remotion/renderer');
  if (!renderer.ensureBrowser) {
    throw new Error(
      'Failed to load @remotion/renderer.ensureBrowser required for browser preparation.',
    );
  }

  const browserStatus = await renderer.ensureBrowser({
    logLevel: 'info',
    chromeMode,
  });

  if (browserStatus.type === 'no-browser') {
    throw new Error(
      'Remotion ensureBrowser() completed without a browser path.',
    );
  }

  const platformDir = getPlatformDirName();
  const sourcePlatformDir = getSourcePlatformDir(platformDir);
  const destinationPlatformDir = getDestinationPlatformDir(platformDir);

  await fs.promises.access(sourcePlatformDir);
  await fs.promises.rm(destinationPlatformDir, {
    recursive: true,
    force: true,
  });
  await fs.promises.mkdir(path.dirname(destinationPlatformDir), {
    recursive: true,
  });
  await fs.promises.cp(sourcePlatformDir, destinationPlatformDir, {
    recursive: true,
  });

  const executableRelativePath = path.relative(
    sourcePlatformDir,
    browserStatus.path,
  );
  const destinationExecutablePath = path.join(
    destinationPlatformDir,
    executableRelativePath,
  );
  if (process.platform !== 'win32') {
    await fs.promises
      .chmod(destinationExecutablePath, 0o755)
      .catch(() => undefined);
  }

  const manifestPath = path.join(destinationPlatformDir, 'manifest.json');
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify(
      {
        chromeMode,
        platform: platformDir,
        executableRelativePath,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(
    `[Remotion browser] Prepared ${destinationExecutablePath} from ${sourcePlatformDir}`,
  );
}

main().catch((error) => {
  console.error(
    `[Remotion browser] Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
