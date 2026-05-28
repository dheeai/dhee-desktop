/**
 * AudioNode — renders audio artifacts via file:// stream.
 *
 * Stage: <audio> with browser controls (full transport).
 * Tile:  small play affordance + itemId caption.
 *
 * The real waveform renderer (mockup-style bar chart) is deferred —
 * needs either a pre-rendered peaks JSON sidecar or a runtime
 * decoder.
 */
import { useArtifactUrl } from '../useArtifactText';
import styles from './AudioNode.module.scss';

export interface AudioStageProps {
  outputPath?: string;
  headlineField?: string; // ignored
}

export interface AudioTileProps extends AudioStageProps {
  itemId?: string;
  status?: string;
}

export function AudioNodeStage({ outputPath }: AudioStageProps) {
  const url = useArtifactUrl(outputPath);
  if (!outputPath || !url) {
    return <div className={styles.empty}>not yet generated</div>;
  }
  return (
    <div className={styles.stage}>
      <audio controls preload="metadata" className={styles.stageAudio}>
        <source src={url} type="audio/mpeg" />
      </audio>
    </div>
  );
}

export function AudioNodeTile({ outputPath, itemId, status = 'pending' }: AudioTileProps) {
  const url = useArtifactUrl(outputPath);
  const failed = status === 'failed';
  const invalidated = status === 'invalidated';
  return (
    <div
      className={`${styles.tile} ${failed ? styles.tileFailed : ''} ${invalidated ? styles.tileInvalidated : ''}`}
      data-testid="audio-tile"
      data-status={status}
    >
      {url ? (
        <button type="button" className={styles.tilePlay} data-testid="audio-tile-play">
          <svg viewBox="0 0 12 12" fill="currentColor" width="9" height="9">
            <path d="M3 2l7 4-7 4V2z" />
          </svg>
        </button>
      ) : (
        <div className={styles.tileEmpty}>pending</div>
      )}
      <div className={styles.tileLabel}>
        <span>{itemId ?? '—'}</span>
        <span className={`${styles.tileDot} ${styles[`dot-${status}`] ?? ''}`} />
      </div>
    </div>
  );
}
