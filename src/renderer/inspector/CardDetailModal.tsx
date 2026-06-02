/**
 * CardDetailModal — fullscreen overlay for inspecting an instance.
 *
 * Renders the full artifact (md/json/image/video/audio) at large size
 * + the metadata header + an action bar driven by `availableActions`.
 *
 * Three modes, switched by the action bar:
 *   - view     — the artifact at full size (default).
 *   - versions — every version of this instance (folded from the event
 *                log); click one to select it (emits version.selected).
 *   - edit     — a friendly inline editor. For JSON nodes whose bundle
 *                names a `headlineField` (e.g. imagePrompt) we surface
 *                JUST that text, not the raw JSON guts. Save routes
 *                through dhee-core's writeNodeContent (preserve prior
 *                version + per-instance downstream cascade).
 *
 * open-file / regenerate / invalidate are dispatched UP to the parent
 * (it owns the graph + redo/invalidate IPC). versions + edit are
 * handled here because they only need this instance's identity.
 */
import { useEffect, useState } from 'react';
import type { InstanceGraphNode, VersionTrayEntry } from '../../shared/dheeIpc';
import {
  availableActions,
  actionLabel,
  instanceKey,
  type CardAction,
} from './cardDetailModel';
import { prepareEdit, applyEdit, prepareReadableView, type PreparedEdit, type ReadableField } from './nodeTextEdit';

interface Props {
  instance: InstanceGraphNode | null;
  projectDir: string | null;
  /** Bundle dot-path naming this node's primary text field, if any. */
  headlineField?: string;
  onClose: () => void;
  onAction: (action: CardAction, instance: InstanceGraphNode) => void;
  /** Called after a version select / content edit so the parent re-reads the graph. */
  onChanged?: () => void | Promise<void>;
}

type Panel = 'view' | 'versions' | 'edit';

function inferFormat(outputPath: string | undefined): 'md' | 'json' | 'image' | 'video' | 'audio' | 'unknown' {
  if (!outputPath) return 'unknown';
  const lower = outputPath.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')) return 'image';
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) return 'video';
  if (lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.endsWith('.ogg') || lower.endsWith('.flac')) return 'audio';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'md';
  return 'unknown';
}

function statusColor(s: string): string {
  switch (s) {
    case 'completed':   return '#6d8f7a';
    case 'in_progress': return '#907b58';
    case 'failed':      return '#a56d6f';
    case 'invalidated': return '#a9b0ba';
    default:            return '#7d848e';
  }
}

function fmtTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(ms);
  }
}

const BTN_GHOST: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(168, 156, 139, 0.24)',
  color: '#e5e1d8',
  padding: '8px 16px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
};

/** Render a single supporting field's value — references as chips,
 * arrays/objects compactly, primitives as text. */
function FieldValue({ value }: { value: unknown }) {
  // Array of {id, type?} → reference chips (the common shot-prompt shape).
  if (Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'id' in (v as object))) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(value as Array<Record<string, unknown>>).map((ref, i) => (
          <span
            key={`${String(ref.id)}-${i}`}
            style={{
              fontSize: 11,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: '#e5e1d8',
              background: 'rgba(95, 136, 178, 0.12)',
              border: '1px solid rgba(95, 136, 178, 0.3)',
              borderRadius: 5,
              padding: '3px 8px',
            }}
          >
            {String(ref.id)}{ref.type ? <span style={{ color: 'rgba(229,225,216,0.5)' }}> · {String(ref.type)}</span> : null}
          </span>
        ))}
      </div>
    );
  }
  if (Array.isArray(value)) {
    return <span>{value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')}</span>;
  }
  if (value !== null && typeof value === 'object') {
    return <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{JSON.stringify(value)}</span>;
  }
  return <span>{String(value)}</span>;
}

/** Readable view of a JSON node: prose headline + supporting details,
 * with a toggle to the raw JSON. Default is the friendly view — the raw
 * guts are one click away, not the first thing you see. */
