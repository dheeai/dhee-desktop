import { useEffect, useRef, useState, useId } from 'react';
import type { GpuTarget, GpuWorkflow } from '../../../shared/gpuQueue';
import styles from './GpuPreparationPanel.module.scss';

const targetKey = (target: GpuTarget) =>
  JSON.stringify([target.nodeId, target.itemId ?? '']);
const supported = [
  'string',
  'file',
  'file_list',
  'int',
  'float',
  'number',
  'bool',
  'enum',
];
function optionsFor(schema: Record<string, unknown>): unknown[] {
  if (schema.type === 'bool') return [true, false];
  return Array.isArray(schema.options) ? schema.options : [];
}
function defaults(workflow: GpuWorkflow, saved?: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(workflow.inputs).map(([name, schema]) => {
      const value = saved?.[name] ?? schema.default;
      if (value === undefined) return [name, ''];
      return [name, Array.isArray(value) ? value.join('\n') : String(value)];
    }),
  );
}
function values(workflow: GpuWorkflow, draft: Record<string, string>) {
  const result: Record<string, unknown> = {};
  Object.entries(workflow.inputs).forEach(([name, schema]) => {
    const text = draft[name] ?? '';
    if (!text.trim()) {
      if (
        schema.required === true &&
        schema.random_default !== true &&
        schema.default === undefined
      )
        throw new Error(`Enter ${name}.`);
      return;
    }
    if (schema.type === 'file_list')
      result[name] = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    else if (['int', 'float', 'number'].includes(String(schema.type))) {
      const numeric = Number(text);
      if (!Number.isFinite(numeric))
        throw new Error(`Enter a number for ${name}.`);
      result[name] = numeric;
    } else if (schema.type === 'bool') result[name] = text === 'true';
    else if (schema.type === 'enum')
      result[name] = (schema.options as unknown[]).find(
        (option) => String(option) === text,
      );
    else result[name] = text;
  });
  return result;
}
export function GpuPreparationPanel({ projectDir }: { projectDir: string }) {
  const formId = useId();
  const [branchId, setBranchId] = useState('main');
  const [branches, setBranches] = useState<
    { branchId: string; label?: string }[]
  >([{ branchId: 'main' }]);
  const [targets, setTargets] = useState<GpuTarget[]>([]);
  const [selected, setSelected] = useState('');
  const [workflows, setWorkflows] = useState<GpuWorkflow[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const retry = useRef<{ body: string; requestId: string } | null>(null);
  const target = targets.find((item) => targetKey(item) === selected);
  const workflow = workflows.find((item) => item.name === workflowName);
  async function refreshTargets(token: number) {
    if (!window.dhee.gpuPreparation)
      throw new Error('This Desktop build does not support GPU preparation.');
    const response = await window.dhee.gpuPreparation({
      action: 'gpu.targets',
      projectDir,
      branchId,
    });
    if (revision.current !== token) return;
    if (!response.ok) throw new Error(response.error);
    setTargets(response.result.targets ?? []);
    setBranches(response.result.branches ?? [{ branchId }]);
  }
  useEffect(() => {
    revision.current += 1;
    const token = revision.current;
    setTargets([]);
    setSelected('');
    setWorkflowName('');
    setDraft({});
    setMessage('');
    setError('');
    setBusy(true);
    retry.current = null;
    refreshTargets(token)
      .finally(() => {
        if (revision.current === token) setBusy(false);
      })
      .catch((failure: Error) => {
        if (revision.current === token) setError(failure.message);
      });
    return () => {
      revision.current += 1;
    };
    // The project and branch own all async results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir, branchId]);
  function chooseWorkflow(name: string, nextTarget = target) {
    setWorkflowName(name);
    setMessage('');
    setError('');
    const chosen = workflows.find((item) => item.name === name);
    const saved = nextTarget?.selection;
    setDraft(
      chosen
        ? defaults(
            chosen,
            saved?.workflow === name && saved.workflowVersion === chosen.version
              ? (saved.inputs as Record<string, unknown>)
              : undefined,
          )
        : {},
    );
  }
  async function loadWorkflows() {
    const token = revision.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await window.dhee.gpuPreparation({
        action: 'gpu.catalog',
      });
      if (revision.current !== token) return;
      if (!response.ok) throw new Error(response.error);
      setWorkflows(response.result.workflows ?? []);
      setWorkflowName('');
      setDraft({});
    } catch (failure) {
      if (revision.current === token)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (revision.current === token) setBusy(false);
    }
  }
  async function save() {
    if (!target || !workflow?.version) return;
    const token = revision.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = {
        action: 'gpu.prepare' as const,
        projectDir,
        branchId,
        nodeId: target.nodeId,
        ...(target.itemId ? { itemId: target.itemId } : {}),
        expectedSelectionId: target.selectionId,
        workflow: workflow.name,
        workflowVersion: workflow.version,
        inputs: values(workflow, draft),
        primaryOutput: 0,
      };
      const serialized = JSON.stringify(body);
      if (retry.current?.body !== serialized)
        retry.current = {
          body: serialized,
          requestId: window.crypto.randomUUID(),
        };
      const response = await window.dhee.gpuPreparation({
        ...body,
        requestId: retry.current.requestId,
      });
      if (revision.current !== token) return;
      if (!response.ok) throw new Error(response.error);
      setMessage(
        response.result.active === false
          ? 'This attempt was superseded. Reload the target to see the current selection.'
          : 'Attempt saved. No job has been submitted; creative approvals still apply.',
      );
      await refreshTargets(token);
    } catch (failure) {
      if (revision.current === token)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (revision.current === token) setBusy(false);
    }
  }
  const unsupported =
    workflow &&
    Object.values(workflow.inputs).some(
      (schema) => !supported.includes(String(schema.type)),
    );
  const blocked =
    !target ||
    target.unsupported ||
    ['completed', 'in_progress'].includes(target.status);
  return (
    <details className={styles.root}>
      <summary>Prepare a GPU scene or reference</summary>
      <p>
        Choose inputs for one planned output. Saving prepares an attempt without
        uploading references or starting generation.
      </p>
      <fieldset disabled={busy}>
        <div className={styles.row}>
          <label htmlFor={`${formId}-branch`}>
            Project branch
            <select
              id={`${formId}-branch`}
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.branchId} value={branch.branchId}>
                  {branch.label ?? branch.branchId}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${formId}-target`}>
            Scene or reference
            <select
              id={`${formId}-target`}
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                chooseWorkflow(
                  '',
                  targets.find(
                    (item) => targetKey(item) === event.target.value,
                  ),
                );
              }}
            >
              <option value="">Choose a planned output</option>
              {targets.map((item) => (
                <option key={targetKey(item)} value={targetKey(item)}>
                  {item.nodeId}
                  {item.itemId ? ` · ${item.itemId}` : ''} · {item.status}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!targets.length && !busy && (
          <p>No media targets are ready in the current plan.</p>
        )}
        {target?.selection && (
          <p>
            Saved workflow: {String(target.selection.workflow)} ·{' '}
            {String(target.selection.workflowVersion)}
          </p>
        )}
        {target && blocked && (
          <p>
            This output is complete, running, or needs adaptive chunk planning.
            Stop or explicitly invalidate it before preparing a replacement.
          </p>
        )}
        <button type="button" onClick={loadWorkflows}>
          Load workflows
        </button>
        <label htmlFor={`${formId}-workflow`}>
          Workflow
          <select
            id={`${formId}-workflow`}
            value={workflowName}
            onChange={(event) => chooseWorkflow(event.target.value)}
          >
            <option value="">Choose a catalog workflow</option>
            {workflows.map((item) => (
              <option
                key={item.name}
                value={item.name}
                disabled={!item.available || !item.version}
              >
                {item.name} · {item.version ?? 'no version'}
                {item.available ? '' : ' · unavailable'}
              </option>
            ))}
          </select>
        </label>
        {workflow && (
          <>
            <p>{workflow.description}</p>
            <p>
              {workflow.status === 'unchecked'
                ? 'Available, not yet verified by a completed render.'
                : `Gateway status: ${workflow.status}`}
            </p>
            {Object.entries(workflow.inputs).map(([name, schema]) => (
              <label key={name} htmlFor={`${formId}-${name}`}>
                {name}
                {schema.required === true ? ' *' : ''}
                {schema.type === 'bool' || schema.type === 'enum' ? (
                  <select
                    id={`${formId}-${name}`}
                    aria-label={`${name}${schema.required === true ? ' *' : ''}`}
                    value={draft[name] ?? ''}
                    onChange={(event) =>
                      setDraft({ ...draft, [name]: event.target.value })
                    }
                  >
                    <option value="">Choose</option>
                    {optionsFor(schema).map((option) => (
                      <option key={String(option)} value={String(option)}>
                        {String(option)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    rows={schema.type === 'string' ? 3 : 2}
                    id={`${formId}-${name}`}
                    aria-label={`${name}${schema.required === true ? ' *' : ''}`}
                    value={draft[name] ?? ''}
                    onChange={(event) =>
                      setDraft({ ...draft, [name]: event.target.value })
                    }
                  />
                )}
                {typeof schema.description === 'string' && (
                  <small>{schema.description}</small>
                )}
                {schema.type === 'file_list' && (
                  <small>
                    One project media path or upload handle per line, in
                    reference order.
                  </small>
                )}
                {schema.type === 'file' && (
                  <small>Project media path or upload handle.</small>
                )}
                {schema.random_default === true && (
                  <small>Leave blank for a seed saved with this attempt.</small>
                )}
              </label>
            ))}
          </>
        )}
        {unsupported && (
          <p>This workflow has inputs this form does not support yet.</p>
        )}
        <button
          type="button"
          disabled={
            blocked ||
            !workflow?.available ||
            !workflow.version ||
            !!unsupported
          }
          onClick={save}
        >
          Save generation attempt
        </button>
      </fieldset>
      {busy && <p role="status">Working…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}

export default GpuPreparationPanel;
