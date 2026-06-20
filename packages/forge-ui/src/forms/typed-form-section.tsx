import type { JSX } from "react";
import type { ReactNode } from "react";
import { cn } from "../tokens/cn";

export interface TypedFormSectionProps {
  /** Section heading. */
  title: string;
  /** Optional one-line description. */
  description?: string;
  /** Section fields. */
  children: ReactNode;
  className?: string;
}

/**
 * TypedFormSection — Plan 4 §4. Groups related fields under a section heading
 * for multi-section forms. Renders as a <fieldset> with a <legend> so screen
 * readers announce the section boundary.
 */
export function TypedFormSection({
  title,
  description,
  children,
  className,
}: TypedFormSectionProps): JSX.Element {
  return (
    <fieldset className={cn("rounded-md border border-surface-border bg-surface-raised p-4", className)}>
      <legend className="px-2 text-body-sm font-medium text-ink-default">{title}</legend>
      {description && <p className="mb-3 text-caption text-ink-muted">{description}</p>}
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}
