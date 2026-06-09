/* eslint-disable react/require-default-props */
import { Loader2, AlertTriangle, Check, PauseCircle } from 'lucide-react';
import type { ActivityState } from '../ChatPanelEmbedded/activityState';
import styles from './ActivityTransport.module.scss';

const VARIANT_CLASS: Partial<Record<ActivityState['kind'], string>> = {
  failed: styles.failedVariant,
  paused: styles.pausedVariant,
  done: styles.doneVariant,
};

export interface ActivityTransportProps {
  state: ActivityState;
  /** Pre-formatted elapsed time, e.g. "3:18". */
  elapsed?: string;
  /** Pre-formatted ETA, e.g. "~1:50". */
  eta?: string;
  onStop?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
}

function Dial({ kind }: { kind: ActivityState['kind'] }) {
  if (kind === 'failed') {
    return (
      <span className={styles.dial}>
        <AlertTriangle size={17} />
      </span>
    );
  }
  if (kind === 'done') {
    return (
      <span className={styles.dial}>
        <Check size={18} />
      </span>
    );
  }
  if (kind === 'paused') {
    return (
      <span className={styles.dial}>
        <PauseCircle size={18} />
      </span>
    );
  }
  // thinking / working / rendering — a live spinner + pulse
  return (
    <span className={styles.dial}>
      <Loader2 size={18} className={styles.spin} />
    </span>
  );
}

/**
 * The single live activity indicator. Renders nothing when idle; otherwise
 * shows what the agent is doing right now — a verb + object, a meter when a
 * run reports countable progress, and the right action (stop / resume /
 * retry) for the state.
 */
export default function ActivityTransport({
  state,
  elapsed,
  eta,
  onStop,
  onResume,
  onRetry,
}: ActivityTransportProps) {
  if (state.kind === 'idle') return null;

  const variantClass = VARIANT_CLASS[state.kind] ?? '';
  const showCaret = state.kind === 'thinking';

  return (
    <div
      className={`${styles.transport} ${variantClass}`}
      role="status"
      aria-live="polite"
    >
      <Dial kind={state.kind} />
      <div className={styles.body}>
        <div className={styles.line}>
          <span className={styles.verb}>{state.verb}</span>
          {state.object && (
            <span className={styles.object}>
              {state.object}
              {showCaret && (
                <span className={styles.caret} aria-hidden="true" />
              )}
            </span>
          )}
          {!state.object && showCaret && (
            <span className={styles.caret} aria-hidden="true" />
          )}
        </div>

        {state.progress && (
          <div
            className={styles.meter}
            role="progressbar"
            aria-label="Run progress"
            aria-valuenow={state.progress.pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${state.progress.pct}%` }} />
          </div>
        )}

        {(state.progress || elapsed || eta || state.failureClass) && (
          <div className={styles.meta}>
            {state.progress && (
              <span>
                <b>{state.progress.pct}%</b>
              </span>
            )}
            {elapsed && (
              <span>
                elapsed <b>{elapsed}</b>
              </span>
            )}
            {eta && (
              <span>
                eta <b>{eta}</b>
              </span>
            )}
            {state.failureClass && (
              <span
                className={`${styles.classchip} ${styles[state.failureClass]}`}
              >
                {state.failureClass === 'transient'
                  ? 'Transient · retryable'
                  : 'Structural · fix the node'}
              </span>
            )}
          </div>
        )}
      </div>

      {state.kind === 'rendering' && onStop && (
        <button
          type="button"
          className={`${styles.action} ${styles.stop}`}
          onClick={onStop}
        >
          Stop
        </button>
      )}
      {state.kind === 'paused' && onResume && (
        <button
          type="button"
          className={`${styles.action} ${styles.primary}`}
          onClick={onResume}
        >
          Continue
        </button>
      )}
      {state.kind === 'failed' && onRetry && (
        <button
          type="button"
          className={`${styles.action} ${styles.primary}`}
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}
