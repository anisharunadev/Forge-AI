'use client';

/**
 * TanStack Query hooks for the `/admin/llm-gateway/*` surfaces
 * (F-829 Phase B).
 *
 * Pure wrappers around the typed SDK in `lib/litellm/data.ts`. The
 * query-key factory (`litellmQueryKeys`) is the stable identifier
 * used by the global `LLMUnavailableBanner` (in
 * `components/system/LLMUnavailableBanner.tsx`) and the per-page
 * invalidations.
 *
 * Pattern mirrors `lib/hooks/useSettings.ts` (canonical example in
 * this codebase).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { forgeFetch } from '@/lib/forge-api';

import {
  disableGuardrail,
  enableGuardrail,
  getAdminLLMHealth,
  getLiteLLMHealth,
  getTenantLLMConfig,
  listGuardrails,
  listMCPServers,
  listModels,
  listSpendModels,
  listSpendTeams,
  listTenantKeys,
  revokeTenantKey,
  rotateTenantKey,
  type AdminLLMHealth,
  type GuardrailEntry,
  type LiteLLMHealthSnapshot,
  type MCPServerEntry,
  type ModelInfoEntry,
  type RevokeKeyInput,
  type RotateKeyInput,
  type SpendModelRow,
  type SpendTeamRow,
  type TenantLLMConfig,
  type VirtualKeyMetadata,
} from '@/lib/litellm/data';

// ---------------------------------------------------------------------------
// Governance Center v2 — typed shapes returned by the LiteLLM-backed
// governance endpoints. These mirror the Pydantic models in
// backend/app/api/v1/{policies,standards,audit,admin_llm_gateway}.py
// (Zone 4 / 5 / 7 / 10).
// ---------------------------------------------------------------------------

/** LiteLLM guardrail — exposed as a Forge "policy". */
export interface LiteLLMGuardrail {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  readonly applies_to: ReadonlyArray<string>;
  readonly description?: string | null;
}

/** LiteLLM spend entry per team (Zone 10 admin endpoint). */
export interface SpendByTeam {
  readonly team_id: string;
  readonly team_alias: string;
  readonly spend: number;
  readonly max_budget: number;
}

/** LiteLLM spend entry per model (Zone 10 admin endpoint). */
export interface SpendByModel {
  readonly model: string;
  readonly spend: number;
  readonly requests: number;
}

/** LiteLLM spend log entry — daily bucket shape. */
export interface SpendByDayBucket {
  readonly date: string;
  readonly spend: number;
  readonly requests: number;
  readonly tokens: number;
}

/** LiteLLM model catalog entry (Zone 10 admin endpoint). */
export interface LlmModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly max_tokens: number | null;
  readonly max_input_tokens: number | null;
  readonly input_cost: number;
  readonly output_cost: number;
  readonly enabled: boolean;
}

/** Forge standards — combined LiteLLM guardrails + manual attestations. */
export interface StandardRead {
  readonly id: string;
  readonly name: string;
  readonly category: 'llm_safety' | 'regulatory' | 'internal';
  readonly source: 'litellm_guardrail' | 'manual_attestation' | 'external';
  readonly status: 'active' | 'pending' | 'deprecated';
  readonly description?: string | null;
  readonly attested_at?: string | null;
  readonly config?: Readonly<Record<string, unknown>> | null;
}

