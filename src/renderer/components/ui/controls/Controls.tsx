/**
 * Form controls — Input, Textarea, Select, and the Field wrapper
 * (label + control + hint/error). One padding / radius / focus-ring for
 * every form across the app. Replaces the ~6 bespoke field styles.
 */
import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './Controls.module.scss';

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono, className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(styles.control, mono && styles.mono, className)} {...rest} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { mono, className, ...rest },
  ref,
) {
  return (
    <textarea ref={ref} className={cx(styles.control, styles.textarea, mono && styles.mono, className)} {...rest} />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  mono?: boolean;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { mono, className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(styles.control, styles.select, mono && styles.mono, className)} {...rest}>
      {children}
    </select>
  );
});

export interface FieldProps {
  label?: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}
export function Field({ label, optional, hint, error, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cx(styles.field, className)}>
      {label && (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
          {optional && <span className={styles.optional}> · optional</span>}
        </label>
      )}
      {children}
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
