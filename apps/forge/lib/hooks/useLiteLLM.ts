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

import {
  getAdminLLMHealth,
  getLiteLLMHealth,
  getTenantLLMConfig,
  listMCPServers,
  listTenantKeys,
  revokeTenantKey,
  rotateTenantKey,
  type AdminLLMHealth,
  type LiteLLMHealthSnapshot,
  type MCPServerEntry,
  type RevokeKeyInput,
  type RotateKeyInput,
  type TenantLLMConfig,
  type VirtualKeyMetadata,
} from '@/lib/litellm/data';

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
