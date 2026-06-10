/**
 * ProductionView — render coverage (exercises the real component).
 *
 * useRunModel + the contexts are mocked so we can drive a specific run
 * state; the layer derivation + section rendering run for real. ScriptDoc
 * and CardDetailModal are stubbed (file IPC / modal internals aren't under
 * test here).
 *
 * Failure modes:
 *   1. layer bar is derived from the bundle stages using their declared
 *      display names (Film/Script/Shots/Clips/Characters/Settings)
 *   2. defaults to Film once visual artifacts exist; hero renders
 *   3. switching to a reference layer shows that stage's items
 *   4. empty project (no stages) renders the "new" hero without crashing
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
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
jest.mock('../../hooks/useRunModel', () => ({ useRunModel: () => ({ model: mockModel, stop: jest.fn() }) }));
jest.mock('../../contexts/WorkspaceContext', () => ({ useWorkspace: () => ({ projectDirectory: '/proj/Set In The 1970s' }) }));
jest.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({ bundle: { id: 'narr', nodes: mockNarrative } }) }));
jest.mock('../CardDetailModal', () => ({ CardDetailModal: () => null }));
jest.mock('./ScriptDoc', () => ({ ScriptDoc: () => <div data-testid="script-doc" /> }));

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

beforeEach(() => {
  mockModel = buildModel(MID_RUN);
});

describe('ProductionView', () => {
  it('derives the layer bar from the bundle stages + display names', () => {
    render(<ProductionView />);
    for (const label of ['Film', 'Script', 'Shots', 'Clips', 'Characters', 'Settings']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('defaults to the Film layer once visual artifacts exist and renders the hero', () => {
    render(<ProductionView />);
    // hero title derived from the project dir
    expect(screen.getByText('Set In The 1970s')).toBeTruthy();
  });

  it('switches to a reference layer and shows that stage’s items', () => {
    render(<ProductionView />);
    const charsBtn = screen
      .getAllByText('Characters')
      .map((el) => el.closest('button'))
      .find(Boolean) as HTMLButtonElement;
    fireEvent.click(charsBtn);
    expect(screen.getByText('Lyla')).toBeTruthy();
    expect(screen.getByText('Floyd')).toBeTruthy();
  });

  it('renders the "new" hero for an empty project without crashing', () => {
    mockModel = buildModel([]);
    render(<ProductionView />);
    expect(screen.getByText(/no footage yet/i)).toBeTruthy();
  });
});
