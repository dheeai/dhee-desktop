import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';
import styles from './ComboList.module.scss';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type ComboListOption = {
  value: string;
  label?: string;
};

export type ComboListProps = {
  value: string;
  onChange: (value: string) => void;
  onOptionSelect?: (value: string) => void;
  options: ComboListOption[];
  disabled?: boolean;
  triggerDisabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  buttonLabel?: string;
  emptyLabel?: string;
  dataTourId?: string;
  className?: string;
  inputClassName?: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'disabled' | 'placeholder' | 'role'
  >;
  onRequestOptions?: () => void | Promise<void>;
};

export function ComboList({
  value,
  onChange,
  onOptionSelect,
  options,
  disabled = false,
  triggerDisabled = false,
  loading = false,
  placeholder,
  buttonLabel = 'Options',
  emptyLabel = 'No options returned.',
  dataTourId,
  className,
  inputClassName,
  inputProps,
  onRequestOptions,
}: ComboListProps) {
  const generatedId = useId();
  const listboxId = `combolist-${generatedId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const requestOptions = async (openAfterLoad: boolean) => {
    if (disabled || triggerDisabled || loading) return;
    if (onRequestOptions) {
      await onRequestOptions();
    }
    if (openAfterLoad) setOpen(true);
  };

  const optionCountLabel = options.length > 0 ? ` ${options.length}` : '';

  return (
    <div className={cx(styles.root, className)} ref={rootRef}>
      <div className={styles.controlRow}>
        <input
          {...inputProps}
          type="text"
          role="combobox"
          aria-autocomplete="none"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          className={cx(styles.input, inputClassName)}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          data-tour-id={dataTourId}
          onFocus={(event) => {
            inputProps?.onFocus?.(event);
            if (options.length === 0) void requestOptions(false);
          }}
          onKeyDown={(event) => {
            inputProps?.onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key === 'Escape') {
              setOpen(false);
            }
            if ((event.key === 'ArrowDown' || event.key === 'Enter') && options.length > 0) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.trigger}
          onClick={() => {
            if (options.length > 0) {
              setOpen((current) => !current);
              return;
            }
            void requestOptions(true);
          }}
          disabled={disabled || triggerDisabled || loading}
          aria-label={`Show ${buttonLabel}`}
          aria-expanded={open}
          aria-controls={listboxId}
        >
          <span>{loading ? 'Loading' : `${buttonLabel}${optionCountLabel}`}</span>
          <span className={styles.chevron} aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <div id={listboxId} className={styles.listbox} role="listbox">
          {options.length > 0 ? (
            options.map((option) => {
              const label = option.label ?? option.value;
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cx(styles.option, selected && styles.optionSelected)}
                  onClick={() => {
                    if (onOptionSelect) {
                      onOptionSelect(option.value);
                    } else {
                      onChange(option.value);
                    }
                    setOpen(false);
                  }}
                >
                  {label}
                </button>
              );
            })
          ) : (
            <div className={styles.empty}>{emptyLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ComboList;
