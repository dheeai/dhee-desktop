import { describe, expect, it, afterEach } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bootstrapPackagedEsbuildBinaryPath } from './esbuildBinaryPath';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempResourcesDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhee-esbuild-'));
  tempDirs.push(tempDir);
  return tempDir;
}

describe('esbuildBinaryPath', () => {
  it('sets ESBUILD_BINARY_PATH in packaged mode when binary exists', () => {
    const resourcesPath = createTempResourcesDir();
    const binaryPath = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@esbuild',
      'darwin-arm64',
      'bin',
      'esbuild',
    );
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\necho ok\n', 'utf-8');

    const env: NodeJS.ProcessEnv = {};
    const result = bootstrapPackagedEsbuildBinaryPath({
      isPackaged: true,
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
      env,
    });

    expect(result.applied).toBe(true);
    expect(result.reason).toBe('resolved');
    expect(result.binaryPath).toBe(binaryPath);
    expect(env['ESBUILD_BINARY_PATH']).toBe(binaryPath);
  });

  it('leaves env untouched in packaged mode when binary is missing', () => {
    const resourcesPath = createTempResourcesDir();
    const env: NodeJS.ProcessEnv = {};
    const warningMessages: string[] = [];
    const result = bootstrapPackagedEsbuildBinaryPath({
      isPackaged: true,
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
      env,
      logger: {
        warn: (message: string, ...args: unknown[]) => {
          warningMessages.push(
            [message, ...args.map((value) => String(value))].join(' '),
          );
        },
      },
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('binary_not_found');
    expect(result.attemptedPaths.length).toBeGreaterThan(0);
    expect(env['ESBUILD_BINARY_PATH']).toBeUndefined();
    expect(warningMessages.length).toBe(1);
    expect(warningMessages[0]).toContain(
      'Could not resolve packaged esbuild binary',
    );
    expect(warningMessages[0]).toContain('@esbuild');
  });

  it('does nothing in development mode', () => {
    const resourcesPath = createTempResourcesDir();
    const env: NodeJS.ProcessEnv = {};
    const result = bootstrapPackagedEsbuildBinaryPath({
      isPackaged: false,
      resourcesPath,
      env,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not_packaged');
    expect(env['ESBUILD_BINARY_PATH']).toBeUndefined();
  });
});
