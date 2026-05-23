import { AlertTriangle, Settings as _Settings, X } from 'lucide-react';
import type { LaneConfigCheck } from './backendConfigStatus';
import styles from './LandingScreen.module.scss';

const Settings = _Settings as unknown as React.FC<
  React.SVGProps<SVGSVGElement> & { size?: number | string }
>;
const AlertTriangleIcon = AlertTriangle as unknown as React.FC<
  React.SVGProps<SVGSVGElement> & { size?: number | string }
>;
const XIcon = X as unknown as React.FC<
  React.SVGProps<SVGSVGElement> & { size?: number | string }
>;

interface BackendNotReadyDialogProps {
  isOpen: boolean;
  unconfiguredLanes: LaneConfigCheck[];
  canSignIn: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onSignIn: () => void;
}

const LANE_LABELS: Record<string, string> = {
  llm: 'LLM',
  comfy: 'ComfyUI',
  vlm: 'VLM',
};

export default function BackendNotReadyDialog({
  isOpen,
  unconfiguredLanes,
  canSignIn,
  onClose,
  onOpenSettings,
  onSignIn,
}: BackendNotReadyDialogProps) {
  if (!isOpen) return null;
  return (
    <div className={styles.warnOverlay}>
      <div
        className={styles.warnDialog}
        role="alertdialog"
        aria-modal="true"
        aria-label="Backends not configured"
      >
        <div className={styles.warnHeader}>
          <div className={styles.warnTitleRow}>
            <AlertTriangleIcon size={18} className={styles.warnIcon} />
            <h2 className={styles.warnTitle}>Configure backends first</h2>
          </div>
          <button
            type="button"
            className={styles.warnClose}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className={styles.warnBody}>
          <p className={styles.warnIntro}>
            Dhee needs an LLM and ComfyUI to generate anything. The
            following {unconfiguredLanes.length === 1 ? 'lane needs' : 'lanes need'}{' '}
            attention before you can create a project:
          </p>
          <ul className={styles.warnLaneList}>
            {unconfiguredLanes.map((lane) => (
              <li key={lane.lane} className={styles.warnLaneItem}>
                <span className={styles.warnLaneName}>
                  {LANE_LABELS[lane.lane] ?? lane.lane}
                </span>
                <span className={styles.warnLaneReason}>{lane.reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.warnActions}>
          <button
            type="button"
            className={styles.warnSecondary}
            onClick={onClose}
          >
            Cancel
          </button>
          {canSignIn ? (
            <button
              type="button"
              className={styles.warnSecondary}
              onClick={onSignIn}
            >
              Sign in to Cloud
            </button>
          ) : null}
          <button
            type="button"
            className={styles.warnPrimary}
            onClick={onOpenSettings}
          >
            <Settings size={14} />
            Open Settings
          </button>
        </div>
      </div>
    </div>
  );
}
