import { useEffect, useRef, useState } from 'react';
import type { GpuTarget } from '../../../shared/gpuQueue';
import type { MediaCheckReport } from '../../../shared/mediaChecks';
import styles from './GpuPreparationPanel.module.scss';
import { MediaMeasurements } from './MediaMeasurements';

export function MediaChecksPanel({ projectDir }: { projectDir: string }) {
  const [branch, setBranch] = useState('main');
  const [branches, setBranches] = useState<string[]>(['main']);
  const [targets, setTargets] = useState<GpuTarget[]>([]);
  const [choice, setChoice] = useState('');
  const [audio, setAudio] = useState(false);
  const [duration, setDuration] = useState('');
  const [report, setReport] = useState<MediaCheckReport>();
  const [savedState, setSavedState] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  function invalidate() {
    epoch.current += 1;
    setReport(undefined);
    setSavedState('');
    setError('');
    setBusy(false);
  }
  useEffect(() => {
    epoch.current += 1;
    let cancelled = false;
    setReport(undefined);
    setSavedState('');
    setTargets([]);
    setChoice('');
    setError('');
    setBusy(false);
    window.dhee
      .gpuPreparation({ action: 'gpu.targets', projectDir, branchId: branch })
      .then((response) => {
        if (cancelled) return undefined;
        if (!response.ok) {
          setError(response.error);
          return undefined;
        }
        setTargets(
          (response.result.targets ?? []).filter(
            (t) =>
              ['video', 'audio'].includes(t.format) && t.status === 'completed',
          ),
        );
        setBranches(
          (response.result.branches ?? [{ branchId: 'main' }]).map(
            (b) => b.branchId,
          ),
        );
        return undefined;
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
      epoch.current += 1;
    };
  }, [projectDir, branch, revision]);
  useEffect(() => {
    const changed = (event: Event) => {
      if (
        (event as CustomEvent<{ projectDir: string }>).detail?.projectDir ===
        projectDir
      ) {
        invalidate();
        setRevision((v) => v + 1);
      }
    };
    window.addEventListener('dhee:production-changed', changed);
    return () => window.removeEventListener('dhee:production-changed', changed);
  }, [projectDir]);
  const target = choice === '' ? undefined : targets[Number(choice)];
  const validDuration =
    duration === '' ||
    (Number.isFinite(Number(duration)) &&
      Number(duration) > 0 &&
      Number(duration) <= 86400);
  async function check(saved = false) {
    if (!target || !validDuration) return;
    epoch.current += 1;
    const id = epoch.current;
    setBusy(true);
    setError('');
    setReport(undefined);
    setSavedState('');
    try {
      const response = await window.dhee.mediaCheck({
        action: saved ? 'media.read' : 'media.check',
        projectDir,
        branchId: branch,
        nodeId: target.nodeId,
        itemId: target.itemId,
        expectedAudio: audio || target.format === 'audio',
        ...(duration === '' ? {} : { expectedDurationSec: Number(duration) }),
      });
      if (id !== epoch.current) return;
      if (response.ok) {
        if ('status' in response.result) {
          const result = response.result;
          setSavedState(
            result.status === 'current'
              ? 'Saved result matches the selected file.'
              : result.status === 'stale'
                ? `Saved result is stale. ${result.reason ?? 'Run checks again.'}`
                : 'No saved result for this target.',
          );
          setReport(result.report);
        } else {
          setReport(response.result);
          setSavedState('Result saved for this media version.');
        }
      } else setError(response.error);
    } catch (reason) {
      if (id === epoch.current) setError(String(reason));
    } finally {
      if (id === epoch.current) setBusy(false);
    }
  }
  return (
    <details className={styles.root} open>
      <summary>Check scene and voice media</summary>
      <p>
        Inspect the selected completed take before assembly. This is a
        point-in-time technical check, not creative approval or final export
        approval. Recheck after changing media.
      </p>
      <label htmlFor="media-check-branch">
        Media branch
        <select
          id="media-check-branch"
          value={branch}
          onChange={(e) => {
            invalidate();
            setBranch(e.target.value);
          }}
        >
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          invalidate();
          setRevision((v) => v + 1);
        }}
      >
        Reload media
      </button>
      <fieldset disabled={busy}>
        <label htmlFor="media-check-target">
          Media to check
          <select
            id="media-check-target"
            value={choice}
            onChange={(e) => {
              invalidate();
              setChoice(e.target.value);
            }}
          >
            <option value="">Choose completed media</option>
            {targets.map((t, i) => (
              <option key={`${t.nodeId}:${t.itemId ?? ''}`} value={i}>
                {t.nodeId}
                {t.itemId ? ` · ${t.itemId}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="media-check-audio">
          <input
            id="media-check-audio"
            type="checkbox"
            checked={audio || target?.format === 'audio'}
            disabled={target?.format === 'audio'}
            onChange={(e) => {
              invalidate();
              setAudio(e.target.checked);
            }}
          />
          Expect audio
        </label>
        <label htmlFor="media-check-duration">
          Expected duration in seconds (optional)
          <input
            id="media-check-duration"
            type="number"
            min="0.001"
            max="86400"
            step="any"
            value={duration}
            onChange={(e) => {
              invalidate();
              setDuration(e.target.value);
            }}
          />
        </label>
        {!validDuration && (
          <p>Enter a positive duration up to 86400 seconds.</p>
        )}
        <button
          type="button"
          disabled={!target || !validDuration}
          onClick={() => check()}
        >
          Check selected media
        </button>
        <button
          type="button"
          disabled={!target || !validDuration}
          onClick={() => check(true)}
        >
          Load saved result
        </button>
      </fieldset>
      <p>
        Up to 2 GiB. Each analysis step has a 60-second limit. Audio
        measurements cover the first audio track; silence and high peaks need
        review.
      </p>
      {busy && <p role="status">Checking media…</p>}
      {error && <p role="alert">{error}</p>}
      {savedState && <p role="status">{savedState}</p>}
      {report && (
        <section aria-label="Media check results">
          <p>
            <strong>
              {savedState.startsWith('Saved result is stale.')
                ? 'Previous technical result'
                : 'Technical result'}
              : {report.technicalStatus}
            </strong>
          </p>
          <ul>
            {report.checks.map((c) => (
              <li key={c.code}>
                <strong>{c.status}: </strong>
                <span>{c.message}</span>
              </li>
            ))}
          </ul>
          <MediaMeasurements media={report.media} />
          <p>Creative review still required</p>
          <ul>
            {report.manualChecks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <details>
            <summary>Checked file identity</summary>
            <p>
              {report.checkedAt} · version {report.source.versionId}
            </p>
            <p>{report.source.outputPath}</p>
            <p style={{ overflowWrap: 'anywhere' }}>
              SHA-256: {report.source.sha256}
            </p>
          </details>
        </section>
      )}
    </details>
  );
}
export default MediaChecksPanel;
