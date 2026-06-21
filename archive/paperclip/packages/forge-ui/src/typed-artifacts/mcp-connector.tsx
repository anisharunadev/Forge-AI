import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, McpConnector } from "./types";
import { ConnectorStatusPill } from "./connector-status-pill";

function fmtPct(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${n} ms`;
}

/**
 * McpConnectorRenderer — Plan 1 §3.2 typed-artifact surface.
 * Variants:
 *   * `summary-card` — Connector Center list page; compact overview.
 *   * `detail-panel` — Connector Center detail page; full health /
 *     scope / credential envelope.
 *   * `row` — dense lists inside other centers (Audit Center, etc.).
 *
 * The renderer NEVER displays the raw credential value. The
 * `CredentialEnvelope.redacted` contract (FORA-128) is enforced
 * by the no-raw regression test in
 * `__tests__/typed-artifacts-connector.test.tsx`.
 */
export function McpConnectorRenderer({
  artifact,
  variant = "summary-card",
  className,
}: BaseRendererProps<McpConnector>): JSX.Element {
  if (variant === "detail-panel") {
    return (
      <article
        aria-labelledby={`connector-${artifact.id}-title`}
        className={cn(
          "rounded-lg border border-surface-border bg-surface p-5 shadow-elev-1",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-caption text-ink-muted">
              {artifact.tier === 1 ? "Tier 1" : "Tier 2"} connector ·{" "}
              <span className="font-mono">{artifact.tenantId}</span>
            </p>
            <h2
              id={`connector-${artifact.id}-title`}
              className="text-heading-2 font-semibold text-ink-default"
            >
              {artifact.displayName}
            </h2>
            <p className="font-mono text-caption text-ink-subtle">{artifact.id}</p>
          </div>
          <ConnectorStatusPill status={artifact.status} />
        </header>

        <section
          aria-labelledby={`connector-${artifact.id}-health`}
          className="mt-4"
        >
          <h3
            id={`connector-${artifact.id}-health`}
            className="text-heading-3 font-semibold"
          >
            Health snapshot
          </h3>
          <dl
            className="mt-2 grid grid-cols-2 gap-2 text-body-sm"
            aria-label="Health metrics"
          >
            <dt className="text-ink-muted">Last call</dt>
            <dd className="font-mono text-ink-default">
              {artifact.health.lastCallAt ?? "—"}
            </dd>
            <dt className="text-ink-muted">p50</dt>
            <dd className="font-mono text-ink-default">
              {fmtMs(artifact.health.p50Ms)}
            </dd>
            <dt className="text-ink-muted">p95</dt>
            <dd className="font-mono text-ink-default">
              {fmtMs(artifact.health.p95Ms)}
            </dd>
            <dt className="text-ink-muted">Error rate (24h)</dt>
            <dd className="font-mono text-ink-default">
              {fmtPct(artifact.health.errorRate)}
            </dd>
            <dt className="text-ink-muted">Calls (24h)</dt>
            <dd className="font-mono text-ink-default">
              {artifact.health.callCount24h}
            </dd>
          </dl>
        </section>

        <section
          aria-labelledby={`connector-${artifact.id}-scope`}
          className="mt-4"
        >
          <h3
            id={`connector-${artifact.id}-scope`}
            className="text-heading-3 font-semibold"
          >
            Scope grant
          </h3>
          <p className="mt-1 text-body-sm text-ink-muted">
            Role binding:{" "}
            <span className="font-mono text-ink-default">
              {artifact.scope.roleBinding}
            </span>
          </p>
          <div
            className="mt-2 flex flex-wrap gap-1"
            aria-label="Granted scopes"
          >
            {artifact.scope.grantedScopes.length === 0 ? (
              <span className="text-caption text-ink-muted">none granted</span>
            ) : (
              artifact.scope.grantedScopes.map((s) => (
                <Badge
                  key={`g-${s}`}
                  tone="primary"
                  aria-label={`Granted: ${s}`}
                >
                  {s}
                </Badge>
              ))
            )}
          </div>
          {artifact.scope.deniedScopes &&
            artifact.scope.deniedScopes.length > 0 && (
              <div
                className="mt-2 flex flex-wrap gap-1"
                aria-label="Denied scopes"
              >
                {artifact.scope.deniedScopes.map((s) => (
                  <Badge
                    key={`d-${s}`}
                    tone="neutral"
                    aria-label={`Denied: ${s}`}
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            )}
        </section>

        <section
          aria-labelledby={`connector-${artifact.id}-cred`}
          className="mt-4"
        >
          <h3
            id={`connector-${artifact.id}-cred`}
            className="text-heading-3 font-semibold"
          >
            Credential envelope
          </h3>
          <p className="mt-1 text-caption text-ink-muted">
            <span
              aria-label="Redacted"
              data-testid="credential-redacted"
              className="font-semibold uppercase tracking-wide"
            >
              Redacted
            </span>{" "}
            per FORA-128 — raw values never cross the wire.
          </p>
          <dl
            className="mt-2 grid grid-cols-2 gap-2 text-body-sm"
            aria-label="Credential metadata"
          >
            <dt className="text-ink-muted">Secret ref</dt>
            <dd className="font-mono text-ink-default">
              {artifact.credential.secretRef}
            </dd>
            <dt className="text-ink-muted">Fingerprint</dt>
            <dd className="font-mono text-ink-default">
              {artifact.credential.fingerprint}
            </dd>
            {artifact.credential.valueLen !== undefined && (
              <>
                <dt className="text-ink-muted">Value length</dt>
                <dd className="font-mono text-ink-default">
                  {artifact.credential.valueLen} bytes
                </dd>
              </>
            )}
            {artifact.credential.lastRotatedAt && (
              <>
                <dt className="text-ink-muted">Last rotated</dt>
                <dd className="font-mono text-ink-default">
                  {artifact.credential.lastRotatedAt}
                </dd>
              </>
            )}
            {artifact.credential.expiresAt && (
              <>
                <dt className="text-ink-muted">Expires at</dt>
                <dd className="font-mono text-ink-default">
                  {artifact.credential.expiresAt}
                </dd>
              </>
            )}
          </dl>
        </section>
      </article>
    );
  }

  if (variant === "row") {
    return (
      <div
        role="row"
        aria-label={`MCP connector ${artifact.displayName}`}
        className={cn(
          "grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 border-b border-surface-border px-3 py-2 text-body-sm",
          className,
        )}
      >
        <span className="truncate text-ink-default">
          <span className="font-medium">{artifact.displayName}</span>{" "}
          <span className="font-mono text-caption text-ink-subtle">
            {artifact.id}
          </span>
        </span>
        <ConnectorStatusPill status={artifact.status} />
        <span className="font-mono text-ink-muted" aria-label="Error rate">
          {fmtPct(artifact.health.errorRate)}
        </span>
        <span className="font-mono text-ink-muted" aria-label="Calls 24h">
          {artifact.health.callCount24h}
        </span>
        <span className="font-mono text-caption text-ink-subtle" aria-label="Last call">
          {artifact.health.lastCallAt ?? "—"}
        </span>
      </div>
    );
  }

  // summary-card (default)
  return (
    <article
      aria-labelledby={`connector-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3
            id={`connector-${artifact.id}-title`}
            className="text-heading-3 font-semibold text-ink-default"
          >
            {artifact.displayName}
          </h3>
          <p className="font-mono text-caption text-ink-subtle">
            {artifact.id}
          </p>
        </div>
        <ConnectorStatusPill status={artifact.status} />
      </header>
      <dl
        className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm"
        aria-label="Connector summary"
      >
        <dt className="text-ink-muted">Last call</dt>
        <dd className="font-mono text-ink-default">
          {artifact.health.lastCallAt ?? "—"}
        </dd>
        <dt className="text-ink-muted">Error rate</dt>
        <dd className="font-mono text-ink-default">
          {fmtPct(artifact.health.errorRate)}
        </dd>
        <dt className="text-ink-muted">Role binding</dt>
        <dd className="font-mono text-ink-default">
          {artifact.scope.roleBinding}
        </dd>
        <dt className="text-ink-muted">Scopes</dt>
        <dd className="text-ink-default">
          {artifact.scope.grantedScopes.length === 0
            ? "—"
            : `${artifact.scope.grantedScopes.length} granted`}
        </dd>
      </dl>
    </article>
  );
}
