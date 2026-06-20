/**
 * FORA-578 typed mock data source for the Connector Center.
 *
 * This is the seam the list page reads from. FORA-579 (detail) + FORA-580
 * (rotate modal) will swap this for the live `@fora/connector-config`
 * binding + the secrets-mcp rotate action; the typed shape is the
 * contract.
 *
 * Source of truth:
 *   * `McpConnector` / `ConnectorHealth` / `ConnectorScope` /
 *     `CredentialEnvelope` / `ToolCallStatus` / `ConnectorTier` — from
 *     `@fora/forge-ui/typed-artifacts` (shipped in FORA-577, package
 *     v0.3.0). The app currently renders with its own tailwind tokens,
 *     so we mirror the type shape here rather than import.
 *   * `ConnectorId` closed enum — from `@fora/connector-config` v0.1.0
 *     (shipped in FORA-485).
 *
 * Why mock: the connector-config and connector-events services are
 * wired to orchestrator persistence but not yet exposed to the forge
 * console. The mock lets the UI ship in v1.0 GA; the swap is a
 * one-file change in the data source seam.
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

const NOW = "2026-06-20T17:21:00Z";
// Single source of truth for the seeded tenant id — matches the stub
// auth in `lib/auth.ts`. Keeps the mock data and the page query in
// lockstep so the list page never renders zero rows on a tenant miss.
const TENANT = process.env.FORA_SEED_TENANT_ID ?? "acme-corp";

function env(
  id: ConnectorId,
  fingerprintSuffix: string,
  lastRotatedAt: string,
  expiresAt: string,
): CredentialEnvelope {
  return {
    secretRef: `tenants/${TENANT}/secrets/${id}_cred@latest`,
    redacted: true,
    valueLen: 64,
    fingerprint: `sha256:${fingerprintSuffix}`,
    lastRotatedAt,
    expiresAt,
  };
}

/**
 * Mock per-tenant connector list. Reads as the live data source would
 * once the connector-config + connector-events services are wired to
 * the forge console. One row per Tier-1 connector; the persona gate
 * (PM) filters to a smaller subset.
 */
