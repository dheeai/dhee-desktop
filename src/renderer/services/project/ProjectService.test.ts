import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ProjectService } from './ProjectService';
import { createDefaultBackendProject } from './backendProjectAdapter';
import type { AssetInfo } from '../../types/dhee';

/**
 * These tests exercise the pure/testable surface of ProjectService:
 *   - validateProject (file-existence -> validation flags)
 *   - openProject (cache / rate-limit / dedupe, uninitialized-folder path,
 *     invalid-manifest preservation, timeline normalization, event->state mapping)
 *   - field updaters and their "No project open" guards
 *   - close / invalidateCache / accessors
 *
 * The only thing mocked is the minimal IPC surface the service touches:
 * window.electron.project.{readFile, writeFile, createFolder}. Reads are
 * routed by path so each project file (project.json, assets/manifest.json,
 * timeline-ui.json, context-index.json) can be controlled independently.
 */

const DIR = '/projects/demo';

const AGENT_PROJECT_PATH = `${DIR}/project.json`;
const ASSET_MANIFEST_PATH = `${DIR}/assets/manifest.json`;
const TIMELINE_PATH = `${DIR}/timeline-ui.json`;

type ReadFile = (path: string) => Promise<string | null>;
type WriteFile = (
  path: string,
  content: string,
  meta?: unknown,
) => Promise<void>;

let files: Record<string, string | null>;
let mockReadFile: jest.MockedFunction<ReadFile>;
let mockWriteFile: jest.MockedFunction<WriteFile>;

/** Build a complete, valid backend project.json string with one scene. */
function buildBackendProjectJson(): string {
  const project = createDefaultBackendProject({
    id: 'proj-1',
    title: 'Demo Project',
    description: 'A test project',
  });
  project.currentPhase = 'scene_images';
  project.scenes = [
    {
      sceneNumber: 1,
      title: 'Scene 1',
      contentApprovalStatus: 'pending',
      imageApprovalStatus: 'pending',
      videoApprovalStatus: 'pending',
      regenerationCount: 0,
    },
  ];
  return JSON.stringify(project);
}

function installBridge() {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      project: {
        readFile: mockReadFile,
        writeFile: mockWriteFile,
        createFolder: jest.fn(),
      },
    },
  });
}

beforeEach(() => {
  files = {};
  mockReadFile = jest.fn<ReadFile>(async (path) => {
    if (path in files) return files[path];
    return null;
  });
  mockWriteFile = jest.fn<WriteFile>(async () => undefined);
  installBridge();
});

describe('ProjectService.validateProject', () => {
  it('flags a folder with no project.json as invalid', async () => {
    const service = new ProjectService();
    const result = await service.validateProject(DIR);

    expect(result.isValid).toBe(false);
    expect(result.hasAgentState).toBe(false);
    expect(result.errors).toContain('Missing project.json file');
  });

  it('reports valid with manifest/timeline flags reflecting which files exist', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });
    // timeline-ui.json intentionally absent

    const service = new ProjectService();
    const result = await service.validateProject(DIR);

    expect(result.isValid).toBe(true);
    expect(result.hasAgentState).toBe(true);
    expect(result.hasAssetManifest).toBe(true);
    expect(result.hasTimelineState).toBe(false);
    expect(result.errors).toEqual([]);
  });
});

