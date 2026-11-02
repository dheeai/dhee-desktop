import { useEffect, useId, useRef, useState } from 'react';
import type { QueueRecoveryPreview } from '../../../shared/gpuQueue';
import styles from './ProductionReviewPanel.module.scss';

export function GpuRecoveryForm({
  projectDir,
  id,
  disabled,
  onLinked,
}: {
  projectDir: string;
  id: string;
  disabled: boolean;
  onLinked: () => void;
}) {
  const fieldId = useId();
  const [jobId, setJobId] = useState('');
  const [preview, setPreview] = useState<QueueRecoveryPreview>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current += 1;
    },
    [],
  );
  async function act(link: boolean) {
    const token = revision.current;
    if (link && (!preview || !acknowledged)) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.dhee.queueJobs({
        projectDir,
        id,
        jobId: jobId.trim(),
        action: link ? 'link-existing' : 'inspect-recovery',
        ...(link
          ? {
              expectedFingerprint: preview!.fingerprint,
              humanAcknowledged: true as const,
            }
          : {}),
      });
      if (revision.current !== token) return;
      if (!result.ok) throw new Error(result.error);
      if (link) {
        setPreview(undefined);
        setAcknowledged(false);
        onLinked();
      } else {
        if (!result.recovery)
          throw new Error('No recovery evidence was returned.');
        setPreview(result.recovery);
        setAcknowledged(false);
      }
    } catch (failure) {
      if (revision.current === token) {
        setError(failure instanceof Error ? failure.message : String(failure));
        setPreview(undefined);
        setAcknowledged(false);
      }
    } finally {
      if (revision.current === token) setBusy(false);
    }
  }
  return (
    <fieldset className={styles.recovery} disabled={disabled || busy}>
      <p>
        Saved attempt: {id.slice(0, 12)}. Find the existing job in your gateway
        history. Linking does not start another render.
      </p>
      <label htmlFor={fieldId}>
        Existing gateway job ID
        <input
          id={fieldId}
          value={jobId}
          onChange={(event) => {
            setJobId(event.target.value);
            setPreview(undefined);
            setAcknowledged(false);
            setError('');
          }}
        />
      </label>
      <button type="button" disabled={!jobId.trim()} onClick={() => act(false)}>
        Inspect existing job
      </button>
      {preview && (
        <>
          <p>
            Gateway job: {preview.job.jobId} · {preview.job.state}
          </p>
          <p>
            Saved workflow: {preview.local.workflow} · {preview.local.version} ·{' '}
            {preview.local.createdAt}
          </p>
          <p>
            {preview.evidence === 'matched'
              ? 'Reported workflow and inputs match. Verify that this is the original submission, not a different render with identical inputs.'
              : 'The gateway did not return complete workflow and input evidence. Dhee cannot prove this is the same submission. Verify it in gateway history before linking.'}
          </p>
          <details>
            <summary>Compare saved and reported inputs</summary>
            <p>Saved inputs</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(preview.local.inputs, null, 2)}
            </pre>
            <p>Gateway workflow: {preview.job.workflow ?? 'Not reported'}</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {preview.job.inputs === undefined
                ? 'Inputs not reported'
                : JSON.stringify(preview.job.inputs, null, 2)}
            </pre>
          </details>
          <label htmlFor={`${fieldId}-ack`}>
            <input
              id={`${fieldId}-ack`}
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I verified this job is the same submission as this saved attempt.
          </label>
          <button
            type="button"
            disabled={!acknowledged}
            onClick={() => act(true)}
          >
            Link existing job
          </button>
          <p>
            After linking, resume the original saved scene attempt to finish it.
            Creative approvals still apply.
          </p>
        </>
      )}
      {busy && <p role="status">Checking saved job…</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
export default GpuRecoveryForm;
