/**
 * StatusStrip — the only persistent top-edge UI in the binary
 * workspace (per 2026-05-28 architectural pivot to "agent + canvas
 * as the entire surface").
 *
 * Layout (left → right):
 *   ← Back   Project · Bundle    [ RUN STATUS or idle ]   overlay launchers
 *
 * The run-status block grows to fill the middle when active, showing
 * the task kind, an elapsed mm:ss timer, and a Stop button. Idle
 * state is a subtle "Idle" pill so the user always knows the engine
 * is reachable.
 */
import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  Square,
  Settings as SettingsIcon,
  Film,
  FileText,
  Clock,
} from 'lucide-react';
import { useRunnerStatus } from '../../../hooks/useRunnerStatus';
import { useOverlay, type OverlayKey } from '../../../overlays/OverlayContext';
import styles from './StatusStrip.module.scss';

export interface StatusStripProps {
  /** Optional — hidden when undefined (e.g. on the landing screen). */
  onBack?: () => void;
  /** Project name shown next to the back button. */
  projectName?: string;
  /** Bundle id (e.g. 'narrative_qwen_chain_relay'). */
  bundleId?: string;
}

function formatElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(sec / 60).toString().padStart(2, '0');
  const ss = (sec % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function StatusStrip({ onBack, projectName, bundleId }: StatusStripProps) {
  const { status, active, cancelling, cancel } = useRunnerStatus();
  const { open } = useOverlay();
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick a clock once per second so the elapsed counter updates
  // independently of the runner poll cadence.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const launchers: Array<{ key: OverlayKey; label: string; Icon: typeof SettingsIcon }> = [
    { key: 'library', label: 'Library', Icon: Film },
    { key: 'plans', label: 'Plans', Icon: FileText },
    { key: 'timeline', label: 'Timeline', Icon: Clock },
    { key: 'settings', label: 'Settings', Icon: SettingsIcon },
  ];

  return (
    <div className={styles.strip} role="banner">
      <div className={styles.left}>
        {onBack ? (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onBack}
            aria-label="Back to landing"
            title="Back"
          >
            <ChevronLeft size={16} />
          </button>
        ) : null}
        {projectName ? (
          <div className={styles.project}>
            <span className={styles.projectName}>{projectName}</span>
            {bundleId ? (
              <span className={styles.bundleId}>{bundleId}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.center}>
        {!active ? (
          <span className={styles.idlePill} data-testid="status-state">
            Idle
          </span>
        ) : (
          <span className={styles.runningPill} data-testid="status-state">
            <span className={`${styles.dot} ${cancelling ? styles.dotCancel : styles.dotRun}`} />
            <span className={styles.runLabel}>
              {cancelling ? 'Stopping…' : 'Running'}
            </span>
            <span className={styles.kind}>{status?.kind ?? 'task'}</span>
            {status?.startedAt ? (
              <span className={styles.elapsed} data-testid="status-elapsed">
                {formatElapsed(status.startedAt, now)}
              </span>
            ) : null}
            <button
              type="button"
              className={styles.stopButton}
              onClick={() => void cancel()}
              aria-label="Stop"
              title="Stop the current run"
              disabled={cancelling}
            >
              <Square size={11} fill="currentColor" />
              <span>Stop</span>
            </button>
          </span>
        )}
      </div>

      <div className={styles.right}>
        {launchers.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={styles.iconButton}
            onClick={() => open(key)}
            aria-label={label}
            title={label}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default StatusStrip;
