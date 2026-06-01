/**
 * CardDetailModal — fullscreen overlay for inspecting an instance.
 *
 * Renders the full artifact (md/json/image/video/audio) at large size
 * + the metadata header + an action bar driven by `availableActions`
 * from the model.
 *
 * Actions are dispatched up via callback; this component doesn't know
 * how to regenerate/edit/invalidate — the parent wires those to IPC.
 */
import { useEffect, useState } from 'react';
import type { InstanceGraphNode } from '../../shared/dheeIpc';
import {
  availableActions,
  actionLabel,
  type CardAction,
} from './cardDetailModel';

interface Props {
  instance: InstanceGraphNode | null;
  projectDir: string | null;
  onClose: () => void;
  onAction: (action: CardAction, instance: InstanceGraphNode) => void;
}

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

export function CardDetailModal({ instance, projectDir, onClose, onAction }: Props) {
  const [text, setText] = useState<string | null>(null);
  // ESC to close
  useEffect(() => {
    if (!instance) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [instance, onClose]);

  // Load text body for md/json
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
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid rgba(168, 156, 139, 0.24)',
                color: '#a9b0ba',
                padding: '6px 14px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Close ⏎
            </button>
          </div>
        </div>

        {/* Body — large content render */}
        <div style={{ flex: 1, overflow: 'auto', background: '#0c0d11' }}>
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
          {(fmt === 'md' || fmt === 'json') && (
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
          {(fmt === 'unknown' || !fileUrl) && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(229,225,216,0.55)', fontSize: 13 }}>
              {instance.error ? `Failed: ${instance.error}` : 'No content to display yet.'}
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
            justifyContent: 'flex-end',
          }}
        >
          {actions.map((a) => (
            <button
              key={a}
              onClick={() => onAction(a, instance)}
              style={{
                background: a === 'regenerate' ? '#5f88b2' : 'transparent',
                border: `1px solid ${a === 'regenerate' ? '#5f88b2' : 'rgba(168, 156, 139, 0.24)'}`,
                color: a === 'regenerate' ? '#161821' : '#e5e1d8',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: a === 'regenerate' ? 600 : 400,
              }}
            >
              {actionLabel(a)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CardDetailModal;
