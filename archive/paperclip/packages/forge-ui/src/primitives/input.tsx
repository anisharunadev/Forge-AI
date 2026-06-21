import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../tokens/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Input — WCAG 3.3.2 (Labels or instructions) is the consumer's responsibility:
 * every Input must be wrapped in a <label> or have aria-label/aria-labelledby.
 * Inline errors should use aria-describedby pointing to a <FieldError> element.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-10 w-full rounded-md border border-surface-border bg-surface px-3 py-2",
        "text-body text-ink-default placeholder:text-ink-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-brand-danger focus-visible:ring-brand-danger",
        className,
      )}
      {...props}
    />
  );
});