function JsonReadableBody({
  content,
  outputPath,
  headlineField,
  showRaw,
  onToggleRaw,
}: {
  content: string;
  outputPath: string | undefined;
  headlineField?: string;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const view = prepareReadableView({ content, outputPath, ...(headlineField ? { headlineField } : {}) });
  // Only offer the toggle when there's a friendly view to toggle FROM.
  const canToggle = view.kind === 'json';
  const showingRaw = showRaw || !canToggle;

  return (
    <div style={{ padding: 24, position: 'relative' }}>
      {canToggle && (
        <button
          onClick={onToggleRaw}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: '1px solid rgba(168, 156, 139, 0.24)',
            color: 'rgba(229,225,216,0.7)',
            padding: '4px 10px',
            borderRadius: 5,
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}
        >
          {showRaw ? '✦ Formatted' : '{ } Raw JSON'}
        </button>
      )}

      {showingRaw && (
        <pre
          style={{
            margin: 0,
            paddingRight: 90,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.6,
            color: '#d6d2c8',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {view.kind === 'raw' ? view.raw : view.kind === 'json' ? view.raw : content}
        </pre>
      )}

      {!showingRaw && view.kind === 'json' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingRight: 90 }}>
          <div>
            <div style={{ fontSize: 11, color: '#a9b0ba', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, marginBottom: 8 }}>
              {view.headlineLabel}
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.6, color: '#e5e1d8' }}>{view.headline}</div>
          </div>
          {view.fields.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid rgba(168, 156, 139, 0.12)', paddingTop: 16 }}>
              {view.fields.map((f: ReadableField) => (
                <div key={f.key} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                  <div style={{ width: 140, flexShrink: 0, fontSize: 11, color: 'rgba(229,225,216,0.5)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {f.label}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, color: '#d6d2c8', minWidth: 0 }}>
                    <FieldValue value={f.value} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CardDetailModal({ instance, projectDir, headlineField, onClose, onAction, onChanged }: Props) {
  const [text, setText] = useState<string | null>(null);

  // Mode + panel state.
  const [panel, setPanel] = useState<Panel>('view');
  // Versions.
  const [versions, setVersions] = useState<VersionTrayEntry[] | null>(null);
  const [versionsErr, setVersionsErr] = useState<string | null>(null);
  // Edit.
  const [prepared, setPrepared] = useState<PreparedEdit | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editOriginal, setEditOriginal] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** High-blast-radius preview text awaiting an explicit confirm. */
  const [blastPreview, setBlastPreview] = useState<string | null>(null);
  /** JSON view: show raw guts instead of the readable summary. */
  const [showRaw, setShowRaw] = useState(false);

  const instKey = instance ? instanceKey(instance) : null;

  // Reset to view mode whenever a DIFFERENT instance opens (by key, so a
  // version-select that swaps the same instance's outputPath doesn't kick
  // us out of the Versions panel).
  useEffect(() => {
    setPanel('view');
    setVersions(null);
    setVersionsErr(null);
    setPrepared(null);
    setEditErr(null);
    setBlastPreview(null);
    setShowRaw(false);
  }, [instKey]);

  // ESC to close (or back out of a panel).
  useEffect(() => {
    if (!instance) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (panel !== 'view') setPanel('view');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [instance, onClose, panel]);

  // Load text body for md/json.
  useEffect(() => {
    setText(null);
    if (!instance || !projectDir || !instance.outputPath) return;
    const fmt = inferFormat(instance.outputPath);
    if (fmt !== 'md' && fmt !== 'json') return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await window.electron.project.readFile(`${projectDir}/${instance.outputPath}`);
        if (cancelled) return;
        setText(raw ?? '');
      } catch (e) {
        if (!cancelled) setText(`(read failed: ${e instanceof Error ? e.message : String(e)})`);
      }
    })();
    return () => { cancelled = true; };
  }, [instance, projectDir]);

  if (!instance) return null;

  const fmt = inferFormat(instance.outputPath);
  const actions = availableActions(instance);
  const fileUrl = projectDir && instance.outputPath ? `file://${projectDir}/${instance.outputPath}` : null;

  async function loadVersions(): Promise<void> {
    if (!instance || !projectDir) return;
    setVersions(null);
    setVersionsErr(null);
    try {
      const resp = await window.dhee.listVersions({
        projectDir,
        nodeId: instance.nodeId,
        ...(instance.itemId ? { itemId: instance.itemId } : {}),
      });
      if (resp.ok) setVersions(resp.versions ?? []);
      else setVersionsErr(resp.error ?? 'failed to list versions');
    } catch (e) {
      setVersionsErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function selectVersion(versionId: string): Promise<void> {
    if (!instance || !projectDir) return;
    try {
      await window.dhee.selectVersion({
        projectDir,
        nodeId: instance.nodeId,
        versionId,
        ...(instance.itemId ? { itemId: instance.itemId } : {}),
      });
      await onChanged?.();
      await loadVersions();
    } catch (e) {
      setVersionsErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function startEdit(): Promise<void> {
    if (!instance) return;
    let raw = text;
    if (raw === null && projectDir && instance.outputPath) {
      try {
        raw = (await window.electron.project.readFile(`${projectDir}/${instance.outputPath}`)) ?? '';
      } catch {
        raw = '';
      }
    }
    raw = raw ?? '';
    const p = prepareEdit({ content: raw, outputPath: instance.outputPath, ...(headlineField ? { headlineField } : {}) });
    setEditOriginal(raw);
    setPrepared(p);
    setEditValue(p.editable);
    setEditErr(null);
    setBlastPreview(null);
    setPanel('edit');
  }

  async function saveEdit(confirm: boolean): Promise<void> {
    if (!instance || !projectDir || !prepared) return;
    const applied = applyEdit({
      original: editOriginal,
      kind: prepared.kind,
      ...(prepared.headlineField ? { headlineField: prepared.headlineField } : {}),
      edited: editValue,
    });
    if (!applied.ok) {
      setEditErr(applied.error);
      return;
    }
    setSaving(true);
    setEditErr(null);
    try {
      const resp = await window.dhee.writeNodeContent({
        projectDir,
        nodeId: instance.nodeId,
        ...(instance.itemId ? { itemId: instance.itemId } : {}),
        content: applied.content,
        reason: 'inspector inline edit',
        confirm,
      });
      if (!resp.ok) {
        setEditErr(resp.error ?? 'write failed');
        return;
      }
      if (resp.status === 'preview') {
        setBlastPreview(resp.preview ?? 'This edit has a large downstream blast radius.');
        return;
      }
      // Written.
      setBlastPreview(null);
      setPanel('view');
      await onChanged?.();
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleAction(a: CardAction): void {
    if (!instance) return;
    if (a === 'show-versions') {
      setPanel('versions');
      void loadVersions();
      return;
    }
    if (a === 'edit') {
      void startEdit();
      return;
    }
    onAction(a, instance);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 9, 13, 0.82)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#161821',
          border: '1px solid rgba(168, 156, 139, 0.18)',
          borderRadius: 14,
          width: 'min(1200px, 96vw)',
          height: 'min(820px, 90vh)',
          display: 'flex',
          flexDirection: 'column',
          color: '#e5e1d8',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid rgba(168, 156, 139, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: '#a9b0ba', letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 600 }}>
              {instance.nodeId}
              {panel !== 'view' && (
                <span style={{ color: '#5f88b2', marginLeft: 8 }}>· {panel === 'versions' ? 'Versions' : 'Edit'}</span>
              )}
            </div>
            {instance.itemId && (
              <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14, color: '#e5e1d8', marginTop: 4 }}>
                {instance.itemId}
              </div>
            )}
            {instance.outputPath && (
              <div
                style={{
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  fontSize: 11,
                  color: 'rgba(229, 225, 216, 0.5)',
                  marginTop: 4,
                }}
                title={instance.outputPath}
              >
                {instance.outputPath}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                background: statusColor(instance.status),
                color: '#161821',
                padding: '4px 10px',
                borderRadius: 5,
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              {instance.status}
            </span>
            <button onClick={onClose} style={{ ...BTN_GHOST, color: '#a9b0ba', padding: '6px 14px' }}>
              Close ⏎
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', background: '#0c0d11' }}>
          {/* ── VIEW ─────────────────────────────────────────────── */}
          {panel === 'view' && (
            <>
              {fmt === 'image' && fileUrl && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
                  <img src={fileUrl} alt={instance.outputPath ?? ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>
              )}
              {fmt === 'video' && fileUrl && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
                  <video src={fileUrl} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
                </div>
              )}
              {fmt === 'audio' && fileUrl && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
                  <audio src={fileUrl} controls style={{ width: '100%', maxWidth: 600 }} />
                </div>
              )}
              {fmt === 'md' && (
                <pre
                  style={{
                    margin: 0,
                    padding: 24,
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: '#d6d2c8',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {text === null ? '(loading…)' : text}
                </pre>
              )}
              {fmt === 'json' && (
                text === null ? (
                  <div style={{ padding: 24, color: 'rgba(229,225,216,0.55)', fontSize: 13 }}>(loading…)</div>
                ) : (
                  <JsonReadableBody
                    content={text}
                    outputPath={instance.outputPath}
                    headlineField={headlineField}
                    showRaw={showRaw}
                    onToggleRaw={() => setShowRaw((v) => !v)}
                  />
                )
              )}
              {(fmt === 'unknown' || !fileUrl) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(229,225,216,0.55)', fontSize: 13 }}>
                  {instance.error ? `Failed: ${instance.error}` : 'No content to display yet.'}
                </div>
              )}
            </>
          )}

          {/* ── VERSIONS ─────────────────────────────────────────── */}
          {panel === 'versions' && (
            <div style={{ padding: 24 }}>
              {versionsErr && (
                <div style={{ color: '#a56d6f', fontSize: 13, marginBottom: 12 }}>Failed to load versions: {versionsErr}</div>
              )}
              {versions === null && !versionsErr && (
                <div style={{ color: 'rgba(229,225,216,0.55)', fontSize: 13 }}>Loading versions…</div>
              )}
              {versions !== null && versions.length === 0 && (
                <div style={{ color: 'rgba(229,225,216,0.55)', fontSize: 13 }}>
                  No recorded versions yet. Versions appear after a regenerate or an edit.
                </div>
              )}
              {versions !== null && versions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {versions.map((v) => {
                    const vUrl = projectDir ? `file://${projectDir}/${v.outputPath}` : null;
                    const vFmt = inferFormat(v.outputPath);
                    return (
                      <div
                        key={v.versionId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: `1px solid ${v.selected ? '#5f88b2' : 'rgba(168, 156, 139, 0.18)'}`,
                          background: v.selected ? 'rgba(95, 136, 178, 0.10)' : 'transparent',
                        }}
                      >
                        {/* Thumbnail for image versions */}
                        {vFmt === 'image' && vUrl && (
                          <img src={vUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#e5e1d8' }}>
                              {v.versionId}
                            </span>
                            {v.selected && (
                              <span style={{ background: '#5f88b2', color: '#161821', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Selected
                              </span>
                            )}
                            {v.tool && (
                              <span style={{ fontSize: 10, color: 'rgba(95, 136, 178, 0.85)' }}>{v.tool}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: 'rgba(229,225,216,0.45)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.outputPath}>
                            {fmtTimestamp(v.createdAt)} · {v.outputPath}
                          </div>
                        </div>
                        <button
                          onClick={() => void selectVersion(v.versionId)}
                          disabled={v.selected}
                          style={{
                            ...BTN_GHOST,
                            padding: '6px 12px',
                            opacity: v.selected ? 0.4 : 1,
                            cursor: v.selected ? 'default' : 'pointer',
                          }}
                        >
                          {v.selected ? 'Current' : 'Select'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── EDIT ─────────────────────────────────────────────── */}
          {panel === 'edit' && prepared && (
            <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>
              <div style={{ fontSize: 11, color: '#a9b0ba', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
                {prepared.label}
                {prepared.kind === 'json-field' && (
                  <span style={{ textTransform: 'none', letterSpacing: 0, color: 'rgba(229,225,216,0.45)', marginLeft: 8, fontWeight: 400 }}>
                    (the rest of the JSON is preserved)
                  </span>
                )}
              </div>
              <textarea
                value={editValue}
                onChange={(e) => { setEditValue(e.target.value); setBlastPreview(null); }}
                spellCheck={false}
                style={{
                  flex: 1,
                  width: '100%',
                  resize: 'none',
                  background: '#0c0d11',
                  color: '#e5e1d8',
                  border: '1px solid rgba(168, 156, 139, 0.24)',
                  borderRadius: 8,
                  padding: 14,
                  fontFamily: prepared.kind === 'json-raw' ? 'ui-monospace, Menlo, monospace' : 'system-ui, -apple-system, sans-serif',
                  fontSize: 13,
                  lineHeight: 1.6,
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              {editErr && <div style={{ color: '#a56d6f', fontSize: 12 }}>{editErr}</div>}
              {blastPreview && (
                <div style={{ color: '#caa46a', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', border: '1px solid rgba(202,164,106,0.3)', borderRadius: 8, padding: 12, background: 'rgba(202,164,106,0.06)' }}>
                  {blastPreview}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: '1px solid rgba(168, 156, 139, 0.12)',
            display: 'flex',
            gap: 8,
            justifyContent: panel === 'view' ? 'flex-end' : 'space-between',
            alignItems: 'center',
          }}
        >
          {panel === 'view' && actions.map((a) => (
            <button
              key={a}
              onClick={() => handleAction(a)}
              style={{
                ...BTN_GHOST,
                background: a === 'regenerate' ? '#5f88b2' : 'transparent',
                border: `1px solid ${a === 'regenerate' ? '#5f88b2' : 'rgba(168, 156, 139, 0.24)'}`,
                color: a === 'regenerate' ? '#161821' : '#e5e1d8',
                fontWeight: a === 'regenerate' ? 600 : 400,
              }}
            >
              {actionLabel(a)}
            </button>
          ))}

          {panel === 'versions' && (
            <>
              <button onClick={() => setPanel('view')} style={BTN_GHOST}>← Back</button>
              <span style={{ fontSize: 11, color: 'rgba(229,225,216,0.45)' }}>
                {versions ? `${versions.length} version${versions.length === 1 ? '' : 's'}` : ''}
              </span>
            </>
          )}

          {panel === 'edit' && (
            <>
              <button onClick={() => setPanel('view')} style={BTN_GHOST} disabled={saving}>← Cancel</button>
              <div style={{ display: 'flex', gap: 8 }}>
                {blastPreview ? (
                  <button
                    onClick={() => void saveEdit(true)}
                    disabled={saving}
                    style={{ ...BTN_GHOST, background: '#caa46a', border: '1px solid #caa46a', color: '#161821', fontWeight: 600 }}
                  >
                    {saving ? 'Saving…' : 'Save anyway'}
                  </button>
                ) : (
                  <button
                    onClick={() => void saveEdit(false)}
                    disabled={saving}
                    style={{ ...BTN_GHOST, background: '#5f88b2', border: '1px solid #5f88b2', color: '#161821', fontWeight: 600 }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CardDetailModal;
