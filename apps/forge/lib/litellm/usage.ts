/**
 * F-829 Phase C — Analytics + Compliance data layer.
 *
 * Mirrors `lib/analytics/data.ts` pattern: thin `forgeFetch` wrappers
 * over the orchestrator's `/api/v1/analytics/usage*` and
 * `/api/v1/governance/violations*` endpoints.
 */

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function safeJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface ModelUsageBucket {
  model: string;
  cost_usd: number;
  calls: number;
}

export interface UserUsageRow {
  actor_id: string;
  cost_usd: number;
  calls: number;
}

export interface TenantUsagePayload {
  total_cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
  by_model: ReadonlyArray<ModelUsageBucket>;
  by_user: ReadonlyArray<UserUsageRow>;
  since: string | null;
  until: string | null;
  cached: boolean;
  cache_ttl_seconds: number;
}

export interface WorkflowUsagePayload {
  workflow_id: string;
  cost_usd: number;
  calls: number;
}

export interface ComplianceViolation {
  id: string;
  tenant_id: string;
  project_id: string;
  guardrail_id: string;
  severity: string;
  action_taken: string;
  sanitized_content: string;
  resolved: boolean;
  occurred_at: string;
}

export interface ViolationsPayload {
  items: ReadonlyArray<ComplianceViolation>;
  count: number;
}

/** GET /api/v1/analytics/usage?tenant_id=...&since=...&until=... */
export async function getTenantUsage(
  tenantId: string,
  params: { since?: string; until?: string } = {},
): Promise<TenantUsagePayload | null> {
  const url = new URL(`${SERVER_BASE}/api/v1/analytics/usage`);
  url.searchParams.set('tenant_id', tenantId);
  if (params.since) url.searchParams.set('since', params.since);
  if (params.until) url.searchParams.set('until', params.until);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  return safeJson<TenantUsagePayload>(res);
}

/** GET /api/v1/analytics/usage/workflow/{run_id}?tenant_id=... */
export async function getWorkflowUsage(
  tenantId: string,
  workflowId: string,
): Promise<WorkflowUsagePayload | null> {
  const url = new URL(
    `${SERVER_BASE}/api/v1/analytics/usage/workflow/${encodeURIComponent(workflowId)}`,
  );
  url.searchParams.set('tenant_id', tenantId);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  return safeJson<WorkflowUsagePayload>(res);
}

/** GET /api/v1/governance/violations?tenant_id=...&severity=...&resolved=... */
export async function listViolations(
  tenantId: string,
  params: { severity?: string; resolved?: boolean; limit?: number } = {},
): Promise<ViolationsPayload | null> {
  const url = new URL(`${SERVER_BASE}/api/v1/governance/violations`);
  url.searchParams.set('tenant_id', tenantId);
  if (params.severity) url.searchParams.set('severity', params.severity);
  if (params.resolved !== undefined)
    url.searchParams.set('resolved', String(params.resolved));
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  return safeJson<ViolationsPayload>(res);
}

/** POST /api/v1/governance/violations/{id}/resolve?tenant_id=... */
export async function resolveViolation(
  tenantId: string,
  violationId: string,
): Promise<{ ok: boolean }> {
  const url = new URL(
    `${SERVER_BASE}/api/v1/governance/violations/${encodeURIComponent(violationId)}/resolve`,
  );
  url.searchParams.set('tenant_id', tenantId);
  const res = await fetch(url.toString(), { method: 'POST' });
  return { ok: res.ok };
}

/** POST /api/v1/governance/violations/{id}/reopen?tenant_id=... */
export async function reopenViolation(
  tenantId: string,
  violationId: string,
): Promise<{ ok: boolean }> {
  const url = new URL(
    `${SERVER_BASE}/api/v1/governance/violations/${encodeURIComponent(violationId)}/reopen`,
  );
  url.searchParams.set('tenant_id', tenantId);
  const res = await fetch(url.toString(), { method: 'POST' });
  return { ok: res.ok };
}

/** POST /api/v1/governance/violations/poll — manual trigger. */
export async function triggerViolationPoll(): Promise<{
  ingested: number;
  skipped_duplicates: number;
} | null> {
  const res = await fetch(
    `${SERVER_BASE}/api/v1/governance/violations/poll`,
    { method: 'POST' },
  );
  return safeJson<{ ingested: number; skipped_duplicates: number }>(res);
}
