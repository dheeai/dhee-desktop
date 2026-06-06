/**
 * MarkdownCardBody — first ~6 lines of the artifact's markdown file.
 *
 * Fetches via window.electron.project.readFile (already used by
 * ProjectContext). Cached in-component per (projectDir, outputPath)
 * so re-renders from hover don't re-trigger IPC.
 */
import { useEffect, useState } from 'react';

interface Props {
  projectDir: string | null;
  outputPath: string | null;
}

export function MarkdownCardBody({ projectDir, outputPath }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectDir || !outputPath) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await window.electron.project.readFile(`${projectDir}/${outputPath}`);
        if (cancelled) return;
        setText(raw ?? '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [projectDir, outputPath]);

  if (error) {
    return <div style={{ padding: 10, fontSize: 10, color: '#a56d6f' }}>read failed: {error}</div>;
  }
  if (text === null) {
    return <div style={{ padding: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>loading…</div>;
  }
  // First 6 non-empty lines, stripped of leading markdown markers.
  const lines = text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, 8);

  return (
    <div
      style={{
        padding: '8px 12px',
        fontSize: 11,
        color: '#d6d2c8',
        lineHeight: 1.4,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
        flex: 1,
      }}
    >
      {lines.map((line, i) => {
        const isHeading = /^#{1,6}\s/.test(line);
        const isList = /^[-*]\s/.test(line);
        const cleaned = line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '• ');
        return (
          <div
            key={i}
            style={{
              fontWeight: isHeading ? 600 : 400,
              fontSize: isHeading ? 12 : 11,
              color: isHeading ? '#e5e1d8' : 'var(--color-text-secondary)',
              marginBottom: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingLeft: isList ? 4 : 0,
            }}
            title={line}
          >
            {cleaned}
          </div>
        );
      })}
    </div>
  );
}
