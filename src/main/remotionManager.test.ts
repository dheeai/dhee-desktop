import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/dhee-app',
  },
}));

jest.mock('electron-log', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('./utils/remotionPath', () => ({
  getRemotionInfographicsDir: jest.fn(() => '/tmp/remotion-infographics'),
}));

jest.mock('./utils/esbuildBinaryPath', () => ({
  bootstrapPackagedEsbuildBinaryPath: jest.fn(() => ({
    applied: false,
    reason: 'not_packaged',
    attemptedPaths: [],
  })),
}));

jest.mock('./utils/remotionBrowserPath', () => ({
  getBundledRemotionBrowserExecutable: jest.fn(() => null),
}));

import { __private__ } from './remotionManager';
import { getBundledRemotionBrowserExecutable } from './utils/remotionBrowserPath';

describe('remotionManager workspace template copy', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'remotion-manager-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('copies package metadata and public assets into the server render workspace', async () => {
    const remotionDir = path.join(tempRoot, 'runtime');
    const workspaceDir = path.join(tempRoot, 'workspace');

    await fs.mkdir(path.join(remotionDir, 'src', 'components'), {
      recursive: true,
    });
    await fs.mkdir(path.join(remotionDir, 'public', 'icons'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(remotionDir, 'package.json'),
      JSON.stringify({ name: 'remotion-infographics' }),
      'utf-8',
    );
    await fs.writeFile(
      path.join(remotionDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
      'utf-8',
    );
    await fs.writeFile(
      path.join(remotionDir, 'src', 'index.tsx'),
      'export const root = true;\n',
      'utf-8',
    );
    await fs.writeFile(
      path.join(remotionDir, 'public', 'icons', 'desk.svg'),
      '<svg />\n',
      'utf-8',
    );

    await __private__.copyRemotionWorkspaceTemplate(remotionDir, workspaceDir);

    await expect(
      fs.readFile(path.join(workspaceDir, 'package.json'), 'utf-8'),
    ).resolves.toContain('remotion-infographics');
    await expect(
      fs.readFile(path.join(workspaceDir, 'tsconfig.json'), 'utf-8'),
    ).resolves.toContain('react-jsx');
    await expect(
      fs.readFile(path.join(workspaceDir, 'src', 'index.tsx'), 'utf-8'),
    ).resolves.toContain('root = true');
    await expect(
      fs.readFile(
        path.join(workspaceDir, 'public', 'icons', 'desk.svg'),
        'utf-8',
      ),
    ).resolves.toContain('<svg />');
  });

  it('ensures the Remotion browser runtime and returns its executable path', async () => {
    const ensureBrowser = jest
      .fn<() => Promise<{ type: string; path: string }>>()
      .mockResolvedValue({
        type: 'local-puppeteer-browser',
        path: '/tmp/remotion-headless-shell',
      });

    const browserExecutable = await __private__.ensureRemotionBrowser({
      ensureBrowser,
    } as unknown as typeof import('@remotion/renderer'));

    expect(browserExecutable).toBe('/tmp/remotion-headless-shell');
    expect(ensureBrowser).toHaveBeenCalledWith({
      logLevel: 'info',
      chromeMode: 'headless-shell',
    });
  });

  it('prefers the bundled browser executable in packaged builds', async () => {
    const mockedBundledBrowserPath =
      getBundledRemotionBrowserExecutable as jest.MockedFunction<
        typeof getBundledRemotionBrowserExecutable
      >;
    mockedBundledBrowserPath.mockReturnValueOnce('/tmp/bundled-headless-shell');

    const ensureBrowser = jest.fn();

    const browserExecutable = await __private__.ensureRemotionBrowser({
      ensureBrowser,
    } as unknown as typeof import('@remotion/renderer'));

    expect(browserExecutable).toBe('/tmp/bundled-headless-shell');
    expect(ensureBrowser).not.toHaveBeenCalled();
  });

  it('uses a software-backed Chromium GL renderer for Remotion renders', () => {
    expect(__private__.REMOTION_CHROMIUM_OPTIONS).toEqual({
      gl: 'swangle',
    });
  });
});
