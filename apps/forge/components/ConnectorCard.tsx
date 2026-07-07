/**
 * ConnectorCard — the typed-artifact summary card for the Connector
 * Center list page (FORA-578).
 *
 * Mirrors `McpConnectorRenderer` variant="summary-card" from
 * `the v2.0 typed-artifact system` (shipped in FORA-577) but uses the
 * forge console's tailwind `forge-*` tokens so the card matches the
 * rest of the app. The two renderers share the brand-token mapping
 * (Plan 3 §7.1) — success/degraded/error → green/amber/red.
 *
 * Renders:
 *   * Display name + connector id.
 *   * Status pill (via @/components/ConnectorStatusPill).
 *   * Health: last call, error rate (24h), p50 / p95.
 *   * Scope grant: chips per granted scope + denied chips.
 *   * "Open" link to the per-connector detail page (FORA-579).
 *
 * The card NEVER displays the raw credential value. The
 * `credential-redacted` marker is surfaced so the audit harness can
 * assert the redacted contract on the page DOM (FORA-128).
 */

import Link from "next/link";
import type { Connector } from "@/lib/connectors/data"; // ponytail: aliased to Connector after refactor
import { asScopeDetail } from "@/lib/connectors/data";
import { ConnectorStatusPill } from "@/components/ConnectorStatusPill";

export interface ConnectorCardProps {
  readonly connector: Connector;
}

function fmtPct(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${n} ms`;
}

export function ConnectorCard({ connector }: ConnectorCardProps) {
  const c = connector;
  const scope = asScopeDetail(c.scope);
  return (
    <li
      className="card space-y-3"
      data-testid="connector-row"
      data-connector-id={c.id}
      data-connector-tier={c.tier}
      data-connector-status={c.status}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-forge-300">
            Tier {c.tier} · {scope.roleBinding}
          </p>
          <h3 className="text-lg font-semibold" id={`connector-${c.id}-h`}>
            {c.displayName}
          </h3>
          <p className="font-mono text-xs text-forge-300">{c.id}</p>
        </div>
        <ConnectorStatusPill status={c.status} />
      </header>

      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        aria-label="Health summary"
      >
        <dt className="text-forge-300">Last call</dt>
        <dd className="font-mono text-forge-100" data-testid="connector-last-call">
          {c.health.lastCallAt ?? "—"}
        </dd>
        <dt className="text-forge-300">p50 / p95</dt>
        <dd className="font-mono text-forge-100" data-testid="connector-latency">
          {fmtMs(c.health.p50Ms)} / {fmtMs(c.health.p95Ms)}
        </dd>
        <dt className="text-forge-300">Error rate (24h)</dt>
        <dd className="font-mono text-forge-100" data-testid="connector-error-rate">
          {fmtPct(c.health.errorRate)}
        </dd>
        <dt className="text-forge-300">Calls (24h)</dt>
        <dd className="font-mono text-forge-100">{c.health.callCount24h}</dd>
      </dl>

      <div className="flex flex-col gap-2" aria-label="Scope grant">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-forge-300">Granted:</span>
          {scope.grantedScopes.length === 0 ? (
            <span
              className="rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-mono text-forge-300"
              data-testid="scope-granted-empty"
            >
              none
            </span>
          ) : (
            scope.grantedScopes.map((s) => (
              <span
                key={`g-${s}`}
                className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-200"
                data-testid="scope-granted-chip"
                data-scope={s}
                aria-label={`Granted: ${s}`}
              >
                {s}
              </span>
            ))
          )}
        </div>
        {scope.deniedScopes && scope.deniedScopes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-forge-300">Denied:</span>
            {scope.deniedScopes.map((s) => (
              <span
                key={`d-${s}`}
                className="rounded-sm border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-rose-200"
                data-testid="scope-denied-chip"
                data-scope={s}
                aria-label={`Denied: ${s}`}
              >
                {s}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-forge-800 pt-3 text-xs">
        <span
          className="text-forge-300"
          data-testid="credential-redacted"
          data-redacted={String(c.credential.redacted) as "true"}
        >
          Credential · redacted
        </span>
        <Link
          href={`/connector-center/${c.id}`}
          className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50 hover:border-forge-500"
          data-testid="connector-open"
          aria-label={`Open ${c.displayName} connector details`}
        >
          Open →
        </Link>
      </footer>
    </li>
  );
}