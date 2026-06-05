/**
 * BundleConfigurator — the reusable surface that reconciles what a
 * bundle's ComfyUI workflows NEED (models + custom nodes) against what
 * a given endpoint HAS. Mounted in three contexts (first-run setup,
 * community install, bring-your-own workflow); this is the read-only
 * core (gap display). Resolve actions (remap / swap / install) are
 * layered on in a later milestone.
 *
 * Drives off dhee-core's checkBundle via window.electron.bundleConfig.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EnrichedBundleFit,
  EnrichedModelGap,
  EnrichedNodeGap,
  BundleFitStatus,
} from '../../../shared/bundleConfigTypes';
import styles from './BundleConfigurator.module.scss';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8188';

interface Props {
  bundleId: string;
  /** Endpoint to check against; when omitted, resolved from settings. */
  endpoint?: string;
  /** Notified with the rolled-up status (or null on error) after each check. */
  onStatus?: (status: BundleFitStatus | null) => void;
}

export default function BundleConfigurator({ bundleId, endpoint, onStatus }: Props) {
  const [resolvedEndpoint, setResolvedEndpoint] = useState<string>(endpoint ?? DEFAULT_ENDPOINT);
  const [loading, setLoading] = useState(false);
  const [fit, setFit] = useState<EnrichedBundleFit | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the configured local ComfyUI URL from settings (unless the
  // caller pinned an endpoint).
  useEffect(() => {
    if (endpoint) return;
    let cancelled = false;
    window.electron.settings
      .get()
      .then((s) => {
        if (cancelled) return;
        const ep = s.comfyuiMode === 'custom' && s.comfyuiUrl ? s.comfyuiUrl : DEFAULT_ENDPOINT;
        setResolvedEndpoint(ep);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electron.bundleConfig.check(bundleId, resolvedEndpoint);
      if ('error' in res) {
        setError(res.error);
        setFit(null);
        onStatus?.(null);
      } else {
        setFit(res);
        onStatus?.(res.status);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFit(null);
      onStatus?.(null);
    } finally {
      setLoading(false);
    }
  }, [bundleId, resolvedEndpoint, onStatus]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  return (
    <div className={styles.configurator}>
      <div className={styles.endpointRow}>
        <label className={styles.endpointLabel}>ComfyUI endpoint</label>
        <input
          className={styles.endpointInput}
          value={resolvedEndpoint}
          onChange={(e) => setResolvedEndpoint(e.target.value)}
          spellCheck={false}
        />
        <button type="button" className={styles.recheck} onClick={() => void runCheck()} disabled={loading}>
          {loading ? 'Checking…' : 'Check fit'}
        </button>
      </div>

      {loading && !fit && <div className={styles.hint}>Scanning models + custom nodes…</div>}

      {error && (
        <div className={styles.unreachable}>
          <b>Couldn&apos;t reach ComfyUI.</b> {error}
          <div className={styles.help}>
            The running ComfyUI app <em>is</em> the API — no separate server. Same machine? Use{' '}
            <code>http://127.0.0.1:8188</code>. Another machine? Relaunch ComfyUI with{' '}
            <code>--listen 0.0.0.0</code> and use that host.
          </div>
        </div>
      )}

      {fit && fit.status === 'unreachable' && !error && (
        <div className={styles.unreachable}>Endpoint unreachable — start ComfyUI or check the URL.</div>
      )}

      {fit && fit.status !== 'unreachable' && (
        <div className={styles.results}>
          <StatusHeader fit={fit} />
          {fit.workflows.map((w) => {
            const clean = w.missing_refs.length === 0 && w.missing_node_classes.length === 0 && !w.error;
            if (clean) return null;
            return (
              <div key={w.workflowKey} className={styles.workflow}>
                <div className={styles.workflowName}>{w.workflowKey.replace(/^workflows\//, '')}</div>
                {w.error && <div className={styles.wfError}>{w.error}</div>}
                {w.missing_refs.length > 0 && (
                  <div className={styles.group}>
                    <div className={styles.groupHead}>Missing models · {w.missing_refs.length}</div>
                    {w.missing_refs.map((m) => (
                      <ModelGapRow key={`${w.workflowKey}:${m.nodeId}:${m.inputField}`} gap={m} />
                    ))}
                  </div>
                )}
                {w.missing_node_classes.length > 0 && (
                  <div className={styles.group}>
                    <div className={styles.groupHead}>Missing custom nodes · {w.missing_node_classes.length}</div>
                    {w.missing_node_classes.map((n) => (
                      <NodeGapRow key={`${w.workflowKey}:${n.nodeId}`} gap={n} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusHeader({ fit }: { fit: EnrichedBundleFit }) {
  if (fit.status === 'ready') {
    return <div className={`${styles.statusChip} ${styles.ok}`}>✓ All models &amp; custom nodes present on this ComfyUI</div>;
  }
  return (
    <div className={`${styles.statusChip} ${styles.warn}`}>
      {fit.modelsMissing} model{fit.modelsMissing === 1 ? '' : 's'} · {fit.nodesMissing} custom node
      {fit.nodesMissing === 1 ? '' : 's'} missing
    </div>
  );
}

function ModelGapRow({ gap }: { gap: EnrichedModelGap }) {
  const req = gap.requirement;
  return (
    <div className={styles.gap}>
      <div className={styles.gapName}>
        <span className={styles.fn}>{gap.current_value}</span>
        <span className={styles.sub}>
          {req?.type ? `${req.type} · ` : `${gap.nodeType}.${gap.inputField} · `}
          {req?.sizeGb ? `~${req.sizeGb} GB` : 'not installed'}
        </span>
      </div>
      {req?.downloadUrl ? (
        <span className={styles.action}>Download ↗</span>
      ) : (
        <span className={styles.actionMuted}>install or remap</span>
      )}
    </div>
  );
}

function NodeGapRow({ gap }: { gap: EnrichedNodeGap }) {
  const req = gap.requirement;
  return (
    <div className={styles.gap}>
      <div className={styles.gapName}>
        <span className={styles.fn}>{gap.class_type}</span>
        <span className={styles.sub}>
          {req?.pack ? `pack: ${req.pack}` : 'custom-node class not installed'}
          {req?.installVia ? ` · via ${req.installVia === 'manager' ? 'ComfyUI-Manager' : 'git'}` : ''}
        </span>
      </div>
      <span className={styles.actionMuted}>install or swap</span>
    </div>
  );
}
