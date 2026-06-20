/**
 * Connector Center — list page (FORA-578).
 *
 * The operator view of every MCP integration the tenant uses. Server
 * fetches the typed-mock connector list, applies the RBAC gate, and
 * renders one card per connector. Per-tenant, persona-gated:
 *
 *   * Eng Lead, CTO — full Tier-1 + Tier-2 list of <ConnectorCard />.
 *   * PM — typed-artifact empty-state (cards never render); the empty
 *     state names the persona to ask.
 *
 * Reconciles with:
 *   * FORA-128 — credential envelope is always redacted; raw values
 *     never appear on the wire or in the DOM.
 *   * FORA-125 — status colors map to the audit-log `tool_call_status`
 *     enum (success / degraded / error → green / amber / red).
 *   * Plan 3 §7.1 — ConnectorStatusPill is the single canonical
 *     connector-health indicator.
 *   * Plan 4 §3.2 — every card is a typed-artifact render of the
 *     `McpConnector` shape.
 *
 * The "(centers)" route group is reserved for the future Center
 * layout (a shared shell that wraps /connector-center, /audit-center,
 * /run-center, etc.). Today the page still renders under the root
 * layout so the URL resolves to `/connector-center` exactly.
 */

import { cookies } from "next/headers";
import {
  listConnectors,
  TIER_1_CONNECTORS,
  type McpConnector,
} from "@/lib/connectors/mock-data";
import { SEED_TENANT_ID, readPersonaFromCookieHeader } from "@/lib/auth";
import {
  canAccessConnectorCenter,
  escalationPersonaLabel,
  type ConnectorCenterPersona,
} from "@/lib/connectors/rbac";
import { ConnectorCard } from "@/components/ConnectorCard";

export const dynamic = "force-dynamic";

const PERSONA_LABEL: Record<ConnectorCenterPersona, string> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  cto: "CTO",
};

function tierOneCoverage(rows: ReadonlyArray<McpConnector>): {
  present: ReadonlyArray<string>;
  missing: ReadonlyArray<string>;
} {
  const present = TIER_1_CONNECTORS.filter((id) => rows.some((r) => r.id === id));
  const missing = TIER_1_CONNECTORS.filter((id) => !rows.some((r) => r.id === id));
  return { present, missing };
}

export default async function ConnectorCenterPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const persona: ConnectorCenterPersona = readPersonaFromCookieHeader(
    cookieHeader,
  );

  if (!canAccessConnectorCenter(persona)) {
    return (
      <div className="space-y-6" data-testid="connector-center">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-forge-300">
            Center
          </p>
          <h1 className="text-2xl font-semibold">Connector Center</h1>
          <p className="text-sm text-forge-200">
            Operator view of every MCP integration {PERSONA_LABEL[persona]} can audit.
            Credentials are redacted (FORA-128); rotate a credential from the per-connector
            detail page.
          </p>
        </header>

        <section
          aria-labelledby="empty-h"
          className="card flex flex-col items-start gap-3 border-amber-500/40 bg-amber-500/5"
          data-testid="connector-empty-state"
          data-empty-kind="rbac-denied"
        >
          <p
            className="inline-flex rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-amber-200"
            data-testid="connector-empty-pill"
          >
            Access restricted
          </p>
          <h2 id="empty-h" className="text-lg font-semibold text-amber-100">
            Connector Center is restricted to Engineering Lead and CTO personas.
          </h2>
          <p className="text-sm text-amber-200">
            The <span className="font-mono">{persona}</span> persona cannot audit MCP
            connectors or rotate credentials. Ask the{" "}
            <span className="font-mono">
              {escalationPersonaLabel(persona).toLowerCase()}
            </span>{" "}
            to operate the Connector Center for tenant{" "}
            <span className="font-mono">{SEED_TENANT_ID}</span>.
          </p>
        </section>
      </div>
    );
  }

  const rows = await listConnectors(SEED_TENANT_ID);
  const coverage = tierOneCoverage(rows);

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

        {coverage.missing.length > 0 ? (
          <p
            className="text-xs text-rose-300"
            data-testid="tier-one-coverage"
            data-present={coverage.present.join(",")}
            data-missing={coverage.missing.join(",")}
          >
            Tier-1 coverage: {coverage.present.length}/{TIER_1_CONNECTORS.length} —
            missing {coverage.missing.join(", ")}.
          </p>
        ) : (
          <p
            className="text-xs text-forge-300"
            data-testid="tier-one-coverage"
            data-present={coverage.present.join(",")}
            data-missing=""
          >
            Tier-1 coverage: {coverage.present.length}/{TIER_1_CONNECTORS.length} (all
            present).
          </p>
        )}

        {rows.length === 0 ? (
          <div
            className="card"
            data-testid="connector-empty"
            data-empty-kind="no-connectors"
          >
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
            {rows.map((c) => (
              <ConnectorCard key={c.id} connector={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}