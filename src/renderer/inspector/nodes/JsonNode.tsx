/**
 * JsonNode — JSON renderer for the Inspector Canvas.
 *
 * Phase 3 placeholder. Replaced with the real headline / tree
 * renderer in the next commit.
 */
export interface JsonNodeProps {
  outputPath?: string;
  headlineField?: string;
}

export function JsonNodeStage({ outputPath }: JsonNodeProps) {
  return <div data-testid="json-stage-placeholder">{outputPath ?? 'pending'}</div>;
}

export function JsonNodeTile({ outputPath, headlineField }: JsonNodeProps) {
  return (
    <div data-testid="json-tile-placeholder" data-headline-field={headlineField}>
      {outputPath ?? 'pending'}
    </div>
  );
}
