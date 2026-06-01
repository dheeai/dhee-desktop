import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { getBundledRemotionBrowserExecutable } from './remotionBrowserPath';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

describe('remotionBrowserPath', () => {
  it('returns bundled browser executable when manifest and executable exist', () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'remotion-browser-path-'),
    );
    const resourcesPath = path.join(tempRoot, 'Resources');
    const platformDir = path.join(
      resourcesPath,
      'assets',
      'remotion-browser',
      'chrome-headless-shell',
      'mac-arm64',
    );
    const executableRelativePath = path.join(
      'chrome-headless-shell-mac-arm64',
      'chrome-headless-shell',
    );
    const executablePath = path.join(platformDir, executableRelativePath);

    writeFile(
      path.join(platformDir, 'manifest.json'),
      JSON.stringify({ executableRelativePath }),
    );
    writeFile(executablePath, 'binary');

    const result = getBundledRemotionBrowserExecutable({
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(result).toBe(executablePath);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns null when bundled browser manifest is missing', () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'remotion-browser-path-'),
    );
    const resourcesPath = path.join(tempRoot, 'Resources');

    const result = getBundledRemotionBrowserExecutable({
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(result).toBeNull();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns null for unsupported macOS x64 architecture', () => {
    const result = getBundledRemotionBrowserExecutable({
      resourcesPath: '/tmp/dhee-resources',
      platform: 'darwin',
      arch: 'x64',
    });

    expect(result).toBeNull();
  });
});
