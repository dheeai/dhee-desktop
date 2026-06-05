/**
 * WorkflowImport — bring-your-own ComfyUI workflow. Paste the graph, we
 * validate it's API-format (rejecting the UI-format normal "Save"
 * produces, with the Dev-mode fix), then suggest how its inputs map to
 * the pipeline for the user to confirm. Model/custom-node fit is the
 * same BundleConfigurator.
 */
import { useState } from 'react';
import type { ParameterMapping } from '../../../shared/bundleConfigTypes';
import { Button, Textarea, Card } from '../ui';
import styles from './WorkflowImport.module.scss';

export default function WorkflowImport() {
  const [json, setJson] = useState('');
  const [reason, setReason] = useState<'ui_format' | 'invalid' | null>(null);
  const [mappings, setMappings] = useState<ParameterMapping[] | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = async () => {
    setBusy(true);
    setReason(null);
    setMappings(null);
    try {
      const v = await window.electron.bundleConfig.validateWorkflow(json);
      if (!v.ok) {
        setReason(v.reason);
        return;
      }
      const m = await window.electron.bundleConfig.suggestMap(json);
      setMappings(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={styles.wrap}>
      <Textarea
        mono
        className={styles.textarea}
        placeholder="Paste your ComfyUI workflow JSON (API format) here…"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
      />
      <Button variant="primary" onClick={() => void validate()} disabled={busy || !json.trim()}>
        {busy ? 'Checking…' : 'Validate & map'}
      </Button>

      {reason === 'ui_format' && (
        <div className={styles.reject}>
          <b>This is a UI-format workflow — Dhee needs API format.</b>
          <ol className={styles.steps}>
            <li>
              In ComfyUI: Settings → enable <b>Dev mode</b>.
            </li>
            <li>
              Use the <b>Save (API Format)</b> button that appears.
            </li>
            <li>Re-paste that file (it&apos;s structurally different from the normal save).</li>
          </ol>
        </div>
      )}
      {reason === 'invalid' && <div className={styles.reject}>That doesn&apos;t parse as a ComfyUI workflow.</div>}

      {mappings && (
        <div>
          <div className={styles.ok}>✓ API-format workflow — confirm how its inputs map to the pipeline:</div>
          {mappings.length === 0 ? (
            <div className={styles.none}>No standard inputs auto-detected — you&apos;ll map them manually.</div>
          ) : (
            <table className={styles.maptable}>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.input}>
                    <td className={styles.k}>{m.input}</td>
                    <td className={styles.arrow}>→</td>
                    <td className={styles.target}>
                      node {m.nodeId} · {m.field}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
