/**
 * MdNode — markdown renderer for the Inspector Canvas.
 *
 * Phase 3 placeholder. Replaced in commit "feat(inspector): MdNode
 * renderer" with the real markdown body + fade mask.
 */
export interface MdNodeProps {
  outputPath?: string;
  headlineField?: string;
}

export function MdNodeStage({ outputPath }: MdNodeProps) {
  return <div data-testid="md-stage-placeholder">{outputPath ?? 'pending'}</div>;
}

export function MdNodeTile({ outputPath }: MdNodeProps) {
  return <div data-testid="md-tile-placeholder">{outputPath ?? 'pending'}</div>;
}
