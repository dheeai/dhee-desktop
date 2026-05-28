/**
 * ImageNode — image renderer for the Inspector Canvas.
 *
 * Phase 3 placeholder. Replaced with the real <img>-based renderer
 * in the next commit.
 */
export interface ImageNodeProps {
  outputPath?: string;
}

export function ImageNodeStage({ outputPath }: ImageNodeProps) {
  return <div data-testid="image-stage-placeholder">{outputPath ?? 'pending'}</div>;
}

export function ImageNodeTile({ outputPath }: ImageNodeProps) {
  return <div data-testid="image-tile-placeholder">{outputPath ?? 'pending'}</div>;
}
