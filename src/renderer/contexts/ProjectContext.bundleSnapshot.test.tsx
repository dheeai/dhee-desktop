/**
 * Pins the BundleSnapshot hoist into ProjectContext.
 *
 * Until Phase 2 each view (PromptsView etc.) fetched the bundle into
 * its own local state via `window.dhee.resolveBundle()` — a latent
 * cache-invalidation issue (the cache never invalidated when the
 * project switched, but PromptsView happened to remount because of
 * project-directory key changes that triggered other tear-downs).
 *
 * In Phase 2 the bundle becomes a first-class field on ProjectContext.
 * Every view that wants the bundle reads `useProject().bundle`.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ProjectProvider, useProject } from './ProjectContext';
import type { ResolveBundleResponse } from '../../shared/dheeIpc';

// ── Mock the workspace context (provides projectDirectory). ──────────
const useWorkspaceMock = jest.fn();
jest.mock('./WorkspaceContext', () => ({
  useWorkspace: () => useWorkspaceMock(),
}));

// ── Mock projectService.openProject to avoid disk reads. ─────────────
const openProjectMock = jest.fn();
const invalidateCacheMock = jest.fn();
jest.mock('../services/project', () => ({
  projectService: {
    openProject: (dir: string) => openProjectMock(dir),
    invalidateCache: () => invalidateCacheMock(),
    readManifest: () => Promise.resolve(null),
  },
}));

// ── Mock the assets thumbnail sync. ──────────────────────────────────
jest.mock('../services/project/projectThumbnail', () => ({
  ensureProjectThumbnailFromManifest: (_d: string, m: unknown) =>
    Promise.resolve({ manifest: m, changed: false }),
}));

// ── Mock the image sync engine. ──────────────────────────────────────
jest.mock('../services/assets', () => ({
  createEmptyImageProjectionSnapshot: () => ({ scenes: {} }),
  createImageAssetSyncEngine: () => ({
    subscribe: () => () => {},
    getSnapshot: () => ({ scenes: {} }),
    trigger: () => {},
    setExpected: () => {},
    dispose: () => {},
  }),
}));

// ── Mock the dhee preload bridge — the canonical way to resolve a bundle. ──
const resolveBundleMock = jest.fn<Promise<ResolveBundleResponse>, [{ bundleSource: string }]>();
const readFileMock = jest.fn<Promise<string | null>, [string]>();
beforeAll(() => {
  (global as unknown as { window: Window }).window = global.window || ({} as Window);
  (window as unknown as { dhee: { resolveBundle: typeof resolveBundleMock } }).dhee = {
    resolveBundle: resolveBundleMock,
  };
  (window as unknown as { electron: unknown }).electron = {
    project: {
      readFile: (p: string) => readFileMock(p),
      listDirectory: jest.fn().mockResolvedValue([]),
      readTree: jest.fn().mockResolvedValue([]),
      watchManifest: jest.fn().mockResolvedValue(undefined),
      watchImagePlacements: jest.fn().mockResolvedValue(undefined),
      watchInfographicPlacements: jest.fn().mockResolvedValue(undefined),
      // Subscriptions return unsubscribe functions; ProjectContext
      // teardown calls them on cleanup.
      onFileChange: jest.fn().mockReturnValue(() => {}),
      onManifestWritten: jest.fn().mockReturnValue(() => {}),
      removeFileChangeListener: jest.fn(),
    },
    ipcRenderer: { on: jest.fn(), removeAllListeners: jest.fn(), invoke: jest.fn() },
  };
});

beforeEach(() => {
  resolveBundleMock.mockReset();
  readFileMock.mockReset();
  // Default: project.json contains no bundleSource. Individual tests
  // override per-project.
  readFileMock.mockResolvedValue(null);
  openProjectMock.mockReset();
  invalidateCacheMock.mockReset();
  useWorkspaceMock.mockReset();
});

/** Mock `window.electron.project.readFile` to return a project.json
 *  with the given top-level fields when the consumer asks for that
 *  exact file. */
function mockProjectJson(projectDir: string, body: Record<string, unknown>) {
  readFileMock.mockImplementation(async (path: string) => {
    if (path === `${projectDir}/project.json`) return JSON.stringify(body);
    return null;
  });
}

const FAKE_BUNDLE: NonNullable<ResolveBundleResponse['bundle']> = {
  id: 'fixture',
  version: '0.1.0',
  goal: 'final_video',
  nodes: [
    {
      id: 'plot',
      kind: 'stage',
      outputs: { format: 'md', pattern: 'plans/plot.md' },
      inputs: [],
      displayCapability: 'plot.outline',
    },
  ],
};

