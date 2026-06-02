/**
 * VideoNode — renders video artifacts (scene_clip, final_video, shot_video).
 *
 * Stage: <video> element with controls + poster (if outputPath
 *        ending in .mp4 — Electron's content protocol streams the
 *        file via file://).
 * Tile:  poster frame (uses video's first-frame attribute hint) +
 *        play overlay.
 *
 * `final_video` click behaviour (open Timeline tab) is Phase 4 — not
 * tested here.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { VideoNodeStage, VideoNodeTile } from './VideoNode';

jest.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory: '/tmp/p' }),
}));

describe('VideoNodeStage', () => {
  it('renders pending state when no outputPath', () => {
    render(<VideoNodeStage />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
  });

  it('renders a <video> element with file:// URL when outputPath is present', () => {
    const { container } = render(<VideoNodeStage outputPath="assets/videos/scene_1.mp4" />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.querySelector('source')?.getAttribute('src')).toBe(
      'file:///tmp/p/assets/videos/scene_1.mp4',
    );
  });

  it('exposes the controls attribute so the user can play/pause/seek', () => {
    const { container } = render(<VideoNodeStage outputPath="a.mp4" />);
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('controls');
  });
});

describe('VideoNodeTile', () => {
  it('shows the itemId label', () => {
    render(<VideoNodeTile itemId="scene_1" status="completed" />);
    expect(screen.getByText('scene_1')).toBeInTheDocument();
  });

  it('renders a poster + play overlay when outputPath is present', () => {
    render(
      <VideoNodeTile outputPath="assets/videos/scene_1.mp4" itemId="scene_1" status="completed" />,
    );
    expect(screen.getByTestId('video-tile-play')).toBeInTheDocument();
  });

  it('renders pending placeholder when no outputPath', () => {
    render(<VideoNodeTile itemId="x" status="pending" />);
    expect(screen.queryByTestId('video-tile-play')).toBeNull();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it('surfaces failed status via data attribute', () => {
    render(<VideoNodeTile itemId="x" status="failed" />);
    expect(screen.getByTestId('video-tile')).toHaveAttribute('data-status', 'failed');
  });
});