const MOCK: ReadonlyArray<McpConnector> = [
  {
    id: "jira",
    name: "jira",
    displayName: "Jira",
    tenantId: TENANT,
    status: "success",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:20:00Z",
      p50Ms: 120,
      p95Ms: 380,
      errorRate: 0.012,
      callCount24h: 4321,
    },
    scope: {
      grantedScopes: ["read:jira-work", "write:jira-work"],
      deniedScopes: ["admin:jira-project"],
      roleBinding: "developer",
    },
    credential: env("jira", "abcd1234ef56", "2026-06-01T00:00:00Z", "2026-09-20T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:20:00Z",
    lastAuditEntryId: "audit-7",
  },
  {
    id: "github",
    name: "github",
    displayName: "GitHub",
    tenantId: TENANT,
    status: "degraded",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:15:00Z",
      p50Ms: 220,
      p95Ms: 980,
      errorRate: 0.084,
      callCount24h: 2104,
    },
    scope: {
      grantedScopes: ["repo:read", "repo:write"],
      roleBinding: "developer",
    },
    credential: env("github", "9988aabbccdd", "2026-05-15T00:00:00Z", "2026-07-04T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:15:00Z",
    lastAuditEntryId: "audit-12",
  },
  {
    id: "gitlab",
    name: "gitlab",
    displayName: "GitLab",
    tenantId: TENANT,
    status: "success",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:18:00Z",
      p50Ms: 180,
      p95Ms: 510,
      errorRate: 0.022,
      callCount24h: 654,
    },
    scope: {
      grantedScopes: ["api:read", "api:write"],
      roleBinding: "developer",
    },
    credential: env("gitlab", "0011223344aa", "2026-04-30T00:00:00Z", "2026-10-30T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:18:00Z",
  },
  {
    id: "slack",
    name: "slack",
    displayName: "Slack",
    tenantId: TENANT,
    status: "success",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:20:30Z",
      p50Ms: 95,
      p95Ms: 240,
      errorRate: 0.005,
      callCount24h: 8210,
    },
    scope: {
      grantedScopes: ["chat:write", "channels:read"],
      roleBinding: "pm",
    },
    credential: env("slack", "5566778899bb", "2026-06-10T00:00:00Z", "2026-12-10T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:20:30Z",
  },
  {
    id: "teams",
    name: "teams",
    displayName: "Microsoft Teams",
    tenantId: TENANT,
    status: "success",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:10:00Z",
      p50Ms: 140,
      p95Ms: 360,
      errorRate: 0.018,
      callCount24h: 412,
    },
    scope: {
      grantedScopes: ["ChannelMessage.Send"],
      roleBinding: "pm",
    },
    credential: env("teams", "ccddeeff0011", "2026-05-22T00:00:00Z", "2026-11-22T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:10:00Z",
  },
  {
    id: "sonarqube",
    name: "sonarqube",
    displayName: "SonarQube",
    tenantId: TENANT,
    status: "error",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T16:45:00Z",
      p50Ms: 320,
      p95Ms: 1240,
      errorRate: 0.41,
      callCount24h: 88,
    },
    scope: {
      grantedScopes: ["scan:read"],
      roleBinding: "qa",
    },
    credential: env("sonarqube", "9988776655aa", "2026-03-12T00:00:00Z", "2026-06-12T00:00:00Z"),
    lastUsedAt: "2026-06-20T16:45:00Z",
  },
  {
    id: "figma",
    name: "figma",
    displayName: "Figma",
    tenantId: TENANT,
    status: "success",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:05:00Z",
      p50Ms: 110,
      p95Ms: 290,
      errorRate: 0.011,
      callCount24h: 256,
    },
    scope: {
      grantedScopes: ["files:read"],
      roleBinding: "designer",
    },
    credential: env("figma", "ffee00112233", "2026-04-15T00:00:00Z", "2026-10-15T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:05:00Z",
  },
  {
    id: "aws",
    name: "aws",
    displayName: "AWS",
    tenantId: TENANT,
    status: "success",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:19:00Z",
      p50Ms: 250,
      p95Ms: 720,
      errorRate: 0.006,
      callCount24h: 1834,
    },
    scope: {
      grantedScopes: ["ec2:Describe*", "s3:GetObject", "iam:GetRole"],
      deniedScopes: ["iam:DeleteUser", "ec2:TerminateInstances"],
      roleBinding: "devops",
    },
    credential: env("aws", "aabbccdd0011", "2026-05-01T00:00:00Z", "2026-08-01T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:19:00Z",
  },
  {
    id: "azdo",
    name: "azdo",
    displayName: "Azure DevOps",
    tenantId: TENANT,
    status: "degraded",
    tier: 2,
    health: {
      lastCallAt: "2026-06-20T16:55:00Z",
      p50Ms: 290,
      p95Ms: 880,
      errorRate: 0.061,
      callCount24h: 142,
    },
    scope: {
      grantedScopes: ["vso.code_read"],
      roleBinding: "developer",
    },
    credential: env("azdo", "1122334455cc", "2026-02-20T00:00:00Z", "2026-08-20T00:00:00Z"),
    lastUsedAt: "2026-06-20T16:55:00Z",
  },
  {
    id: "zendesk",
    name: "zendesk",
    displayName: "Zendesk",
    tenantId: TENANT,
    status: "success",
    tier: 2,
    health: {
      lastCallAt: "2026-06-20T17:12:00Z",
      p50Ms: 175,
      p95Ms: 440,
      errorRate: 0.014,
      callCount24h: 98,
    },
    scope: {
      grantedScopes: ["tickets:read"],
      roleBinding: "support",
    },
    credential: env("zendesk", "778899aabbcc", "2026-06-05T00:00:00Z", "2026-12-05T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:12:00Z",
  },
  {
    id: "databricks",
    name: "databricks",
    displayName: "Databricks",
    tenantId: TENANT,
    status: "success",
    tier: 2,
    health: {
      lastCallAt: "2026-06-20T17:18:00Z",
      p50Ms: 410,
      p95Ms: 1340,
      errorRate: 0.028,
      callCount24h: 76,
    },
    scope: {
      grantedScopes: ["sql:read"],
      roleBinding: "data-eng",
    },
    credential: env("databricks", "ddeeff001122", "2026-04-25T00:00:00Z", "2026-10-25T00:00:00Z"),
    lastUsedAt: "2026-06-20T17:18:00Z",
  },
];

/**
 * List connectors for a tenant. The forge console is single-tenant in
 * v1.0 GA; `tenantId` is a thin seam so a future multi-tenant client
 * can scope by tenant. Sorted with Tier-1 first, then by display name.
 */
export async function listConnectors(tenantId: string): Promise<ReadonlyArray<McpConnector>> {
  return MOCK
    .filter((c) => c.tenantId === tenantId)
    .slice()
    .sort((a, b) => a.tier - b.tier || a.displayName.localeCompare(b.displayName));
}

/**
 * One connector by id. Returns `null` for a miss — the caller (the
 * detail page in FORA-579) surfaces an "unknown connector" empty
 * state. Mirrors the resolver MISS contract from FORA-391 §4.
 */
export async function getConnector(
  tenantId: string,
  id: string,
): Promise<McpConnector | null> {
  return MOCK.find((c) => c.tenantId === tenantId && c.id === id) ?? null;
}

/** PM-tier subset of Tier-1 connectors (FORA-578 RBAC). */
export function pmPersonaSubset(rows: ReadonlyArray<McpConnector>): ReadonlyArray<McpConnector> {
  // PM doesn't see AWS / SonarQube by default — the persona is read-only
  // and doesn't operate infra. Other Tier-1 connectors are surfaced so
  // the PM can audit (Jira, GitHub, Slack, Teams, Figma).
  const pmAllowed: ReadonlyArray<ConnectorId> = [
    "jira",
    "github",
    "gitlab",
    "slack",
    "teams",
    "figma",
  ];
  return rows.filter((c) => pmAllowed.includes(c.id));
}

// Keep NOW referenced so the constant isn't stripped during a future
// refactor; it's the data source's "as-of" timestamp.
export const __MOCK_AS_OF__ = NOW;
