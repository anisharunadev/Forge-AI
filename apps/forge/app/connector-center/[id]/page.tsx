/**
 * Connector Center — per-connector detail page (FORA-579).
 *
 * Server-rendered. Reads the typed-mock connector by id, applies the
 * RBAC gate (same as the list page: Eng Lead + CTO only), then renders
 * the full detail panel. Per Plan 1 §3.2 + Plan 4 §3.9, the panel
 * surfaces:
 *
 *   * Header (display name + status pill + "Open in audit" link)
 *   * Health snapshot (last call, p50, p95, error rate, callCount24h,
 *     sparkline)
 *   * Scope grant (granted/denied chips, roleBinding link)
 *   * Credential envelope (secretRef, fingerprint, valueLen,
 *     lastRotatedAt, expiresAt — redacted per FORA-128)
 *   * Rotation deadline callout (when expiresAt is within 14d)
 *   * Last 100 audit entries (inline panel composing the typed
 *     AuditEntry row)
 *   * "Rotate credential" action placeholder (modal wires in FORA-580)
 *
 * Reconciles with FORA-128 (redacted envelope), FORA-125 (IAM broker
 * scope), FORA-505 (audit center v0.5.0 — the "Open in audit" target).
 */

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getConnector,
  TIER_1_CONNECTORS,
  type ConnectorId,
} from "@/lib/connectors/mock-data";
import { getConnectorAuditFeed } from "@/lib/connectors/audit-feed";
import { SEED_TENANT_ID, readPersonaFromCookieHeader } from "@/lib/auth";
import {
  canAccessConnectorCenter,
  escalationPersonaLabel,
  type ConnectorCenterPersona,
} from "@/lib/connectors/rbac";
import { ConnectorDetailPanel } from "@/components/ConnectorDetailPanel";

export const dynamic = "force-dynamic";

const PERSONA_LABEL: Record<ConnectorCenterPersona, string> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  cto: "CTO",
};

/** Last-N inline panel size. Per spec: "last 100 audit entries". */
const AUDIT_FEED_LIMIT = 100;

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ConnectorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const persona: ConnectorCenterPersona = readPersonaFromCookieHeader(cookieHeader);

  // RBAC gate — same as list page.
  if (!canAccessConnectorCenter(persona)) {
    return (
      <div className="space-y-6" data-testid="connector-detail-rbac">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-forge-300">
            Center
          </p>
          <h1 className="text-2xl font-semibold">Connector detail</h1>
          <p className="text-sm text-forge-200">
            Operator view of every MCP integration {PERSONA_LABEL[persona]} can audit.
            Credentials are redacted (FORA-128); rotate a credential from the per-connector
            detail page.
          </p>
        </header>

        <section
          aria-labelledby="empty-h"
          className="card flex flex-col items-start gap-3 border-amber-500/40 bg-amber-500/5"
          data-testid="connector-detail-empty"
          data-empty-kind="rbac-denied"
        >
          <p
            className="inline-flex rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-amber-200"
            data-testid="connector-detail-empty-pill"
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

  // Resolve the connector by id. Unknown id → 404 via notFound().
  // Note: the typed-mock allows any string id to resolve; we explicitly
  // narrow against the ConnectorId closed enum so the page never
  // surfaces a misspelled URL.
  if (!TIER_1_CONNECTORS.includes(id as ConnectorId) && !isMockTier2(id as ConnectorId)) {
    notFound();
  }

  const connector = await getConnector(SEED_TENANT_ID, id);
  if (!connector) {
    notFound();
  }

  const feed = await getConnectorAuditFeed(SEED_TENANT_ID, connector.id, AUDIT_FEED_LIMIT);

  return (
    <div className="space-y-6" data-testid="connector-detail-page">
      <nav aria-label="Breadcrumb" className="text-xs text-forge-300">
        <a href="/connector-center" className="hover:text-forge-100">
          ← Connector Center
        </a>
      </nav>

      <ConnectorDetailPanel
        connector={connector}
        auditEntries={feed.entries}
      />
    </div>
  );
}

/**
 * Tier-2 connectors are not in TIER_1_CONNECTORS but exist in the
 * mock; allow them through too. The list page lists both tiers, so
 * the detail page must allow either.
 */
function isMockTier2(id: string): boolean {
  return id === "azdo" || id === "zendesk" || id === "databricks";
}