import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import TimelineContextMenu from './TimelineContextMenu';

describe('TimelineContextMenu', () => {
  it('shows Regenerate Shot only when explicitly enabled', () => {
    const { rerender } = render(
      <TimelineContextMenu
        x={10}
        y={20}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByText('Regenerate Shot')).toBeNull();

    rerender(
      <TimelineContextMenu
        x={10}
        y={20}
        showRegenerateShotAction
        onRegenerateShot={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByText('Regenerate Shot')).not.toBeNull();
  });

  it('invokes regenerate and closes the menu', () => {
    const onRegenerateShot = jest.fn();
    const onClose = jest.fn();

    render(
      <TimelineContextMenu
        x={10}
        y={20}
        showRegenerateShotAction
        onRegenerateShot={onRegenerateShot}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('Regenerate Shot'));
    expect(onRegenerateShot).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
