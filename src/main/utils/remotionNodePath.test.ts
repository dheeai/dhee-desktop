import path from 'path';
import { describe, expect, it } from '@jest/globals';
import {
  buildPackagedNodePath,
  normalizeNodePathEntry,
} from './remotionNodePath';

describe('remotionNodePath', () => {
  it('normalizes app.asar path segments to app.asar.unpacked', () => {
    const normalized = normalizeNodePathEntry(
      '/Applications/dhee.app/Contents/Resources/app.asar/node_modules',
      '/',
    );
    expect(normalized).toContain(
      '/Applications/dhee.app/Contents/Resources/app.asar.unpacked/node_modules',
    );
  });

  it('builds deterministic NODE_PATH, preferring unpacked and keeping packaged fallback', () => {
    const resourcesPath = '/Applications/dhee.app/Contents/Resources';
    const rawNodePath = [
      '/Applications/dhee.app/Contents/Resources/app.asar/node_modules',
      '/tmp/custom-node-modules',
    ].join(path.delimiter);

    const built = buildPackagedNodePath(rawNodePath, resourcesPath, '/');
    expect(built).toContain('app.asar.unpacked/node_modules');
    expect(built).toContain('/tmp/custom-node-modules');
    expect(built).toContain('/app.asar/node_modules');
  });
});
