/**
 * TextNode — renders plain-text artifacts (e.g. original_input).
 * Monospace; preserves whitespace; no soft-fade at the edge.
 */
import { useArtifactText } from '../useArtifactText';
import styles from './TextNode.module.scss';

export interface TextStageProps {
  outputPath?: string;
  headlineField?: string; // ignored
}

export interface TextTileProps extends TextStageProps {
  itemId?: string;
  status?: string;
}

export function TextNodeStage({ outputPath }: TextStageProps) {
  const { text, status } = useArtifactText(outputPath);
  if (!outputPath) return <div className={styles.empty}>not yet generated</div>;
  if (status === 'loading' || status === 'idle') return <div className={styles.empty}>loading…</div>;
  if (status === 'missing' || text === null) return <div className={styles.empty}>file missing</div>;
  return (
    <pre className={styles.stage} data-testid="text-stage-body">
      {text}
    </pre>
  );
}

export function TextNodeTile({ outputPath, itemId, status = 'pending' }: TextTileProps) {
  const failed = status === 'failed';
  const invalidated = status === 'invalidated';
  return (
    <div
      className={`${styles.tile} ${failed ? styles.tileFailed : ''} ${invalidated ? styles.tileInvalidated : ''}`}
      data-testid="text-tile"
      data-status={status}
    >
      <div className={styles.tileLabel}>
        <span>{itemId ?? '—'}</span>
        <span className={`${styles.tileDot} ${styles[`dot-${status}`] ?? ''}`} />
      </div>
      {outputPath ? (
        <TextTileBody outputPath={outputPath} />
      ) : (
        <div className={styles.tileBodyMuted}>pending</div>
      )}
    </div>
  );
}

function TextTileBody({ outputPath }: { outputPath: string }) {
  const { text, status } = useArtifactText(outputPath);
  if (status === 'loading' || status === 'idle') return <div className={styles.tileBodyMuted}>loading…</div>;
  if (status === 'missing' || text === null) return <div className={styles.tileBodyMuted}>file missing</div>;
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return <div className={styles.tileBody}>{firstLine}</div>;
}
