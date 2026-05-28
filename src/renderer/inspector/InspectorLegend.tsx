/**
 * InspectorLegend — small status-color legend pinned to a corner
 * of the canvas. Fixes the "what does yellow mean?" cliff that hit
 * every first-time user.
 */
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import styles from './InspectorLegend.module.scss';

interface Chip {
  status: 'completed' | 'running' | 'failed' | 'pending' | 'goal';
  label: string;
}

const CHIPS: Chip[] = [
  { status: 'completed', label: 'Complete' },
  { status: 'running', label: 'Running' },
  { status: 'failed', label: 'Failed' },
  { status: 'pending', label: 'Pending' },
  { status: 'goal', label: 'Goal' },
];

export function InspectorLegend() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={styles.legend} aria-label="Status legend">
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? 'Show legend' : 'Hide legend'}
        title={collapsed ? 'Show legend' : 'Hide legend'}
      >
        {collapsed ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
      {!collapsed ? (
        <div className={styles.chips}>
          {CHIPS.map((chip) => (
            <div
              key={chip.status}
              className={styles.chip}
              data-testid={`legend-chip-${chip.status}`}
              data-status={chip.status}
            >
              <span className={styles.dot} />
              <span className={styles.label}>{chip.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
