import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, GlossaryEntry } from "./types";

/**
 * GlossaryEntryRenderer — Plan 1 §3.3 typed-artifact surface.
 *
 * Variants:
 *   - `card`  (default) — summary card for the glossary browser row.
 *   - `panel` — full side-panel viewer with the definition body.
 *
 * The `usageCount` drives the size hint in the Knowledge Graph
 * (Plan 2 §3.1); the renderer surfaces it as a visible count plus
 * `aria-label` so screen readers announce the same number.
 *
 * v1.0 is read-only. v1.1 will add the "file glossary PR" affordance
 * behind RBAC, gated by the Governance Center token (the anti-glossary
 * is too important to let an agent edit unsupervised).
 */
export function GlossaryEntryRenderer({
  artifact,
  variant = "card",
  className,
}: BaseRendererProps<GlossaryEntry>): JSX.Element {
  if (variant === "panel") {
    return (
      <article
        aria-labelledby={`gl-${artifact.id}-term`}
        className={cn(
          "w-full space-y-3 rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
          className,
        )}
        data-testid="glossary-entry-panel"
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <h3
            id={`gl-${artifact.id}-term`}
            className="text-heading-3 font-semibold text-ink-default"
          >
            {artifact.term}
          </h3>
          <Badge tone="primary" aria-label={`Used by ${artifact.usageCount} files`}>
            used by {artifact.usageCount}
          </Badge>
        </header>
        <p className="text-body text-ink-default">{artifact.definition}</p>
        {artifact.antiNote && (
          <aside
            aria-label="Anti-glossary note"
            className="rounded-md border border-brand-warn/30 bg-brand-warn/10 p-3 text-body-sm text-ink-default"
          >
            <p className="mb-1 text-caption font-medium uppercase tracking-wide text-brand-warn">
              Anti-glossary
            </p>
            <p>{artifact.antiNote}</p>
          </aside>
        )}
        {artifact.relatedFileIds && artifact.relatedFileIds.length > 0 && (
          <footer className="text-caption text-ink-muted">
            <span>Referenced by {artifact.relatedFileIds.length} file(s).</span>
          </footer>
        )}
      </article>
    );
  }

  return (
    <article
      aria-labelledby={`gl-${artifact.id}-term`}
      className={cn(
        "max-w-prose space-y-1 rounded-lg border border-surface-border bg-surface p-3 shadow-elev-1",
        className,
      )}
      data-testid="glossary-entry-card"
      data-usage={artifact.usageCount}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id={`gl-${artifact.id}-term`}
          className="text-heading-3 font-semibold text-ink-default"
        >
          {artifact.term}
        </h3>
        <Badge tone="primary" aria-label={`Used by ${artifact.usageCount} files`}>
          {artifact.usageCount}
        </Badge>
      </header>
      <p className="line-clamp-2 text-body-sm text-ink-default">{artifact.definition}</p>
    </article>
  );
}
