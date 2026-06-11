/**
 * StatusStrip — the only persistent top-edge UI in the binary
 * workspace (per 2026-05-28 architectural pivot to "agent + canvas
 * as the entire surface").
 *
 * Layout (left → right):
 *   ← Back   Project · Bundle    [ RUN STATUS or idle ]   overlay launchers
 *
 * The center is a compact, HONEST activity chip: it reflects the walk
 * runner OR the agent working a turn (previously it only knew the walk,
 * so it read "Idle" while the agent was busy). The detailed readout —
 * phase, progress, elapsed, Stop — lives in the TransportBar directly
 * below; the strip just answers "is it working?" at a glance.
 */
import {
  ChevronLeft,
  Settings as SettingsIcon,
  Film,
  FileText,
  Clock,
} from 'lucide-react';
import { useDheeSession } from '../../../hooks/useDheeSession';
import { useOverlay, type OverlayKey } from '../../../overlays/OverlayContext';
import BackendBadges from '../../backend/BackendBadges';
import styles from './StatusStrip.module.scss';

export interface StatusStripProps {
  /** Optional — hidden when undefined (e.g. on the landing screen). */
  onBack?: () => void;
  /** Project name shown next to the back button. */
  projectName?: string;
  /** Bundle id (e.g. 'narrative_qwen_chain_relay'). */
  bundleId?: string;
}

export function StatusStrip({ onBack, projectName, bundleId }: StatusStripProps) {
  const session = useDheeSession();
  const { open } = useOverlay();
  const runnerActive = session.execution?.runnerActive ?? false;
  const cancelling = session.execution?.pendingCancel ?? false;
  const sessionStatus = session.status;
  const agentBusy = sessionStatus === 'running';
  const active = runnerActive || agentBusy;
  const activityLabel = cancelling ? 'Stopping…' : runnerActive ? 'Running' : 'Working';

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
            <span className={styles.runLabel}>{activityLabel}</span>
          </span>
        )}
      </div>

      <div className={styles.right}>
        <button
          type="button"
          className={styles.badgesButton}
          onClick={() => open('settings')}
          aria-label="Engine connection status — click to configure"
          title="Engine connection status — click to configure"
        >
          <BackendBadges />
        </button>
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
