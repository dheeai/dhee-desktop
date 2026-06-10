/**
 * ScriptDoc — renders a single text-stage artifact in full for the Script
 * reading room. Markdown → flowing drop-cap prose (treatment); JSON →
 * a readable pretty-printed block. Unlike MarkdownCardBody (a truncated
 * card preview) this shows the whole document.
 */
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './ProductionView.module.scss';

interface Props {
  projectDir: string | null;
  outputPath: string | null;
  format: string;
}

export function ScriptDoc({ projectDir, outputPath, format }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectDir || !outputPath) {
      setText('');
      return undefined;
    }
    let cancelled = false;
    setText(null);
    setError(null);
    (async () => {
      try {
        const raw = await window.electron.project.readFile(`${projectDir}/${outputPath}`);
        if (!cancelled) setText(raw ?? '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDir, outputPath]);

  if (error) return <div className={styles.docError}>Couldn’t read this document: {error}</div>;
  if (text === null) return <div className={styles.docLoading}>Loading…</div>;
  if (text.trim() === '') return <div className={styles.docLoading}>Not written yet.</div>;

  if (format === 'json') {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* malformed — show raw */
    }
    return <pre className={styles.jsonBlock}>{pretty}</pre>;
  }

  // md / txt → flowing prose
  return (
    <div className={styles.prose}>
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

export default ScriptDoc;
