/**
 * Status & feedback primitives — StatusDot, StatusBadge, Chip, Spinner,
 * and RecDot (the pulsing amber live/recording indicator). The status
 * pieces are driven by the one --color-status-* palette so graph, chat,
 * and the status strip read identically.
 */
import type { ReactNode } from 'react';
import styles from './Status.module.scss';

export type RunStatus = 'completed' | 'running' | 'failed' | 'invalidated' | 'pending';

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function StatusDot({ status, className }: { status: RunStatus; className?: string }) {
  return <span className={cx(styles.dot, styles[status], className)} aria-hidden="true" />;
}

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: RunStatus;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx(styles.badge, styles[`bg_${status}`], className)}>{children}</span>;
}

export function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx(styles.chip, className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx(styles.spinner, className)} role="status" aria-label="loading" />;
}

/** Pulsing amber dot — live / recording / active only. */
export function RecDot({ className }: { className?: string }) {
  return <span className={cx(styles.recdot, className)} aria-hidden="true" />;
}
