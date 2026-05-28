/**
 * VideoNode — video renderer for the Inspector Canvas.
 *
 * Phase 3 placeholder. Replaced with poster + play affordance in the
 * next commit; the final_video click → Timeline tab deep-link lands
 * in Phase 4.
 */
export interface VideoNodeProps {
  outputPath?: string;
}

export function VideoNodeStage({ outputPath }: VideoNodeProps) {
  return <div data-testid="video-stage-placeholder">{outputPath ?? 'pending'}</div>;
}

export function VideoNodeTile({ outputPath }: VideoNodeProps) {
  return <div data-testid="video-tile-placeholder">{outputPath ?? 'pending'}</div>;
}
