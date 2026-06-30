/**
 * LiteLLM Gateway — typed async SDK for the `/admin/llm-gateway/*`
 * admin surfaces (F-829 Phase B).
 *
 * Wraps `forgeFetch` (lib/forge-api.ts) with resource shapes for
 * per-tenant LLM config, Virtual Key management, the MCP server
 * browser, and the LiteLLM health probe.
 *
 * Pure functions — no React, no caching. The TanStack Query hooks in
 * `lib/hooks/useLiteLLM.ts` wrap these.
 *
 * Security: the Virtual Key VALUE never crosses the API boundary.
 * The list endpoint returns metadata only (alias, fingerprint, last
 * used) — and this file never adds a "value" field to the response
 * shape, so even a misbehaving server cannot leak a key into the
 * client. Mutations (rotate, revoke) intentionally discard the
 * returned value server-side as well.
 */

import { forgeFetch } from '@/lib/forge-api';

// ---------------------------------------------------------------------------
// Health (GET /health/litellm)
// ---------------------------------------------------------------------------

export interface LiteLLMHealthSnapshot {
  readonly healthy: boolean;
  readonly last_check_at: string | null;
  readonly consecutive_failures: number;
  readonly source: 'monitor' | 'direct';
}

export async function getLiteLLMHealth(): Promise<LiteLLMHealthSnapshot> {
  return forgeFetch<LiteLLMHealthSnapshot>('/health/litellm');
}

// ---------------------------------------------------------------------------
// Per-tenant LLM config
// ---------------------------------------------------------------------------

export interface TenantLLMConfig {
  readonly tenant_id: string;
  readonly project_id: string;
  readonly litellm_team_id: string | null;
  readonly litellm_team_status: string | null;
  readonly has_virtual_key: boolean;
  readonly last_key_rotated_at: string | null;
  readonly budget_max_usd: number | null;
  readonly budget_period: string | null;
  readonly budget_spend_usd: number | null;
  readonly guardrail_ids: ReadonlyArray<string>;
  readonly model_alias: string | null;
}

export async function getTenantLLMConfig(
  tenantId: string,
): Promise<TenantLLMConfig> {
  return forgeFetch<TenantLLMConfig>(
    `/admin/llm-gateway/tenants/${encodeURIComponent(tenantId)}`,
  );
}

// ---------------------------------------------------------------------------
// Virtual Keys (metadata only — never the value)
// ---------------------------------------------------------------------------

export type VirtualKeyStatus = 'active' | 'rotated' | 'revoked';

export interface VirtualKeyMetadata {
  readonly id: string;
  readonly tenant_id: string;
  readonly alias: string;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly status: VirtualKeyStatus;
  readonly fingerprint: string;
}

export async function listTenantKeys(
  tenantId: string,
): Promise<ReadonlyArray<VirtualKeyMetadata>> {
  return forgeFetch<ReadonlyArray<VirtualKeyMetadata>>(
    `/admin/llm-gateway/tenants/${encodeURIComponent(tenantId)}/keys`,
  );
}

export interface RotateKeyInput {
  readonly actor_id?: string | null;
  readonly reason?: string | null;
}

