'use client';

/**
 * use-litellm-guardrails — query-key factory for the guardrail
 * catalog + per-tenant assignments.
 *
 * Phase B exposes the catalog via `useMCPServers` shape; the
 * catalog endpoint is `GET /admin/llm-gateway/guardrails` (added
 * in a follow-up). For now this hook returns the assignment list
 * (per-tenant guardrail ids) so pages can call a single seam.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listTenantKeys, type VirtualKeyMetadata } from '@/lib/litellm/data';

export const guardrailCatalogKey = () =>
  ['litellm', 'guardrails', 'catalog'] as const;

export const guardrailAssignmentsKey = (tenantId: string) =>
  ['litellm', 'guardrails', 'assignments', tenantId] as const;

/**
 * Convenience hook used by the Steward "assign guardrails" dialog
 * to fetch the tenant's existing assignments.
 *
 * Implementation note: the assignments are returned as part of the
 * tenant LLM config (see `lib/litellm/data.ts:getTenantLLMConfig`)
 * so this hook re-uses the keys query as a proxy. When the dedicated
 * `/guardrails` endpoints land, replace the body with a direct call.
 */
export function useGuardrailAssignments(
  tenantId: string,
): UseQueryResult<ReadonlyArray<VirtualKeyMetadata>, Error> {
  return useQuery<ReadonlyArray<VirtualKeyMetadata>, Error>({
    queryKey: guardrailAssignmentsKey(tenantId),
    queryFn: () => listTenantKeys(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });
}
