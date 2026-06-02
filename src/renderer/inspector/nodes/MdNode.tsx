/**
 * MdNode — renders markdown artifacts (plot, story, world_style, etc.).
 *
 * v1 renders as styled plain text. At the Inspector Canvas's default
 * zoom level, rich markdown rendering (react-markdown) is overkill —
 * the cards are small and the reader scans the prose at a glance.
 * Future: optional rich rendering at full zoom.
 */
import { useArtifactText } from '../useArtifactText';
import styles from './MdNode.module.scss';

export interface MdStageProps {
  outputPath?: string;
  headlineField?: string; // ignored — md doesn't need it
}

export interface MdTileProps extends MdStageProps {
  itemId?: string;
  status?: string;
}

export function MdNodeStage({ outputPath }: MdStageProps) {
  const { text, status } = useArtifactText(outputPath);
  if (!outputPath) return <div className={styles.empty}>not yet generated</div>;
  if (status === 'loading' || status === 'idle') return <div className={styles.empty}>loading…</div>;
  if (status === 'missing' || text === null) return <div className={styles.empty}>file missing</div>;
  return (
    <div className={styles.stage} data-testid="md-stage-body">
      {text}
    </div>
  );
}

export function MdNodeTile({ outputPath, itemId, status = 'pending' }: MdTileProps) {
  const failed = status === 'failed';
  const invalidated = status === 'invalidated';
  return (
    <div
      className={`${styles.tile} ${failed ? styles.tileFailed : ''} ${invalidated ? styles.tileInvalidated : ''}`}
      data-testid="md-tile"
      data-status={status}
    >
      <div className={styles.tileLabel}>
        <span>{itemId ?? '—'}</span>
        <span className={`${styles.tileDot} ${styles[`dot-${status}`] ?? ''}`} />
      </div>
      {outputPath ? (
        <MdTileBody outputPath={outputPath} />
      ) : (
        <div className={styles.tileBodyMuted}>pending</div>
      )}
    </div>
  );
}

function MdTileBody({ outputPath }: { outputPath: string }) {
  const { text, status } = useArtifactText(outputPath);
  if (status === 'loading' || status === 'idle') {
    return <div className={styles.tileBodyMuted}>loading…</div>;
  }
  if (status === 'missing' || text === null) {
    return <div className={styles.tileBodyMuted}>file missing</div>;
  }
  // First paragraph: text up to the first double-newline (or all of it).
  const head = text.split(/\n\s*\n/)[0]?.trim() ?? '';
  return <div className={styles.tileBody}>{head}</div>;
}
