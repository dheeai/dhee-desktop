/**
 * InspectorSearch — Cmd+F find-in-graph.
 *
 * Surfaces a small search palette that filters node ids on type.
 * Up/Down navigates matches; Enter (or click) selects and fires
 * onSelect(nodeId). The canvas wrapper passes a callback that
 * centers the viewport on the matched node.
 *
 * Why this is needed: for a project with 100+ shots / tracks /
 * 3D models, scrolling the canvas to find a specific item is
 * untenable. Cmd+F → type → Enter → there in three keystrokes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { InspectorFlowNode } from './bundleToFlowGraph';
import styles from './InspectorSearch.module.scss';

export interface InspectorSearchProps {
  nodes: InspectorFlowNode[];
  /** Fired when a match is selected (Enter / click). */
  onSelect: (nodeId: string) => void;
}

export function InspectorSearch({ nodes, onSelect }: InspectorSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Open on Cmd+F / Ctrl+F. Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the input when the palette opens.
  useEffect(() => {
    if (open) {
      // Delay so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
      setActiveIdx(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes.map((n) => n.id);
    return nodes.map((n) => n.id).filter((id) => id.toLowerCase().includes(q));
  }, [nodes, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIdx(0);
  }, []);

  const pickActive = useCallback(() => {
    const id = matches[activeIdx];
    if (id) {
      onSelect(id);
      close();
    }
  }, [matches, activeIdx, onSelect, close]);

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pickActive();
      }
    },
    [matches.length, pickActive],
  );

  if (!open) return null;

  return (
    <>
      <div
        className={styles.backdrop}
        onClick={close}
        data-testid="search-backdrop"
      />
      <div className={styles.palette} role="search">
        <div className={styles.inputRow}>
          <Search size={14} className={styles.icon} />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label="Find node by id"
            value={query}
            placeholder="Find node by id…"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onInputKey}
            className={styles.input}
          />
          <button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>
        <ul className={styles.results}>
          {matches.length === 0 ? (
            <li className={styles.empty}>No matches</li>
          ) : (
            matches.map((id, idx) => (
              <li
                key={id}
                className={`${styles.result} ${idx === activeIdx ? styles.active : ''}`}
                onClick={() => {
                  onSelect(id);
                  close();
                }}
              >
                {id}
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}
