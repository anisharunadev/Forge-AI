'use client';

/**
 * FloatingLabelInput — shadcn Input with a floating label.
 *
 * Implements the spec rule: "every form field uses floating labels
 * (not placeholder-only)". The label sits at the top of the field
 * and shrinks to the top-left when the input is focused or has a
 * value. Required fields show a rose asterisk.
 *
 * Supports a password variant with reveal/copy/rotate actions for the
 * Provider API-key field.
 */

import * as React from 'react';
import {
  Eye,
  EyeOff,
  Copy,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface FloatingLabelInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Field label (visible above the input; floats on focus). */
  label: string;
  /** Required flag — renders a rose asterisk after the label. */
  required?: boolean;
  /** Helper text rendered below the input. */
  helperText?: string;
  /** Mark this as a secret (default: "password"). */
  type?: React.HTMLInputTypeAttribute;
  /** Optional ref passthrough. */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Show copy + rotate actions for password fields. */
  showSecretActions?: boolean;
  /** Copy callback (password fields). */
  onCopy?: () => void;
  /** Rotate callback (password fields). */
  onRotate?: () => void;
  /** Optional test id (consumers must pass it explicitly). */
  testId?: string;
}

export const FloatingLabelInput = React.forwardRef<
  HTMLInputElement,
  FloatingLabelInputProps
>(function FloatingLabelInput(
  {
    label,
    required = false,
    helperText,
    type = 'text',
    inputRef,
    showSecretActions = false,
    onCopy,
    onRotate,
    testId,
    id,
    value,
    defaultValue,
    placeholder = ' ',
    className,
    ...rest
  },
  ref,
) {
  const reactId = React.useId();
  const fieldId = id ?? `fli-${reactId}`;
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const isPassword = type === 'password';
  const effectiveType = isPassword && revealed ? 'text' : type;

  const handleCopy = React.useCallback(() => {
    onCopy?.();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [onCopy]);

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Input
          id={fieldId}
          ref={(node) => {
            if (typeof ref === 'function') ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
            if (typeof inputRef === 'function') inputRef(node);
            else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          type={effectiveType}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cn(
            'peer h-11 pt-4',
            isPassword && showSecretActions ? 'pr-32' : '',
            className,
          )}
          aria-required={required || undefined}
          aria-label={label}
          data-testid={testId}
          {...rest}
        />
        <label
          htmlFor={fieldId}
          className={cn(
            'pointer-events-none absolute left-3 top-1.5 text-[11px] text-[var(--fg-tertiary)] transition-all',
            'peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-[var(--fg-tertiary)]',
            'peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:text-[var(--accent-primary)]',
          )}
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-[var(--accent-rose)]" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {isPassword && showSecretActions ? (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <button
              type="button"
              aria-label={revealed ? 'Hide value' : 'Reveal value'}
              onClick={() => setRevealed((v) => !v)}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              data-testid={`${testId ?? 'secret'}-reveal`}
            >
              {revealed ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              aria-label="Copy value"
              onClick={handleCopy}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              data-testid={`${testId ?? 'secret'}-copy`}
            >
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent-emerald)]" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
            {onRotate ? (
              <button
                type="button"
                aria-label="Rotate key"
                onClick={onRotate}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
                data-testid={`${testId ?? 'secret'}-rotate`}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {helperText ? (
        <p className="text-[11px] text-[var(--fg-tertiary)]">{helperText}</p>
      ) : null}
    </div>
  );
});