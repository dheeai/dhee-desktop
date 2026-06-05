/**
 * SegmentedControl — the single segmented toggle (provider pickers,
 * source tabs, mode switches). Replaces SettingsPanel .modeSwitch,
 * FirstRunSetup .seg, and the New Project .pill group.
 */
import type { ReactNode } from 'react';
import styles from './SegmentedControl.module.scss';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Small mono caption to the right (e.g. "key" / "local"). */
  tag?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className={[styles.seg, className].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={opt.value === value ? `${styles.btn} ${styles.on}` : styles.btn}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
          {opt.tag && <span className={styles.tag}>{opt.tag}</span>}
        </button>
      ))}
    </div>
  );
}

export default SegmentedControl;
