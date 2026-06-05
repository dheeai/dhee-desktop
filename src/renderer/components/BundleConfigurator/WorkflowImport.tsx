/**
 * WorkflowImport — bring-your-own ComfyUI workflow. Paste the graph,
 * we validate it's API-format (rejecting the UI-format normal "Save"
 * produces, with the Dev-mode fix), then suggest how its inputs map to
 * the pipeline (prompt/seed/width/height/filename_prefix) for the user
 * to confirm. Model/custom-node fit is the same BundleConfigurator.
 */
import { useState } from 'react';
import type { ParameterMapping } from '../../../shared/bundleConfigTypes';

const box: React.CSSProperties = {
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 10,
  background: 'var(--color-bg-panel)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const textarea: React.CSSProperties = {
  width: '100%',
  minHeight: 90,
  font: 'inherit',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 12,
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-panel-inset)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 6,
  padding: '9px 11px',
  resize: 'vertical',
};
const primary: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  color: '#0c0e11',
  background: 'var(--color-accent-primary)',
  border: 0,
  borderRadius: 6,
  padding: '9px 16px',
  alignSelf: 'flex-start',
};
const reject: React.CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.6,
  color: 'var(--color-error)',
  background: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
  border: '1px solid color-mix(in srgb, var(--color-error) 40%, transparent)',
  borderRadius: 8,
  padding: '12px 14px',
};

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
    <div style={box}>
      <textarea
        style={textarea}
        placeholder="Paste your ComfyUI workflow JSON (API format) here…"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
      />
      <button type="button" style={{ ...primary, opacity: busy || !json.trim() ? 0.5 : 1 }} onClick={() => void validate()} disabled={busy || !json.trim()}>
        {busy ? 'Checking…' : 'Validate & map'}
      </button>

      {reason === 'ui_format' && (
        <div style={reject}>
          <b>This is a UI-format workflow — Dhee needs API format.</b>
          <ol style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--color-text-secondary)' }}>
            <li>In ComfyUI: Settings → enable <b>Dev mode</b>.</li>
            <li>Use the <b>Save (API Format)</b> button that appears.</li>
            <li>Re-paste that file (it&apos;s structurally different from the normal save).</li>
          </ol>
        </div>
      )}
      {reason === 'invalid' && <div style={reject}>That doesn&apos;t parse as a ComfyUI workflow.</div>}

      {mappings && (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--color-success)', marginBottom: 8 }}>
            ✓ API-format workflow — confirm how its inputs map to the pipeline:
          </div>
          {mappings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              No standard inputs auto-detected — you&apos;ll map them manually.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.input} style={{ borderBottom: '1px dashed var(--color-border-subtle)' }}>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--color-text-primary)' }}>
                      {m.input}
                    </td>
                    <td style={{ padding: '7px 8px', color: 'var(--color-text-muted)' }}>→</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--color-text-secondary)' }}>
                      node {m.nodeId} · {m.field}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
