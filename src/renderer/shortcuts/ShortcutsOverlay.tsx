/**
 * ShortcutsOverlay — Cmd+/ help panel listing every shortcut.
 *
 * Self-mounted overlay (doesn't go through OverlayContext because
 * it's meta — invokable from anywhere, including from inside other
 * overlays).
 */
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { SHORTCUTS, glyphForKey } from './shortcutsRegistry';
import styles from './ShortcutsOverlay.module.scss';

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === '/') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const sections = useMemo(() => {
    const grouped = new Map<string, typeof SHORTCUTS>();
    for (const s of SHORTCUTS) {
      const list = grouped.get(s.section) ?? [];
      list.push(s);
      grouped.set(s.section, list);
    }
    return Array.from(grouped.entries());
  }, []);

  if (!open) return null;

  return (
    <div className={styles.root} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div
        className={styles.backdrop}
        data-testid="shortcuts-backdrop"
        onClick={() => setOpen(false)}
      />
      <div className={styles.frame}>
        <div className={styles.head}>
          <span className={styles.title}>Keyboard shortcuts</span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setOpen(false)}
            aria-label="Close shortcuts"
          >
            <X size={14} />
          </button>
        </div>
        <div className={styles.body}>
          {sections.map(([section, list]) => (
            <section key={section} className={styles.section}>
              <h3 className={styles.sectionTitle}>{section}</h3>
              <ul className={styles.list}>
                {list.map((s) => (
                  <li key={`${section}-${s.combo.join('+')}-${s.description}`} className={styles.row}>
                    <span className={styles.combo}>
                      {s.combo.map((k, i) => (
                        <span key={i} className={styles.key}>{glyphForKey(k, isMac)}</span>
                      ))}
                    </span>
                    <span className={styles.desc}>{s.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className={styles.foot}>
          Press <span className={styles.key}>{glyphForKey('Cmd', isMac)}</span>
          <span className={styles.key}>/</span> any time to reopen this panel.
        </div>
      </div>
    </div>
  );
}

export default ShortcutsOverlay;
