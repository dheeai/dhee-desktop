import { useEffect, useRef, useState } from 'react';
import styles from './ProductionReviewPanel.module.scss';

interface Props {
  projectDir: string;
  voiceConfigured: boolean;
}
function Policy({ projectDir, voiceConfigured }: Props) {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const active = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    let cancelled = false;
    active.current = true;
    const load = async () => {
      try {
        if (!window.dhee?.readReviewPolicy)
          throw new Error(
            'Review policy is unavailable in this Desktop build.',
          );
        const result = await window.dhee.readReviewPolicy({ projectDir });
        if (cancelled) return;
        if (!result.ok) throw new Error(result.error);
        setEnabled(result.enabled);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [projectDir]);
  const toggle = async () => {
    if (saving.current || enabled === undefined) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await window.dhee.setReviewPolicy({
        projectDir,
        enabled: !enabled,
      });
      if (!active.current) return;
      if (!result.ok) throw new Error(result.error);
      setEnabled(result.enabled);
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  let heading = 'Creative approval policy';
  if (enabled !== undefined)
    heading = enabled
      ? 'Creative approvals required'
      : 'Creative approvals optional';
  const action = enabled
    ? 'Make creative approvals optional'
    : 'Require creative approvals';
  return (
    <section className={styles.root} aria-label="Creative approval policy">
      <h2>{heading}</h2>
      <p>
        {enabled === true
          ? 'Production pauses at these three creative checkpoints.'
          : 'These are the three creative checkpoints for this workflow.'}
      </p>
      <ol className={styles.policyStages} aria-label="Creative approval stages">
        <li>
          <strong>Script and storyboard</strong>
          <span>Confirm the story and scene direction.</span>
        </li>
        <li>
          <strong>Characters and voices</strong>
          <span>Confirm the visual references and voice auditions.</span>
        </li>
        <li>
          <strong>Rough cut</strong>
          <span>Review picture, dialogue and pacing together.</span>
        </li>
      </ol>
      <p className={styles.note}>
        Approvals apply to the reviewed versions on the main project branch.
        Technical checks do not replace creative approval.
      </p>
      {!voiceConfigured && (
        <p>
          Voice reference is not configured. Required reviews will stop scene
          generation until an audio audition is added to this workflow.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || enabled === undefined}
          onClick={toggle}
        >
          {busy ? 'Loading…' : action}
        </button>
      </div>
    </section>
  );
}
export function ProductionReviewPolicy({ projectDir, voiceConfigured }: Props) {
  return (
    <Policy
      key={projectDir}
      projectDir={projectDir}
      voiceConfigured={voiceConfigured}
    />
  );
}
export default ProductionReviewPolicy;
