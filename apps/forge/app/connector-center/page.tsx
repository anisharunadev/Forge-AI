/**
 * Connector Center — list page (FORA-578).
 *
 * The operator view of every MCP integration the tenant uses. Server
 * fetches the typed-mock connector list, applies the persona gate,
 * and renders a card per connector. Per-tenant, RBAC-gated:
 *   * Eng Lead, CTO — full Tier-1 + Tier-2 list.
 *   * PM — read-only subset (no infra credentials surfaced).
 *
 * Reconciles with FORA-128 (redacted credential envelope; raw value
 * NEVER on the wire or in the DOM) and Plan 3 §7.1 (status colors
 * map to the audit log's `tool_call_status` enum).
 */

import Link from "next/link";
import { cookies } from "next/headers";
import {
  listConnectors,
  pmPersonaSubset,
  type McpConnector,
} from "@/lib/connectors/mock-data";
import { SEED_TENANT_ID, readPersonaFromCookieHeader } from "@/lib/auth";
import { ConnectorStatusPill } from "@/components/ConnectorStatusPill";

export const dynamic = "force-dynamic";

type Persona = "pm" | "eng-lead" | "cto";

const PERSONA_LABEL: Record<Persona, string> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  cto: "CTO",
};

function fmtPct(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function isPMOnly(p: Persona): boolean {
  return p === "pm";
}

function scopeSummary(c: McpConnector): { granted: number; denied: number } {
  return {
    granted: c.scope.grantedScopes.length,
    denied: c.scope.deniedScopes?.length ?? 0,
  };
}

export default async function ConnectorCenterPage() {
  // Read the persona cookie server-side. The forge console uses a
  // dev-only cookie-based persona switcher (see apps/forge/lib/auth.ts).
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const persona: Persona = readPersonaFromCookieHeader(cookieHeader);

  const all = await listConnectors(SEED_TENANT_ID);
  const rows = isPMOnly(persona) ? pmPersonaSubset(all) : all;

  return (
    <div className="space-y-6" data-testid="connector-center">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-forge-300">Center</p>
        <h1 className="text-2xl font-semibold">Connector Center</h1>
        <p className="text-sm text-forge-200">
          Operator view of every MCP integration {PERSONA_LABEL[persona]} can audit.
          Credentials are redacted (FORA-128); rotate a credential from the per-connector
          detail page.
        </p>
      </header>

      {isPMOnly(persona) ? (
        <div
          role="status"
          aria-live="polite"
          className="card border-amber-500/40 bg-amber-500/5"
          data-testid="pm-read-only"
        >
          <p className="text-sm text-amber-200">
            Product Manager view — the persona sees the customer-facing connectors
            (Jira, GitHub, GitLab, Slack, Teams, Figma) and cannot rotate credentials.
            Ask the <span className="font-mono">eng-lead</span> persona to operate AWS,
            SonarQube, Azure DevOps, Zendesk, or Databricks.
          </p>
        </div>
      ) : null}

      <section aria-labelledby="connectors-h" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="connectors-h" className="text-lg font-semibold">
            Connectors
          </h2>
          <p className="text-xs text-forge-300" data-testid="connector-count">
            {rows.length} connector{rows.length === 1 ? "" : "s"} · tenant{" "}
            <span className="font-mono">{SEED_TENANT_ID}</span>
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="card" data-testid="connector-empty">
            <p className="text-sm text-forge-200">
              No connectors provisioned for this persona. Ask the Eng Lead to onboard a
              connector in the tenant settings.
            </p>
          </div>
        ) : (
          <ul
            className="grid gap-3 md:grid-cols-2"
            aria-label="MCP connectors"
            data-testid="connector-list"
          >
            {rows.map((c) => {
              const scope = scopeSummary(c);
              return (
                <li key={c.id} className="card space-y-3" data-testid="connector-row">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-forge-300">
                        Tier {c.tier} · {c.scope.roleBinding}
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
                    <dd className="font-mono text-forge-100">
                      {c.health.lastCallAt ?? "—"}
                    </dd>
                    <dt className="text-forge-300">p50 / p95</dt>
                    <dd className="font-mono text-forge-100">
                      {c.health.p50Ms ?? "—"} / {c.health.p95Ms ?? "—"} ms
                    </dd>
                    <dt className="text-forge-300">Error rate (24h)</dt>
                    <dd className="font-mono text-forge-100">
                      {fmtPct(c.health.errorRate)}
                    </dd>
                    <dt className="text-forge-300">Calls (24h)</dt>
                    <dd className="font-mono text-forge-100">
                      {c.health.callCount24h}
                    </dd>
                  </dl>

                  <div
                    className="flex flex-wrap items-center gap-2 text-xs"
                    aria-label="Scope grant"
                  >
                    <span className="text-forge-300">Scope:</span>
                    <span className="rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-mono">
                      {scope.granted} granted
                    </span>
                    {scope.denied > 0 ? (
                      <span className="rounded-sm border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-rose-200">
                        {scope.denied} denied
                      </span>
                    ) : null}
                  </div>

                  <footer className="flex items-center justify-between gap-3 border-t border-forge-800 pt-3 text-xs">
                    <span className="text-forge-300" data-testid="credential-redacted">
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
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
