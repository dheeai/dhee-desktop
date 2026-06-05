/**
 * InstanceCard — content-rich card per (nodeId, itemId) instance.
 *
 * Dispatches to a per-format renderer based on the artifact's file
 * extension (md/txt/json → MarkdownCard/JsonCard, image → ImageCard,
 * video → VideoCard, audio → AudioCard).
 *
 * Hover state arrives via HoverContext — set on mouseenter at the
 * canvas level — so cards don't re-render unless their own
 * hovered/dependent/dimmed bit flips.
 *
 * Project dir arrives via ProjectDirContext so renderers can build
 * file:// URLs for binary artifacts (images, videos) without
 * threading the path through node.data.
 */
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';
import { useInstanceHoverState, useProjectDir } from '../InstanceCardsCanvas';
import { MarkdownCardBody } from './content/MarkdownCardBody';
import { JsonCardBody } from './content/JsonCardBody';
import { ImageCardBody } from './content/ImageCardBody';
import { VideoCardBody } from './content/VideoCardBody';
import { AudioCardBody } from './content/AudioCardBody';
import { EmptyCardBody } from './content/EmptyCardBody';

type InstanceCardData = InstanceGraphNode;

function keyOf(nodeId: string, itemId: string | undefined): string {
  return itemId !== undefined ? `${nodeId}:${itemId}` : nodeId;
}

function statusColor(status: string): string {
  // One status palette (re-themes via --color-status-*).
  switch (status) {
    case 'completed':   return 'var(--color-status-completed)';
    case 'in_progress': return 'var(--color-status-running)';
    case 'failed':      return 'var(--color-status-failed)';
    case 'invalidated': return 'var(--color-status-invalidated)';
    case 'pending':
    default:            return 'var(--color-status-pending)';
  }
}

function inferFormat(outputPath: string | undefined): 'md' | 'json' | 'image' | 'video' | 'audio' | 'unknown' {
  if (!outputPath) return 'unknown';
  const lower = outputPath.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')) return 'image';
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv')) return 'video';
  if (lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.endsWith('.ogg') || lower.endsWith('.flac')) return 'audio';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'md';
  return 'unknown';
}

const CARD_W = 320;
const CARD_H = 220;

function InstanceCardImpl({ data }: { data: InstanceCardData }) {
  const { nodeId, itemId, status, outputPath, tool, cached, error, ts } = data;
  const projectDir = useProjectDir();
  const { hoveredKey, highlighted } = useInstanceHoverState();
  const myKey = keyOf(nodeId, itemId);
  const isHovered = hoveredKey === myKey;
  const isDependent = highlighted.has(myKey);
  const isDimmed = hoveredKey !== null && !isHovered && !isDependent;

  const fmt = inferFormat(outputPath);
  // Visual signal hierarchy: hovered card is the focus (warm yellow,
  // strong glow), dependents glow saturated orange (3px ring) and
  // stay full opacity, everything else dims hard to 0.2 so the
  // blast-radius chain reads instantly even at zoom-out.
  const borderColor = isHovered
    ? '#f2c97a'
    : isDependent
      ? '#ff9248'
      : statusColor(status);
  const borderWidth = isHovered || isDependent ? 3 : 1.5;
  const opacity = isDimmed ? 0.18 : 1;
  const boxShadow = isHovered
    ? '0 0 0 3px #f2c97a, 0 0 32px rgba(242, 201, 122, 0.55), 0 12px 30px rgba(0,0,0,0.6)'
    : isDependent
      ? '0 0 0 2px #ff9248, 0 0 22px rgba(255, 146, 72, 0.45), 0 6px 18px rgba(0,0,0,0.4)'
      : '0 3px 10px rgba(0,0,0,0.25)';

  const isCompleted = status === 'completed' && outputPath && projectDir;
  const bodyProps = {
    projectDir,
    outputPath: outputPath ?? null,
    // ts (node.completed event timestamp from the projection) → used
    // by image/video body components as a cache-bust key on the
    // file:// URL. When the canonical artifact is overwritten by a
    // regen, ts changes, URL changes, browser fetches fresh bytes
    // instead of serving the stale cached version.
    completedAt: ts ?? null,
  };

  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        background: 'var(--color-bg-panel-elevated)',
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 10,
        color: 'var(--color-text-primary)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        opacity,
        boxShadow,
        transition: 'opacity 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Handle id="top" type="target" position={Position.Top} style={{ background: '#5f88b2', width: 7, height: 7 }} />

      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--color-accent-primary-soft)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {nodeId}
          </div>
          {itemId && (
            <div
              style={{
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {itemId}
            </div>
          )}
        </div>
        <span
          style={{
            background: statusColor(status),
            color: 'var(--color-bg-app)',
            padding: '2px 7px',
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            flexShrink: 0,
            marginLeft: 8,
          }}
        >
          {status === 'in_progress' ? 'run' : status.slice(0, 4)}
        </span>
      </div>

      {/* Content body — per-format */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {!isCompleted ? (
          <EmptyCardBody status={status} error={error} outputPath={outputPath} />
        ) : fmt === 'image' ? (
          <ImageCardBody {...bodyProps} />
        ) : fmt === 'video' ? (
          <VideoCardBody {...bodyProps} />
        ) : fmt === 'audio' ? (
          <AudioCardBody {...bodyProps} />
        ) : fmt === 'json' ? (
          <JsonCardBody {...bodyProps} />
        ) : fmt === 'md' ? (
          <MarkdownCardBody {...bodyProps} />
        ) : (
          <EmptyCardBody status={status} error={null} outputPath={outputPath} />
        )}
      </div>

      {/* Footer — tool + CAS */}
      {(tool || cached) && (
        <div
          style={{
            padding: '4px 12px',
            fontSize: 9,
            color: 'var(--color-text-muted)',
            display: 'flex',
            gap: 8,
            borderTop: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          {tool && <span>via {tool}</span>}
          {cached && <span style={{ color: '#6d8f7a' }}>· CAS hit</span>}
        </div>
      )}

      <Handle id="bottom" type="source" position={Position.Bottom} style={{ background: '#5f88b2', width: 7, height: 7 }} />
    </div>
  );
}

export const InstanceCard = memo(InstanceCardImpl);
export default InstanceCard;
