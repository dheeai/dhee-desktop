import { useEffect, useMemo, useRef, useState } from 'react';
import type { BundleSnapshot } from '../../lib/bundleCapability';
import type {
  EditingRequest,
  EditPayload,
  EditResult,
  EditVersion,
} from '../../../shared/productionEditing';
import { toFileUrl } from '../../utils/pathResolver';
import styles from './ProductionEditingPanel.module.scss';

export function ProductionEditingPanel({
  projectDir,
  bundle,
}: {
  projectDir: string;
  bundle: BundleSnapshot | null;
}) {
  const targets = useMemo(
    () =>
      (bundle?.fileInputs ?? []).flatMap((input) => {
        const nodes = (bundle?.nodes ?? []).filter(
          (n) => n.kind === 'stage' && n.outputs.pattern === input.path,
        );
        return nodes.length === 1
          ? [
              {
                ...input,
                nodeId: nodes[0].id,
                label: nodes[0].displayName ?? nodes[0].id.replace(/_/g, ' '),
                format: nodes[0].outputs.format,
              },
            ]
          : [];
      }),
    [bundle],
  );
  const [choice, setChoice] = useState('');
  const target = targets.find((t) => t.id === choice);
  const [draft, setDraft] = useState<string>();
  const [file, setFile] = useState<EditPayload>();
  const [versions, setVersions] = useState<EditVersion[]>([]);
  const [version, setVersion] = useState('');
  const [asset, setAsset] = useState<EditResult>();
  const [history, setHistory] = useState<EditResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<{
    result: EditResult;
    request: EditingRequest;
    restore: boolean;
  }>();
  const epoch = useRef(0);
  const nodeId = target?.nodeId;
  useEffect(() => {
    const id = ++epoch.current;
    setPending(undefined);
    setVersions([]);
    setVersion('');
    setDraft(undefined);
    setFile(undefined);
    setAsset(undefined);
    setHistory(undefined);
    setError('');
    if (!nodeId) {
      setBusy(false);
      return undefined;
    }
    setBusy(true);
    const api = window.dhee?.productionEditing;
    if (!api) {
      setError(
        'Editing controls are unavailable. Restart with the matching Desktop build.',
      );
      setBusy(false);
      return undefined;
    }
    Promise.all([
      api({ action: 'version.list', projectDir, nodeId }),
      api({ action: 'artifact.read', projectDir, nodeId }),
    ])
      .then(([list, read]) => {
        if (id !== epoch.current) return;
        if (!list.ok) throw Error(list.error);
        setVersions(list.result.versions ?? []);
        if (read.ok) {
          setDraft(read.result.text);
          setAsset(read.result);
        } else setError(read.error);
      })
      .catch((e) => {
        if (id === epoch.current) setError(String(e));
      })
      .finally(() => {
        if (id === epoch.current) setBusy(false);
      });
    return () => {
      epoch.current += 1;
    };
  }, [projectDir, nodeId, revision]);
  async function invoke(
    request: EditingRequest,
    done: (result: EditResult) => void,
  ) {
    const id = ++epoch.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await window.dhee.productionEditing(request);
      if (id !== epoch.current) return;
      if (!response.ok) throw Error(response.error);
      done(response.result);
    } catch (e) {
      if (id === epoch.current) {
        setError(String(e));
        setPending(undefined);
      }
    } finally {
      if (id === epoch.current) setBusy(false);
    }
  }
  const textKind =
    target && ['md', 'json', 'text', 'txt'].includes(target.format);
  function preview(restore: boolean) {
    if (!target) return;
    const request: EditingRequest = restore
      ? {
          action: 'version.restorePreview',
          projectDir,
          nodeId: target.nodeId,
          versionId: version,
        }
      : {
          action: 'input.preview',
          projectDir,
          inputId: target.id,
          payload: textKind ? { kind: 'text', content: draft ?? '' } : file!,
        };
    setPending(undefined);
    void invoke(request, (result) => {
      if (!result.fingerprint)
        throw Error('No change preview returned. Reload and try again.');
      setPending({ result, request, restore });
    });
  }
  function save() {
    if (!pending) return;
    const { request, result, restore } = pending;
    setPending(undefined);
    const action = restore ? 'version.restore' : 'input.write';
    void invoke(
      {
        ...request,
        action,
        expectedFingerprint: result.fingerprint,
        humanAcknowledged: true,
      } as EditingRequest,
      () => {
        setMessage(
          'Saved. Previous files are preserved. Review affected materials again before continuing generation.',
        );
        window.dispatchEvent(new CustomEvent('dhee:production-changed', {detail:{projectDir}}));
        setRevision((r) => r + 1);
      },
    );
  }
  return (
    <details className={styles.root}>
      <summary>Edit storyboard and references</summary>
      <p>
        Revise a script, replace a reference, or bring back a saved version.
        Preview the affected stages before saving.
      </p>
      {!targets.length ? (
        <p>
          This bundle has no declared editable stage inputs. Its existing
          materials remain available in the production view.
        </p>
      ) : (
        <fieldset disabled={busy}>
          <label>
            Material
            <select
              aria-label="Material"
              value={choice}
              onChange={(e) => {
                setPending(undefined);
                setMessage('');
                setChoice(e.target.value);
              }}
            >
              <option value="">Choose a material</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <>
              {textKind ? (
                <label>
                  Script or storyboard text
                  <textarea
                    aria-label="Script or storyboard text"
                    rows={10}
                    value={draft ?? ''}
                    disabled={draft === undefined}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setPending(undefined);
                      setMessage('');
                    }}
                  />
                </label>
              ) : (
                <>
                  {asset?.absolutePath && target.format === 'audio' && (
                    <audio
                      controls
                      src={`${toFileUrl(asset.absolutePath)}?v=${asset.sha256 ?? ''}`}
                      aria-label="Reference preview"
                    />
                  )}
                  {asset?.absolutePath && target.format === 'image' && (
                    <img
                      style={{
                        maxWidth: '100%',
                        maxHeight: 280,
                        objectFit: 'contain',
                      }}
                      src={`${toFileUrl(asset.absolutePath)}?v=${asset.sha256 ?? ''}`}
                      alt="Reference preview"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPending(undefined);
                      void invoke({ action: 'reference.pick' }, (result) => {
                        if (result.payload) {
                          setFile(result.payload);
                          if (result.payload.kind === 'localFile')
                            setAsset({
                              absolutePath: result.payload.sourcePath,
                              sha256: result.payload.expectedSha256,
                            });
                        }
                      });
                    }}
                  >
                    Choose replacement file
                  </button>
                  {file?.kind === 'localFile' && (
                    <p>Replacement: {file.sourcePath.split(/[\\/]/).pop()}</p>
                  )}
                </>
              )}
              <button
                type="button"
                disabled={textKind ? draft === undefined : !file}
                onClick={() => preview(false)}
              >
                Preview change
              </button>
              <label>
                Saved version
                <select
                  aria-label="Saved version"
                  value={version}
                  onChange={(e) => {
                    setVersion(e.target.value);
                    setHistory(undefined);
                    setPending(undefined);
                  }}
                >
                  <option value="">Choose a saved version</option>
                  {versions.map((v, i) => (
                    <option
                      key={`${v.versionId}:${i}`}
                      value={v.versionId}
                      disabled={!v.available}
                    >
                      {v.path.split(/[\\/]/).pop()}
                      {v.selected ? ' · current' : ''}
                      {!v.available
                        ? ` · unavailable: ${v.reason ?? 'missing file'}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!version}
                onClick={() => {
                  setPending(undefined);
                  void invoke(
                    {
                      action: 'artifact.read',
                      projectDir,
                      nodeId: target.nodeId,
                      versionId: version,
                    },
                    (result) => setHistory(result),
                  );
                }}
              >
                Inspect saved version
              </button>
              <button
                type="button"
                disabled={!version}
                onClick={() => preview(true)}
              >
                Preview restore
              </button>
              {history && (
                <section aria-label="Inspected saved version">
                  <p>
                    Saved version:{' '}
                    {versions.find((v) => v.versionId === version)?.path}
                  </p>
                  {history.text !== undefined && (
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        maxHeight: 240,
                        overflow: 'auto',
                      }}
                    >
                      {history.text}
                    </pre>
                  )}
                  {history.absolutePath && target.format === 'audio' && (
                    <audio
                      aria-label="Saved version preview"
                      controls
                      src={`${toFileUrl(history.absolutePath)}?v=${history.sha256 ?? ''}`}
                    />
                  )}
                  {history.absolutePath && target.format === 'image' && (
                    <img
                      style={{
                        maxWidth: '100%',
                        maxHeight: 280,
                        objectFit: 'contain',
                      }}
                      alt="Saved version preview"
                      src={`${toFileUrl(history.absolutePath)}?v=${history.sha256 ?? ''}`}
                    />
                  )}
                </section>
              )}
            </>
          )}
        </fieldset>
      )}
      {busy && <p role="status">Loading…</p>}
      {pending && (
        <section aria-label="Change preview">
          <h4>
            {pending.restore
              ? 'Restore saved version'
              : 'Save revised material'}
          </h4>
          {pending.result.candidate && (
            <p>Restore file: {pending.result.candidate.path}</p>
          )}
          <p>
            Previous files will be preserved. Affected creative approvals will
            need review again. Nothing will be generated automatically.
          </p>
          {pending.result.downstream?.length ? (
            <>
              <p>These stages will need updating:</p>
              <ul>
                {pending.result.downstream.map((d) => (
                  <li key={`${d.nodeId}:${d.itemId ?? ''}`}>
                    {bundle?.nodes.find(n => n.id === d.nodeId)?.displayName ?? d.nodeId.replace(/_/g, ' ')}
                    {d.itemId ? ` · ${d.itemId}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No downstream stages reported.</p>
          )}
          <button type="button" disabled={busy} onClick={save}>
            {pending.restore ? 'Restore this version' : 'Save this change'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPending(undefined)}
          >
            Cancel
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
