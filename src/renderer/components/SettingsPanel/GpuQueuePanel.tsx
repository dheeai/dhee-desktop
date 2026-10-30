import { useEffect, useRef, useState } from 'react';
import type { GpuCatalogResponse, GpuWorkflow } from '../../../shared/gpuQueue';
import styles from './SettingsPanel.module.scss';
import workflowStyles from './WorkflowsTab.module.scss';

function availability(workflow: GpuWorkflow): string {
  if (!workflow.available)
    return `Unavailable${workflow.reason ? ` · ${workflow.reason}` : ''}`;
  if (workflow.status === 'unchecked') return 'Available · not yet verified';
  return `Available · gateway status: ${workflow.status}`;
}

export default function GpuQueuePanel({
  savedEndpoint = '',
}: {
  savedEndpoint?: string;
}) {
  const [endpoint, setEndpoint] = useState(savedEndpoint);
  const [result, setResult] = useState<GpuCatalogResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const revision = useRef(0);
  const previousSaved = useRef(savedEndpoint);
  useEffect(() => {
    if (previousSaved.current !== savedEndpoint) {
      if (endpoint === previousSaved.current) {
        revision.current += 1;
        setEndpoint(savedEndpoint);
        setResult(null);
        setBusy(false);
        setSaved(false);
      }
      previousSaved.current = savedEndpoint;
    }
  }, [savedEndpoint, endpoint]);
  useEffect(
    () => () => {
      revision.current += 1;
    },
    [],
  );

  async function check() {
    revision.current += 1;
    const request = revision.current;
    setBusy(true);
    setResult(null);
    setSaved(false);
    try {
      const response = await window.dhee.gpuQueueCatalog({ endpoint });
      if (revision.current === request) setResult(response);
    } catch (error) {
      if (revision.current === request)
        setResult({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (revision.current === request) setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await window.electron.settings.update({ gpuQueueUrl: endpoint.trim() });
      setSaved(true);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="RTX 5090 shared queue">
      <div className={styles.sectionHeader}>
        <h3>RTX 5090 shared queue</h3>
        <p className={styles.sectionDescription}>
          Connect to the shared generation queue. Checking the connection does
          not start a render.
        </p>
      </div>
      <label className={workflowStyles.field} htmlFor="gpu-queue-endpoint">
        <span className={workflowStyles.fieldLabel}>
          GPU queue MCP endpoint
        </span>
        <input
          className={workflowStyles.input}
          id="gpu-queue-endpoint"
          type="url"
          value={endpoint}
          disabled={busy}
          placeholder="http://your-gpu-host:9000/mcp"
          onChange={(event) => {
            revision.current += 1;
            setEndpoint(event.target.value);
            setResult(null);
            setSaved(false);
          }}
        />
      </label>
      <div className={workflowStyles.editorActions}>
        <button
          className={workflowStyles.actionButton}
          type="button"
          disabled={busy || !endpoint.trim()}
          onClick={check}
        >
          {busy ? 'Working…' : 'Check connection'}
        </button>
        <button
          className={workflowStyles.actionButton}
          type="button"
          disabled={busy || !result?.ok}
          onClick={save}
        >
          Save connection
        </button>
      </div>
      {saved && <p role="status">Connection saved.</p>}
      {result && !result.ok && (
        <p className={styles.error} role="alert">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <>
          <p role="status">
            Connected · {result.workflows.length} workflows. A connection check
            does not verify render quality.
          </p>
          <ul className={workflowStyles.list}>
            {result.workflows.map((workflow) => (
              <li className={workflowStyles.builtInRow} key={workflow.name}>
                <div className={workflowStyles.rowMain}>
                  <span className={workflowStyles.rowName}>
                    {workflow.name}
                  </span>
                  <span className={workflowStyles.rowMeta}>
                    {workflow.description}
                  </span>
                  <span className={workflowStyles.rowMeta}>
                    {availability(workflow)}
                  </span>
                  {workflow.version && (
                    <span className={workflowStyles.rowMeta}>
                      Version {workflow.version}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

GpuQueuePanel.defaultProps = { savedEndpoint: '' };
