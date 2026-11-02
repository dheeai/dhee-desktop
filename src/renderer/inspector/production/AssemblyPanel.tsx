import { useEffect, useRef, useState } from 'react';
import type { GpuTarget } from '../../../shared/gpuQueue';
import styles from './GpuPreparationPanel.module.scss';

export function AssemblyPanel({ projectDir }: { projectDir: string }) {
  const [branch, setBranch] = useState('main');
  const [branches, setBranches] = useState<string[]>(['main']);
  const [targets, setTargets] = useState<GpuTarget[]>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  function clear() {
    epoch.current += 1;
    setMessage('');
    setError('');
    setBusy(false);
  }
  useEffect(() => {
    epoch.current += 1;
    let cancelled = false;
    setTargets([]);
    setChoice('');
    setMessage('');
    setError('');
    setBusy(false);
    window.dhee
      .assembly({ action: 'assembly.targets', projectDir, branchId: branch })
      .then((response) => {
        if (cancelled) return undefined;
        if (!response.ok) {
          setError(response.error);
          return undefined;
        }
        setTargets(response.result.targets ?? []);
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
  const target = choice === '' ? undefined : targets[Number(choice)];
  async function run() {
    if (!target) return;
    epoch.current += 1;
    const id = epoch.current;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await window.dhee.assembly({
        action: 'assembly.run',
        projectDir,
        branchId: branch,
        nodeId: target.nodeId,
        itemId: target.itemId,
        expectedSelectionId: target.selectionId,
      });
      if (id !== epoch.current) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const { result } = response;
      if (result.gatedAfter)
        setMessage(
          `Creative review required: ${result.gatedAfter.replace('review:', '')}. Complete that review, then reload assembly.`,
        );
      else if (result.budgetExceeded)
        setMessage(
          `Budget paused: $${result.budgetExceeded.spentUsd} spent of $${result.budgetExceeded.capUsd}.`,
        );
      else if (result.selectedOutput)
        setMessage(
          `Assembly available: ${result.selectedOutput.outputRel}. Reload media below and check this file before delivery.`,
        );
      else
        setError(
          'Assembly returned no output. Reload the project state before retrying.',
        );
    } catch (reason) {
      if (id === epoch.current) setError(String(reason));
    } finally {
      if (id === epoch.current) setBusy(false);
    }
  }
  return (
    <details className={styles.root}>
      <summary>Assemble completed clips</summary>
      <p>
        Run one local FFmpeg assembly stage using the project’s configured order
        and transitions. All source stages must already be complete. Existing
        creative approvals still apply.
      </p>
      <fieldset disabled={busy}>
        <label htmlFor="assembly-branch">
          Assembly branch
          <select
            id="assembly-branch"
            value={branch}
            onChange={(e) => {
              clear();
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
          onClick={() => {
            clear();
            setRevision((v) => v + 1);
          }}
        >
          Reload assembly
        </button>
        <label htmlFor="assembly-target">
          Assembly stage
          <select
            id="assembly-target"
            value={choice}
            onChange={(e) => {
              clear();
              setChoice(e.target.value);
            }}
          >
            <option value="">Choose assembly stage</option>
            {targets.map((t, i) => (
              <option key={`${t.nodeId}:${t.itemId ?? ''}`} value={i}>
                {t.nodeId}
                {t.itemId ? ` · ${t.itemId}` : ''} · {t.status}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!target} onClick={run}>
          Assemble selected stage
        </button>
      </fieldset>
      {busy && <p role="status">Assembling selected stage…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        Completed output is reused. This does not regenerate source clips or
        mark the video delivery-ready. No supported stage listed? This project
        needs an ffmpeg.concat stage in its bundle.
      </p>
    </details>
  );
}
export default AssemblyPanel;
