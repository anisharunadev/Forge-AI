import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, Requirement } from "./types";

const STATUS_TONE: Record<
  Requirement["status"],
  "neutral" | "primary" | "success" | "warn" | "danger"
> = {
  draft: "neutral",
  review: "primary",
  accepted: "success",
  "out-of-scope": "warn",
};

/**
 * RequirementRenderer — Plan 4 §3.1. Variants: card | inline | panel.
 * Default implementation here covers `card` (the most common); consumers
 * extend via className for `inline` (linked citation) and `panel` (full side
 * panel surface).
 */
export function RequirementRenderer({
  artifact,
  variant = "card",
  className,
}: BaseRendererProps<Requirement>) {
  return (
    <article
      aria-labelledby={`req-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        variant === "card" && "max-w-prose",
        variant === "panel" && "w-full",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <h3
          id={`req-${artifact.id}-title`}
          className="text-heading-3 font-semibold text-ink-default"
        >
          {artifact.title}
        </h3>
        <Badge tone={STATUS_TONE[artifact.status]} aria-label={`Status: ${artifact.status}`}>
          {artifact.status}
        </Badge>
      </header>

      {artifact.sections.problem && (
        <section className="mt-3">
          <h4 className="text-body-sm font-medium text-ink-muted">Problem</h4>
          <p className="text-body text-ink-default">{artifact.sections.problem}</p>
        </section>
      )}

      {artifact.sections.openQuestions && artifact.sections.openQuestions.length > 0 && (
        <section className="mt-3">
          <h4 className="text-body-sm font-medium text-ink-muted">
            Open questions ({artifact.sections.openQuestions.length})
          </h4>
          <ul className="mt-1 space-y-1">
            {artifact.sections.openQuestions.map((q) => (
              <li key={q.id} className="text-body-sm text-ink-default">
                <span className="font-medium">{q.prompt}</span>
                {q.owner && (
                  <span className="ml-2 text-ink-subtle">— owner: {q.owner}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}