import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { Adr, BaseRendererProps } from "./types";

const ADR_TONE: Record<
  Adr["status"],
  "neutral" | "primary" | "success" | "warn"
> = {
  proposed: "primary",
  accepted: "success",
  superseded: "warn",
  deprecated: "neutral",
};

/**
 * AdrRenderer — Plan 4 §3.2. Shows number, title, status, decision date, and
 * the context → decision → consequences chain.
 */
export function AdrRenderer({
  artifact,
  className,
}: BaseRendererProps<Adr>) {
  return (
    <article
      aria-labelledby={`adr-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <h3
          id={`adr-${artifact.id}-title`}
          className="text-heading-3 font-semibold text-ink-default"
        >
          <span className="font-mono text-body-sm text-ink-muted mr-2">
            ADR-{artifact.number}
          </span>
          {artifact.title}
        </h3>
        <Badge tone={ADR_TONE[artifact.status]} aria-label={`Status: ${artifact.status}`}>
          {artifact.status}
        </Badge>
      </header>

      {artifact.decisionDate && (
        <p className="mt-2 text-body-sm text-ink-subtle">
          Decided {artifact.decisionDate}
          {artifact.deciders && artifact.deciders.length > 0 && (
            <> · {artifact.deciders.join(", ")}</>
          )}
        </p>
      )}

      {artifact.context && (
        <section className="mt-3">
          <h4 className="text-body-sm font-medium text-ink-muted">Context</h4>
          <p className="text-body text-ink-default">{artifact.context}</p>
        </section>
      )}
      {artifact.decision && (
        <section className="mt-3">
          <h4 className="text-body-sm font-medium text-ink-muted">Decision</h4>
          <p className="text-body text-ink-default">{artifact.decision}</p>
        </section>
      )}
      {artifact.consequences && (
        <section className="mt-3">
          <h4 className="text-body-sm font-medium text-ink-muted">Consequences</h4>
          <p className="text-body text-ink-default">{artifact.consequences}</p>
        </section>
      )}
    </article>
  );
}