/* eslint-disable import/prefer-default-export, react/no-array-index-key -- Named component convention; interval rows have no independent state. */
import { useEffect, useId, useMemo, useState } from 'react';
import styles from './ProductionEditingPanel.module.scss';

type Plan = Record<string, unknown> & {
  dialogueSha256: string;
  bedSha256: string;
  bedGain: number;
  duckGain?: number;
  fadeSec?: number;
  speech: Array<{ startSec: number; endSec: number }>;
};
type Fields = {
  level: string;
  duck: string;
  fade: string;
  speech: Array<{
    start: string;
    end: string;
    original?: Plan['speech'][number];
  }>;
};
function parse(content: string): Plan | undefined {
  try {
    const p = JSON.parse(content);
    if (
      p &&
      /^[a-f0-9]{64}$/.test(p.dialogueSha256) &&
      /^[a-f0-9]{64}$/.test(p.bedSha256) &&
      typeof p.bedGain === 'number' &&
      Number.isFinite(p.bedGain) &&
      (p.duckGain === undefined || typeof p.duckGain === 'number') &&
      (p.fadeSec === undefined || typeof p.fadeSec === 'number') &&
      Array.isArray(p.speech) &&
      p.speech.length <= 200 &&
      p.speech.every(
        (s: Plan['speech'][number]) =>
          s && typeof s.startSec === 'number' && typeof s.endSec === 'number',
      )
    )
      return p;
  } catch {
    /* Unrecognized documents remain in the raw material editor. */
  }
  return undefined;
}
function displayTime(value: number): string {
  return String(Number(value.toFixed(3)));
}
function timing(row: Fields['speech'][number], edge: 'start' | 'end'): number {
  const original = row.original?.[edge === 'start' ? 'startSec' : 'endSec'];
  return original !== undefined && row[edge] === displayTime(original)
    ? original
    : Number(row[edge]);
}
function fields(p?: Plan): Fields {
  return {
    level: String((p?.bedGain ?? 0.5) * 100),
    duck: String((p?.duckGain ?? 0.1) * 100),
    fade: String(p?.fadeSec ?? 0.15),
    speech:
      p?.speech.map((s) => ({
        start: displayTime(s.startSec),
        end: displayTime(s.endSec),
        original: s,
      })) ?? [],
  };
}
function problem(f: Fields): string | undefined {
  const number = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));
  if (
    ![
      f.level,
      f.duck,
      f.fade,
      ...f.speech.flatMap((s) => [s.start, s.end]),
    ].every(number)
  )
    return 'Complete each field with a valid number.';
  if (
    Number(f.level) < 0 ||
    Number(f.level) > 100 ||
    Number(f.duck) < 0 ||
    Number(f.duck) > 100
  )
    return 'Music levels must be between 0 and 100%.';
  if (Number(f.fade) < 0.01 || Number(f.fade) > 5)
    return 'Fade time must be between 0.01 and 5 seconds.';
  for (let i = 0; i < f.speech.length; i += 1) {
    const s = f.speech[i];
    if (
      timing(s, 'start') < 0 ||
      timing(s, 'end') <= timing(s, 'start') ||
      timing(s, 'end') > 300
    )
      return 'Each speech interval needs a start before its end, within 0–300 seconds.';
    if (i > 0 && timing(s, 'start') < timing(f.speech[i - 1], 'end'))
      return 'Speech intervals must be in timeline order and must not overlap.';
  }
  return undefined;
}
/** Local form only. Parent preview/save owns source versions, downstream impact and approval invalidation. */
export function SoundtrackEditor({
  content,
  onChange,
  onPendingChange,
}: {
  content: string;
  onChange: (content: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const id = useId();
  const plan = useMemo(() => parse(content), [content]);
  const [form, setForm] = useState(() => fields(plan));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setForm(fields(plan));
    setDirty(false);
    onPendingChange(false);
  }, [plan, onPendingChange]);
  const error = problem(form);
  if (!plan) return null;
  function edit(next: Fields) {
    setForm(next);
    setDirty(true);
    onPendingChange(true);
  }
  function apply() {
    if (!plan || error || !dirty) return;
    onChange(
      JSON.stringify(
        {
          ...plan,
          bedGain: Number(form.level) / 100,
          duckGain: Number(form.duck) / 100,
          fadeSec: Number(form.fade),
          speech: form.speech.map((s) => ({
            startSec: timing(s, 'start'),
            endSec: timing(s, 'end'),
          })),
        },
        null,
        2,
      ),
    );
    setDirty(false);
    onPendingChange(false);
  }
  return (
    <section className={styles.soundtrack} aria-label="Soundtrack settings">
      <div className={styles.soundtrackHeading}>
        <div>
          <h4>Soundtrack settings</h4>
          <p>Keep dialogue at its original level. Shape the music around it.</p>
        </div>
        <span className={styles.soundtrackBadge}>Original dialogue level</span>
      </div>
      <div className={styles.row}>
        <label htmlFor={`${id}-level`}>
          Music level (%)
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            id={`${id}-level`}
            aria-label="Music level (%)"
            value={form.level}
            onChange={(e) => edit({ ...form, level: e.target.value })}
          />
          <small>Level outside spoken intervals.</small>
        </label>
        <label htmlFor={`${id}-duck`}>
          Music during speech (%)
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            id={`${id}-duck`}
            aria-label="Music during speech (%)"
            value={form.duck}
            onChange={(e) => edit({ ...form, duck: e.target.value })}
          />
          <small>Percentage of the music level retained under speech.</small>
        </label>
        <label htmlFor={`${id}-fade`}>
          Fade time (seconds)
          <input
            type="number"
            min="0.01"
            max="5"
            step="0.01"
            id={`${id}-fade`}
            aria-label="Fade time (seconds)"
            value={form.fade}
            onChange={(e) => edit({ ...form, fade: e.target.value })}
          />
          <small>Fade at the ends and ease music around dialogue.</small>
        </label>
      </div>
      <h5>Spoken intervals</h5>
      <p>
        Use the dialogue timeline. These intervals lower the music; they do not
        move or cut speech. Times display to milliseconds; unchanged timings
        keep their original precision.
      </p>
      {form.speech.map((s, i) => (
        <div className={styles.speechInterval} key={i}>
          <span className={styles.intervalNumber}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <label htmlFor={`${id}-start-${i}`}>
            Start (seconds)
            <input
              id={`${id}-start-${i}`}
              aria-label={`Speech ${i + 1} start (seconds)`}
              type="number"
              min="0"
              max="300"
              step="0.01"
              value={s.start}
              onChange={(e) =>
                edit({
                  ...form,
                  speech: form.speech.map((v, j) =>
                    j === i ? { ...v, start: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label htmlFor={`${id}-end-${i}`}>
            End (seconds)
            <input
              id={`${id}-end-${i}`}
              aria-label={`Speech ${i + 1} end (seconds)`}
              type="number"
              min="0"
              max="300"
              step="0.01"
              value={s.end}
              onChange={(e) =>
                edit({
                  ...form,
                  speech: form.speech.map((v, j) =>
                    j === i ? { ...v, end: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            aria-label={`Remove speech interval ${i + 1}`}
            onClick={() =>
              edit({ ...form, speech: form.speech.filter((_, j) => i !== j) })
            }
          >
            Remove
          </button>
        </div>
      ))}
      {!form.speech.length && (
        <p>
          No spoken intervals. The mixer will refuse audible dialogue that is
          not covered.
        </p>
      )}
      <button
        type="button"
        disabled={form.speech.length >= 200}
        onClick={() =>
          edit({ ...form, speech: [...form.speech, { start: '', end: '' }] })
        }
      >
        Add speech interval
      </button>
      {error && <p role="alert">{error}</p>}
      <div className={styles.soundtrackActions}>
        <button type="button" disabled={!dirty || !!error} onClick={apply}>
          Apply settings to draft
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            setForm(fields(plan));
            setDirty(false);
            onPendingChange(false);
          }}
        >
          Discard settings changes
        </button>
      </div>
      <small>
        {dirty
          ? 'Apply or discard these settings before previewing the material change.'
          : 'Settings are part of the material draft. Preview and save below; the changed cut still needs review.'}
      </small>
      <details>
        <summary>Bound source recordings</summary>
        <p>
          Source hashes remain unchanged when editing these settings. Replacing
          a recording requires an updated, verified binding.
        </p>
        <dl>
          <dt>Dialogue SHA-256</dt>
          <dd>{plan.dialogueSha256}</dd>
          <dt>Music / effects SHA-256</dt>
          <dd>{plan.bedSha256}</dd>
        </dl>
      </details>
    </section>
  );
}