describe('ProjectService.openProject', () => {
  it('returns an in-memory uninitialized project for a fresh folder (writes nothing)', async () => {
    const service = new ProjectService();
    const result = await service.openProject(DIR);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    // Uninitialized: empty title, no scenes, default phase.
    expect(result.data.agentState.title).toBe('');
    expect(result.data.agentState.scenes).toEqual([]);
    expect(service.getProjectDirectory()).toBe(DIR);
    // System-B removal: nothing is persisted from the uninitialized path.
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('loads a valid project and maps backend scenes into desktop agent state', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });

    const service = new ProjectService();
    const result = await service.openProject(DIR);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.agentState.title).toBe('Demo Project');
    expect(result.data.agentState.current_phase).toBe('scene_images');
    expect(result.data.agentState.scenes).toHaveLength(1);
    expect(result.data.agentState.scenes[0]).toMatchObject({
      scene_number: 1,
      title: 'Scene 1',
      image_approval_status: 'pending',
    });
    expect(service.getCurrentProject()).toBe(result.data);
  });

  it('creates a default asset manifest on disk when manifest.json is missing', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    // manifest.json absent -> readFile returns null -> "missing"

    const service = new ProjectService();
    const result = await service.openProject(DIR);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.assetManifest.assets).toEqual([]);
    // The missing-manifest branch writes a default manifest back to disk.
    expect(
      mockWriteFile.mock.calls.some(
        ([path]) => path === ASSET_MANIFEST_PATH,
      ),
    ).toBe(true);
  });

  it('preserves in-memory asset manifest when the on-disk manifest is invalid JSON', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    const goodAsset: AssetInfo = {
      id: 'img_1',
      type: 'scene_image',
      path: 'assets/images/a.png',
      version: 1,
      created_at: 1,
    } as AssetInfo;
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [goodAsset] });

    const service = new ProjectService();
    const first = await service.openProject(DIR);
    expect(first.success).toBe(true);
    if (!first.success) throw new Error('expected success');
    expect(first.data.assetManifest.assets).toHaveLength(1);

    // Now corrupt the manifest and force a re-read.
    files[ASSET_MANIFEST_PATH] = '{not json';
    files[`${ASSET_MANIFEST_PATH}.tmp`] = null; // no atomic-write fallback
    service.invalidateCache();

    const second = await service.openProject(DIR);
    expect(second.success).toBe(true);
    if (!second.success) throw new Error('expected success');
    // Invalid manifest must not wipe the previously loaded assets.
    expect(second.data.assetManifest.assets).toHaveLength(1);
    expect(second.data.assetManifest.assets[0].id).toBe('img_1');
  });

  it('recovers a corrupt project file via its atomic-write .tmp sibling', async () => {
    files[AGENT_PROJECT_PATH] = '{corrupt';
    files[`${AGENT_PROJECT_PATH}.tmp`] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });

    const service = new ProjectService();
    const result = await service.openProject(DIR);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.agentState.title).toBe('Demo Project');
  });

  it('normalizes a sparse timeline-ui.json by filling default collections', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });
    // Timeline missing the collection fields entirely.
    files[TIMELINE_PATH] = JSON.stringify({ playhead_position: 3 });

    const service = new ProjectService();
    const result = await service.openProject(DIR);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    const t = result.data.timelineState;
    expect(t.active_versions).toEqual({});
    expect(t.markers).toEqual([]);
    expect(t.imported_clips).toEqual([]);
    expect(t.image_timing_overrides).toEqual({});
    expect(t.video_split_overrides).toEqual({});
    expect(t.segment_timing_overrides).toEqual({});
    // Provided value survives the merge.
    expect((t as unknown as { playhead_position: number }).playhead_position).toBe(3);
  });

  it('serves the cached result for repeat opens within the rate-limit window', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });

    const service = new ProjectService();
    const first = await service.openProject(DIR);
    const callsAfterFirst = mockReadFile.mock.calls.length;

    const second = await service.openProject(DIR);

    expect(second).toBe(first); // identical cached reference
    expect(mockReadFile.mock.calls.length).toBe(callsAfterFirst); // no new reads
  });

  it('re-reads from disk after invalidateCache', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });

    const service = new ProjectService();
    await service.openProject(DIR);
    const callsAfterFirst = mockReadFile.mock.calls.length;

    service.invalidateCache();
    await service.openProject(DIR);

    expect(mockReadFile.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('deduplicates concurrent opens of the same directory onto one in-flight read', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });

    const service = new ProjectService();
    // Prime lastOpenDirectory so sameDir is true for the concurrent pair below.
    await service.openProject(DIR);
    // Force the next open to bypass the rate-limit cache and actually re-read.
    service.invalidateCache();

    const [a, b] = await Promise.all([
      service.openProject(DIR),
      service.openProject(DIR),
    ]);

    // The second call piggybacks on the first's pendingOpen -> identical reference.
    expect(a).toBe(b);
  });
});

describe('ProjectService field updaters guard on no open project', () => {
  it('updatePhase / updateSceneApproval / saveTimelineState / addAssetToManifest / updateAssetManifest all fail cleanly', async () => {
    const service = new ProjectService();

    expect(await service.updatePhase('plot' as never)).toEqual({
      success: false,
      error: 'No project open',
    });
    expect(
      await service.updateSceneApproval(1, 'image', 'approved'),
    ).toEqual({ success: false, error: 'No project open' });
    expect(
      await service.saveTimelineState({} as never),
    ).toEqual({ success: false, error: 'No project open' });
    expect(
      await service.addAssetToManifest({ id: 'x' } as AssetInfo),
    ).toEqual({ success: false, error: 'No project open' });
    expect(
      await service.updateAssetManifest({ assets: [] } as never),
    ).toEqual({ success: false, error: 'No project open' });
  });
});

