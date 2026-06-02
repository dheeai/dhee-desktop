/**
 * VideoNode — renders video artifacts via file:// stream.
 *
 * Stage: <video> with controls. Tile: poster (1st-frame preload) +
 * play overlay; user can click to play inline.
 *
 * The `final_video` deep-link to the Timeline tab is Phase 4 — not
 * handled here.
 */
import { useArtifactUrl } from '../useArtifactText';
import styles from './VideoNode.module.scss';

export interface VideoStageProps {
  outputPath?: string;
  headlineField?: string; // ignored
}

export interface VideoTileProps extends VideoStageProps {
  itemId?: string;
  status?: string;
}

export function VideoNodeStage({ outputPath }: VideoStageProps) {
  const url = useArtifactUrl(outputPath);
  if (!outputPath || !url) {
    return <div className={styles.empty}>not yet generated</div>;
  }
  return (
    <div className={styles.stage}>
      {/* preload="metadata" makes the first frame appear without
          forcing a full byte download. */}
      <video controls preload="metadata" className={styles.stageVideo}>
        <source src={url} type="video/mp4" />
      </video>
    </div>
  );
}

export function VideoNodeTile({ outputPath, itemId, status = 'pending' }: VideoTileProps) {
  const url = useArtifactUrl(outputPath);
  const failed = status === 'failed';
  const invalidated = status === 'invalidated';
  return (
    <div
      className={`${styles.tile} ${failed ? styles.tileFailed : ''} ${invalidated ? styles.tileInvalidated : ''}`}
      data-testid="video-tile"
      data-status={status}
    >
      <div className={styles.tileThumb}>
        {url ? (
          <>
            {/* Show poster frame via video element with metadata preload */}
            <video preload="metadata" muted playsInline className={styles.tileVideo}>
              <source src={`${url}#t=0.1`} type="video/mp4" />
            </video>
            <div className={styles.tilePlay} data-testid="video-tile-play">
              <svg viewBox="0 0 12 12" fill="currentColor" width="9" height="9">
                <path d="M3 2l7 4-7 4V2z" />
              </svg>
            </div>
          </>
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
