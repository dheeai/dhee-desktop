/**
 * TransportBar — the honest, unified run surface.
 *
 * The slim StatusStrip only ever knew about the walk runner, so it read
 * "Idle" while the agent was busy working a turn. This bar merges BOTH
 * signals (runner-active OR agent-busy) into one truthful readout and adds
 * what was missing during a run: live progress (N / M), the current node,
 * a per-stage rail, elapsed + an approximate ETA, and a single Stop.
 *
 * Everything shown is derived by deriveRunModel from the live instance
 * graph + the bundle's own node metadata, so the SAME bar serves a
 * narrative video bundle and a financial-report bundle — no video
 * vocabulary is hardcoded here. The bar self-hides when nothing is running.
 */
import { Fragment } from 'react';
import { Square } from 'lucide-react';
import { useRunModel } from '../../../hooks/useRunModel';
import styles from './TransportBar.module.scss';

const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function TransportBar() {
  const { model, stop } = useRunModel();

  if (model.activity === 'idle') return null;

  const cancelling = model.activity === 'cancelling';
  const stage = model.activeStage;
  const determinate = !!stage && stage.total > 0;
  const stagePct = determinate ? Math.round((stage!.done / stage!.total) * 100) : 0;
  const ringOffset = RING_C * (1 - model.overall.pct / 100);

  const phaseLabel = cancelling
    ? 'Stopping'
    : model.activity === 'thinking'
      ? 'Agent'
      : model.phaseVerb;

  return (
    <div className={styles.bar} role="status" aria-label="Run status">
      <div className={styles.main}>
        {/* rec ring — overall progress arc */}
        <div className={styles.rec} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle className={styles.recTrack} cx="20" cy="20" r={RING_R} fill="none" strokeWidth="2.5" />
            <circle
              className={styles.recFill}
              cx="20"
              cy="20"
              r={RING_R}
              fill="none"
              strokeWidth="2.5"
              strokeDasharray={RING_C}
              strokeDashoffset={ringOffset}
            />
          </svg>
          <span className={`${styles.recDot} ${cancelling ? styles.cancel : ''}`} />
        </div>

        {/* phase + current node */}
        <div className={styles.phase}>
          <span className={`${styles.phaseLabel} ${cancelling ? styles.cancel : ''}`}>{phaseLabel}</span>
          <span className={styles.phaseNow}>
            {cancelling ? (
              'Cancelling the current run…'
            ) : model.currentNode ? (
              <>
                {model.currentNode.stageLabel}
                {model.currentNode.itemLabel ? (
                  <>
                    {' · '}
                    <b>{model.currentNode.itemLabel}</b>
                  </>
                ) : null}
              </>
            ) : stage ? (
              stage.label
            ) : model.activity === 'thinking' ? (
              'Agent is working…'
            ) : (
              'Working…'
            )}
          </span>
        </div>

        {/* counter + meter */}
        <div className={styles.meterWrap}>
          <div className={styles.meterTop}>
            {determinate ? (
              <span className={styles.count}>
                {stage!.done}
                <span className={styles.of}> / {stage!.total}</span>
                <span className={styles.unit}>{model.unitNoun}</span>
              </span>
            ) : (
              <span className={styles.count} style={{ fontSize: 15 }}>
                {model.activity === 'thinking' ? 'Thinking…' : 'Preparing…'}
              </span>
            )}
            {determinate ? (
              <span className={styles.meterMeta}>
                <b>{stagePct}%</b> stage · <b>{model.overall.pct}%</b> overall
                {model.activity === 'running' && model.cascadeCount > 0 ? (
                  <span className={styles.cascade}>{model.cascadeCount} to build</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className={`${styles.meter} ${determinate ? '' : styles.indeterminate}`}>
            <span className={styles.meterFill} style={determinate ? { width: `${stagePct}%` } : undefined} />
          </div>
        </div>

        {/* clock */}
        {model.elapsedMs !== null ? (
          <div className={styles.clock}>
            <span className={styles.elapsed}>{mmss(model.elapsedMs)}</span>
            {model.etaMs !== null ? <span className={styles.eta}>ETA ~{mmss(model.etaMs)}</span> : null}
          </div>
        ) : null}

        {/* stop */}
        <button
          type="button"
          className={styles.stop}
          onClick={stop}
          disabled={cancelling}
          aria-label="Stop the current run"
          title="Stop"
        >
          <Square size={10} fill="currentColor" />
          <span>{cancelling ? 'Stopping' : 'Stop'}</span>
        </button>
      </div>

      {/* stage rail — the run's spine */}
      {model.stages.length > 0 ? (
        <div className={styles.rail}>
          {model.stages.map((s, i) => (
            <Fragment key={s.id}>
              <span
                className={`${styles.stagePip} ${
                  s.status === 'done'
                    ? styles.done
                    : s.status === 'active'
                      ? styles.active
                      : s.status === 'failed'
                        ? styles.failed
                        : ''
                }`}
                title={`${s.label} — ${s.done}/${s.total}`}
              >
                <span className={styles.pipDot} />
                <span className={styles.pipLabel}>{s.label}</span>
                {s.total > 1 ? (
                  <span className={styles.pipCount}>
                    {s.done}/{s.total}
                  </span>
                ) : null}
              </span>
              {i < model.stages.length - 1 ? <span className={styles.railSep} /> : null}
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default TransportBar;