describe('ProjectService field updaters mutate loaded state', () => {
  async function openLoaded() {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });
    const service = new ProjectService();
    const result = await service.openProject(DIR);
    if (!result.success) throw new Error('expected success');
    mockWriteFile.mockClear();
    return service;
  }

  it('updatePhase sets the phase, stamps updated_at, and persists', async () => {
    const service = await openLoaded();
    const before = service.getCurrentProject()!.agentState.updated_at;

    const result = await service.updatePhase('video' as never);

    expect(result.success).toBe(true);
    const state = service.getCurrentProject()!.agentState;
    expect(state.current_phase).toBe('video');
    expect(state.updated_at).toBeGreaterThanOrEqual(before);
    expect(
      mockWriteFile.mock.calls.some(([p]) => p === AGENT_PROJECT_PATH),
    ).toBe(true);
  });

  it('updateSceneApproval writes the status key and an approved_at on approval', async () => {
    const service = await openLoaded();

    const result = await service.updateSceneApproval(1, 'image', 'approved');

    expect(result.success).toBe(true);
    const scene = service
      .getCurrentProject()!
      .agentState.scenes.find((s) => s.scene_number === 1)!;
    expect(
      (scene as unknown as Record<string, unknown>).image_approval_status,
    ).toBe('approved');
    expect(
      (scene as unknown as Record<string, unknown>).image_approved_at,
    ).toEqual(expect.any(Number));
  });

  it('updateSceneApproval fails for an unknown scene number', async () => {
    const service = await openLoaded();

    const result = await service.updateSceneApproval(99, 'image', 'approved');

    expect(result).toEqual({ success: false, error: 'Scene 99 not found' });
  });

  it('addAssetToManifest appends a new asset and updates an existing one in place', async () => {
    const service = await openLoaded();

    const asset: AssetInfo = {
      id: 'img_new',
      type: 'scene_image',
      path: 'assets/images/new.png',
      version: 1,
      created_at: 1,
    } as AssetInfo;

    await service.addAssetToManifest(asset);
    expect(service.getCurrentProject()!.assetManifest.assets).toHaveLength(1);

    // Same id -> replace, not append.
    const updated: AssetInfo = { ...asset, path: 'assets/images/new-v2.png' };
    await service.addAssetToManifest(updated);

    const assets = service.getCurrentProject()!.assetManifest.assets;
    expect(assets).toHaveLength(1);
    expect(assets[0].path).toBe('assets/images/new-v2.png');
  });

  it('saveTimelineState replaces the in-memory timeline and persists', async () => {
    const service = await openLoaded();

    const newTimeline = {
      ...service.getCurrentProject()!.timelineState,
      markers: [{ id: 'm1', time: 2 }],
    };
    const result = await service.saveTimelineState(newTimeline as never);

    expect(result.success).toBe(true);
    expect(service.getCurrentProject()!.timelineState).toBe(newTimeline);
    expect(
      mockWriteFile.mock.calls.some(([p]) => p === TIMELINE_PATH),
    ).toBe(true);
  });
});

describe('ProjectService.closeProject', () => {
  it('clears the loaded project and directory', async () => {
    files[AGENT_PROJECT_PATH] = buildBackendProjectJson();
    files[ASSET_MANIFEST_PATH] = JSON.stringify({ assets: [] });
    const service = new ProjectService();
    await service.openProject(DIR);
    expect(service.getCurrentProject()).not.toBeNull();

    service.closeProject();

    expect(service.getCurrentProject()).toBeNull();
    expect(service.getProjectDirectory()).toBeNull();
  });
});

describe('ProjectService.readAssetManifest', () => {
  it('returns the parsed manifest when present and null when missing/invalid', async () => {
    const service = new ProjectService();

    // Missing.
    expect(await service.readAssetManifest(DIR)).toBeNull();

    // Present.
    files[ASSET_MANIFEST_PATH] = JSON.stringify({
      assets: [
        {
          id: 'img_1',
          type: 'scene_image',
          path: 'assets/images/a.png',
          version: 1,
          created_at: 1,
        },
      ],
    });
    const ok = await service.readAssetManifest(DIR);
    expect(ok?.assets).toHaveLength(1);

    // Invalid JSON, no .tmp fallback -> null.
    files[ASSET_MANIFEST_PATH] = '{bad';
    files[`${ASSET_MANIFEST_PATH}.tmp`] = null;
    expect(await service.readAssetManifest(DIR)).toBeNull();
  });
});
