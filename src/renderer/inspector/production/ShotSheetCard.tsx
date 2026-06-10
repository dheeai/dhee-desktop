/**
 * ShotSheetCard — one shot's permanent "sheet": every artifact for that shot
 * (image prompt, frame(s), motion directive, clip) stacked together, readable,
 * always available. Each entry is a labelled lane; text artifacts project to
 * readable prose (raw behind a toggle), media render in place. Absence is
 * graceful — a single-frame shot simply has no last-frame lanes; an
 * in-progress entry shows a "producing…" placeholder rather than nothing.
 */
import { useState } from 'react';
import type { ShotSheet, ShotEntry } from '../../lib/runCockpit/shotSheets';
import { toFileUrl } from '../../utils/pathResolver';
import { ReadableArtifact } from './ReadableArtifact';
import styles from './ProductionView.module.scss';

interface Props {
  sheet: ShotSheet;
  projectDir: string;
  defaultOpen?: boolean;
  onOpenEntry: (key: string) => void;
}

function mediaUrl(projectDir: string, outputPath: string, ts?: number): string {
  return `${toFileUrl(`${projectDir}/${outputPath}`)}?t=${ts ?? 0}`;
}

function laneNoun(e: ShotEntry): string {
  if (e.frameRole === 'last') return `${e.stageLabel} · last frame`;
  if (e.frameRole === 'first' && /frame|image|shot/i.test(e.stageLabel)) return `${e.stageLabel} · first frame`;
  return e.stageLabel;
}

function MediaLane({ entry, projectDir }: { entry: ShotEntry; projectDir: string }) {
  const done = entry.status === 'completed' && !!entry.outputPath;
  const running = entry.status === 'in_progress';
  return (
    <div className={styles.lane}>
      <div className={styles.laneRail}>{laneNoun(entry)}</div>
      <div className={styles.laneBody}>
        {done && entry.outputPath ? (
          entry.format === 'video' ? (
            <div className={styles.laneMedia}>
              <video
                className={styles.laneVideo}
                src={mediaUrl(projectDir, entry.outputPath, entry.ts)}
                muted
                loop
                playsInline
                preload="metadata"
                onMouseOver={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => undefined)}
                onMouseOut={(e) => (e.currentTarget as HTMLVideoElement).pause()}
              />
              <span className={styles.videoPin} />
            </div>
          ) : (
            <div className={styles.laneMedia}>
              <img className={styles.laneImg} src={mediaUrl(projectDir, entry.outputPath, entry.ts)} alt={laneNoun(entry)} />
            </div>
          )
        ) : (
          <div className={`${styles.laneMedia} ${styles.lanePlaceholder} ${running ? styles.laneLive : ''}`}>
            <span className={styles.phTag}>{running ? 'producing…' : 'queued'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TextLane({ entry, projectDir }: { entry: ShotEntry; projectDir: string }) {
  const done = entry.status === 'completed' && !!entry.outputPath;
  const running = entry.status === 'in_progress';
  return (
    <div className={styles.lane}>
      <div className={styles.laneRail}>{laneNoun(entry)}</div>
      <div className={styles.laneBody}>
        {done ? (
          <ReadableArtifact
            projectDir={projectDir}
            outputPath={entry.outputPath ?? null}
            format={entry.format}
            headlineField={entry.headlineField}
            compact
          />
        ) : (
          <div className={styles.lanePending}>{running ? 'Writing…' : 'Queued — not written yet.'}</div>
        )}
      </div>
    </div>
  );
}

export function ShotSheetCard({ sheet, projectDir, defaultOpen, onOpenEntry }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);
  const firstFrame = sheet.entries.find((e) => e.format === 'image' && e.status === 'completed' && e.outputPath);
  const statusCls = sheet.status === 'running' ? styles.shotRunning : sheet.status === 'done' ? styles.shotDone : styles.shotQueued;

  return (
    <article className={`${styles.shotSheet} ${sheet.status === 'running' ? styles.shotSheetRunning : ''} ${open ? styles.shotOpen : ''}`}>
      <button type="button" className={styles.sheetHead} onClick={() => setOpen((o) => !o)}>
        <span className={styles.sheetThumb}>
          {firstFrame?.outputPath ? (
            <img src={mediaUrl(projectDir, firstFrame.outputPath, firstFrame.ts)} alt="" />
          ) : (
            <span className={styles.sheetThumbPh} />
          )}
        </span>
        <span className={styles.sheetId}>
          <span className={styles.sheetSlug}>{sheet.label}</span>
          <span className={styles.sheetCount}>{sheet.entries.length} artifact{sheet.entries.length === 1 ? '' : 's'}</span>
        </span>
        <span className={styles.sheetRight}>
          <span className={`${styles.statusChip} ${statusCls}`}>
            <span className={styles.cd} />
            {sheet.status === 'running' ? 'producing' : sheet.status === 'done' ? 'complete' : 'queued'}
          </span>
          <span className={styles.chev} />
        </span>
      </button>
      {open ? (
        <div className={styles.sheetBody}>
          {sheet.entries.map((e) =>
            e.isText ? (
              <TextLane key={e.key} entry={e} projectDir={projectDir} />
            ) : (
              <MediaLane key={e.key} entry={e} projectDir={projectDir} />
            ),
          )}
          <div className={styles.sheetActions}>
            {sheet.entries.map((e) => (
              <button key={e.key} type="button" className={styles.act} onClick={() => onOpenEntry(e.key)} title={`Open ${e.stageLabel}`}>
                {e.stageLabel}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default ShotSheetCard;
