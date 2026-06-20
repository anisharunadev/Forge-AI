import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { AuditEntry, BaseRendererProps } from "./types";

const ACTOR_TONE: Record<AuditEntry["actor"]["kind"], "neutral" | "primary" | "accent" | "warn"> = {
  user: "primary",
  agent: "accent",
  system: "neutral",
  scheduler: "warn",
};

function fmtCost(cost: number | undefined): string {
  if (cost === undefined) return "—";
  if (cost < 0.01 && cost > 0) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(4)}`;
}

/**
 * AuditEntryRenderer — Plan 4 §3.9. Variants: row | panel | export-row.
 * Every audit-log row across the centers uses this; it's the renderer the
 * Audit Timeline Graph composes per node.
 */
export function AuditEntryRenderer({
  artifact,
  variant = "row",
  className,
}: BaseRendererProps<AuditEntry>) {
  if (variant === "panel") {
    return (
      <article
        aria-labelledby={`audit-${artifact.id}-title`}
        className={cn(
          "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3">
          <h3 id={`audit-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
            Audit entry
          </h3>
          <Badge tone={ACTOR_TONE[artifact.actor.kind]}>{artifact.actor.kind}</Badge>
        </header>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-body-sm" aria-label="Audit entry details">
          <dt className="text-ink-muted">Timestamp</dt>
          <dd className="font-mono text-ink-default">{artifact.timestamp}</dd>
          <dt className="text-ink-muted">Actor</dt>
          <dd className="text-ink-default">
            {artifact.actor.displayName ?? artifact.actor.id}{" "}
            <span className="font-mono text-ink-subtle">({artifact.actor.id})</span>
          </dd>
          <dt className="text-ink-muted">Tenant</dt>
          <dd className="font-mono text-ink-default">{artifact.tenantId}</dd>
          <dt className="text-ink-muted">Tool</dt>
          <dd className="font-mono text-ink-default">{artifact.tool}</dd>
          {artifact.queryHash && (
            <>
              <dt className="text-ink-muted">Query hash</dt>
              <dd className="font-mono text-ink-default">{artifact.queryHash}</dd>
            </>
          )}
          {artifact.responseHash && (
            <>
              <dt className="text-ink-muted">Response hash</dt>
              <dd className="font-mono text-ink-default">{artifact.responseHash}</dd>
            </>
          )}
          {artifact.latencyMs !== undefined && (
            <>
              <dt className="text-ink-muted">Latency</dt>
              <dd className="font-mono text-ink-default">{artifact.latencyMs} ms</dd>
            </>
          )}
          {artifact.tokens && (
            <>
              <dt className="text-ink-muted">Tokens</dt>
              <dd className="font-mono text-ink-default">
                {artifact.tokens.prompt} → {artifact.tokens.completion}
              </dd>
            </>
          )}
          {artifact.costUsd !== undefined && (
            <>
              <dt className="text-ink-muted">Cost</dt>
              <dd className="font-mono text-ink-default">{fmtCost(artifact.costUsd)}</dd>
            </>
          )}
          {artifact.artifactRef && (
            <>
              <dt className="text-ink-muted">Artifact</dt>
              <dd className="font-mono text-ink-default">
                {artifact.artifactRef.kind}:{artifact.artifactRef.id}
              </dd>
            </>
          )}
        </dl>
      </article>
    );
  }

  // row / export-row
  return (
    <div
      role="row"
      aria-label={`Audit entry ${artifact.id}`}
      className={cn(
        "grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] items-center gap-3 border-b border-surface-border px-3 py-2 text-body-sm",
        variant === "export-row" && "bg-surface-sunken",
        className,
      )}
    >
      <span className="font-mono text-caption text-ink-muted">{artifact.timestamp}</span>
      <Badge tone={ACTOR_TONE[artifact.actor.kind]}>{artifact.actor.kind}</Badge>
      <span className="truncate text-ink-default">
        <span className="font-mono">{artifact.tool}</span>
        {artifact.artifactRef && (
          <span className="ml-2 text-ink-subtle">
            → {artifact.artifactRef.kind}:{artifact.artifactRef.id}
          </span>
        )}
      </span>
      <span className="font-mono text-ink-muted">{artifact.tenantId}</span>
      <span className="font-mono text-ink-muted" aria-label="Latency">
        {artifact.latencyMs !== undefined ? `${artifact.latencyMs}ms` : "—"}
      </span>
      <span className="font-mono text-ink-muted" aria-label="Cost">
        {fmtCost(artifact.costUsd)}
      </span>
      <span className="font-mono text-caption text-ink-subtle" aria-label="Hashes">
        {artifact.queryHash?.slice(0, 6) ?? "—"}
      </span>
    </div>
  );
}