export async function rotateTenantKey(
  tenantId: string,
  body: RotateKeyInput = {},
): Promise<VirtualKeyMetadata> {
  return forgeFetch<VirtualKeyMetadata>(
    `/admin/llm-gateway/tenants/${encodeURIComponent(tenantId)}/keys/rotate`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

export interface RevokeKeyInput {
  readonly actor_id?: string | null;
  readonly reason: string;
}

export async function revokeTenantKey(
  tenantId: string,
  keyId: string,
  body: RevokeKeyInput,
): Promise<VirtualKeyMetadata> {
  return forgeFetch<VirtualKeyMetadata>(
    `/admin/llm-gateway/tenants/${encodeURIComponent(tenantId)}/keys/${encodeURIComponent(keyId)}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// MCP servers (read-only browser)
// ---------------------------------------------------------------------------

export interface MCPServerEntry {
  readonly id: string;
  readonly name: string;
  readonly transport: string;
  readonly command: string;
  readonly url: string;
  readonly scopes: ReadonlyArray<string>;
  readonly status: string;
}

export async function listMCPServers(): Promise<ReadonlyArray<MCPServerEntry>> {
  return forgeFetch<ReadonlyArray<MCPServerEntry>>(
    '/admin/llm-gateway/mcp-servers',
  );
}

// ---------------------------------------------------------------------------
// Admin (LLM-gateway scoped) health
// ---------------------------------------------------------------------------

export interface AdminLLMHealth {
  readonly healthy: boolean;
  readonly last_check_at: string | null;
  readonly last_ok_at: string | null;
  readonly last_fail_at: string | null;
  readonly consecutive_failures: number;
  readonly last_error: string | null;
}

export async function getAdminLLMHealth(): Promise<AdminLLMHealth> {
  return forgeFetch<AdminLLMHealth>('/admin/llm-gateway/health');
}

// ---------------------------------------------------------------------------
// Spend aggregation — Team-level (Step-59 Zone 10 + 11)
// ---------------------------------------------------------------------------

/**
 * Per-team spend aggregation from `/admin/llm-gateway/spend/teams`.
 * Mirrors the backend `SpendByTeam` pydantic model.
 */
export interface SpendTeamRow {
  readonly team_id: string | null;
  readonly team_alias: string | null;
  readonly spend: number;
  readonly max_budget: number;
}

/** GET /admin/llm-gateway/spend/teams?days={days} */
export async function listSpendTeams(params: {
  readonly days?: number;
} = {}): Promise<ReadonlyArray<SpendTeamRow>> {
  const search = new URLSearchParams();
  if (params.days !== undefined) {
    search.set('days', String(params.days));
  }
  const qs = search.toString();
  return forgeFetch<ReadonlyArray<SpendTeamRow>>(
    `/admin/llm-gateway/spend/teams${qs ? `?${qs}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Spend aggregation — Model-level (Step-59 Zone 10 + 11)
// ---------------------------------------------------------------------------

/**
 * Per-model spend row from LiteLLM `/spend/models`. The backend
 * passes the upstream shape through unmodified, so we model the
 * fields used by the Analytics Center (model name, total spend,
 * prompt/completion token counts, invocation count).
 */
export interface SpendModelRow {
  readonly model?: string;
  readonly model_name?: string;
  readonly model_group?: string;
  readonly spend?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly requests?: number;
  readonly invocations?: number;
  readonly [k: string]: unknown;
}

/** GET /admin/llm-gateway/spend/models?days={days} */
export async function listSpendModels(params: {
  readonly days?: number;
} = {}): Promise<ReadonlyArray<SpendModelRow>> {
  const search = new URLSearchParams();
  if (params.days !== undefined) {
    search.set('days', String(params.days));
  }
  const qs = search.toString();
  return forgeFetch<ReadonlyArray<SpendModelRow>>(
    `/admin/llm-gateway/spend/models${qs ? `?${qs}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Spend logs (Step-59 Zone 11)
// ---------------------------------------------------------------------------

/**
 * One row from `/costs` — LiteLLM-derived spend log entries. The
 * Analytics Center groups these client-side (by `metadata.agent_id`,
 * `model`, etc.) for charts that the pre-baked aggregations don't
 * cover.
 */
export interface SpendLogEntry {
  readonly request_id?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly model?: string;
  readonly spend?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly user?: string;
  readonly key_alias?: string;
  readonly team_id?: string;
  readonly status?: string | number | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly [k: string]: unknown;
}

/**
 * GET /costs?days={days}&limit={limit}
 *
 * Returns the LiteLLM spend logs (filtered to the caller's tenant
 * server-side). The forgeFetch path lives at the versioned root, so
 * the resolved URL is `/api/v1/costs`.
 */
export async function listSpendLogs(params: {
  readonly days?: number;
  readonly limit?: number;
} = {}): Promise<ReadonlyArray<SpendLogEntry>> {
  const search = new URLSearchParams();
  if (params.days !== undefined) {
    search.set('days', String(params.days));
  }
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  const qs = search.toString();
  return forgeFetch<ReadonlyArray<SpendLogEntry>>(`/costs${qs ? `?${qs}` : ''}`);
}

// ---------------------------------------------------------------------------
// Guardrails (Step-59 Zone 10)
// ---------------------------------------------------------------------------

/**
 * LiteLLM guardrail definition. The proxy returns the upstream shape
 * with `guardrail_name`, `type`, `litellm_params`, and `enabled`
 * fields. We surface only what the UI consumes today and keep the
 * bag open for forward compatibility.
 */
export interface GuardrailEntry {
  readonly guardrail_name?: string;
  readonly name?: string;
  readonly type?: string;
  readonly enabled?: boolean;
  readonly litellm_params?: Readonly<Record<string, unknown>>;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly applies_to?: ReadonlyArray<string>;
  readonly [k: string]: unknown;
}

/** GET /admin/llm-gateway/guardrails */
export async function listGuardrails(): Promise<ReadonlyArray<GuardrailEntry>> {
  return forgeFetch<ReadonlyArray<GuardrailEntry>>(
    '/admin/llm-gateway/guardrails',
  );
}

/** POST /admin/llm-gateway/guardrails/{name}/enable */
export async function enableGuardrail(
  name: string,
): Promise<GuardrailEntry> {
  return forgeFetch<GuardrailEntry>(
    `/admin/llm-gateway/guardrails/${encodeURIComponent(name)}/enable`,
    { method: 'POST' },
  );
}

/** POST /admin/llm-gateway/guardrails/{name}/disable */
export async function disableGuardrail(
  name: string,
): Promise<GuardrailEntry> {
  return forgeFetch<GuardrailEntry>(
    `/admin/llm-gateway/guardrails/${encodeURIComponent(name)}/disable`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Model catalog (Step-59 Zone 10)
// ---------------------------------------------------------------------------

/**
 * LiteLLM model catalog entry — exposed by the proxy with per-million
 * pricing (the backend converts from per-token on the way out).
 */
export interface ModelInfoEntry {
  readonly name: string;
  readonly provider: string;
  readonly max_tokens: number | null;
  readonly max_input_tokens: number | null;
  readonly input_cost: number;
  readonly output_cost: number;
}

/** GET /admin/llm-gateway/models */
export async function listModels(): Promise<ReadonlyArray<ModelInfoEntry>> {
  return forgeFetch<ReadonlyArray<ModelInfoEntry>>('/admin/llm-gateway/models');
}
