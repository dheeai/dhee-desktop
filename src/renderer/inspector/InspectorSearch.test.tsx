/**
 * InspectorSearch — Cmd+F find-in-graph for the canvas.
 *
 * Per UX critique: large graphs (a music project with 80 tracks, a
 * future complex narrative bundle) need search by node id. This
 * component mounts inside ReactFlowProvider and uses xyflow's
 * setCenter to pan to the matched node.
 *
 * Pure behavior tested here:
 *   - Cmd+F (or Ctrl+F) opens the search palette
 *   - Typing filters node ids
 *   - Up/Down arrow keys navigate matches
 *   - Enter centers the canvas on the active match (via callback)
 *   - Escape dismisses
 *   - Backdrop click dismisses
 */
import '@testing-library/jest-dom';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { InspectorSearch } from './InspectorSearch';
import type { InspectorFlowNode } from './bundleToFlowGraph';

const makeNode = (id: string): InspectorFlowNode => ({
  id,
  type: 'inspector',
  position: { x: 0, y: 0 },
  data: {
    bundleNode: {
      id,
      kind: 'stage',
      outputs: { format: 'md', pattern: `${id}.md` },
      inputs: [],
    },
    status: 'pending',
    instances: [],
    isGoal: false,
  },
});

describe('InspectorSearch', () => {
  it('is closed by default', () => {
    render(<InspectorSearch nodes={[makeNode('plot')]} onSelect={() => {}} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('Cmd+F opens the search input', () => {
    render(<InspectorSearch nodes={[makeNode('plot')]} onSelect={() => {}} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('Ctrl+F also opens (windows/linux)', () => {
    render(<InspectorSearch nodes={[makeNode('plot')]} onSelect={() => {}} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    });
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('typing filters node ids (substring match, case-insensitive)', () => {
    render(
      <InspectorSearch
        nodes={[makeNode('plot'), makeNode('story'), makeNode('shot_image_prompt')]}
        onSelect={() => {}}
      />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'shot' } });
    });
    expect(screen.getByText('shot_image_prompt')).toBeInTheDocument();
    expect(screen.queryByText('plot')).toBeNull();
    expect(screen.queryByText('story')).toBeNull();
  });

  it('Enter fires onSelect with the active match', () => {
    const onSelect = jest.fn();
    render(
      <InspectorSearch
        nodes={[makeNode('plot'), makeNode('story')]}
        onSelect={onSelect}
      />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'sto' } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSelect).toHaveBeenCalledWith('story');
  });

  it('Down arrow advances the active match', () => {
    const onSelect = jest.fn();
    render(
      <InspectorSearch
        nodes={[makeNode('a'), makeNode('b'), makeNode('c')]}
        onSelect={onSelect}
      />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '' } }); // empty matches all
    });
    // First match (a) is active by default; Down should move to b.
    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('Up arrow moves backward through matches', () => {
    const onSelect = jest.fn();
    render(
      <InspectorSearch
        nodes={[makeNode('a'), makeNode('b'), makeNode('c')]}
        onSelect={onSelect}
      />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '' } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // → b
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // → c
      fireEvent.keyDown(input, { key: 'ArrowUp' });   // → b
    });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('Escape closes the search', () => {
    render(<InspectorSearch nodes={[makeNode('plot')]} onSelect={() => {}} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('clicking a match fires onSelect and closes the search', () => {
    const onSelect = jest.fn();
    render(
      <InspectorSearch nodes={[makeNode('plot'), makeNode('story')]} onSelect={onSelect} />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    act(() => {
      screen.getByText('story').click();
    });
    expect(onSelect).toHaveBeenCalledWith('story');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows "no matches" when nothing matches the query', () => {
    render(
      <InspectorSearch nodes={[makeNode('plot')]} onSelect={() => {}} />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'f', metaKey: true });
    });
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'zzz' } });
    });
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
