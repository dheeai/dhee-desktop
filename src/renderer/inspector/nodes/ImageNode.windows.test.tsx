/**
 * Regression: on Windows the project directory is a drive-letter path
 * (C:/Users/…). The inspector built `file://${dir}/…`, which on Windows
 * becomes `file://C:/…` — `C:` is parsed as the URL host, so EVERY
 * artifact image silently failed to load ("none of the images are
 * showing"). useArtifactUrl now routes through toFileUrl, which yields
 * `file:///C:/…` (valid). Unix paths are covered in ImageNode.test.tsx.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ImageNodeStage, ImageNodeTile } from './ImageNode';

jest.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory: 'C:/Users/user/dhee-studios' }),
}));

describe('ImageNode on a Windows project directory', () => {
  it('stage <img> src is a valid file:///C:/… URL (three slashes)', () => {
    render(<ImageNodeStage outputPath="assets/images/characters/ruby.png" />);
    const img = screen.getByRole('img', { hidden: true });
    expect(img).toHaveAttribute(
      'src',
      'file:///C:/Users/user/dhee-studios/assets/images/characters/ruby.png',
    );
  });

  it('tile <img> src is a valid file:///C:/… URL (not file://C:/)', () => {
    render(
      <ImageNodeTile
        outputPath="assets/images/shots/shot_1.png"
        itemId="shot_1"
        status="completed"
      />,
    );
    const img = screen.getByRole('img', { hidden: true });
    const src = img.getAttribute('src') ?? '';
    expect(src).toBe(
      'file:///C:/Users/user/dhee-studios/assets/images/shots/shot_1.png',
    );
    // Guard against the regression specifically: the drive letter must
    // not sit in the URL authority position.
    expect(src.startsWith('file://C:')).toBe(false);
  });
});
