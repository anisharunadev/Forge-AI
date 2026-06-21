/**
 * Connectors — async data seam (MCP connector list/detail).
 *
 * Replaces the sync `lib/connectors/mock-data.ts` for production
 * rendering. Server components import the fetchers here; client
 * components can still consume the typed shapes via the `useApiData`
 * hook in `hooks/use-api-data.ts`.
 *
 * API endpoints (from `bin/orchestrator-stub.py`):
 *   GET  /v1/connectors          → McpConnector[]
 *   GET  /v1/connectors/{id}     → McpConnector | 404
 */

export type ToolCallStatus = "success" | "degraded" | "error";
export type ConnectorTier = 1 | 2;
export type ConnectorId =
  | "jira"
  | "github"
  | "gitlab"
  | "slack"
  | "teams"
  | "sonarqube"
  | "figma"
  | "aws"
  | "azdo"
  | "zendesk"
  | "databricks";

/** Tier 1 = priority-1 per tech-stack.md §10; Tier 2 = priority-2. */
export const TIER_1_CONNECTORS: ReadonlyArray<ConnectorId> = [
  "jira",
  "github",
  "gitlab",
  "slack",
  "teams",
  "sonarqube",
  "figma",
  "aws",
  "azdo",
  "zendesk",
  "databricks",
] as const;

export interface ConnectorHealth {
  readonly lastCallAt?: string;
  readonly p50Ms?: number;
  readonly p95Ms?: number;
  readonly errorRate?: number; // 0..1
  readonly callCount24h: number;
}

export interface ConnectorScope {
  readonly grantedScopes: ReadonlyArray<string>;
  readonly deniedScopes?: ReadonlyArray<string>;
  readonly roleBinding: string;
}

export interface CredentialEnvelope {
  /** `tenants/{tenant_id}/secrets/{name}@{version}` per FORA-128. */
  readonly secretRef: string;
  /** Always `true` on the wire. Raw value NEVER crosses. */
  readonly redacted: true;
  readonly valueLen?: number;
  /** sha256[:12] of the raw value — the only stable identifier. */
  readonly fingerprint: string;
  readonly expiresAt?: string;
  readonly lastRotatedAt?: string;
}

export interface McpConnector {
  readonly id: ConnectorId;
  readonly name: string;
  readonly displayName: string;
  readonly tenantId: string;
  readonly status: ToolCallStatus;
  readonly tier: ConnectorTier;
  readonly health: ConnectorHealth;
  readonly scope: ConnectorScope;
  /** ALWAYS redacted. */
  readonly credential: CredentialEnvelope;
  readonly lastUsedAt?: string;
  readonly lastAuditEntryId?: string;
}

const BASE_URL =
  process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * List connectors for a tenant. The forge console is single-tenant in
 * v1.0 GA; `tenantId` is a thin seam so a future multi-tenant client
 * can scope by tenant. The orchestrator ignores `tenantId` today and
 * returns the seeded list; the parameter is kept for API symmetry.
 */
export async function listConnectors(
  _tenantId: string,
): Promise<ReadonlyArray<McpConnector>> {
  const rows = await getJson<McpConnector[]>('/v1/connectors');
  return rows ?? [];
}

/**
 * One connector by id. Returns `null` for a miss — the caller (the
 * detail page) surfaces an "unknown connector" empty state.
 */
export async function getConnector(
  _tenantId: string,
  id: string,
): Promise<McpConnector | null> {
  const row = await getJson<McpConnector>(`/v1/connectors/${encodeURIComponent(id)}`);
  return row;
}

/** PM-tier subset of Tier-1 connectors (FORA-578 RBAC). */
export function pmPersonaSubset(
  rows: ReadonlyArray<McpConnector>,
): ReadonlyArray<McpConnector> {
  const pmAllowed: ReadonlyArray<ConnectorId> = [
    'jira',
    'github',
    'gitlab',
    'slack',
    'teams',
    'figma',
  ];
  return rows.filter((c) => pmAllowed.includes(c.id));
}