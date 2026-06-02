/**
 * ImageNode — renders image artifacts via file:// URL.
 *
 * Stage: hero image. Tile: thumbnail with itemId caption + status
 * overlays (failed border, invalidated stripes).
 */
import { useArtifactUrl } from '../useArtifactText';
import styles from './ImageNode.module.scss';

export interface ImageStageProps {
  outputPath?: string;
  headlineField?: string; // ignored
}

export interface ImageTileProps extends ImageStageProps {
  itemId?: string;
  status?: string;
}

export function ImageNodeStage({ outputPath }: ImageStageProps) {
  const url = useArtifactUrl(outputPath);
  if (!outputPath || !url) {
    return <div className={styles.empty}>not yet generated</div>;
  }
  return (
    <div className={styles.stage}>
      <img src={url} alt="artifact" className={styles.stageImage} />
    </div>
  );
}

export function ImageNodeTile({ outputPath, itemId, status = 'pending' }: ImageTileProps) {
  const url = useArtifactUrl(outputPath);
  const failed = status === 'failed';
  const invalidated = status === 'invalidated';
  return (
    <div
      className={`${styles.tile} ${failed ? styles.tileFailed : ''} ${invalidated ? styles.tileInvalidated : ''}`}
      data-testid="image-tile"
      data-status={status}
    >
      <div className={styles.tileThumb}>
        {url ? (
          <img src={url} alt={itemId ?? 'artifact'} className={styles.tileImage} />
        ) : (
          <div className={styles.tileEmpty}>pending</div>
        )}
      </div>
      <div className={styles.tileLabel}>
        <span>{itemId ?? '—'}</span>
        <span className={`${styles.tileDot} ${styles[`dot-${status}`] ?? ''}`} />
      </div>
    </div>
  );
}
