/**
 * ReadableArtifact — render any text/json artifact READABLE by default.
 *
 * md/txt render as prose. JSON renders STRUCTURED, not as a flat id-dump:
 *   · scalar fields            → labelled value
 *   · arrays of scalars        → chips (capped, "+N more")
 *   · arrays of objects        → a list of readable sub-cards (each titled by
 *                                its name/title/id), so a cast/scene/location
 *                                breakdown shows real content, not "a, b, c"
 *   · nested objects           → inline sub-card (depth-capped → summarised)
 * The raw source is ALWAYS available behind an "Inspect" disclosure, never the
 * default surface. Reads the file (the only IO layer); projection keys off
 * the shared prepareReadableView for the md/headline decision.
 */
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { prepareReadableView, type ReadableView } from '../nodeTextEdit';
import styles from './ProductionView.module.scss';

interface Props {
  projectDir: string | null;
  outputPath: string | null;
  /** 'md' | 'txt' | 'json' — accepted for caller ergonomics; projection keys off the path. */
  format?: string;
  headlineField?: string;
  /** compact = no headline label chrome (used inside shot-sheet lanes). */
  compact?: boolean;
}

const MAX_ITEMS = 6;
const MAX_DEPTH = 2;
const HEADLINE_KEYS = ['name', 'title', 'label', 'heading', 'slug', 'id'];

/** Title-case a camelCase / snake_case key for a field label. */
function labelFor(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
function scalarText(v: unknown): string | null {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}
function headlineOf(o: Record<string, unknown>): { text: string; key: string } | null {
  for (const k of HEADLINE_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return { text: v, key: k };
  }
  return null;
}

function Chips({ items }: { items: string[] }) {
  const shown = items.slice(0, MAX_ITEMS);
  return (
    <span className={styles.chipRow}>
      {shown.map((s, i) => <span key={i} className={styles.chip}>{s}</span>)}
      {items.length > MAX_ITEMS ? <span className={styles.moreNote}>+{items.length - MAX_ITEMS} more</span> : null}
    </span>
  );
}

function ValueView({ value, depth }: { value: unknown; depth: number }) {
  const s = scalarText(value);
  if (s !== null) return <span className={styles.fieldVal}>{s}</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={styles.fieldVal}>—</span>;
    const scalars = value.map(scalarText);
    if (scalars.every((x) => x !== null)) return <Chips items={scalars as string[]} />;
    if (depth >= MAX_DEPTH) return <span className={styles.fieldVal}>{value.length} items</span>;
    const shown = value.slice(0, MAX_ITEMS);
    return (
      <div className={styles.subList}>
        {shown.map((o, i) =>
          isPlainObject(o) ? <ObjectCard key={i} obj={o} depth={depth + 1} /> : <div key={i} className={styles.subCard}><ValueView value={o} depth={depth + 1} /></div>,
        )}
        {value.length > MAX_ITEMS ? <div className={styles.moreNote}>+{value.length - MAX_ITEMS} more</div> : null}
      </div>
    );
  }

  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) return <span className={styles.fieldVal}>{Object.keys(value).map(labelFor).join(' · ')}</span>;
    return <ObjectCard obj={value} depth={depth + 1} />;
  }
  return <span className={styles.fieldVal}>{JSON.stringify(value)}</span>;
}

function isCompactField(v: unknown): boolean {
  return scalarText(v) !== null || (Array.isArray(v) && v.every((x) => scalarText(x) !== null));
}

function ObjectFields({ obj, depth, exclude }: { obj: Record<string, unknown>; depth: number; exclude?: string }) {
  const entries = Object.entries(obj).filter(([k]) => k !== exclude);
  if (entries.length === 0) return null;
  return (
    <div className={styles.fieldGrid}>
      {entries.map(([k, v]) => (
        <div key={k} className={isCompactField(v) ? styles.field : styles.fieldWide}>
          <b>{labelFor(k)}</b>
          <ValueView value={v} depth={depth} />
        </div>
      ))}
    </div>
  );
}

function ObjectCard({ obj, depth }: { obj: Record<string, unknown>; depth: number }) {
  const h = headlineOf(obj);
  return (
    <div className={styles.subCard}>
      {h ? <div className={styles.subCardTitle}>{h.text}</div> : null}
      <ObjectFields obj={obj} depth={depth} exclude={h?.key} />
    </div>
  );
}

export function ReadableArtifact({ projectDir, outputPath, headlineField, compact }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectDir || !outputPath) {
      setContent('');
      return undefined;
    }
    let cancelled = false;
    setContent(null);
    setError(null);
    (async () => {
      try {
        const raw = await window.electron.project.readFile(`${projectDir}/${outputPath}`);
        if (!cancelled) setContent(raw ?? '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDir, outputPath]);

  if (error) return <div className={styles.docError}>Couldn’t read this artifact: {error}</div>;
  if (content === null) return <div className={styles.docLoading}>Loading…</div>;
  if (content.trim() === '') return <div className={styles.docLoading}>Not written yet.</div>;

  const view: ReadableView = prepareReadableView({ content, outputPath: outputPath ?? undefined, headlineField });

  if (view.kind === 'text') {
    return (
      <div className={styles.prose}>
        <ReactMarkdown>{view.text}</ReactMarkdown>
      </div>
    );
  }

  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { parsed = undefined; }

  const rawDisclosure = (
    <details className={styles.rawBlock}>
      <summary>Inspect JSON</summary>
      <pre className={styles.jsonBlock}>{view.raw}</pre>
    </details>
  );

  // json with a readable headline: prose first, then the rest of the structure.
  if (view.kind === 'json') {
    const headlineKey = (headlineField ?? '').split('.')[0];
    return (
      <div className={styles.readable}>
        {!compact ? <div className={styles.readableLabel}>{view.headlineLabel}</div> : null}
        <p className={styles.readableHeadline}>{view.headline}</p>
        {isPlainObject(parsed) ? <ObjectFields obj={parsed} depth={0} exclude={headlineKey} /> : null}
        {rawDisclosure}
      </div>
    );
  }

  // no designated headline — render the structure readable anyway.
  if (isPlainObject(parsed)) {
    return (
      <div className={styles.readable}>
        <ObjectFields obj={parsed} depth={0} />
        {rawDisclosure}
      </div>
    );
  }
  if (parsed !== undefined) {
    return (
      <div className={styles.readable}>
        <ValueView value={parsed} depth={0} />
        {rawDisclosure}
      </div>
    );
  }
  // truly unparseable → show the source, visible (never an empty card).
  return <pre className={styles.jsonBlock}>{view.raw}</pre>;
}

export default ReadableArtifact;
