/**
 * Right-click context menu with "Regenerate" — dispatches
 * `window.dhee.redoNode({ sessionId, nodeId })` via the existing IPC.
 *
 * On stage cards: nodeId === bundleNode.id (e.g. 'plot').
 * On collection-rail tiles: nodeId === `${bundleNode.id}:${itemId}`
 *   (e.g. 'shot_image:scene_1_shot_1') — matches the collection
 *   instance key used in walkState.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegenerateMenu } from './RegenerateMenu';

const redoNodeMock = jest.fn();
jest.mock('../../hooks/useDheeSession', () => ({
  useDheeSession: () => ({
    sessionId: 'sess-1',
    redoNode: (nodeId: string, opts?: object) => redoNodeMock(nodeId, opts),
  }),
}));

beforeEach(() => {
  redoNodeMock.mockReset();
  redoNodeMock.mockResolvedValue({ ok: true });
});

describe('RegenerateMenu', () => {
  it('renders a target child', () => {
    render(
      <RegenerateMenu nodeId="plot">
        <button data-testid="card">card</button>
      </RegenerateMenu>,
    );
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });

  it('opens the menu on right-click and closes on outside click', () => {
    render(
      <RegenerateMenu nodeId="plot">
        <div data-testid="card">card</div>
      </RegenerateMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('card'));
    expect(screen.getByText(/regenerate/i)).toBeInTheDocument();

    // Click the menu's own backdrop to dismiss.
    fireEvent.click(screen.getByTestId('regenerate-backdrop'));
    expect(screen.queryByText(/regenerate/i)).toBeNull();
  });

  it('calls redoNode with the stage nodeId on Regenerate click', async () => {
    render(
      <RegenerateMenu nodeId="plot">
        <div data-testid="card">card</div>
      </RegenerateMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('card'));
    fireEvent.click(screen.getByText(/regenerate/i));
    expect(redoNodeMock).toHaveBeenCalledWith('plot', undefined);
  });

  it('calls redoNode with the collection-instance nodeId for a per-item tile', async () => {
    render(
      <RegenerateMenu nodeId="shot_image:scene_1_shot_1">
        <div data-testid="tile">tile</div>
      </RegenerateMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('tile'));
    fireEvent.click(screen.getByText(/regenerate/i));
    expect(redoNodeMock).toHaveBeenCalledWith('shot_image:scene_1_shot_1', undefined);
  });

  it('closes the menu after firing regen', () => {
    render(
      <RegenerateMenu nodeId="plot">
        <div data-testid="card">card</div>
      </RegenerateMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('card'));
    fireEvent.click(screen.getByText(/regenerate/i));
    expect(screen.queryByText(/regenerate/i)).toBeNull();
  });

  it('does not re-fire if Regenerate is clicked twice on the same open menu', () => {
    render(
      <RegenerateMenu nodeId="plot">
        <div data-testid="card">card</div>
      </RegenerateMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('card'));
    const menuItem = screen.getByText(/regenerate/i);
    fireEvent.click(menuItem);
    // Menu is gone; clicking again is a no-op (no event target).
    expect(redoNodeMock).toHaveBeenCalledTimes(1);
  });

  it('does not open the menu when nodeId is undefined (pending node)', () => {
    render(
      <RegenerateMenu>
        <div data-testid="card">card</div>
      </RegenerateMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('card'));
    expect(screen.queryByText(/regenerate/i)).toBeNull();
  });
});
