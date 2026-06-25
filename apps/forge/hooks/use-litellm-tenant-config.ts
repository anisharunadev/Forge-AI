'use client';

/**
 * use-litellm-tenant-config — query-key factory + convenience hook
 * for per-tenant LiteLLM config.
 *
 * The query key is exposed so the MCP server browser, the keys
 * page, and the per-tenant config page all share one cache entry
 * for a given tenant — invalidating any one invalidates the others.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getTenantLLMConfig,
  type TenantLLMConfig,
} from '@/lib/litellm/data';

export const tenantConfigQueryKey = (tenantId: string) =>
  ['litellm', 'tenantConfig', tenantId] as const;

export function useTenantConfig(
  tenantId: string,
): UseQueryResult<TenantLLMConfig, Error> {
  return useQuery<TenantLLMConfig, Error>({
    queryKey: tenantConfigQueryKey(tenantId),
    queryFn: () => getTenantLLMConfig(tenantId),
    enabled: Boolean(tenantId),
  });
}
