/**
 * ShotSheetCard — DUMB render of one pre-resolved EntityCard. All grouping /
 * pairing / status was decided by buildProductionDoc; this just lays out the
 * header + each pair side-by-side (media left, the text that produced it
 * right). ReadableArtifact (the file read) only mounts when the sheet is open.
 */
import { useState } from 'react';
import type { EntityCard, ArtifactPair, ArtifactRef } from '../../lib/runCockpit/productionModel';
import { toFileUrl } from '../../utils/pathResolver';
import { ReadableArtifact } from './ReadableArtifact';
import styles from './ProductionView.module.scss';

interface Props {
  entity: EntityCard;
  projectDir: string;
  /** portrait entities (characters, locations) use a 3:4 frame so heads aren't cropped. */
  portrait?: boolean;
  defaultOpen?: boolean;
  onOpenEntry: (key: string) => void;
}

function mediaUrl(projectDir: string, outputPath: string, ts?: number): string {
  return `${toFileUrl(`${projectDir}/${outputPath}`)}?t=${ts ?? 0}`;
}

function MediaBlock({ media, projectDir, expectVideo, portrait }: { media?: ArtifactRef; projectDir: string; expectVideo: boolean; portrait?: boolean }) {
  const done = media?.status === 'completed' && !!media.outputPath;
  const running = media?.status === 'in_progress';
  // video is always 16:9; portrait flag only reshapes image frames.
  const cls = `${styles.pairMediaInner} ${portrait && media?.format !== 'video' ? styles.portraitMedia : ''}`;
  if (done && media?.outputPath) {
    return media.format === 'video' ? (
      <div className={styles.pairMediaInner}>
        <video
          className={styles.laneVideo}
          src={mediaUrl(projectDir, media.outputPath, media.ts)}
          muted loop playsInline preload="metadata"
          onMouseOver={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => undefined)}
          onMouseOut={(e) => (e.currentTarget as HTMLVideoElement).pause()}
        />
        <span className={styles.videoPin} />
      </div>
    ) : (
      <div className={cls}>
        <img className={styles.laneImg} src={mediaUrl(projectDir, media.outputPath, media.ts)} alt="" />
      </div>
    );
  }
  return (
    <div className={`${cls} ${styles.lanePlaceholder} ${running ? styles.laneLive : ''}`}>
      <span className={styles.phTag}>{running ? 'producing…' : expectVideo ? 'clip queued' : 'queued'}</span>
    </div>
  );
}

function PairRow({ pair, projectDir, portrait }: { pair: ArtifactPair; projectDir: string; portrait?: boolean }) {
  const { media, text } = pair;
  const textDone = text?.status === 'completed' && !!text.outputPath;
  const textRunning = text?.status === 'in_progress';
  return (
    <div className={`${styles.pairRow} ${text ? '' : styles.pairSolo}`}>
      <div className={styles.pairMedia}>
        <span className={styles.mediaTag}>{pair.mediaTag}</span>
        <MediaBlock media={media} projectDir={projectDir} expectVideo={pair.expectVideo} portrait={portrait} />
      </div>
      {text ? (
        <div className={styles.pairText}>
          <div className={styles.artifactLabel}>{text.stageLabel}</div>
          {textDone ? (
            <ReadableArtifact projectDir={projectDir} outputPath={text.outputPath ?? null} format={text.format} headlineField={text.headlineField} compact />
          ) : (
            <div className={styles.lanePending}>{textRunning ? 'Writing…' : 'Queued — not written yet.'}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ShotSheetCard({ entity, projectDir, portrait, defaultOpen, onOpenEntry }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);
  const statusCls = entity.status === 'running' ? styles.shotRunning : entity.status === 'done' ? styles.shotDone : styles.shotQueued;
  const refs = entity.pairs.flatMap((p) => [p.text, p.media]).filter(Boolean) as ArtifactRef[];

  return (
    <article className={`${styles.shotSheet} ${entity.status === 'running' ? styles.shotSheetRunning : ''} ${open ? styles.shotOpen : ''}`}>
      <button type="button" className={styles.sheetHead} onClick={() => setOpen((o) => !o)}>
        <span className={`${styles.sheetThumb} ${portrait ? styles.sheetThumbPortrait : ''}`}>
          {entity.thumb?.outputPath ? <img src={mediaUrl(projectDir, entity.thumb.outputPath, entity.thumb.ts)} alt="" /> : <span className={styles.sheetThumbPh} />}
        </span>
        <span className={styles.sheetId}>
          <span className={styles.sheetSlug}>{entity.label}</span>
          <span className={styles.sheetCount}>{entity.artifactCount} artifact{entity.artifactCount === 1 ? '' : 's'}</span>
        </span>
        <span className={styles.sheetRight}>
          <span className={`${styles.statusChip} ${statusCls}`}>
            <span className={styles.cd} />
            {entity.status === 'running' ? 'producing' : entity.status === 'done' ? 'complete' : 'queued'}
          </span>
          <span className={styles.chev} />
        </span>
      </button>
      {open ? (
        <div className={styles.sheetBody}>
          {entity.pairs.map((p, i) => (
            <PairRow key={p.text?.key ?? p.media?.key ?? i} pair={p} projectDir={projectDir} />
          ))}
          <div className={styles.sheetActions}>
            {refs.map((ref) => (
              <button key={ref.key} type="button" className={styles.act} onClick={() => onOpenEntry(ref.key)} title={`Open ${ref.stageLabel}`}>
                {ref.stageLabel}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default ShotSheetCard;
