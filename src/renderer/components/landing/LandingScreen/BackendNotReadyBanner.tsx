/**
 * BackendNotReadyBanner — non-blocking inline banner.
 *
 * Replaces the old `BackendNotReadyDialog` (modal). UX critique
 * 2026-05-28: walling the entire screen behind an alert dialog for
 * a config-issue is hostile, especially for a desktop app the user
 * just installed and is browsing for the first time. The banner
 * surfaces the same information + actions inline so the user can
 * keep exploring while fixing config.
 *
 * Per-session dismissible. Renders nothing when all lanes are
 * configured.
 */
import { useState } from 'react';
import { AlertTriangle, Settings as _Settings, X } from 'lucide-react';
import type { LaneConfigCheck } from './backendConfigStatus';
import styles from './BackendNotReadyBanner.module.scss';

const Settings = _Settings as unknown as React.FC<
  React.SVGProps<SVGSVGElement> & { size?: number | string }
>;
const AlertTriangleIcon = AlertTriangle as unknown as React.FC<
  React.SVGProps<SVGSVGElement> & { size?: number | string }
>;
const XIcon = X as unknown as React.FC<
  React.SVGProps<SVGSVGElement> & { size?: number | string }
>;

const LANE_LABELS: Record<string, string> = {
  llm: 'LLM',
  comfy: 'ComfyUI',
  vlm: 'VLM',
};

export interface BackendNotReadyBannerProps {
  unconfiguredLanes: LaneConfigCheck[];
  canSignIn: boolean;
  onOpenSettings: () => void;
  onSignIn: () => void;
}

export function BackendNotReadyBanner({
  unconfiguredLanes,
  canSignIn,
  onOpenSettings,
  onSignIn,
}: BackendNotReadyBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (unconfiguredLanes.length === 0 || dismissed) return null;

  return (
    <section
      className={styles.banner}
      role="region"
      aria-label="Backends not configured"
    >
      <AlertTriangleIcon size={16} className={styles.icon} />
      <div className={styles.text}>
        <span className={styles.lede}>
          {unconfiguredLanes.length === 1
            ? '1 backend needs setup before you can generate.'
            : `${unconfiguredLanes.length} backends need setup before you can generate.`}
        </span>
        <span className={styles.lanes}>
          {unconfiguredLanes.map((lane, idx) => (
            <span key={lane.lane} className={styles.lane}>
              <span className={styles.laneName}>
                {LANE_LABELS[lane.lane] ?? lane.lane}
              </span>
              <span className={styles.laneReason}>{lane.reason}</span>
              {idx < unconfiguredLanes.length - 1 ? <span className={styles.sep}>·</span> : null}
            </span>
          ))}
        </span>
      </div>
      <div className={styles.actions}>
        {canSignIn ? (
          <button
            type="button"
            className={styles.secondary}
            onClick={onSignIn}
          >
            Sign in to Cloud
          </button>
        ) : null}
        <button
          type="button"
          className={styles.primary}
          onClick={onOpenSettings}
        >
          <Settings size={13} />
          Open Settings
        </button>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          title="Dismiss this session"
        >
          <XIcon size={14} />
        </button>
      </div>
    </section>
  );
}

export default BackendNotReadyBanner;
