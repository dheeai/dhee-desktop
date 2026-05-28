/**
 * TextNode — plain text renderer for the Inspector Canvas.
 *
 * Phase 3 placeholder. Replaced with the real renderer in the next
 * commit.
 */
export interface TextNodeProps {
  outputPath?: string;
}

export function TextNodeStage({ outputPath }: TextNodeProps) {
  return <div data-testid="text-stage-placeholder">{outputPath ?? 'pending'}</div>;
}

export function TextNodeTile({ outputPath }: TextNodeProps) {
  return <div data-testid="text-tile-placeholder">{outputPath ?? 'pending'}</div>;
}
