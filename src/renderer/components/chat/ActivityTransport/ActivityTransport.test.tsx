import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ActivityTransport from './ActivityTransport';
import type { ActivityState } from '../ChatPanelEmbedded/activityState';

const state = (
  s: Partial<ActivityState> & { kind: ActivityState['kind'] },
): ActivityState => ({
  verb: '',
  ...s,
});

describe('ActivityTransport', () => {
  it('renders nothing when idle', () => {
    const { container } = render(
      <ActivityTransport state={state({ kind: 'idle' })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the thinking verb', () => {
    render(
      <ActivityTransport
        state={state({ kind: 'thinking', verb: 'Thinking' })}
      />,
    );
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('shows a meter + stop button while rendering and fires onStop', () => {
    const onStop = jest.fn();
    render(
      <ActivityTransport
        state={state({
          kind: 'rendering',
          verb: 'Rendering',
          object: 'shot 12 of 40',
          progress: { completed: 12, total: 40, pct: 30 },
        })}
        onStop={onStop}
      />,
    );
    expect(screen.getByText('shot 12 of 40')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '30',
    );
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows a continue button when paused and fires onResume', () => {
    const onResume = jest.fn();
    render(
      <ActivityTransport
        state={state({
          kind: 'paused',
          verb: 'Paused',
          object: 'after character_image',
        })}
        onResume={onResume}
      />,
    );
    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('shows the transient classification and a retry button on failure', () => {
    const onRetry = jest.fn();
    render(
      <ActivityTransport
        state={state({
          kind: 'failed',
          verb: 'Failed',
          object: 'Comfy 502',
          failureClass: 'transient',
        })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Transient · retryable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
