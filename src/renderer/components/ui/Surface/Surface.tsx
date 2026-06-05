/**
 * Surface primitives — Panel (elevated, shadowed), Card (flat panel),
 * Divider (default + cinematic double-line), and SectionLabel (the mono
 * uppercase caption used everywhere: "THE STORY", group heads). Replace
 * every ad-hoc card/divider/label.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Surface.module.scss';

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.panel, className)} {...rest}>
      {children}
    </div>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.card, className)} {...rest}>
      {children}
    </div>
  );
}

export function Divider({ cinematic = false, className }: { cinematic?: boolean; className?: string }) {
  return <hr className={cx(cinematic ? styles.cinematic : styles.divider, className)} />;
}

export function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx(styles.sectionLabel, className)}>{children}</div>;
}
