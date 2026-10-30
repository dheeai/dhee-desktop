import { useEffect, useRef, useState } from 'react';
import type {
  QueueJobSummary,
  QueueJobsRequest,
} from '../../../shared/gpuQueue';
import styles from './ProductionReviewPanel.module.scss';

export function GpuJobsPanel({ projectDir }: { projectDir: string }) {
  const [jobs, setJobs] = useState<QueueJobSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  async function invoke(action: QueueJobsRequest['action'], id?: string) {
    generation.current += 1;
    const request = generation.current;
    setBusy(true);
    setError('');
    try {
      if (!window.dhee.queueJobs)
        throw new Error('This Desktop build does not support saved GPU jobs.');
      const result = await window.dhee.queueJobs({ projectDir, action, id });
      if (generation.current !== request) return;
      if (result.ok) setJobs(result.jobs);
      else setError(result.error);
    } catch (failure) {
      if (generation.current === request)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  useEffect(() => {
    setJobs([]);
    invoke('list');
    return () => {
      generation.current += 1;
    };
    // The project identity owns this request; actions refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir]);
  return (
    <details className={styles.root}>
      <summary>GPU queue · {jobs.length} saved jobs</summary>
      <p>
        Job status is checked on request. Completed remote outputs are retained
        by the gateway for 14 days; save them into this project.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            invoke('list');
          }}
        >
          Reload saved jobs
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!jobs.length && <p>No saved GPU jobs in this project yet.</p>}
      {jobs.map((job) => {
        const active =
          !job.state ||
          ['queued', 'dispatching', 'running'].includes(job.state);
        return (
          <div className={styles.decision} key={job.id}>
            <h3>{job.workflow}</h3>
            <p>
              {job.phase === 'downloaded'
                ? 'Saved locally'
                : job.state || job.phase}
              {job.jobId ? ` · ${job.jobId}` : ''}
            </p>
            {job.cancelRequested && active && (
              <p>
                Cancellation requested — refresh to confirm the remote job
                stopped.
              </p>
            )}
            {(job.phase === 'unknown' || job.phase === 'submitting') && (
              <p>
                Submission outcome is unknown. Check gateway history before
                starting a new attempt to avoid a duplicate render.
              </p>
            )}
            {job.error && <p>{job.error}</p>}
            {job.files && (
              <p>{job.files.length} outputs saved with checksums.</p>
            )}
            <div className={styles.actions}>
              {job.jobId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    invoke('refresh', job.id);
                  }}
                >
                  Refresh status
                </button>
              )}
              {job.jobId && active && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    invoke('cancel', job.id);
                  }}
                >
                  {job.cancelRequested ? 'Retry cancellation' : 'Cancel job'}
                </button>
              )}
              {job.state === 'done' && job.phase !== 'downloaded' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    invoke('download', job.id);
                  }}
                >
                  Save outputs locally
                </button>
              )}
            </div>
          </div>
        );
      })}
    </details>
  );
}
export default GpuJobsPanel;
