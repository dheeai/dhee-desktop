/**
 * AudioNode — renders audio artifacts.
 *
 * Stage: <audio> with controls (full transport).
 * Tile:  small "▷ play" affordance with itemId caption.
 *
 * Real waveform rendering (the mockup's bar chart) is deferred — it
 * requires either pre-rendered waveform JSON or a peaks-decoding lib.
 * v1 ships the standard browser controls.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { AudioNodeStage, AudioNodeTile } from './AudioNode';

jest.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory: '/tmp/p' }),
}));

describe('AudioNodeStage', () => {
  it('renders pending state when no outputPath', () => {
    render(<AudioNodeStage />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
  });

  it('renders an <audio> element with file:// URL when outputPath is present', () => {
    const { container } = render(<AudioNodeStage outputPath="assets/audio/narration.mp3" />);
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio!.querySelector('source')?.getAttribute('src')).toBe(
      'file:///tmp/p/assets/audio/narration.mp3',
    );
  });

  it('exposes the controls attribute', () => {
    const { container } = render(<AudioNodeStage outputPath="a.mp3" />);
    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('controls');
  });
});

describe('AudioNodeTile', () => {
  it('shows the itemId label', () => {
    render(<AudioNodeTile itemId="track_1" status="completed" />);
    expect(screen.getByText('track_1')).toBeInTheDocument();
  });

  it('renders a play affordance when outputPath is present', () => {
    render(
      <AudioNodeTile outputPath="assets/audio/t1.mp3" itemId="track_1" status="completed" />,
    );
    expect(screen.getByTestId('audio-tile-play')).toBeInTheDocument();
  });

  it('renders pending placeholder when no outputPath', () => {
    render(<AudioNodeTile itemId="x" status="pending" />);
    expect(screen.queryByTestId('audio-tile-play')).toBeNull();
  });

  it('surfaces failed status via data attribute', () => {
    render(<AudioNodeTile itemId="x" status="failed" />);
    expect(screen.getByTestId('audio-tile')).toHaveAttribute('data-status', 'failed');
  });
});