function Probe() {
  const { bundle } = useProject();
  return <div data-testid="probe">{bundle ? bundle.id : 'no-bundle'}</div>;
}

describe('ProjectContext.bundle — Phase 2 BundleSnapshot hoist', () => {
  it('exposes bundle: null before any project is loaded', () => {
    useWorkspaceMock.mockReturnValue({ projectDirectory: null });
    render(
      <ProjectProvider>
        <Probe />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('no-bundle');
    expect(resolveBundleMock).not.toHaveBeenCalled();
  });

  it('resolves the bundle when project.json has a bundleSource', async () => {
    useWorkspaceMock.mockReturnValue({ projectDirectory: '/tmp/p1' });
    mockProjectJson('/tmp/p1', { id: 'p1', bundleSource: 'built-in:fixture' });
    openProjectMock.mockResolvedValue({
      success: true,
      data: {
        manifest: null,
        agentState: {},
        assetManifest: { assets: [] },
        timelineState: {
          playhead_seconds: 0,
          zoom_level: 1,
          markers: [],
          imported_clips: [],
          active_versions: {},
        },
        contextIndex: null,
      },
    });
    resolveBundleMock.mockResolvedValue({ ok: true, bundle: FAKE_BUNDLE });
    render(
      <ProjectProvider>
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toHaveTextContent('fixture');
    });
    expect(resolveBundleMock).toHaveBeenCalledWith({ bundleSource: 'built-in:fixture' });
  });

  it('leaves bundle: null when project.json has no bundleSource (legacy project)', async () => {
    useWorkspaceMock.mockReturnValue({ projectDirectory: '/tmp/p1' });
    mockProjectJson('/tmp/p1', { id: 'legacy' });
    openProjectMock.mockResolvedValue({
      success: true,
      data: {
        manifest: null,
        agentState: {},
        assetManifest: { assets: [] },
        timelineState: {
          playhead_seconds: 0,
          zoom_level: 1,
          markers: [],
          imported_clips: [],
          active_versions: {},
        },
        contextIndex: null,
      },
    });
    render(
      <ProjectProvider>
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(openProjectMock).toHaveBeenCalled());
    expect(screen.getByTestId('probe')).toHaveTextContent('no-bundle');
    expect(resolveBundleMock).not.toHaveBeenCalled();
  });

  it('clears the bundle when the project directory changes to one without a bundleSource', async () => {
    useWorkspaceMock.mockReturnValue({ projectDirectory: '/tmp/p1' });
    mockProjectJson('/tmp/p1', { id: 'p1', bundleSource: 'built-in:fixture' });
    openProjectMock.mockResolvedValue({
      success: true,
      data: {
        manifest: null,
        agentState: {},
        assetManifest: { assets: [] },
        timelineState: {
          playhead_seconds: 0,
          zoom_level: 1,
          markers: [],
          imported_clips: [],
          active_versions: {},
        },
        contextIndex: null,
      },
    });
    resolveBundleMock.mockResolvedValue({ ok: true, bundle: FAKE_BUNDLE });
    const { rerender } = render(
      <ProjectProvider>
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('fixture'));

    // Switch to a legacy project — bundle should clear.
    act(() => {
      useWorkspaceMock.mockReturnValue({ projectDirectory: '/tmp/p2-legacy' });
      mockProjectJson('/tmp/p2-legacy', { id: 'legacy' });
    });
    rerender(
      <ProjectProvider>
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('no-bundle'));
  });

  it('exposes bundle: null when resolveBundle returns ok=false', async () => {
    useWorkspaceMock.mockReturnValue({ projectDirectory: '/tmp/p1' });
    mockProjectJson('/tmp/p1', { id: 'p1', bundleSource: 'built-in:missing' });
    openProjectMock.mockResolvedValue({
      success: true,
      data: {
        manifest: null,
        agentState: {},
        assetManifest: { assets: [] },
        timelineState: {
          playhead_seconds: 0,
          zoom_level: 1,
          markers: [],
          imported_clips: [],
          active_versions: {},
        },
        contextIndex: null,
      },
    });
    resolveBundleMock.mockResolvedValue({ ok: false, error: 'not found' });
    render(
      <ProjectProvider>
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(resolveBundleMock).toHaveBeenCalled());
    expect(screen.getByTestId('probe')).toHaveTextContent('no-bundle');
  });
});
