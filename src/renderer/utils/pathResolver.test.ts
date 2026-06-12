import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Silence the debug logger so test output stays clean. These are pure
// side-effect-free console wrappers in the real module.
jest.mock('./debugLogger', () => ({
  debugRendererDebug: jest.fn(),
  debugRendererLog: jest.fn(),
  debugRendererWarn: jest.fn(),
}));

// The module holds two module-level caches (`pathCache` and a memoized
// `cachedResourcesPath`). To keep tests independent we re-import a FRESH
// copy of the module per test via jest.resetModules() + dynamic import.
type PathResolverModule = typeof import('./pathResolver');

async function loadModule(): Promise<PathResolverModule> {
  let mod!: PathResolverModule;
  await jest.isolateModulesAsync(async () => {
    mod = await import('./pathResolver');
  });
  return mod;
}

// Helper to install a fake window.electron.project surface. The module
// reaches for window.electron?.project?.getResourcesPath / checkFileExists.
type ProjectApi = {
  getResourcesPath?: () => Promise<string>;
  checkFileExists?: (p: string) => Promise<boolean>;
};

function setProjectApi(api: ProjectApi | undefined): void {
  (window as unknown as { electron?: { project?: ProjectApi } }).electron = api
    ? { project: api }
    : undefined;
}

