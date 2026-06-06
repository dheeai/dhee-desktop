/**
 * JsonCardBody — summarises a JSON artifact for the card.
 *
 * Picks a "headline" field by trying known field names in order
 * (imagePrompt / description / deltaText / motionDirective / line),
 * then shows 2-3 supporting key/value pairs.
 */
import { useEffect, useState } from 'react';

interface Props {
  projectDir: string | null;
  outputPath: string | null;
}

const HEADLINE_FIELDS = ['imagePrompt', 'description', 'deltaText', 'motionDirective', 'dialogueLine', 'line', 'title', 'name'];

function summarize(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.length}]`;
  }
  if (depth > 0) return '{…}';
  return JSON.stringify(value);
}

export function JsonCardBody({ projectDir, outputPath }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectDir || !outputPath) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await window.electron.project.readFile(`${projectDir}/${outputPath}`);
        if (cancelled) return;
        if (!raw) { setData({}); return; }
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setData(parsed as Record<string, unknown>);
          } else {
            setData({ value: parsed });
          }
        } catch {
          setData(null);
          setError('JSON parse failed');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [projectDir, outputPath]);

  if (error) {
    return <div style={{ padding: 10, fontSize: 10, color: '#a56d6f' }}>{error}</div>;
  }
  if (data === null) {
    return <div style={{ padding: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>loading…</div>;
  }

  // Pick headline field
  let headline: string | null = null;
  let headlineKey: string | null = null;
  for (const k of HEADLINE_FIELDS) {
    if (typeof data[k] === 'string' && (data[k] as string).length > 0) {
      headline = data[k] as string;
      headlineKey = k;
      break;
    }
  }
  // If no headline, pick first string property.
  if (!headline) {
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string' && v.length > 0 && v.length < 600) {
        headline = v;
        headlineKey = k;
        break;
      }
    }
  }

  // Supporting fields: anything else worth showing (numbers, short strings)
  const supportingEntries = Object.entries(data)
    .filter(([k]) => k !== headlineKey)
    .filter(([_, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v))
    .slice(0, 4);

  return (
    <div
      style={{
        padding: '8px 12px',
        fontSize: 11,
        color: '#d6d2c8',
        lineHeight: 1.4,
        overflow: 'hidden',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {headline && (
        <div
          style={{
            color: '#e5e1d8',
            fontSize: 11,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={headline}
        >
          {headline.length > 240 ? headline.slice(0, 240) + '…' : headline}
        </div>
      )}
      {supportingEntries.length > 0 && (
        <div style={{ fontSize: 9, color: 'rgba(229,225,216,0.55)', fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {supportingEntries.map(([k, v]) => (
            <div key={k} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${k}: ${summarize(v)}`}>
              <span style={{ color: 'rgba(var(--color-accent-primary-rgb), 0.85)' }}>{k}</span>: {summarize(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
