/**
 * ImageNode — renders image artifacts (character_image, setting_image,
 * shot_image, key_art).
 *
 * Stage: hero image at full card width.
 * Tile:  thumbnail in a rail entry, with itemId caption and status
 *        overlays.
 *
 * Images load via the absolute file:// URL — useArtifactUrl handles
 * resolution; no file-read IPC needed for the bytes.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ImageNodeStage, ImageNodeTile } from './ImageNode';

jest.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory: '/tmp/p' }),
}));

describe('ImageNodeStage', () => {
  it('renders pending state when no outputPath', () => {
    render(<ImageNodeStage />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
  });

  it('renders an <img> with the file:// URL when outputPath is present', () => {
    render(<ImageNodeStage outputPath="assets/images/characters/ruby.png" />);
    const img = screen.getByRole('img', { hidden: true });
    expect(img).toHaveAttribute('src', 'file:///tmp/p/assets/images/characters/ruby.png');
  });

  it('attaches a generic alt text', () => {
    render(<ImageNodeStage outputPath="assets/x.png" />);
    expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('alt');
  });
});

describe('ImageNodeTile', () => {
  it('shows the itemId label', () => {
    render(<ImageNodeTile itemId="ruby" status="completed" />);
    expect(screen.getByText('ruby')).toBeInTheDocument();
  });

  it('renders an <img> with the file:// URL when outputPath is present', () => {
    render(
      <ImageNodeTile
        outputPath="assets/images/characters/ruby.png"
        itemId="ruby"
        status="completed"
      />,
    );
    const img = screen.getByRole('img', { hidden: true });
    expect(img).toHaveAttribute('src', 'file:///tmp/p/assets/images/characters/ruby.png');
  });

  it('renders a pending placeholder when no outputPath', () => {
    render(<ImageNodeTile itemId="x" status="pending" />);
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it('surfaces failed status via data attribute', () => {
    render(<ImageNodeTile itemId="x" status="failed" />);
    expect(screen.getByTestId('image-tile')).toHaveAttribute('data-status', 'failed');
  });

  it('overlays an invalidated diagonal-stripe pattern when invalidated', () => {
    render(<ImageNodeTile itemId="x" status="invalidated" outputPath="a.png" />);
    expect(screen.getByTestId('image-tile')).toHaveAttribute('data-status', 'invalidated');
  });
});
