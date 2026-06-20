import type { JSX } from "react";
import { useMemo } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { ApiContract, ApiEndpoint, BaseRendererProps } from "./types";

const FORMAT_TONE: Record<ApiContract["format"], "neutral" | "primary" | "accent"> = {
  openapi: "primary",
  graphql: "accent",
  asyncapi: "neutral",
};

function diffEndpoints(
  current: ReadonlyArray<ApiEndpoint> | undefined,
  previous: ReadonlyArray<ApiEndpoint> | undefined,
): {
  added: ReadonlyArray<ApiEndpoint>;
  removed: ReadonlyArray<ApiEndpoint>;
  changed: ReadonlyArray<{ current: ApiEndpoint; previous: ApiEndpoint }>;
} {
  const prevById = new Map((previous ?? []).map((e) => [e.id, e]));
  const curById = new Map((current ?? []).map((e) => [e.id, e]));
  const added: ApiEndpoint[] = [];
  const removed: ApiEndpoint[] = [];
  const changed: { current: ApiEndpoint; previous: ApiEndpoint }[] = [];
  for (const [id, ep] of curById) {
    const prior = prevById.get(id);
    if (!prior) added.push(ep);
    else if (prior.summary !== ep.summary || prior.path !== ep.path || prior.method !== ep.method) {
      changed.push({ current: ep, previous: prior });
    }
  }
  for (const [id, ep] of prevById) {
    if (!curById.has(id)) removed.push(ep);
  }
  return { added, removed, changed };
}

/**
 * ApiContractRenderer — Plan 4 §3.3. Variants: summary | detail | diff.
 * Covers OpenAPI 3.x, GraphQL SDL, and AsyncAPI 2.x shapes.
 */
export function ApiContractRenderer({
  artifact,
  variant = "summary",
  className,
}: BaseRendererProps<ApiContract>) {
  const isDiff = variant === "diff" && artifact.previousVersion;

  const diff = useMemo(
    () =>
      isDiff
        ? diffEndpoints(artifact.endpoints, artifact.previousVersion?.endpoints)
        : null,
    [artifact.endpoints, artifact.previousVersion, isDiff],
  );

  if (isDiff && diff) {
    return (
      <article
        aria-labelledby={`api-${artifact.id}-title`}
        className={cn(
          "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 id={`api-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
              {artifact.name} — diff
            </h3>
            <p className="mt-1 text-body-sm text-ink-muted font-mono">
              {artifact.previousVersion?.version} → {artifact.version}
            </p>
          </div>
          <Badge tone={FORMAT_TONE[artifact.format]} aria-label={`Format: ${artifact.format}`}>
            {artifact.format}
          </Badge>
        </header>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <section aria-label="Added endpoints">
            <h4 className="text-body-sm font-medium text-brand-success">
              + Added ({diff.added.length})
            </h4>
            <ul className="mt-1 space-y-1 font-mono text-body-sm">
              {diff.added.map((e) => (
                <li key={e.id}>
                  <span className="font-semibold">{e.method}</span> {e.path}
                </li>
              ))}
              {diff.added.length === 0 && <li className="text-ink-subtle">none</li>}
            </ul>
          </section>
          <section aria-label="Removed endpoints">
            <h4 className="text-body-sm font-medium text-brand-danger">
              − Removed ({diff.removed.length})
            </h4>
            <ul className="mt-1 space-y-1 font-mono text-body-sm">
              {diff.removed.map((e) => (
                <li key={e.id}>
                  <span className="font-semibold">{e.method}</span> {e.path}
                </li>
              ))}
              {diff.removed.length === 0 && <li className="text-ink-subtle">none</li>}
            </ul>
          </section>
          <section aria-label="Changed endpoints">
            <h4 className="text-body-sm font-medium text-brand-warn">
              ~ Changed ({diff.changed.length})
            </h4>
            <ul className="mt-1 space-y-1 font-mono text-body-sm">
              {diff.changed.map((c) => (
                <li key={c.current.id}>
                  <span className="font-semibold">{c.current.method}</span> {c.current.path}
                </li>
              ))}
              {diff.changed.length === 0 && <li className="text-ink-subtle">none</li>}
            </ul>
          </section>
        </div>
      </article>
    );
  }

  return (
    <article
      aria-labelledby={`api-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`api-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
            {artifact.name}
          </h3>
          <p className="mt-1 font-mono text-body-sm text-ink-muted">{artifact.version}</p>
        </div>
        <Badge tone={FORMAT_TONE[artifact.format]} aria-label={`Format: ${artifact.format}`}>
          {artifact.format}
        </Badge>
      </header>

      {variant === "summary" ? (
        <p className="mt-2 text-body-sm text-ink-muted">
          {artifact.endpoints?.length ?? 0} endpoint{(artifact.endpoints?.length ?? 0) === 1 ? "" : "s"}
        </p>
      ) : (
        <ul aria-label="Endpoints" className="mt-4 divide-y divide-surface-border">
          {(artifact.endpoints ?? []).map((e) => (
            <li key={e.id} className="py-2">
              <p className="font-mono text-body">
                <span className="font-semibold text-brand-primary">{e.method}</span>{" "}
                <span className="text-ink-default">{e.path}</span>
              </p>
              {e.summary && (
                <p className="mt-0.5 text-body-sm text-ink-muted">{e.summary}</p>
              )}
              {e.responses && e.responses.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-2 text-caption text-ink-subtle">
                  {e.responses.map((r) => (
                    <li key={r.status}>
                      <Badge tone={r.status.startsWith("2") ? "success" : r.status.startsWith("4") ? "warn" : r.status.startsWith("5") ? "danger" : "neutral"}>
                        {r.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {(artifact.endpoints ?? []).length === 0 && (
            <li className="py-2 text-body-sm text-ink-subtle">No endpoints declared.</li>
          )}
        </ul>
      )}
    </article>
  );
}
