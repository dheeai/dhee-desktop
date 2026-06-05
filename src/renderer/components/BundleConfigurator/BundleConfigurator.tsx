/**
 * BundleConfigurator — the reusable surface that reconciles what a
 * bundle's ComfyUI workflows NEED (models + custom nodes) against what
 * a given endpoint HAS, and lets the user CLOSE the gaps:
 *   - models: remap to an installed file (name_aliases, + class_swaps
 *     when the chosen candidate lives on a different loader class)
 *   - custom nodes: swap to an installed equivalent class (class_swaps)
 * Each resolution persists per-endpoint (dhee-core workflowAliases) and
 * triggers a live re-check. Mounted in first-run setup, community
 * install, and bring-your-own workflow.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EnrichedBundleFit,
  EnrichedModelGap,
  EnrichedNodeGap,
  EnrichedWorkflowFit,
  BundleFitStatus,
  ResolvePatch,
} from '../../../shared/bundleConfigTypes';
import styles from './BundleConfigurator.module.scss';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8188';

interface Props {
  bundleId: string;
  endpoint?: string;
  onStatus?: (status: BundleFitStatus | null) => void;
}

export default function BundleConfigurator({ bundleId, endpoint, onStatus }: Props) {
  const [resolvedEndpoint, setResolvedEndpoint] = useState<string>(endpoint ?? DEFAULT_ENDPOINT);
  const [loading, setLoading] = useState(false);
  const [fit, setFit] = useState<EnrichedBundleFit | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Persist a remap/swap, then re-check so the gap clears live.
  const applyPatch = useCallback(
    async (patch: ResolvePatch) => {
      const res = await window.electron.bundleConfig.resolve(resolvedEndpoint, patch);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await runCheck();
    },
    [resolvedEndpoint, runCheck],
  );

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
            return <WorkflowGaps key={w.workflowKey} w={w} applyPatch={applyPatch} />;
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

function WorkflowGaps({
  w,
  applyPatch,
}: {
  w: EnrichedWorkflowFit;
  applyPatch: (patch: ResolvePatch) => void | Promise<void>;
}) {
  return (
    <div className={styles.workflow}>
      <div className={styles.workflowName}>{w.workflowKey.replace(/^workflows\//, '')}</div>
      {w.error && <div className={styles.wfError}>{w.error}</div>}
      {w.missing_refs.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupHead}>Missing models · {w.missing_refs.length}</div>
          {w.missing_refs.map((m) => (
            <ModelGapRow
              key={`${m.nodeId}:${m.inputField}`}
              gap={m}
              workflowKey={w.workflowKey}
              availableByClass={w.available_by_class}
              applyPatch={applyPatch}
            />
          ))}
        </div>
      )}
      {w.missing_node_classes.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupHead}>Missing custom nodes · {w.missing_node_classes.length}</div>
          {w.missing_node_classes.map((n) => (
            <NodeGapRow key={n.nodeId} gap={n} workflowKey={w.workflowKey} applyPatch={applyPatch} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Candidate installed files for a missing model ref: same loader field, any class. */
function modelCandidates(
  gap: EnrichedModelGap,
  availableByClass: Record<string, string[]>,
): Array<{ cls: string; name: string; sameClass: boolean }> {
  const sameKey = `${gap.nodeType}.${gap.inputField}`;
  const out: Array<{ cls: string; name: string; sameClass: boolean }> = [];
  for (const [key, names] of Object.entries(availableByClass)) {
    if (key !== sameKey && !key.endsWith(`.${gap.inputField}`)) continue;
    const cls = key.slice(0, key.lastIndexOf('.'));
    for (const name of names) out.push({ cls, name, sameClass: key === sameKey });
  }
  // same-class first
  return out.sort((a, b) => Number(b.sameClass) - Number(a.sameClass));
}

function ModelGapRow({
  gap,
  workflowKey,
  availableByClass,
  applyPatch,
}: {
  gap: EnrichedModelGap;
  workflowKey: string;
  availableByClass: Record<string, string[]>;
  applyPatch: (patch: ResolvePatch) => void | Promise<void>;
}) {
  const req = gap.requirement;
  const candidates = modelCandidates(gap, availableByClass);

  const onPick = (value: string) => {
    if (!value) return;
    const sep = value.indexOf('|');
    const cls = value.slice(0, sep);
    const name = value.slice(sep + 1);
    const patch: ResolvePatch = { name_aliases: { [gap.current_value]: name } };
    if (cls !== gap.nodeType) {
      patch.class_swaps = { [workflowKey]: { [gap.nodeId]: cls } };
    }
    void applyPatch(patch);
  };

  return (
    <div className={styles.gap}>
      <div className={styles.gapName}>
        <span className={styles.fn}>{gap.current_value}</span>
        <span className={styles.sub}>
          {req?.type ? `${req.type} · ` : `${gap.nodeType}.${gap.inputField} · `}
          {req?.sizeGb ? `~${req.sizeGb} GB` : 'not installed'}
        </span>
      </div>
      {candidates.length > 0 && (
        <select
          className={styles.remap}
          defaultValue=""
          onChange={(e) => onPick(e.target.value)}
          aria-label={`remap ${gap.current_value}`}
        >
          <option value="">use a model I have ▾</option>
          {candidates.map((c) => (
            <option key={`${c.cls}|${c.name}`} value={`${c.cls}|${c.name}`}>
              {c.sameClass ? c.name : `${c.name}  (${c.cls})`}
            </option>
          ))}
        </select>
      )}
      {req?.downloadUrl ? <span className={styles.action}>Download ↗</span> : null}
    </div>
  );
}

function NodeGapRow({
  gap,
  workflowKey,
  applyPatch,
}: {
  gap: EnrichedNodeGap;
  workflowKey: string;
  applyPatch: (patch: ResolvePatch) => void | Promise<void>;
}) {
  const req = gap.requirement;
  const [swap, setSwap] = useState('');
  const submit = () => {
    const cls = swap.trim();
    if (!cls) return;
    void applyPatch({ class_swaps: { [workflowKey]: { [gap.nodeId]: cls } } });
  };
  return (
    <div className={styles.gap}>
      <div className={styles.gapName}>
        <span className={styles.fn}>{gap.class_type}</span>
        <span className={styles.sub}>
          {req?.pack ? `pack: ${req.pack}` : 'custom-node class not installed'}
          {req?.installVia ? ` · via ${req.installVia === 'manager' ? 'ComfyUI-Manager' : 'git'}` : ''}
        </span>
      </div>
      <input
        className={styles.swapInput}
        placeholder="swap to installed class…"
        value={swap}
        onChange={(e) => setSwap(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        spellCheck={false}
        aria-label={`swap ${gap.class_type}`}
      />
      <button type="button" className={styles.swapBtn} onClick={submit} disabled={!swap.trim()}>
        Use
      </button>
    </div>
  );
}