/** LiteLLM request log entry — proxied via /audit/llm-traffic. */
export interface LlmTrafficEntry {
  readonly request_id: string;
  readonly timestamp?: string;
  readonly model?: string;
  readonly spend?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly key_alias?: string;
  readonly user?: string;
  readonly status?: string | number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Forge audit event (user actions in the UI). */
export interface AuditEventEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly actor_id: string;
  readonly actor_name?: string | null;
  readonly action: string;
  readonly target_type?: string | null;
  readonly target_id?: string | null;
  readonly tenant_id: string;
  readonly project_id?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/** Stable query keys so the cache survives HMR / route changes. */
export const litellmQueryKeys = {
  health: () => ['litellm', 'health'] as const,
  adminHealth: () => ['litellm', 'adminHealth'] as const,
  mcpServers: () => ['litellm', 'mcpServers'] as const,
  tenantConfig: (tenantId: string) =>
    ['litellm', 'tenantConfig', tenantId] as const,
  tenantKeys: (tenantId: string) =>
    ['litellm', 'tenantKeys', tenantId] as const,
};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Lightweight health probe used by `LLMUnavailableBanner`. 30s refetch
 * so the banner auto-clears within one cycle of LiteLLM recovery
 * (per the Phase B exit criteria).
 */
export function useLiteLLMHealth(): UseQueryResult<
  LiteLLMHealthSnapshot,
  Error
> {
  return useQuery<LiteLLMHealthSnapshot, Error>({
    queryKey: litellmQueryKeys.health(),
    queryFn: () => getLiteLLMHealth(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useAdminLLMHealth(): UseQueryResult<AdminLLMHealth, Error> {
  return useQuery<AdminLLMHealth, Error>({
    queryKey: litellmQueryKeys.adminHealth(),
    queryFn: () => getAdminLLMHealth(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// MCP server browser
// ---------------------------------------------------------------------------

export function useMCPServers(): UseQueryResult<
  ReadonlyArray<MCPServerEntry>,
  Error
> {
  return useQuery<ReadonlyArray<MCPServerEntry>, Error>({
    queryKey: litellmQueryKeys.mcpServers(),
    queryFn: () => listMCPServers(),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Per-tenant LLM config
// ---------------------------------------------------------------------------

export function useTenantLLMConfig(
  tenantId: string,
): UseQueryResult<TenantLLMConfig, Error> {
  return useQuery<TenantLLMConfig, Error>({
    queryKey: litellmQueryKeys.tenantConfig(tenantId),
    queryFn: () => getTenantLLMConfig(tenantId),
    enabled: Boolean(tenantId),
  });
}

// ---------------------------------------------------------------------------
// Virtual Keys
// ---------------------------------------------------------------------------

export function useTenantKeys(
  tenantId: string,
): UseQueryResult<ReadonlyArray<VirtualKeyMetadata>, Error> {
  return useQuery<ReadonlyArray<VirtualKeyMetadata>, Error>({
    queryKey: litellmQueryKeys.tenantKeys(tenantId),
    queryFn: () => listTenantKeys(tenantId),
    enabled: Boolean(tenantId),
  });
}

export function useRotateTenantKey(): UseMutationResult<
  VirtualKeyMetadata,
  Error,
  { tenantId: string; body?: RotateKeyInput }
> {
  const qc = useQueryClient();
  return useMutation<
    VirtualKeyMetadata,
    Error,
    { tenantId: string; body?: RotateKeyInput }
  >({
    mutationFn: ({ tenantId, body }) => rotateTenantKey(tenantId, body),
    onSuccess: (_data, { tenantId }) => {
      void qc.invalidateQueries({
        queryKey: litellmQueryKeys.tenantKeys(tenantId),
      });
      void qc.invalidateQueries({
        queryKey: litellmQueryKeys.tenantConfig(tenantId),
      });
    },
  });
}

export function useRevokeTenantKey(): UseMutationResult<
  VirtualKeyMetadata,
  Error,
  { tenantId: string; keyId: string; body: RevokeKeyInput }
> {
  const qc = useQueryClient();
  return useMutation<
    VirtualKeyMetadata,
    Error,
    { tenantId: string; keyId: string; body: RevokeKeyInput }
  >({
    mutationFn: ({ tenantId, keyId, body }) =>
      revokeTenantKey(tenantId, keyId, body),
    onSuccess: (_data, { tenantId }) => {
      void qc.invalidateQueries({
        queryKey: litellmQueryKeys.tenantKeys(tenantId),
      });
      void qc.invalidateQueries({
        queryKey: litellmQueryKeys.tenantConfig(tenantId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Governance Center v2 hooks (Zone 9 — rewire from fixtures to real data).
//
// All endpoints are proxied through the Forge backend which fans out
// to the LiteLLM admin API. The UI never talks to LiteLLM directly
// (Rule 1 — Provider Abstraction Layer).
// ---------------------------------------------------------------------------

export const governanceQueryKeys = {
  spendByDay: (days: number) =>
    ['governance', 'spend-by-day', days] as const,
  spendByTeam: () => ['governance', 'spend-by-team'] as const,
  guardrails: () => ['governance', 'guardrails'] as const,
  models: () => ['governance', 'models'] as const,
  standards: () => ['governance', 'standards'] as const,
  auditEvents: (days: number, limit: number) =>
    ['governance', 'audit-events', days, limit] as const,
  llmTraffic: (days: number, limit: number) =>
    ['governance', 'llm-traffic', days, limit] as const,
};

/**
 * Daily spend aggregation — sourced from LiteLLM /spend/logs via
 * the admin gateway. Used by the Overview tab "LLM Spend Today"
 * KPI tile and the daily-trend chart.
 */
export function useSpendByDay(
  days: number = 30,
): UseQueryResult<ReadonlyArray<SpendByDayBucket>, Error> {
  return useQuery<ReadonlyArray<SpendByDayBucket>, Error>({
    queryKey: governanceQueryKeys.spendByDay(days),
    queryFn: () =>
      forgeFetch<ReadonlyArray<SpendByDayBucket>>(
        `/admin/llm-gateway/spend/by-day?days=${days}`,
      ),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Per-team spend — combined with `useSpendByDay` to render the
 * Overview tab's LLM usage breakdown (replaces the static
 * `KPIS.llmUsageByModel` fixture).
 */
export function useSpendByTeam(): UseQueryResult<
  ReadonlyArray<SpendByTeam>,
  Error
> {
  return useQuery<ReadonlyArray<SpendByTeam>, Error>({
    queryKey: governanceQueryKeys.spendByTeam(),
    queryFn: () =>
      forgeFetch<ReadonlyArray<SpendByTeam>>(
        '/admin/llm-gateway/spend/teams',
      ),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * LiteLLM guardrails — proxied via GET /policies. Powers the
 * Policies and Guardrails tabs. LiteLLM is the source of truth for
 * guardrail config (Zone 4 of step-59).
 */
export function useGuardrails(): UseQueryResult<
  ReadonlyArray<LiteLLMGuardrail>,
  Error
> {
  return useQuery<ReadonlyArray<LiteLLMGuardrail>, Error>({
    queryKey: governanceQueryKeys.guardrails(),
    queryFn: () => forgeFetch<ReadonlyArray<LiteLLMGuardrail>>('/policies'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * LiteLLM model catalog — proxied via /admin/llm-gateway/models.
 * Replaces the static `MODELS` fixture on the LLM Control tab.
 */
export function useModels(): UseQueryResult<
  ReadonlyArray<LlmModelInfo>,
  Error
> {
  return useQuery<ReadonlyArray<LlmModelInfo>, Error>({
    queryKey: governanceQueryKeys.models(),
    queryFn: () =>
      forgeFetch<ReadonlyArray<LlmModelInfo>>('/admin/llm-gateway/models'),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
}

/**
 * Combined standards — LiteLLM guardrails + manual attestations.
 * Backend route: GET /standards (Zone 5).
 */
export function useStandards(): UseQueryResult<
  ReadonlyArray<StandardRead>,
  Error
> {
  return useQuery<ReadonlyArray<StandardRead>, Error>({
    queryKey: governanceQueryKeys.standards(),
    queryFn: () => forgeFetch<ReadonlyArray<StandardRead>>('/standards'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Forge audit log — user actions (who-clicked-what). Backend
 * route: GET /audit (the Forge-side audit, distinct from LiteLLM
 * request logs).
 */
export function useAuditEvents(
  days: number = 7,
  limit: number = 100,
): UseQueryResult<ReadonlyArray<AuditEventEntry>, Error> {
  return useQuery<ReadonlyArray<AuditEventEntry>, Error>({
    queryKey: governanceQueryKeys.auditEvents(days, limit),
    queryFn: () =>
      forgeFetch<ReadonlyArray<AuditEventEntry>>(
        `/audit?days=${days}&limit=${limit}`,
      ),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * LLM traffic audit — every LiteLLM request log entry. Backend
 * route: GET /audit/llm-traffic (Zone 7). Distinct from the Forge
 * audit log: this is the canonical record of every model invocation.
 */
export function useLLMTraffic(
  days: number = 7,
  limit: number = 100,
): UseQueryResult<ReadonlyArray<LlmTrafficEntry>, Error> {
  return useQuery<ReadonlyArray<LlmTrafficEntry>, Error>({
    queryKey: governanceQueryKeys.llmTraffic(days, limit),
    queryFn: () =>
      forgeFetch<ReadonlyArray<LlmTrafficEntry>>(
        `/audit/llm-traffic?days=${days}&limit=${limit}`,
      ),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Guardrail toggle mutations (Step-59 Zone 10 + 11)
// ---------------------------------------------------------------------------

/**
 * Enable a LiteLLM guardrail by name. Invalidates `governanceQueryKeys.guardrails()`
 * and `governanceQueryKeys.standards()` on success so the UI re-renders
 * with the updated enabled state without an extra round-trip.
 */
export function useEnableGuardrail(): UseMutationResult<
  GuardrailEntry,
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation<GuardrailEntry, Error, string>({
    mutationFn: (name: string) => enableGuardrail(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.guardrails() });
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.standards() });
    },
  });
}

/**
 * Disable a LiteLLM guardrail by name. Same invalidation contract
 * as `useEnableGuardrail` — keep the guardrail list + standards list
 * in sync after the toggle.
 */
export function useDisableGuardrail(): UseMutationResult<
  GuardrailEntry,
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation<GuardrailEntry, Error, string>({
    mutationFn: (name: string) => disableGuardrail(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.guardrails() });
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.standards() });
    },
  });
}

// ---------------------------------------------------------------------------
// Typed-SDK queries (Step-59 Zone 10 + 11)
//
// These queries route through the typed SDK in `lib/litellm/data.ts`
// instead of bare `forgeFetch`. Prefer these over the raw `forgeFetch`
// variants above for new call sites — they get end-to-end type
// coverage from the Pydantic models.
// ---------------------------------------------------------------------------

/**
 * Per-team spend rows. Typed version of the same data the governance
 * Overview tab consumes via `useSpendByDay`.
 */
export function useSpendByTeamTyped(
  days: number = 30,
): UseQueryResult<ReadonlyArray<SpendTeamRow>, Error> {
  return useQuery<ReadonlyArray<SpendTeamRow>, Error>({
    queryKey: governanceQueryKeys.spendByTeam(),
    queryFn: () => listSpendTeams({ days }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Per-model spend rows. Typed version of the same data the governance
 * LLM Control tab consumes.
 */
export function useSpendByModelTyped(
  days: number = 30,
): UseQueryResult<ReadonlyArray<SpendModelRow>, Error> {
  return useQuery<ReadonlyArray<SpendModelRow>, Error>({
    queryKey: ['governance', 'spend-by-model', days] as const,
    queryFn: () => listSpendModels({ days }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Typed guardrail list — uses the SDK instead of bare fetch. Kept
 * alongside `useGuardrails` (which returns the legacy
 * `LiteLLMGuardrail` shape used by governance-v2) so callers can
 * adopt the SDK shape incrementally.
 */
export function useGuardrailsTyped(): UseQueryResult<
  ReadonlyArray<GuardrailEntry>,
  Error
> {
  return useQuery<ReadonlyArray<GuardrailEntry>, Error>({
    queryKey: governanceQueryKeys.guardrails(),
    queryFn: () => listGuardrails(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Typed model catalog — uses the SDK instead of bare fetch.
 */
export function useModelsTyped(): UseQueryResult<
  ReadonlyArray<ModelInfoEntry>,
  Error
> {
  return useQuery<ReadonlyArray<ModelInfoEntry>, Error>({
    queryKey: governanceQueryKeys.models(),
    queryFn: () => listModels(),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
}
