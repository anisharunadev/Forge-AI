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
