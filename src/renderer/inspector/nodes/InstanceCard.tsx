/**
 * InstanceCard — one card per (nodeId, itemId) instance in the
 * per-instance dependency graph view.
 *
 * Shows:
 *   - Stage + item id (e.g. "shot_image / scene_1_shot_3")
 *   - Status pill (pending / in_progress / completed / failed / invalidated)
 *   - Output file basename (when completed)
 *   - Tool name + CAS-hit badge (when present)
 *   - Hovered / dependent / dimmed states for the regen blast-radius UX
 */
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';
import { useInstanceHoverState } from '../InstanceCardsCanvas';

type InstanceCardData = InstanceGraphNode;

function keyOf(nodeId: string, itemId: string | undefined): string {
  return itemId !== undefined ? `${nodeId}:${itemId}` : nodeId;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':   return '#6d8f7a';
    case 'in_progress': return '#907b58';
    case 'failed':      return '#a56d6f';
    case 'invalidated': return '#a9b0ba';
    case 'pending':
    default:            return '#7d848e';
  }
}

function basename(p: string | undefined): string {
  if (!p) return '';
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

function InstanceCardImpl({ data }: { data: InstanceCardData }) {
  const {
    nodeId,
    itemId,
    status,
    outputPath,
    tool,
    cached,
    error,
  } = data;
  // Hover state from context — only this component re-renders when
  // hover changes, NOT the whole xyflow node array.
  const { hoveredKey, highlighted } = useInstanceHoverState();
  const myKey = keyOf(nodeId, itemId);
  const isHovered = hoveredKey === myKey;
  const isDependent = highlighted.has(myKey);
  const isDimmed = hoveredKey !== null && !isHovered && !isDependent;

  const borderColor = isHovered
    ? '#f2c97a'
    : isDependent
      ? '#a3553b'
      : statusColor(status);
  const opacity = isDimmed ? 0.35 : 1;
  const boxShadow = isHovered
    ? '0 0 0 2px #f2c97a, 0 8px 24px rgba(0,0,0,0.5)'
    : isDependent
      ? '0 0 0 1.5px #a3553b, 0 4px 12px rgba(0,0,0,0.3)'
      : '0 2px 6px rgba(0,0,0,0.2)';

  return (
    <div
      style={{
        width: 240,
        background: '#161821',
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8,
        padding: '10px 12px',
        color: '#e5e1d8',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        opacity,
        boxShadow,
        transition: 'opacity 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#5f88b2', width: 6, height: 6 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: '#a9b0ba', fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase' }}>
          {nodeId}
        </span>
        <span
          style={{
            background: statusColor(status),
            color: '#161821',
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {status === 'in_progress' ? 'run' : status.slice(0, 4)}
        </span>
      </div>
      {itemId && (
        <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: '#e5e1d8', marginBottom: 4, wordBreak: 'break-all' }}>
          {itemId}
        </div>
      )}
      {outputPath && (
        <div
          style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 10,
            color: 'rgba(229, 225, 216, 0.5)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={outputPath}
        >
          {basename(outputPath)}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 10, color: '#a56d6f', marginTop: 4 }} title={error}>
          {error.length > 60 ? error.slice(0, 57) + '…' : error}
        </div>
      )}
      {(tool || cached) && (
        <div style={{ marginTop: 6, fontSize: 9, color: 'rgba(229,225,216,0.4)', display: 'flex', gap: 6 }}>
          {tool && <span>via {tool}</span>}
          {cached && <span style={{ color: '#6d8f7a' }}>· CAS</span>}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: '#5f88b2', width: 6, height: 6 }} />
    </div>
  );
}

// Memoize so cards with unchanged data + unchanged context state
// don't re-render. The context subscription invalidates only when
// hoveredKey / highlighted actually change.
export const InstanceCard = memo(InstanceCardImpl);

export default InstanceCard;