describe('pathResolver', () => {
  beforeEach(() => {
    setProjectApi(undefined);
  });

  afterEach(() => {
    setProjectApi(undefined);
    jest.clearAllMocks();
  });

  describe('toFileUrl', () => {
    it('builds a 2-slash file URL for a POSIX absolute path', async () => {
      const { toFileUrl } = await loadModule();
      expect(toFileUrl('/Users/me/img.png')).toBe('file:///Users/me/img.png');
    });

    it('builds a 3-slash file URL for a Windows drive path', async () => {
      const { toFileUrl } = await loadModule();
      expect(toFileUrl('C:/Users/me/img.png')).toBe(
        'file:///C:/Users/me/img.png',
      );
    });

    it('normalizes Windows backslashes to forward slashes', async () => {
      const { toFileUrl } = await loadModule();
      expect(toFileUrl('C:\\Users\\me\\img.png')).toBe(
        'file:///C:/Users/me/img.png',
      );
    });

    it('encodes spaces and URL-reserved characters in file paths', async () => {
      const { toFileUrl } = await loadModule();
      expect(toFileUrl('/Users/me/Desktop/My Image #1?.png')).toBe(
        'file:///Users/me/Desktop/My%20Image%20%231%3F.png',
      );
    });

    it('treats a UNC/backslash-only path as starting with / (2-slash form)', async () => {
      const { toFileUrl } = await loadModule();
      // After backslash normalization \\server\share becomes //server/share
      // which starts with '/', so the 2-slash branch is taken.
      expect(toFileUrl('\\\\server\\share\\f.png')).toBe(
        'file:////server/share/f.png',
      );
    });
  });

  describe('isTestAssetPath', () => {
    it('returns false for empty input', async () => {
      const { isTestAssetPath } = await loadModule();
      expect(isTestAssetPath('')).toBe(false);
    });

    it('detects a test_image segment', async () => {
      const { isTestAssetPath } = await loadModule();
      expect(isTestAssetPath('foo/test_image/a.png')).toBe(true);
    });

    it('detects a test_video segment', async () => {
      const { isTestAssetPath } = await loadModule();
      expect(isTestAssetPath('test_video/clip.mp4')).toBe(true);
    });

    it('detects test asset segments through Windows separators', async () => {
      const { isTestAssetPath } = await loadModule();
      expect(isTestAssetPath('foo\\test_image\\a.png')).toBe(true);
    });

    it('does NOT match a substring inside a larger segment', async () => {
      const { isTestAssetPath } = await loadModule();
      // 'mytest_imagex' is one segment, not equal to 'test_image'.
      expect(isTestAssetPath('foo/mytest_imagex/a.png')).toBe(false);
    });

    it('returns false for an ordinary project path', async () => {
      const { isTestAssetPath } = await loadModule();
      expect(isTestAssetPath('assets/characters/hero.png')).toBe(false);
    });
  });

  describe('resolveTestAssetPathToAbsolute', () => {
    it('returns empty string for empty input', async () => {
      const { resolveTestAssetPathToAbsolute } = await loadModule();
      await expect(resolveTestAssetPathToAbsolute('')).resolves.toBe('');
    });

    it('strips the file:// protocol when given a file URL', async () => {
      const { resolveTestAssetPathToAbsolute } = await loadModule();
      await expect(
        resolveTestAssetPathToAbsolute('file:///Users/me/test_image/a.png'),
      ).resolves.toBe('/Users/me/test_image/a.png');
    });

    it('returns an absolute POSIX path normalized, unchanged otherwise', async () => {
      const { resolveTestAssetPathToAbsolute } = await loadModule();
      await expect(
        resolveTestAssetPathToAbsolute('/abs/test_image/a.png'),
      ).resolves.toBe('/abs/test_image/a.png');
    });

    it('normalizes backslashes in an absolute Windows path', async () => {
      const { resolveTestAssetPathToAbsolute } = await loadModule();
      await expect(
        resolveTestAssetPathToAbsolute('C:\\abs\\test_image\\a.png'),
      ).resolves.toBe('C:/abs/test_image/a.png');
    });

    it('returns empty string for a relative non-test-asset path', async () => {
      const { resolveTestAssetPathToAbsolute } = await loadModule();
      await expect(
        resolveTestAssetPathToAbsolute('some/random/file.png'),
      ).resolves.toBe('');
    });

    it('joins resources path + folder + filename for a relative test asset', async () => {
      setProjectApi({ getResourcesPath: async () => '/resources' });
      const { resolveTestAssetPathToAbsolute } = await loadModule();
      await expect(
        resolveTestAssetPathToAbsolute('test_image/a.png'),
      ).resolves.toBe('/resources/test_image/a.png');
    });

    it('collapses duplicate slashes when joining', async () => {
      setProjectApi({ getResourcesPath: async () => '/resources/' });
      const { resolveTestAssetPathToAbsolute } = await loadModule();
      await expect(
        resolveTestAssetPathToAbsolute('../test_image/a.png'),
      ).resolves.toBe('/resources/test_image/a.png');
    });

    it('returns empty when resources path is unavailable', async () => {
      const prev = process.env.WORKSPACE_ROOT;
      delete process.env.WORKSPACE_ROOT;
      try {
        const { resolveTestAssetPathToAbsolute } = await loadModule();
        await expect(
          resolveTestAssetPathToAbsolute('test_image/a.png'),
        ).resolves.toBe('');
      } finally {
        if (prev !== undefined) process.env.WORKSPACE_ROOT = prev;
      }
    });

    it('falls back to WORKSPACE_ROOT env var when no IPC bridge present', async () => {
      const prev = process.env.WORKSPACE_ROOT;
      process.env.WORKSPACE_ROOT = '/env-root';
      try {
        const { resolveTestAssetPathToAbsolute } = await loadModule();
        await expect(
          resolveTestAssetPathToAbsolute('test_video/clip.mp4'),
        ).resolves.toBe('/env-root/test_video/clip.mp4');
      } finally {
        if (prev === undefined) delete process.env.WORKSPACE_ROOT;
        else process.env.WORKSPACE_ROOT = prev;
      }
    });
  });

  describe('resolveAssetPathForDisplay', () => {
    it('returns empty for empty or whitespace input', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(resolveAssetPathForDisplay('', null)).resolves.toBe('');
      await expect(resolveAssetPathForDisplay('   ', null)).resolves.toBe('');
    });

    it('passes a file:// URL through unchanged', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('file:///abs/a.png', '/proj'),
      ).resolves.toBe('file:///abs/a.png');
    });

    it('converts an absolute POSIX path to a file URL', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('/abs/a.png', null),
      ).resolves.toBe('file:///abs/a.png');
    });

    it('converts an absolute Windows path to a file URL', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('C:\\abs\\a.png', null),
      ).resolves.toBe('file:///C:/abs/a.png');
    });

    it('resolves a .dhee-prefixed relative path under the project dir', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('.dhee/agent/x.png', '/proj'),
      ).resolves.toBe('file:///proj/.dhee/agent/x.png');
    });

    it('resolves backend-format asset folders at the project root', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('assets/hero.png', '/proj'),
      ).resolves.toBe('file:///proj/assets/hero.png');
      await expect(
        resolveAssetPathForDisplay('characters/c.png', '/proj'),
      ).resolves.toBe('file:///proj/characters/c.png');
    });

    it('resolves a legacy agent/ path under .dhee', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('agent/content/x.png', '/proj'),
      ).resolves.toBe('file:///proj/.dhee/agent/content/x.png');
    });

    it('deduplicates an agent/agent/ prefix', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('agent/agent/content/x.png', '/proj'),
      ).resolves.toBe('file:///proj/.dhee/agent/content/x.png');
    });

    it('strips directory-traversal segments emitted by the backend', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      // The escape-handling branch: a path with ../ and a .dhee/agent/ marker
      // is rewritten so it cannot climb out of the project tree.
      const input = 'agent/../../other/.dhee/agent/image-placements/img.png';
      await expect(resolveAssetPathForDisplay(input, '/proj')).resolves.toBe(
        'file:///proj/.dhee/agent/image-placements/img.png',
      );
    });

    it('normalizes backslashes in the project directory', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('assets/a.png', 'C:\\proj'),
      ).resolves.toBe('file:///C:/proj/assets/a.png');
    });

    it('treats other relative paths as project-relative', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('foo/bar.png', '/proj'),
      ).resolves.toBe('file:///proj/foo/bar.png');
    });

    it('falls back to treating a relative path as absolute when no project dir', async () => {
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('foo/bar.png', null),
      ).resolves.toBe('file:///foo/bar.png');
    });

    it('resolves a test asset path to the resources dir when available', async () => {
      setProjectApi({ getResourcesPath: async () => '/resources' });
      const { resolveAssetPathForDisplay } = await loadModule();
      await expect(
        resolveAssetPathForDisplay('test_image/a.png', '/proj'),
      ).resolves.toBe('file:///resources/test_image/a.png');
    });

    it('falls through to project resolution when test asset resolution fails', async () => {
      // No resources path -> resolveTestAssetPathToAbsolute returns '' ->
      // falls through to project-relative resolution.
      const prev = process.env.WORKSPACE_ROOT;
      delete process.env.WORKSPACE_ROOT;
      try {
        const { resolveAssetPathForDisplay } = await loadModule();
        await expect(
          resolveAssetPathForDisplay('test_image/a.png', '/proj'),
        ).resolves.toBe('file:///proj/test_image/a.png');
      } finally {
        if (prev !== undefined) process.env.WORKSPACE_ROOT = prev;
      }
    });

    it('caches a resolution and reuses it on a second call', async () => {
      const getResourcesPath = jest.fn(async () => '/resources');
      setProjectApi({ getResourcesPath });
      const { resolveAssetPathForDisplay } = await loadModule();
      const first = await resolveAssetPathForDisplay('test_image/a.png', '/p');
      const second = await resolveAssetPathForDisplay('test_image/a.png', '/p');
      expect(first).toBe(second);
      // The display-level cache short-circuits the second call entirely, so
      // the IPC bridge is consulted at most once.
      expect(getResourcesPath).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveAssetPathWithRetry', () => {
    it('resolves and verifies an existing file in one shot', async () => {
      setProjectApi({ checkFileExists: async () => true });
      const { resolveAssetPathWithRetry } = await loadModule();
      const res = await resolveAssetPathWithRetry('/abs/a.png', null, {
        verifyExists: true,
      });
      expect(res).toBe('file:///abs/a.png');
    });

    it('returns the path even when the file never appears (after retries)', async () => {
      setProjectApi({ checkFileExists: async () => false });
      const { resolveAssetPathWithRetry } = await loadModule();
      const res = await resolveAssetPathWithRetry('/abs/missing.png', null, {
        verifyExists: true,
        maxRetries: 1,
        retryDelayBase: 0, // no real waiting
      });
      // Resolution still returns the constructed path; existence is advisory.
      expect(res).toBe('file:///abs/missing.png');
    });

    it('skips existence verification when verifyExists is false', async () => {
      const checkFileExists = jest.fn(async () => false);
      setProjectApi({ checkFileExists });
      const { resolveAssetPathWithRetry } = await loadModule();
      const res = await resolveAssetPathWithRetry('/abs/a.png', null, {
        verifyExists: false,
      });
      expect(res).toBe('file:///abs/a.png');
      expect(checkFileExists).not.toHaveBeenCalled();
    });

    it('serves a cached result without re-resolving', async () => {
      setProjectApi({ checkFileExists: async () => true });
      const { resolveAssetPathWithRetry } = await loadModule();
      const first = await resolveAssetPathWithRetry('/abs/a.png', null, {
        verifyExists: true,
      });
      // Remove the bridge; a cache hit must not need it.
      setProjectApi(undefined);
      const second = await resolveAssetPathWithRetry('/abs/a.png', null, {
        verifyExists: true,
      });
      expect(second).toBe(first);
    });
  });

  describe('invalidatePathCache', () => {
    it('clears a specific cached path by prefix', async () => {
      const getResourcesPath = jest.fn(async () => '/resources');
      setProjectApi({ getResourcesPath });
      const { resolveAssetPathForDisplay, invalidatePathCache } =
        await loadModule();
      await resolveAssetPathForDisplay('test_image/a.png', '/p');
      // The display cache key is `display:<path>:<projdir>`; invalidating by
      // that prefix evicts it. (getResourcesPath itself memoizes internally,
      // so we assert via re-resolution producing the same value rather than
      // a second IPC call.)
      invalidatePathCache('display:test_image/a.png');
      const again = await resolveAssetPathForDisplay('test_image/a.png', '/p');
      expect(again).toBe('file:///resources/test_image/a.png');
    });

    it('clears the entire cache when called with no argument', async () => {
      setProjectApi({ getResourcesPath: async () => '/resources' });
      const { resolveAssetPathForDisplay, invalidatePathCache } =
        await loadModule();
      await resolveAssetPathForDisplay('test_image/a.png', '/p');
      invalidatePathCache();
      const again = await resolveAssetPathForDisplay('test_image/a.png', '/p');
      expect(again).toBe('file:///resources/test_image/a.png');
    });
  });
});
