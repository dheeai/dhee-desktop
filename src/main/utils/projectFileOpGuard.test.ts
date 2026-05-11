import { describe, expect, it } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  assertCanonicalProjectContainment,
  normalizeIncomingPath,
  ProjectFileOpGuardError,
  resolveAndValidateProjectPath,
  resolveValidationRoot,
} from './projectFileOpGuard';

describe('projectFileOpGuard', () => {
  it('normalizes malformed leading backslash windows-style path on posix', () => {
    const normalized = normalizeIncomingPath(
      '\\Users\\indhicdev\\Documents\\Demo-3\\.dhee\\context\\index.json',
      'darwin',
      '/Users/indhicdev/dhee/dhee-desktop',
    );
    expect(normalized).toBe(
      '/Users/indhicdev/Documents/Demo-3/.dhee/context/index.json',
    );
  });

  it('rejects absolute path when allowAbsolute is disabled', () => {
    expect(() =>
      normalizeIncomingPath('/Users/dev/project/.dhee/context/index.json', 'darwin', process.cwd(), {
        allowAbsolute: false,
      }),
    ).toThrow(ProjectFileOpGuardError);
  });

  it('rejects traversal outside project root', () => {
    expect(() =>
      resolveAndValidateProjectPath('../outside.txt', '/Users/dev/project'),
    ).toThrow(ProjectFileOpGuardError);
  });

  it('rejects absolute path outside project root', () => {
    expect(() =>
      resolveAndValidateProjectPath('/tmp/outside.txt', '/Users/dev/project'),
    ).toThrow(ProjectFileOpGuardError);
  });

  it('accepts valid in-project path', () => {
    const resolved = resolveAndValidateProjectPath(
      '.dhee/context/index.json',
      '/Users/dev/project',
    );
    expect(resolved).toBe('/Users/dev/project/.dhee/context/index.json');
  });

  it('accepts remote-emitted relative project paths', () => {
    const resolved = resolveAndValidateProjectPath(
      'plans/plot.md',
      '/Users/dev/project',
    );
    expect(resolved).toBe('/Users/dev/project/plans/plot.md');
  });

  it('prefers renderer project root over stale active project root', () => {
    const root = resolveValidationRoot(
      '/Users/dev/old-project',
      '/Users/dev/new-project',
      {
        source: 'renderer',
        projectRoot: '/Users/dev/new-project',
      },
    );

    expect(root).toBe('/Users/dev/new-project');
  });

  it('does not use fallback paths for agent websocket operations', () => {
    const root = resolveValidationRoot(null, '/Users/dev/project', {
      source: 'agent_ws',
    });

    expect(root).toBeNull();
  });

  it('supports remote cross-os flow (windows-style emitted path -> posix project path)', () => {
    const normalized = normalizeIncomingPath(
      '\\Users\\indhicdev\\Documents\\Demo-3\\.dhee\\context\\index.json',
      'darwin',
      '/Users/indhicdev/dhee/dhee-desktop',
    );
    const resolved = resolveAndValidateProjectPath(
      normalized,
      '/Users/indhicdev/Documents/Demo-3',
    );
    expect(resolved).toBe(
      '/Users/indhicdev/Documents/Demo-3/.dhee/context/index.json',
    );
  });

  it('rejects symlink escape outside canonical project root', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-guard-root-'));
    const tmpOutside = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dhee-guard-outside-'),
    );
    const symlinkPath = path.join(tmpRoot, 'linked');

    await fs.symlink(tmpOutside, symlinkPath);
    const escapedTarget = path.join(symlinkPath, 'escape.txt');

    await expect(
      assertCanonicalProjectContainment(escapedTarget, tmpRoot),
    ).rejects.toMatchObject({
      name: 'ProjectFileOpGuardError',
      code: 'SYMLINK_ESCAPE_DETECTED',
    });
  });
});
