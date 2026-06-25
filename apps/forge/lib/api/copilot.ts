/**
 * F-800 — Co-pilot REST API client + TypeScript mirror of the locked
 * Pydantic schemas in `backend/app/schemas/copilot.py`.
 *
 * Plan 3 — frontend thin slice. Mirrors 7 endpoints:
 *   POST   /api/v1/copilot/conversations
 *   GET    /api/v1/copilot/conversations
 *   GET    /api/v1/copilot/conversations/{id}
 *   DELETE /api/v1/copilot/conversations/{id}
 *   POST   /api/v1/copilot/messages/{id}/feedback
 *   GET    /api/v1/copilot/conversations/{id}/cost
 *   GET    /api/v1/copilot/tools
 *
 * The Pydantic source-of-truth is in `backend/app/schemas/copilot.py`.
 * If you change one side, change the other.
 */

import { forgeFetch, ForgeApiError } from '@/lib/forge-api';
import { SEED_TENANT_ID } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Types — mirror CopilotCitation / ToolCall / SuggestedAction / etc.
// ---------------------------------------------------------------------------

export type CopilotCitationType =
  | 'service'
  | 'adr'
  | 'standard'
  | 'template'
  | 'doc'
  | 'kg_node'
  | 'command';

export interface CopilotCitation {
  type: CopilotCitationType;
  id: string;
  label: string;
  snippet: string;
  url: string;
}

export interface CopilotToolCall {
  tool: string;
  args: Record<string, unknown>;
  result_status: 'success' | 'error';
  duration_ms: number;
  error: string | null;
}

export type CopilotActionType = 'navigate' | 'run_command' | 'draft' | 'open_modal';

export interface CopilotSuggestedAction {
  label: string;
  action_type: CopilotActionType;
  payload: Record<string, unknown>;
}

export type CopilotRole = 'user' | 'assistant' | 'system' | 'tool';
export type CopilotConfidence = 'high' | 'medium' | 'low';
export type CopilotFeedbackRating = 'up' | 'down';

export interface CopilotMessageRead {
  id: string;
  conversation_id: string;
  role: CopilotRole;
  content: string;
  citations: CopilotCitation[];
  tool_calls: CopilotToolCall[];
  suggested_actions: CopilotSuggestedAction[];
  confidence: CopilotConfidence | null;
  feedback_rating: CopilotFeedbackRating | null;
  model: string | null;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  created_at: string;
}

export interface CopilotConversationSummary {
  id: string;
  user_id: string;
  title: string | null;
  message_count: number;
  total_cost_usd: number;
  archived_at: string | null;
}

export interface CopilotConversationRead extends CopilotConversationSummary {
  total_tokens_in: number;
  total_tokens_out: number;
  messages: CopilotMessageRead[];
}

export interface CopilotPageContext {
  current_page: string;
  current_center: string | null;
  current_artifact_id: string | null;
  recent_actions: string[];
}

export interface CopilotChatRequest {
  conversation_id: string | null;
  project_id: string | null;
  message: string;
  context: CopilotPageContext;
}

export interface CopilotChatResponse {
  conversation_id: string;
  message_id: string;
  content: string;
  citations: CopilotCitation[];
  confidence: CopilotConfidence;
  tool_calls: CopilotToolCall[];
  suggested_actions: CopilotSuggestedAction[];
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  model: string;
  latency_ms: number;
}

export interface CopilotCostRead {
  conversation_id: string;
  total_cost_usd: number;
  total_tokens_in: number;
  total_tokens_out: number;
  budget_remaining_usd: number | null;
  budget_ceiling_usd: number | null;
  budget_status: 'active' | 'exhausted' | 'closed' | null;
}

export interface CopilotToolRead {
  name: string;
  description: string;
  permission: string;
  rate_limit_per_min: number;
}

export interface CopilotFeedbackRequest {
  rating: CopilotFeedbackRating;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Fetcher helpers
// ---------------------------------------------------------------------------

/**
 * Throws `ForgeApiError` on non-2xx. Includes status + parsed body.
 * Re-exported here so tests can `import { ForgeApiError } from '@/lib/api/copilot'`.
 */
export { ForgeApiError };

/**
 * `GET /api/v1/copilot/conversations` — list summaries for the current user.
 */
export async function listConversations(
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotConversationSummary[]> {
  return forgeFetch<CopilotConversationSummary[]>('/copilot/conversations', {
    tenantId,
  });
}

/**
 * `GET /api/v1/copilot/conversations/{id}` — full conversation with messages.
 */
export async function getConversation(
  id: string,
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotConversationRead> {
  return forgeFetch<CopilotConversationRead>(
    `/copilot/conversations/${encodeURIComponent(id)}`,
    { tenantId },
  );
}

/**
 * `POST /api/v1/copilot/conversations` — create or continue. Returns
 * the assistant message + full metadata for the new turn.
 */
export async function sendMessage(
  req: CopilotChatRequest,
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotChatResponse> {
  return forgeFetch<CopilotChatResponse>('/copilot/conversations', {
    method: 'POST',
    body: JSON.stringify(req),
    tenantId,
  });
}

/**
 * `DELETE /api/v1/copilot/conversations/{id}` — hard delete (the
 * backend may also support soft-archive via `archived_at`; the V1
 * spec says hard delete is enough).
 */
export async function deleteConversation(
  id: string,
  tenantId: string = SEED_TENANT_ID,
): Promise<void> {
  await forgeFetch<void>(
    `/copilot/conversations/${encodeURIComponent(id)}`,
    { method: 'DELETE', tenantId },
  );
}

/**
 * `POST /api/v1/copilot/messages/{id}/feedback` — thumbs up/down
 * with optional comment. Returns void on 204.
 */
export async function submitFeedback(
  messageId: string,
  rating: CopilotFeedbackRating,
  comment?: string,
  tenantId: string = SEED_TENANT_ID,
): Promise<void> {
  const body: CopilotFeedbackRequest = comment
    ? { rating, comment }
    : { rating };
  await forgeFetch<void>(
    `/copilot/messages/${encodeURIComponent(messageId)}/feedback`,
    { method: 'POST', body: JSON.stringify(body), tenantId },
  );
}

/**
 * `GET /api/v1/copilot/conversations/{id}/cost` — running cost + budget.
 */
export async function getCost(
  conversationId: string,
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotCostRead> {
  return forgeFetch<CopilotCostRead>(
    `/copilot/conversations/${encodeURIComponent(conversationId)}/cost`,
    { tenantId },
  );
}

/**
 * `GET /api/v1/copilot/tools` — Steward-only list of registered tools.
 */
export async function listTools(
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotToolRead[]> {
  return forgeFetch<CopilotToolRead[]>('/copilot/tools', { tenantId });
}