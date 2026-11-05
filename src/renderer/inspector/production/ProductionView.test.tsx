jest.mock('./AssemblyPanel', () => ({ AssemblyPanel: () => null }));
jest.mock('./MediaChecksPanel', () => ({ MediaChecksPanel: () => null }));
/**
 * ProductionView — render coverage (exercises the real component).
 *
 * useRunModel + the contexts are mocked so we can drive a specific run
 * state; the pure buildProductionDoc shape + the dumb section/pill render
 * run for real. CardDetailModal/ReadableArtifact/ShotSheetCard internals
 * (file IPC, modal) aren't under test here and are stubbed.
 *
 * jsdom lacks IntersectionObserver (the indicate-only viewing tracker) and
 * Element.scrollIntoView (pill click → scroll) — both are stubbed below so
 * the component's effects/handlers run without throwing.
 *
 * Failure modes covered:
 *   1. one pill per bundle stage, using declared display names
 *   2. the Final Cut hero renders with the project title
 *   3. media-only stages render as a board of their items
 *   4. empty project (no artifacts) renders the "new" hero without crashing
 */
import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { deriveRunModel, type RunModel } from '../../lib/runCockpit/deriveRunModel';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockNarrative = [
  { id: 'story', kind: 'stage', displayName: 'Story', outputs: { format: 'md', pattern: 'story.md' } },
  { id: 'scenes_plan', kind: 'stage', displayName: 'Scene Breakdown', outputs: { format: 'json', pattern: 's.json' } },
  { id: 'character_image', kind: 'collection', displayName: 'Characters', outputs: { format: 'image', pattern: 'c/{id}.png' } },
  { id: 'setting_image', kind: 'collection', displayName: 'Settings', outputs: { format: 'image', pattern: 'se/{id}.png' } },
  { id: 'shot_image', kind: 'collection', displayName: 'Shots', outputs: { format: 'image', pattern: 's/{id}.png' } },
  { id: 'scene_clip', kind: 'collection', displayName: 'Clips', outputs: { format: 'video', pattern: 'v/{id}.mp4' } },
  { id: 'final_video', kind: 'stage', displayName: 'Final Cut', outputs: { format: 'video', pattern: 'final.mp4' } },
];

let mockModel: RunModel;
let mockProjectName: string | null = null;
jest.mock('../../hooks/useRunModel', () => ({ useRunModel: () => ({ model: mockModel, stop: jest.fn() }) }));
jest.mock('../../contexts/WorkspaceContext', () => ({ useWorkspace: () => ({ projectDirectory: '/proj/Set In The 1970s', projectName: mockProjectName }) }));
jest.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({ bundle: { id: 'narr', nodes: mockNarrative } }) }));
jest.mock('../CardDetailModal', () => ({ CardDetailModal: () => null }));
// Preparation interactions have their own real-component tests.
jest.mock('./GpuPreparationPanel', () => ({ GpuPreparationPanel: () => null }));
jest.mock('./ReadableArtifact', () => ({ ReadableArtifact: () => <div data-testid="readable" /> }));
jest.mock('./ShotSheetCard', () => ({
  ShotSheetCard: ({ entity }: any) => <div data-testid="sheet">{entity.label}</div>,
}));

import { ProductionView } from './ProductionView';

const inst = (nodeId: string, status: InstanceGraphNode['status'], extra: Partial<InstanceGraphNode> = {}): InstanceGraphNode => ({ nodeId, status, ...extra });

function buildModel(instances: InstanceGraphNode[]): RunModel {
  return deriveRunModel({ instances, edges: [], bundleNodes: mockNarrative as any, runnerActive: false, cancelling: false, agentBusy: false, now: 1_000_000_000_000 });
}

const MID_RUN: InstanceGraphNode[] = [
  inst('story', 'completed', { outputPath: 'story.md' }),
  inst('scenes_plan', 'completed', { outputPath: 's.json' }),
  inst('character_image', 'completed', { itemId: 'lyla', outputPath: 'c/lyla.png' }),
  inst('character_image', 'completed', { itemId: 'floyd', outputPath: 'c/floyd.png' }),
  inst('setting_image', 'completed', { itemId: 'main_street', outputPath: 'se/main.png' }),
  inst('shot_image', 'completed', { itemId: 'scene_1_shot_1', outputPath: 's/1.png' }),
  inst('shot_image', 'completed', { itemId: 'scene_1_shot_2', outputPath: 's/2.png' }),
  inst('shot_image', 'in_progress', { itemId: 'scene_1_shot_3' }),
  inst('scene_clip', 'pending', { itemId: 'scene_1' }),
  inst('final_video', 'pending'),
];

