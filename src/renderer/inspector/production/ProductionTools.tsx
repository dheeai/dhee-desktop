import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './ProductionTools.module.scss';

interface Panel {
  id: string;
  label: string;
  description: string;
  content: ReactNode;
}

export default function ProductionTools({ panels }: { panels: Panel[] }) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const regions = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const disclosure = regions.current[selected]?.querySelector('details');
    if (disclosure) disclosure.open = true;
  }, [selected]);
  return (
    <section className={styles.root} aria-label="Production tools">
      <header className={styles.header}>
        <h2>Production tools</h2>
        <p>
          Shape your materials, generate on RTX, then assemble and check the
          cut.
        </p>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="Production tools">
        {panels.map((panel, index) => (
          <button
            key={panel.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${panel.id}`}
            aria-controls={`${id}-panel-${panel.id}`}
            aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight')
                next = (index + 1) % panels.length;
              else if (event.key === 'ArrowLeft')
                next = (index + panels.length - 1) % panels.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = panels.length - 1;
              else return;
              event.preventDefault();
              setSelected(next);
              buttons.current[next]?.focus();
            }}
          >
            {panel.label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div
          key={panel.id}
          ref={(element) => {
            regions.current[index] = element;
          }}
          role="tabpanel"
          id={`${id}-panel-${panel.id}`}
          aria-labelledby={`${id}-tab-${panel.id}`}
          hidden={selected !== index}
          className={styles.panel}
        >
          <p className={styles.description}>{panel.description}</p>
          {panel.content}
        </div>
      ))}
    </section>
  );
}
