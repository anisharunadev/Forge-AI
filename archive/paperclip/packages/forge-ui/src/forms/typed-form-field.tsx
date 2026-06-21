import type { JSX } from "react";
import type { ReactNode } from "react";
import { cn } from "../tokens/cn";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";

export interface TypedFormFieldProps {
  /** Field name (passed to `register` upstream). */
  name: string;
  /** Human label (rendered as <label for>). */
  label: string;
  /** Optional help text under the field. */
  helpText?: string;
  /** Error message (when the Zod schema rejected this field). */
  error?: string;
  /** Required marker — purely visual; schema is the source of truth. */
  required?: boolean;
  /** Field children — typically <Input {...form.register(name)} />. */
  children: ReactNode;
  className?: string;
}

/**
 * TypedFormField — Plan 4 §4. Wraps a form control with a label, optional help
 * text, and inline error. All accessibility per Plan 3 §5.1:
 *   - Associated <label> (3.3.2)
 *   - aria-describedby for help + error (announced via live region)
 *   - role="alert" on the error
 */
export function TypedFormField({
  name,
  label,
  helpText,
  error,
  required,
  children,
  className,
}: TypedFormFieldProps) {
  const helpId = helpText ? `${name}-help` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name} className="text-body-sm font-medium text-ink-default">
        {label}
        {required && (
          <span className="ml-1 text-brand-danger" aria-label="required">
            *
          </span>
        )}
      </Label>
      {/* Inject aria-describedby into the child control. The child is
          expected to accept className + aria-* via cloneElement-style props
          spread (rendered by RHF `register`). For simplicity we forward via a
          wrapper attribute the consumer can read. */}
      <FormControlChild hostId={name} {...(describedBy !== undefined ? { describedBy } : {})}>
        {children}
      </FormControlChild>
      {helpText && (
        <p id={helpId} className="text-caption text-ink-muted">
          {helpText}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption text-brand-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Internal: clone the child to inject id (label-for target) and aria-describedby.
 * Keeps the consumer's API simple: <TypedFormField name="x"><Input {...rest} /></TypedFormField>.
 */
function FormControlChild({
  hostId,
  describedBy,
  children,
}: {
  hostId: string;
  describedBy?: string;
  children: ReactNode;
}): JSX.Element {
  if (isElement(children)) {
    const child = children as JSX.Element & {
      props: Record<string, unknown>;
    };
    const merged = {
      id: child.props["id"] ?? hostId,
      "aria-describedby": describedBy ?? child.props["aria-describedby"],
      "aria-invalid": describedBy?.includes("error") ? true : child.props["aria-invalid"],
    };
    return { ...child, props: { ...child.props, ...merged } } as JSX.Element;
  }
  // Fallback: render an Input with the wired attributes. This is the most
  // common case; consumers that need richer controls pass their own children
  // through cloneElement above.
  return (
    <Input id={hostId} aria-describedby={describedBy} aria-invalid={describedBy?.includes("error") || undefined} />
  );
}

function isElement(node: unknown): node is JSX.Element {
  return typeof node === "object" && node !== null && "props" in (node as object);
}
