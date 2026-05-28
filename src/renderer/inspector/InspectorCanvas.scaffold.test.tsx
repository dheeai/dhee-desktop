/**
 * Inspector Canvas — Phase 2 scaffold test.
 *
 * The canvas is the new project workspace surface. In Phase 2 every
 * card is a generic stub; the per-kind renderers ship in Phase 3. This
 * test pins the mount contract: the component reads bundle + walkState
 * from props, renders one card per bundle node, and degrades cleanly
 * when the bundle is null.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

// Per-kind renderers call useWorkspace() to resolve outputPath →
// absolute URL. The scaffold test isolates the dispatcher / canvas
// mount, so provide a stable projectDirectory.
jest.mock('../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory: '/tmp/p' }),
}));

// InspectorNode wraps each card in RegenerateMenu which needs the
// session hook.
jest.mock('../hooks/useDheeSession', () => ({
  useDheeSession: () => ({
    sessionId: 'sess-test',
    redoNode: jest.fn(),
  }),
}));

import { InspectorCanvas } from './InspectorCanvas';
import type { BundleSnapshot } from '../lib/bundleCapability';
import type { ProjectStateLike } from '../lib/bundleCapability';

const bundle = (
  ...nodes: Array<{
    id: string;
    kind?: 'stage' | 'collection';
    inputs?: Array<{ from: string }>;
    format?: string;
    displayCapability?: string;
  }>
): BundleSnapshot => ({
  id: 'fixture',
  version: '0.1.0',
  goal: nodes[nodes.length - 1]?.id ?? 'end',
  nodes: nodes.map((n) => ({
    id: n.id,
    kind: n.kind ?? 'stage',
    outputs: { format: n.format ?? 'md', pattern: `${n.id}.md` },
    inputs: n.inputs ?? [],
    ...(n.displayCapability ? { displayCapability: n.displayCapability } : {}),
  })),
});

const state = (entries: Record<string, { status: string; outputPath?: string }>): ProjectStateLike => ({
  nodes: entries,
});

describe('InspectorCanvas — Phase 2 scaffold', () => {
  it('renders an empty state when bundle is null', () => {
    render(<InspectorCanvas bundle={null} walkState={{ nodes: {} }} />);
    expect(screen.getByTestId('inspector-canvas-empty')).toBeInTheDocument();
  });

  it('renders one stub card per bundle node', () => {
    const b = bundle(
      { id: 'plot' },
      { id: 'story', inputs: [{ from: 'plot' }] },
      { id: 'scenes_plan', inputs: [{ from: 'story' }] },
    );
    render(<InspectorCanvas bundle={b} walkState={{ nodes: {} }} />);
    expect(screen.getByTestId('inspector-node-plot')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-node-story')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-node-scenes_plan')).toBeInTheDocument();
  });

  it('renders the React Flow viewport (the canvas surface itself)', () => {
    const b = bundle({ id: 'plot' });
    const { container } = render(<InspectorCanvas bundle={b} walkState={{ nodes: {} }} />);
    // xyflow puts a `.react-flow` wrapper on the root element it
    // controls — the presence proves the canvas mounted, not just our
    // shell components.
    expect(container.querySelector('.react-flow')).not.toBeNull();
  });

  it('shows the node id as the card label on each stub', () => {
    const b = bundle({ id: 'plot' }, { id: 'shot_image', kind: 'collection' });
    render(<InspectorCanvas bundle={b} walkState={{ nodes: {} }} />);
    expect(screen.getByText('plot')).toBeInTheDocument();
    expect(screen.getByText('shot_image')).toBeInTheDocument();
  });

  it('attaches walker status as a data attribute so CSS can drive visual state', () => {
    const b = bundle(
      { id: 'plot' },
      { id: 'shot_image', kind: 'collection' },
    );
    const s = state({
      plot: { status: 'completed', outputPath: 'plans/plot.md' },
      'shot_image:s1': { status: 'failed' },
      'shot_image:s2': { status: 'completed', outputPath: 'a.png' },
    });
    render(<InspectorCanvas bundle={b} walkState={s} />);
    expect(screen.getByTestId('inspector-node-plot')).toHaveAttribute('data-status', 'completed');
    // failed instance wins for the collection's aggregate status
    expect(screen.getByTestId('inspector-node-shot_image')).toHaveAttribute('data-status', 'failed');
  });

  describe('onGoalClick deep-link', () => {
    const goalBundle = (): BundleSnapshot => ({
      id: 'fixture',
      version: '0.1.0',
      goal: 'final_video',
      nodes: [
        {
          id: 'plot',
          kind: 'stage',
          outputs: { format: 'md', pattern: 'plans/plot.md' },
          inputs: [],
        },
        {
          id: 'final_video',
          kind: 'stage',
          outputs: { format: 'video', pattern: 'final.mp4' },
          inputs: [{ from: 'plot' }],
        },
      ],
    });

    it('fires onGoalClick when the goal card body is clicked', () => {
      const onGoalClick = jest.fn();
      const b = goalBundle();
      const s = state({
        plot: { status: 'completed', outputPath: 'plans/plot.md' },
        final_video: { status: 'completed', outputPath: 'final.mp4' },
      });
      const { container } = render(
        <InspectorCanvas bundle={b} walkState={s} onGoalClick={onGoalClick} />,
      );
      // The goal card body — first .clickable inside the goal node.
      const goalCard = screen.getByTestId('inspector-node-final_video');
      const body = goalCard.querySelector('[class*="clickable"]') as HTMLElement | null;
      expect(body).not.toBeNull();
      body!.click();
      expect(onGoalClick).toHaveBeenCalledWith('final_video');
      // Suppress unused-binding lint
      expect(container).toBeDefined();
    });

    it('does not fire onGoalClick on non-goal card clicks', () => {
      const onGoalClick = jest.fn();
      const b = goalBundle();
      const s = state({
        plot: { status: 'completed', outputPath: 'plans/plot.md' },
        final_video: { status: 'completed', outputPath: 'final.mp4' },
      });
      render(<InspectorCanvas bundle={b} walkState={s} onGoalClick={onGoalClick} />);
      const plotCard = screen.getByTestId('inspector-node-plot');
      const body = plotCard.querySelector('[class*="nodeBody"]') as HTMLElement | null;
      body?.click();
      expect(onGoalClick).not.toHaveBeenCalled();
    });
  });
});
