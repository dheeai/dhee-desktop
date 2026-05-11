import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { verifyPackagedRemotionRuntimeResolution } from './remotionPath';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function createFakeRemotionRuntime(baseDir: string): string {
  const remotionDir = path.join(baseDir, 'remotion-infographics');
  writeFile(path.join(remotionDir, 'package.json'), JSON.stringify({ name: 'runtime' }));
  writeFile(
    path.join(remotionDir, 'node_modules', '@remotion', 'bundler', 'index.js'),
    'module.exports = {};',
  );
  writeFile(
    path.join(remotionDir, 'node_modules', '@remotion', 'renderer', 'index.js'),
    'module.exports = {};',
  );
  writeFile(
    path.join(remotionDir, 'node_modules', 'react', 'package.json'),
    JSON.stringify({ name: 'react', version: '0.0.0' }),
  );
  writeFile(
    path.join(remotionDir, 'node_modules', 'esbuild', 'package.json'),
    JSON.stringify({ name: 'esbuild', version: '0.0.0' }),
  );
  return remotionDir;
}

describe('remotionPath runtime preflight', () => {
  it('passes when runtime resolves outside read-only app.asar', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-preflight-'));
    const remotionDir = createFakeRemotionRuntime(tempRoot);

    const result = verifyPackagedRemotionRuntimeResolution(remotionDir);
    expect(result.ok).toBe(true);
    expect(result.resolvedModulePaths.bundler).toContain(
      '/node_modules/@remotion/bundler/',
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('fails when resolved runtime path points to read-only app.asar', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-preflight-'));
    const asarRoot = path.join(
      tempRoot,
      'Applications',
      'dhee.app',
      'Contents',
      'Resources',
      'app.asar',
    );
    const remotionDir = createFakeRemotionRuntime(asarRoot);

    const result = verifyPackagedRemotionRuntimeResolution(remotionDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('read-only app.asar');
    expect(result.resolvedModulePaths.bundler).toContain('/app.asar/');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
