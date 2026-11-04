/* eslint-disable jsx-a11y/media-has-caption -- These are source voice auditions; no transcript is inferred. */
import { useEffect, useRef, useState } from 'react';
import type { EditResult } from '../../../shared/productionEditing';
import { toFileUrl } from '../../utils/pathResolver';
import styles from './ProductionEditingPanel.module.scss';

function Take({
  title,
  label,
  take,
  onPlay,
}: {
  title: string;
  label: string;
  take: EditResult;
  onPlay: (audio: HTMLAudioElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.voiceTake}>
      <h5>{title}</h5>
      <p>{take.absolutePath?.split(/[\\/]/).pop()}</p>
      <audio
        controls
        preload="metadata"
        aria-label={label}
        src={`${toFileUrl(take.absolutePath ?? '')}?v=${take.sha256 ?? ''}`}
        onPlay={(event) => onPlay(event.currentTarget)}
        onError={() => setFailed(true)}
      />
      {failed ? (
        <p role="alert">
          Could not load {title}. Reinspect the file before using it.
        </p>
      ) : null}
      <details>
        <summary>File identity</summary>
        {take.versionId ? <p>Version: {take.versionId}</p> : null}
        <p>SHA-256: {take.sha256 ?? 'Unavailable'}</p>
      </details>
    </div>
  );
}

export function VoiceTakeComparison({
  current,
  candidate,
  saved,
}: {
  current: EditResult | undefined;
  candidate: EditResult | undefined;
  saved: EditResult | undefined;
}) {
  const active = useRef<HTMLAudioElement | null>(null);
  const identity = [current, candidate, saved]
    .map((take) => `${take?.absolutePath ?? ''}:${take?.sha256 ?? ''}`)
    .join('|');
  useEffect(
    () => () => {
      active.current?.pause();
      active.current = null;
    },
    [identity],
  );
  const play = (audio: HTMLAudioElement) => {
    if (active.current && active.current !== audio) active.current.pause();
    active.current = audio;
  };
  const takes = [
    {
      kind: 'current',
      take: current,
      title: 'Current voice',
      label: candidate?.absolutePath
        ? 'Current voice preview'
        : 'Reference preview',
    },
    {
      kind: 'candidate',
      take: candidate,
      title: 'Replacement candidate · not saved',
      label: 'Reference preview',
    },
    {
      kind: 'saved',
      take: saved,
      title: 'Saved voice take',
      label: 'Saved version preview',
    },
  ];
  if (!takes.some(({ take }) => take?.absolutePath)) return null;
  return (
    <section
      className={styles.voiceComparison}
      aria-label="Compare voice takes"
    >
      <h4>Compare voice takes</h4>
      <p>
        Listen to one take at a time. Playback does not select or approve a
        voice. Use the change or restore preview below before saving.
      </p>
      <div className={styles.voiceTakes}>
        {takes.flatMap(({ kind, take, title, label }) =>
          take?.absolutePath
            ? [
                <Take
                  key={`${kind}:${take.absolutePath}:${take.sha256 ?? ''}`}
                  title={title}
                  label={label}
                  take={take}
                  onPlay={play}
                />,
              ]
            : [],
        )}
      </div>
    </section>
  );
}
export default VoiceTakeComparison;
