import { useEffect, useRef, useState } from 'react';
import type {
  QueueJobSummary,
  QueueJobsRequest,
} from '../../../shared/gpuQueue';
import styles from './ProductionReviewPanel.module.scss';
import { GpuRecoveryForm } from './GpuRecoveryForm';
import GpuSavedOutput from './GpuSavedOutput';

type JobView = 'all' | 'progress' | 'attention' | 'ready' | 'saved';
const jobViews: Array<{ id: JobView; label: string }> = [
  { id: 'all', label: 'All jobs' },
  { id: 'progress', label: 'In progress' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'ready', label: 'Ready to save' },
  { id: 'saved', label: 'Saved locally' },
];
function jobView(job: QueueJobSummary): JobView {
  if (job.phase === 'downloaded') return 'saved';
  if (job.phase === 'unknown' || job.phase === 'submitting') return 'attention';
  if (job.state === 'done') return 'ready';
  if (
    !job.error &&
    ['queued', 'dispatching', 'running'].includes(job.state ?? '')
  )
    return 'progress';
  return 'attention';
}

export function GpuJobsPanel({ projectDir }: { projectDir: string }) {
  const [jobs, setJobs] = useState<QueueJobSummary[]>([]);
  const [view, setView] = useState<JobView>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activity, setActivity] = useState('');
  const [message, setMessage] = useState('');
  const batchRunning = useRef(false);
  const generation = useRef(0);
  async function invoke(action: QueueJobsRequest['action'], id?: string) {
    // A recovery reload or single-job action supersedes any pending batch.
    batchRunning.current = false;
    generation.current += 1;
    const request = generation.current;
    setBusy(true);
    setActivity(
      action === 'download'
        ? 'Saving RTX outputs to this project…'
        : action === 'cancel'
          ? 'Requesting cancellation on the RTX queue…'
          : action === 'refresh'
            ? 'Checking RTX job status…'
            : 'Loading saved RTX jobs…',
    );
    setError('');
    setMessage('');
    try {
      if (!window.dhee.queueJobs)
        throw new Error('This Desktop build does not support saved GPU jobs.');
      const result = await window.dhee.queueJobs({ projectDir, action, id });
      if (generation.current !== request) return;
      if (result.ok) {
        setJobs(result.jobs);
        setLoaded(true);
      } else setError(result.error);
    } catch (failure) {
      if (generation.current === request)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  const remoteJobs = jobs.filter(
    (job) => job.jobId && job.phase !== 'downloaded',
  );
  const readyToSave = jobs.filter(
    (job) => job.state === 'done' && job.phase !== 'downloaded',
  ).length;
  async function checkAll() {
    if (busy || batchRunning.current || !remoteJobs.length) return;
    batchRunning.current = true;
    generation.current += 1;
    const request = generation.current;
    setBusy(true);
    setError('');
    setMessage('');
    const failures: string[] = [];
    let checked = 0;
    try {
      for (let index = 0; index < remoteJobs.length; index += 1) {
        const job = remoteJobs[index];
        if (generation.current !== request) return;
        setActivity(
          `Checking RTX job ${checked + failures.length + 1} of ${remoteJobs.length}: ${job.workflow}…`,
        );
        try {
          if (!window.dhee.queueJobs)
            throw new Error(
              'This Desktop build does not support saved GPU jobs.',
            );
          // Sequential checks avoid flooding the gateway and preserve each returned job snapshot.
          // eslint-disable-next-line no-await-in-loop
          const result = await window.dhee.queueJobs({
            projectDir,
            action: 'refresh',
            id: job.id,
          });
          if (generation.current !== request) return;
          if (!result.ok) throw new Error(result.error);
          setJobs(result.jobs);
          setLoaded(true);
          checked += 1;
        } catch (failure) {
          if (generation.current !== request) return;
          failures.push(
            `${job.workflow} (${job.jobId}): ${failure instanceof Error ? failure.message : String(failure)}`,
          );
        }
      }
      setMessage(
        `Checked ${checked} of ${remoteJobs.length} remote jobs. No renders were submitted.`,
      );
      setError(failures.join('\n'));
    } finally {
      if (generation.current === request) {
        batchRunning.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    batchRunning.current = false;
    setJobs([]);
    setView('all');
    setLoaded(false);
    invoke('list');
    return () => {
      generation.current += 1;
    };
    // The project identity owns this request; actions refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir]);
  return (
    <details className={styles.root}>
      <summary>
        RTX 5090 queue ·{' '}
        {loaded
          ? `${jobs.length} saved jobs`
          : busy
            ? 'loading…'
            : 'unavailable'}
      </summary>
      <p>
        Reload reads saved local records. Check remote jobs asks the RTX gateway
        for current status. Completed remote outputs are retained by the gateway
        for 14 days; save them into this project.
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
        {jobs.length > 0 && (
          <button
            type="button"
            disabled={busy || !remoteJobs.length}
            onClick={checkAll}
          >
            Check all remote jobs
          </button>
        )}
      </div>
      {readyToSave > 0 && (
        <p>
          {readyToSave} completed {readyToSave === 1 ? 'job' : 'jobs'} ready to
          save.
        </p>
      )}
      {!busy && message && <p role="status">{message}</p>}
      {busy && <p role="status">{activity}</p>}
      {error && <p role="alert">{error}</p>}
      {error && loaded && (
        <p>
          Some job statuses may be outdated. Retry the affected jobs to update
          them.
        </p>
      )}
      {loaded && !busy && !error && !jobs.length && (
        <p>No saved GPU jobs in this project yet.</p>
      )}
      {loaded && jobs.length > 0 && (
        <>
          <div
            className={styles.queueFilters}
            role="group"
            aria-label="Filter RTX jobs"
          >
            {jobViews.map((option) => {
              const count =
                option.id === 'all'
                  ? jobs.length
                  : jobs.filter((job) => jobView(job) === option.id).length;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  onClick={() => setView(option.id)}
                >
                  {option.label} ({count})
                </button>
              );
            })}
          </div>
          {view !== 'all' && !jobs.some((job) => jobView(job) === view) && (
            <p>No jobs match this view.</p>
          )}
        </>
      )}
      {jobs.map((job) => {
        const active =
          job.phase !== 'downloaded' &&
          (!job.state ||
            ['queued', 'dispatching', 'running'].includes(job.state));
        return (
          <div
            className={styles.decision}
            key={job.id}
            hidden={view !== 'all' && jobView(job) !== view}
          >
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
            {!job.jobId && ['unknown', 'submitting'].includes(job.phase) && (
              <GpuRecoveryForm
                key={`${projectDir}:${job.id}`}
                projectDir={projectDir}
                id={job.id}
                disabled={busy}
                onLinked={() => invoke('list')}
              />
            )}
            {job.error && (
              <div className={styles.queueError}>
                <p>
                  This job reported an error. Review the details before starting
                  another attempt.
                </p>
                <details>
                  <summary>View job error</summary>
                  <pre>{job.error}</pre>
                </details>
              </div>
            )}
            {job.files && job.files.length > 0 && (
              <>
                <p>
                  Downloaded outputs still need review before assembly or
                  approval.
                </p>
                <ul
                  className={styles.gpuOutputs}
                  aria-label={`${job.workflow} saved outputs`}
                >
                  {job.files.map((file) => (
                    <GpuSavedOutput
                      key={`${projectDir}:${job.id}:${file.path}:${file.sha256}`}
                      projectDir={projectDir}
                      file={file}
                    />
                  ))}
                </ul>
              </>
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
