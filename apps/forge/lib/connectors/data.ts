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

import { DEV_TENANT_UUID } from '../../config/dev-seeds';

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

// ---------------------------------------------------------------------------
// Connector lifecycle — install / rotate / test / sync
// (Forge AI-440 / Pillar 1 Phase 4 — FORA-580/591)
//
// These call the orchestrator's connector endpoints. The orchestrator
// resolves the connector id to a real MCP server entry from the
// registry (`lib/mcp-registry.ts`) and dispatches the action against
// the running MCP server process (or a deterministic mock in the dev
// stub). All calls carry an `Idempotency-Key` per the `request<T>()`
// contract in `lib/api.ts`.
// ---------------------------------------------------------------------------

const LIFECYCLE_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function postJson<T>(
  path: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    'x-fora-tenant-id': DEV_TENANT_UUID,
  };
  const res = await fetch(`${LIFECYCLE_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `orchestrator returned ${res.status}`;
    try {
      const errBody = (await res.json()) as { message?: unknown };
      if (errBody && typeof errBody.message === 'string') msg = errBody.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** Input payload for `installConnector`. The orchestrator maps `type`
 * to a registry entry and binds the resulting MCP server to the
 * tenant+project with the supplied `config`. */
export interface InstallConnectorInput {
  readonly type: string;
  readonly name: string;
  readonly project_id: string;
  readonly config: Record<string, unknown>;
}

/** Result of a successful install — the new connector id plus the
 * registry entry that was bound. */
export interface InstallConnectorResult {
  readonly ok: true;
  readonly connector_id: string;
  readonly server_name: string;
  readonly display_name: string;
  readonly transport: string;
  readonly tools: ReadonlyArray<string>;
}

/**
 * POST /v1/connectors/install — register a new connector instance
 * against a real MCP server. The orchestrator resolves `type` against
 * the MCP registry and spawns (or maps to an existing) MCP server
 * process scoped to the tenant+project.
 */
export async function installConnector(
  input: InstallConnectorInput,
): Promise<InstallConnectorResult> {
  return postJson<InstallConnectorResult>(
    '/v1/connectors/install',
    input,
    crypto.randomUUID(),
  );
}

/** Result of a credential rotation. */
export interface RotateConnectorResult {
  readonly ok: true;
  readonly connector_id: string;
  readonly rotated_at: string;
  readonly fingerprint: string;
}

/**
 * POST /v1/connectors/{id}/rotate — replace the active credential for
 * a connector. The old value is invalidated immediately and a fresh
 * fingerprint is returned. Body: `{ new_credentials: { value } }`.
 */
export async function rotateConnector(
  connectorId: string,
  input: { new_credentials: Record<string, unknown> },
): Promise<RotateConnectorResult> {
  return postJson<RotateConnectorResult>(
    `/v1/connectors/${encodeURIComponent(connectorId)}/rotate`,
    input,
    crypto.randomUUID(),
  );
}

/** Result of a live reachability probe. */
export interface TestConnectorResult {
  readonly ok: true;
  readonly latency_ms: number;
  readonly detail: string | null;
}

/**
 * POST /v1/connectors/{id}/test — run a live reachability probe
 * against the connector's MCP server. Returns the orchestrator's
 * `ok` + `latency_ms` so the UI can show a receipt.
 */
export async function testConnector(
  connectorId: string,
): Promise<TestConnectorResult> {
  return postJson<TestConnectorResult>(
    `/v1/connectors/${encodeURIComponent(connectorId)}/test`,
    {},
    crypto.randomUUID(),
  );
}

/** Result of a `syncFromJira` pull — issue key + target discriminator
 * so the caller can refetch the matching Project Intelligence row.
 *
 * `external_key` is the alias the UI renders in the success pill
 * (matches the `data-issue-key` attribute the component writes);
 * `issue_key` is the orchestrator's wire key (used for refetch).
 */
export interface JiraSyncResult {
  readonly ok: true;
  readonly issue_key: string;
  readonly external_key: string;
  readonly target: 'epic' | 'story' | 'prd';
  readonly synced_at: string;
  readonly fields: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

/**
 * POST /v1/connectors/jira/sync — pull a Jira issue (epic, story, or
 * PRD) into the matching Project Intelligence row. Body:
 * `{ issue_key, target, idea_id? }`.
 */
export async function syncFromJira(
  target: 'epic' | 'story' | 'prd',
  vars: { issue_key: string; idea_id?: string },
): Promise<JiraSyncResult> {
  return postJson<JiraSyncResult>(
    '/v1/connectors/jira/sync',
    { target, issue_key: vars.issue_key, idea_id: vars.idea_id ?? null },
    crypto.randomUUID(),
  ).then((result) => ({ ...result, external_key: result.issue_key }));
}