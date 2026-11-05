import { useState } from 'react';
import type { QueueJobSummary } from '../../../shared/gpuQueue';
import styles from './ProductionReviewPanel.module.scss';

type Output = NonNullable<QueueJobSummary['files']>[number];

export default function GpuSavedOutput({
  projectDir,
  file,
}: {
  projectDir: string;
  file: Output;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const normalized = file.path.replace(/\\/g, '/');
  const name = normalized.split('/').pop() || file.path;
  const safe =
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !normalized.includes(':') &&
    !normalized.includes('\u0000') &&
    !normalized.split('/').some((part) => part === '..');
  const size =
    file.bytes < 1024
      ? `${file.bytes} B`
      : `${(file.bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;
  async function reveal() {
    if (!safe || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!window.electron?.project?.revealInFinder)
        throw new Error(
          'Opening the output folder is unavailable in this Desktop build.',
        );
      await window.electron.project.revealInFinder(
        `${projectDir.replace(/[\\/]+$/, '')}/${normalized}`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={styles.gpuOutput}>
      <div className={styles.gpuOutputHeading}>
        <strong>{name}</strong>
        <span>{size}</span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!safe || busy}
          onClick={reveal}
          aria-label={`Show ${name} in folder`}
        >
          {busy ? 'Opening folder…' : 'Show in folder'}
        </button>
      </div>
      {!safe && <p>This saved path cannot be opened as a project output.</p>}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>File details</summary>
        <p>{file.path}</p>
        <p>
          SHA-256 recorded at download: <code>{file.sha256}</code>
        </p>
      </details>
    </li>
  );
}
