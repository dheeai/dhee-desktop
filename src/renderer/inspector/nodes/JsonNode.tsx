/**
 * JsonNode — renders JSON artifacts.
 *
 *   Stage: full JSON tree with a headline excerpt at top (when
 *          `headlineField` is declared and the path resolves).
 *   Tile:  rail-friendly card showing the headline value truncated
 *          to 2-3 lines; falls back to a generic preview when no
 *          headlineField. Item id appears as a small label.
 */
import { useMemo } from 'react';
import { useArtifactText } from '../useArtifactText';
import styles from './JsonNode.module.scss';

export interface JsonStageProps {
  outputPath?: string;
  headlineField?: string;
}

export interface JsonTileProps extends JsonStageProps {
  itemId?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// dot-path lookup — supports `frames.first_frame.imagePrompt`
// ---------------------------------------------------------------------------

function readDotPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function toDisplayString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Objects and arrays — stringify compactly.
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export function JsonNodeStage({ outputPath, headlineField }: JsonStageProps) {
  const { text, status } = useArtifactText(outputPath);

  if (!outputPath) {
    return <div className={styles.empty}>not yet generated</div>;
  }
  if (status === 'loading' || status === 'idle') {
    return <div className={styles.empty}>loading…</div>;
  }
  if (status === 'missing' || text === null) {
    return <div className={styles.empty}>file missing</div>;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return <pre className={styles.raw}>{text}</pre>;
  }

  const headline = headlineField
    ? toDisplayString(readDotPath(parsed, headlineField))
    : null;

  return (
    <div className={styles.stage}>
      {headline ? (
        <div className={styles.headline} data-testid="json-headline">
          {headline}
        </div>
      ) : null}
      <JsonTree value={parsed} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile (rail entry)
// ---------------------------------------------------------------------------

export function JsonNodeTile({
  outputPath,
  headlineField,
  itemId,
  status = 'pending',
}: JsonTileProps) {
  const failed = status === 'failed';
  const invalidated = status === 'invalidated';
  return (
    <div
      className={`${styles.tile} ${failed ? styles.tileFailed : ''} ${invalidated ? styles.tileInvalidated : ''}`}
      data-testid="json-tile"
      data-status={failed ? 'failed' : status}
    >
      <div className={styles.tileLabel}>
        <span>{itemId ?? '—'}</span>
        <span
          className={`${styles.tileDot} ${styles[`dot-${status}`] ?? ''}`}
          data-testid="json-tile-status"
          data-status={status}
        />
      </div>
      {outputPath ? (
        <JsonTileBody outputPath={outputPath} headlineField={headlineField} />
      ) : (
        <div className={styles.tileBodyMuted}>pending</div>
      )}
    </div>
  );
}

function JsonTileBody({ outputPath, headlineField }: JsonStageProps) {
  const { text, status } = useArtifactText(outputPath);
  // Pre-compute the body string unconditionally — keeps React hooks
  // rule ("no hooks after early return") satisfied even though we
  // also bail on loading / missing below.
  const body = useMemo(() => {
    if (text === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text.slice(0, 80);
    }
    if (headlineField) {
      const headline = toDisplayString(readDotPath(parsed, headlineField));
      if (headline) return headline;
    }
    return firstScalarPreview(parsed);
  }, [text, headlineField]);

  if (status === 'loading' || status === 'idle') {
    return <div className={styles.tileBodyMuted}>loading…</div>;
  }
  if (status === 'missing' || text === null) {
    return <div className={styles.tileBodyMuted}>file missing</div>;
  }
  return <div className={styles.tileBody}>{body}</div>;
}

function firstScalarPreview(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return firstScalarPreview(value[0]);
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = toDisplayString(v);
      if (s) return `${k}: ${s}`;
    }
    return '{}';
  }
  const s = toDisplayString(value);
  return s ?? '';
}

// ---------------------------------------------------------------------------
// JSON tree (compact, mockup-style)
// ---------------------------------------------------------------------------

function JsonTree({ value, indent = 0 }: { value: unknown; indent?: number }) {
  if (value === null) return <span className={styles.scalar}>null</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={styles.bracket}>[]</span>;
    return (
      <span>
        <span className={styles.bracket}>[</span>
        <span className={styles.meta}> {value.length} items </span>
        <span className={styles.bracket}>]</span>
      </span>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className={styles.bracket}>{'{}'}</span>;
    return (
      <div className={styles.tree} style={{ paddingLeft: indent * 10 }}>
        {entries.slice(0, 8).map(([k, v]) => (
          <div key={k} className={styles.row}>
            <span className={styles.key}>{k}</span>
            <span className={styles.sep}>: </span>
            <JsonTree value={v} indent={indent + 1} />
          </div>
        ))}
        {entries.length > 8 ? (
          <div className={styles.muted}>+ {entries.length - 8} more keys</div>
        ) : null}
      </div>
    );
  }
  return <span className={styles.scalar}>{toDisplayString(value) ?? ''}</span>;
}
