/**
 * F-800 — Co-pilot read hooks (TanStack Query).
 *
 * Plan 3 — server-state layer for the conversation list, the active
 * conversation (with messages), the cost ledger, and the tool catalog.
 *
 * Conventions:
 *   - `enabled: false` while the relevant id is null (so we don't
 *     fire requests before the user has picked a conversation)
 *   - `staleTime` defaults match the global QueryClient (30s)
 *   - `useCost` polls every 5s while the panel is open so the cost
 *     badge can update as tool calls land (Plan 5 spec)
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getConversation,
  getCost,
  listConversations,
  listTools,
  type CopilotConversationRead,
  type CopilotConversationSummary,
  type CopilotCostRead,
  type CopilotToolRead,
} from '@/lib/api/copilot';

/**
 * `useConversations()` — list of summaries for the active user.
 * Used by `ConversationList` to render the left rail.
 */
export function useConversations(): UseQueryResult<CopilotConversationSummary[]> {
  return useQuery({
    queryKey: ['copilot', 'conversations'],
    queryFn: () => listConversations(),
  });
}

/**
 * `useConversation(id)` — full conversation + messages. Disabled
 * until `id` is a non-null string so we don't accidentally fire on
 * the empty state.
 */
export function useConversation(
  id: string | null,
): UseQueryResult<CopilotConversationRead> {
  return useQuery({
    queryKey: ['copilot', 'conversation', id],
    queryFn: () => getConversation(id!),
    enabled: !!id,
  });
}

/**
 * `useTools()` — Steward-only tool catalog. Falls behind permission
 * check upstream; the API will 403 for non-Stewards.
 */
export function useTools(): UseQueryResult<CopilotToolRead[]> {
  return useQuery({
    queryKey: ['copilot', 'tools'],
    queryFn: () => listTools(),
  });
}

/**
 * `useCost(conversationId)` — running cost + budget state.
 * Polls every 5s while the panel is open so the `CostBadge` can
 * update after each turn. Disabled when `conversationId` is null.
 */
export function useCost(
  conversationId: string | null,
): UseQueryResult<CopilotCostRead> {
  return useQuery({
    queryKey: ['copilot', 'cost', conversationId],
    queryFn: () => getCost(conversationId!),
    enabled: !!conversationId,
    refetchInterval: 5_000,
  });
}