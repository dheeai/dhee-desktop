import { useCallback, useEffect, useState } from 'react';
import { Trash2, Pencil, AlertCircle, RefreshCw } from 'lucide-react';
import type {
  WorkflowSummary,
} from '../../../shared/kshanaIpc';
import styles from './SettingsPanel.module.scss';
import workflowStyles from './WorkflowsTab.module.scss';

interface WorkflowsTabProps {
  /**
   * Optional callback the panel can use to switch to chat. The
   * "Add Workflow" button calls this to take the user to the
   * conversational add-a-workflow flow (pi-agent skill drives it
   * after the user attaches a JSON file).
   */
  onOpenChatToAdd?: () => void;
}

export default function WorkflowsTab({ onOpenChatToAdd }: WorkflowsTabProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.kshana.workflows.list({});
      if (!result.ok) {
        setError(result.error ?? 'Failed to load workflows');
        setWorkflows([]);
        return;
      }
      setWorkflows(result.workflows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (workflow: WorkflowSummary) => {
      if (workflow.builtIn) return;
      const confirmed = window.confirm(
        `Delete "${workflow.displayName}" (${workflow.id})?\n\nThis removes the workflow JSON and its manifest. There's no undo.`,
      );
      if (!confirmed) return;
      setBusyId(workflow.id);
      setActionError(null);
      try {
        const result = await window.kshana.workflows.delete({ id: workflow.id });
        if (!result.ok) {
          setActionError(result.error ?? 'Delete failed');
          return;
        }
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const handleSetActive = useCallback(
    async (workflow: WorkflowSummary) => {
      setBusyId(workflow.id);
      setActionError(null);
      try {
        const result = await window.kshana.workflows.update({
          id: workflow.id,
          patch: { isOverride: true },
        });
        if (!result.ok) {
          setActionError(result.error ?? 'Update failed');
          return;
        }
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  // Group user workflows together at the top, then built-ins.
  const userWorkflows = workflows.filter((w) => !w.builtIn);
  const builtInWorkflows = workflows.filter((w) => w.builtIn);

  return (
    <>
      <div className={styles.sectionHeader}>
        <h3>Custom Workflows</h3>
        <p className={styles.sectionDescription}>
          ComfyUI workflows you've added. Use the chat to install a new
          workflow — the pi-agent walks you through validating, mapping
          variables, and saving it.
        </p>
      </div>

      <div className={workflowStyles.toolbar}>
        <button
          type="button"
          className={styles.submitButton}
          onClick={() => onOpenChatToAdd?.()}
        >
          + Add Workflow
        </button>
        <button
          type="button"
          className={workflowStyles.iconButton}
          onClick={() => void refresh()}
          aria-label="Refresh workflow list"
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? workflowStyles.spinning : ''} />
        </button>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {actionError && (
        <div className={styles.error} role="alert">
          <AlertCircle size={14} />
          <span>{actionError}</span>
        </div>
      )}

      {loading && workflows.length === 0 ? (
        <div className={workflowStyles.muted}>Loading…</div>
      ) : null}

      {/* Your workflows */}
      <div className={workflowStyles.groupHeader}>Your workflows</div>
      {userWorkflows.length === 0 ? (
        <div className={workflowStyles.emptyState}>
          No custom workflows yet. Click <strong>+ Add Workflow</strong> to
          install one via the chat.
        </div>
      ) : (
        <ul className={workflowStyles.list}>
          {userWorkflows.map((wf) => (
            <WorkflowRow
              key={wf.id}
              workflow={wf}
              onEdit={() => setEditingId(wf.id)}
              onDelete={() => void handleDelete(wf)}
              onSetActive={() => void handleSetActive(wf)}
              busy={busyId === wf.id}
              isEditing={editingId === wf.id}
              onCloseEdit={() => setEditingId(null)}
              onAfterMutation={refresh}
            />
          ))}
        </ul>
      )}

      {/* Built-ins (read-only, collapsed-style summary) */}
      <div className={workflowStyles.groupHeader}>Built-in workflows</div>
      {builtInWorkflows.length === 0 ? (
        <div className={workflowStyles.muted}>None loaded.</div>
      ) : (
        <ul className={workflowStyles.list}>
          {builtInWorkflows.map((wf) => (
            <li key={wf.id} className={workflowStyles.builtInRow}>
              <div className={workflowStyles.rowMain}>
                <span className={workflowStyles.rowName}>{wf.displayName}</span>
                <span className={workflowStyles.rowMeta}>
                  {wf.id} · {wf.pipeline}
                </span>
              </div>
              <span className={workflowStyles.builtInBadge}>built-in</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── Single workflow row + inline edit panel ──────────────────────────

function WorkflowRow({
  workflow,
  onEdit,
  onDelete,
  onSetActive,
  busy,
  isEditing,
  onCloseEdit,
  onAfterMutation,
}: {
  workflow: WorkflowSummary;
  onEdit: () => void;
  onDelete: () => void;
  onSetActive: () => void;
  busy: boolean;
  isEditing: boolean;
  onCloseEdit: () => void;
  onAfterMutation: () => Promise<void>;
}) {
  return (
    <li className={workflowStyles.row}>
      <div className={workflowStyles.rowHeader}>
        <div className={workflowStyles.rowMain}>
          <span className={workflowStyles.rowName}>{workflow.displayName}</span>
          <span className={workflowStyles.rowMeta}>
            {workflow.id} · {workflow.pipeline}
            {workflow.isOverride ? ' · active for pipeline' : ''}
          </span>
        </div>
        <div className={workflowStyles.rowActions}>
          {!workflow.isOverride && (
            <button
              type="button"
              className={workflowStyles.actionButton}
              onClick={onSetActive}
              disabled={busy}
              title="Make this the default workflow for its pipeline"
            >
              Set active
            </button>
          )}
          <button
            type="button"
            className={workflowStyles.iconButton}
            onClick={onEdit}
            aria-label={`Edit ${workflow.displayName}`}
            title="Edit defaults"
            disabled={busy}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className={`${workflowStyles.iconButton} ${workflowStyles.danger}`}
            onClick={onDelete}
            aria-label={`Delete ${workflow.displayName}`}
            title="Delete workflow"
            disabled={busy}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {isEditing && (
        <WorkflowEditor
          workflowId={workflow.id}
          onClose={onCloseEdit}
          onSaved={async () => {
            await onAfterMutation();
            onCloseEdit();
          }}
        />
      )}
    </li>
  );
}

// ── Inline editor for a workflow's defaults ──────────────────────────

interface ParameterMappingRow {
  input: string;
  nodeId: string;
  field: string;
  defaultValue: unknown;
}

function WorkflowEditor({
  workflowId,
  onClose,
  onSaved,
}: {
  workflowId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [mappings, setMappings] = useState<ParameterMappingRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.kshana.workflows.get({ id: workflowId });
        if (cancelled) return;
        if (!result.ok || !result.manifest) {
          setError(result.error ?? 'Could not load workflow');
          return;
        }
        const m = result.manifest as {
          displayName?: string;
          parameterMappings?: ParameterMappingRow[];
        };
        setDisplayName(m.displayName ?? '');
        setMappings(
          (m.parameterMappings ?? []).map((p) => ({
            input: String(p.input ?? ''),
            nodeId: String(p.nodeId ?? ''),
            field: String(p.field ?? ''),
            defaultValue: p.defaultValue,
          })),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await window.kshana.workflows.update({
        id: workflowId,
        patch: {
          displayName,
          parameterMappings: mappings,
        },
      });
      if (!result.ok) {
        setError(result.error ?? 'Save failed');
        return;
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [workflowId, displayName, mappings, onSaved]);

  if (loading) {
    return <div className={workflowStyles.editor}><span className={workflowStyles.muted}>Loading…</span></div>;
  }

  return (
    <div className={workflowStyles.editor}>
      {error && (
        <div className={styles.error} role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      <label className={workflowStyles.field}>
        <span className={workflowStyles.fieldLabel}>Display name</span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={workflowStyles.input}
          disabled={saving}
        />
      </label>

      <div className={workflowStyles.fieldLabel}>Parameter defaults</div>
      <div className={workflowStyles.tableWrap}>
        <table className={workflowStyles.table}>
          <thead>
            <tr>
              <th>Variable</th>
              <th>Node</th>
              <th>Field</th>
              <th>Default value</th>
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 ? (
              <tr>
                <td colSpan={4} className={workflowStyles.muted}>
                  No parameter mappings.
                </td>
              </tr>
            ) : (
              mappings.map((m, idx) => (
                <tr key={`${m.input}_${idx}`}>
                  <td className={workflowStyles.cellMono}>{m.input}</td>
                  <td className={workflowStyles.cellMono}>{m.nodeId}</td>
                  <td className={workflowStyles.cellMono}>{m.field}</td>
                  <td>
                    <input
                      type="text"
                      className={workflowStyles.input}
                      value={
                        m.defaultValue === undefined || m.defaultValue === null
                          ? ''
                          : typeof m.defaultValue === 'object'
                            ? JSON.stringify(m.defaultValue)
                            : String(m.defaultValue)
                      }
                      onChange={(e) => {
                        const next = [...mappings];
                        // Keep value as a string by default. Numeric
                        // fields can be edited as text — kshana-core
                        // coerces at execution time.
                        next[idx] = { ...next[idx], defaultValue: e.target.value };
                        setMappings(next);
                      }}
                      disabled={saving}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={workflowStyles.editorActions}>
        <button
          type="button"
          className={workflowStyles.actionButton}
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.submitButton}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      <p className={workflowStyles.editorHint}>
        For deeper changes (renaming variables, remapping nodes, changing
        pipeline) re-run the workflow through the chat — the pi-agent will
        re-analyze it.
      </p>
    </div>
  );
}
