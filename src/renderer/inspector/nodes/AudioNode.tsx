/**
 * AudioNode — audio renderer for the Inspector Canvas.
 *
 * Phase 3 placeholder. Replaced with waveform + transport in the next
 * commit.
 */
export interface AudioNodeProps {
  outputPath?: string;
}

export function AudioNodeStage({ outputPath }: AudioNodeProps) {
  return <div data-testid="audio-stage-placeholder">{outputPath ?? 'pending'}</div>;
}

export function AudioNodeTile({ outputPath }: AudioNodeProps) {
  return <div data-testid="audio-tile-placeholder">{outputPath ?? 'pending'}</div>;
}
