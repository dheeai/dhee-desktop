/**
 * TransportBar — render coverage (exercises the real component, not source
 * text). The hooks it consumes are mocked so we can drive specific run
 * states and assert the honest, unified readout.
 *
 * Failure modes:
 *   1. idle (no walk, no agent) → renders nothing (self-hides)
 *   2. agent busy but no walk → renders (the old "Idle" lie is gone)
 *   3. mid-walk → phase verb, N/M counter + unit noun, stage rail, Stop
 *   4. Stop calls the runner cancel while a walk is active
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockRunner: any;
let mockSession: any;
let mockGraph: any;
let mockProject: any;

jest.mock('../../../hooks/useRunnerStatus', () => ({ useRunnerStatus: () => mockRunner }));
jest.mock('../../../hooks/useDheeSession', () => ({ useDheeSession: () => mockSession }));
jest.mock('../../../hooks/useInstanceGraph', () => ({ useInstanceGraph: () => mockGraph }));
jest.mock('../../../contexts/ProjectContext', () => ({ useProject: () => mockProject }));
jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory: '/p' }),
}));

import TransportBar from './TransportBar';

const NARRATIVE = [
  { id: 'story', kind: 'stage', outputs: { format: 'md', pattern: 'story.md' } },
  { id: 'scenes_plan', kind: 'stage', outputs: { format: 'json', pattern: 's.json' } },
  { id: 'shot_image', kind: 'collection', outputs: { format: 'image', pattern: 's/{id}.png' } },
  { id: 'final_video', kind: 'stage', outputs: { format: 'video', pattern: 'f.mp4' } },
];

function midRunGraph() {
  const instances: any[] = [
    { nodeId: 'story', status: 'completed', outputPath: 'story.md' },
    { nodeId: 'scenes_plan', status: 'completed', outputPath: 's.json' },
    { nodeId: 'shot_image', status: 'in_progress', itemId: 's7' },
    { nodeId: 'final_video', status: 'pending' },
  ];
  for (let i = 1; i <= 6; i += 1) instances.push({ nodeId: 'shot_image', status: 'completed', itemId: `s${i}`, outputPath: `s/s${i}.png` });
  for (let i = 8; i <= 23; i += 1) instances.push({ nodeId: 'shot_image', status: 'pending', itemId: `s${i}` });
  return { instances, edges: [] };
}

beforeEach(() => {
  mockRunner = { active: false, cancelling: false, cancel: jest.fn(), status: null };
  mockSession = { status: 'idle', cancel: jest.fn() };
  mockGraph = { graph: null, error: null, refresh: jest.fn() };
  mockProject = { bundle: { id: 'narrative', nodes: NARRATIVE } };
});

describe('TransportBar', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<TransportBar />);
    expect(container.firstChild).toBeNull();
  });

  it('appears when the agent is busy even without a walk (no more "Idle" lie)', () => {
    mockSession = { status: 'running', cancel: jest.fn() };
    const { container } = render(<TransportBar />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('shows the data-driven phase, counter, unit noun and stage rail mid-walk', () => {
    mockRunner = { active: true, cancelling: false, cancel: jest.fn(), status: { startedAt: 1, kind: 'walk' } };
    mockGraph = { graph: midRunGraph(), error: null, refresh: jest.fn() };
    render(<TransportBar />);
    // verb derived from the active stage's image format
    expect(screen.getByText('Rendering')).toBeTruthy();
    // unit noun derived from the active stage id, pluralized
    expect(screen.getByText('shot images')).toBeTruthy();
    // the active-stage counter
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('/ 23')).toBeTruthy();
    // stage rail shows the bundle's stages (label appears at least once)
    expect(screen.getAllByText('Shot Image').length).toBeGreaterThan(0);
    expect(screen.getByText('Final Video')).toBeTruthy();
  });

  it('Stop cancels the active walk via the runner', () => {
    const cancel = jest.fn();
    mockRunner = { active: true, cancelling: false, cancel, status: { startedAt: 1, kind: 'walk' } };
    mockGraph = { graph: midRunGraph(), error: null, refresh: jest.fn() };
    render(<TransportBar />);
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(cancel).toHaveBeenCalled();
  });
});