beforeAll(() => {
  // jsdom implements neither — the viewing-tracker effect and pill-click
  // handler use them. Stub so the real component mounts/handles without throwing.
  (global as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  (Element.prototype as any).scrollIntoView = jest.fn();
});

beforeEach(() => {
  mockProjectName = null;
  mockModel = buildModel(MID_RUN);
});

describe('ProductionView', () => {
  it('renders a pill per bundle stage using its declared display name', () => {
    render(<ProductionView />);
    for (const label of ['Story', 'Scene Breakdown', 'Characters', 'Settings', 'Shots', 'Clips', 'Final Cut']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('renders the Final Cut hero with the project title', () => {
    render(<ProductionView />);
    expect(screen.getByText('Set In The 1970s')).toBeTruthy();
  });

  it('uses the saved project name instead of guessing from the folder', () => {
    mockProjectName = 'Brilliant Care — a patient’s story';
    render(<ProductionView />);
    expect(screen.getByText(mockProjectName)).toBeTruthy();
    expect(screen.queryByText('Set In The 1970s')).toBeNull();
  });

  it('renders media-only stages as a board of their items, and pill clicks scroll without crashing', () => {
    render(<ProductionView />);
    // character_image (media-only) → board; its two items render as tiles.
    expect(screen.getByText(/lyla/i)).toBeTruthy();
    expect(screen.getByText(/floyd/i)).toBeTruthy();
    const charsPill = screen
      .getAllByText('Characters')
      .map((el) => el.closest('button'))
      .find(Boolean) as HTMLButtonElement;
    fireEvent.click(charsPill);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('connects creative review navigation to the actual section', () => {
    render(<ProductionView />);
    const spy = jest.spyOn(Element.prototype, 'scrollIntoView');
    spy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Script' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.instances[0] as unknown as HTMLElement).dataset.sectionId).toBe('story');
  });

  it('labels generated video as needing review', () => {
    mockModel = buildModel([inst('final_video', 'completed', { outputPath: 'final.mp4' })]);
    render(<ProductionView />);
    expect(screen.getByRole('button', { name: 'Review generated cut' })).toBeTruthy();
    expect(screen.getByText('Generated cut · review needed')).toBeTruthy();
    expect(screen.queryByText(/Finished —/)).toBeNull();
  });

  it('jumps directly to a declared stage and focuses its section', () => {
    render(<ProductionView />);
    const spy = jest.spyOn(Element.prototype, 'scrollIntoView');
    spy.mockClear();
    fireEvent.change(screen.getByRole('combobox', { name: 'Go to production stage' }), { target: { value: 'story' } });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Go to selected stage' }));
    expect(spy).toHaveBeenCalledTimes(1);
    const target = spy.mock.instances[0] as unknown as HTMLElement;
    expect(target.dataset.sectionId).toBe('story');
    expect(document.activeElement).toBe(target);
  });

  it('respects reduced motion when navigating to a stage', () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: true })) });
    try {
      render(<ProductionView />);
      const spy = jest.spyOn(Element.prototype, 'scrollIntoView');
      spy.mockClear();
      fireEvent.change(screen.getByRole('combobox', { name: 'Go to production stage' }), { target: { value: 'story' } });
      fireEvent.click(screen.getByRole('button', { name: 'Go to selected stage' }));
      expect(spy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    } finally { Object.defineProperty(window, 'matchMedia', { configurable: true, value: original }); }
  });

  it('renders a blank canvas without crashing when the run has no instances yet', () => {
    // Zero instances → deriveRunModel yields no stages → no sections/pills.
    // The point of this case is that the real component (IntersectionObserver
    // effect included) still mounts cleanly instead of throwing.
    mockModel = buildModel([]);
    const { container } = render(<ProductionView />);
    expect(container.firstChild).toBeTruthy(); // mounted, no throw
    expect(screen.getByRole('region', { name: 'Creative approval policy' })).toBeTruthy(); // policy is available before generation
  });
});
