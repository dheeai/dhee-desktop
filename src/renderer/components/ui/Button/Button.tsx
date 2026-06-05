/**
 * Button — the single button primitive for the whole app. Variants map
 * to the design language: primary (theme accent), secondary, ghost,
 * danger (error), and recording (the amber live/active semantic). Sizes
 * sm|md, plus iconOnly and pill. Replaces every per-surface bespoke
 * button.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.scss';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'recording';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  pill?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  pill = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    styles.btn,
    styles[variant],
    size === 'sm' ? styles.sm : '',
    iconOnly ? styles.iconOnly : '',
    pill ? styles.pill : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  // eslint-disable-next-line react/button-has-type
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export default Button;
