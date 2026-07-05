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

import { api, FORGE_API_BASE_URL, ForgeApiError } from '@/lib/api/client';
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
  return api.get<CopilotConversationSummary[]>('/copilot/conversations', {
    tenantId
});
}

/**
 * `GET /api/v1/copilot/conversations/{id}` — full conversation with messages.
 */
export async function getConversation(
  id: string,
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotConversationRead> {
  return api.get<CopilotConversationRead>(`/copilot/conversations/${encodeURIComponent(id)}`, { tenantId });
}

/**
 * `POST /api/v1/copilot/conversations` — create or continue. Returns
 * the assistant message + full metadata for the new turn.
 */
export async function sendMessage(
  req: CopilotChatRequest,
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotChatResponse> {
  return api.post<CopilotChatResponse>('/copilot/conversations', req, {
    tenantId,
  });
}

export type CopilotStreamEvent =
  | { event: 'start'; data: { conversation_id: string } }
  | { event: 'token'; data: string }
  | { event: 'reasoning'; data: string }
  | { event: 'tool_call'; data: { tool: string; args: Record<string, unknown> } }
  | { event: 'finish'; data: CopilotChatResponse }
  | { event: 'usage'; data: { prompt_tokens: number; completion_tokens: number; cost_usd: number } }
  | { event: 'error'; data: { code: string; message: string } };

export interface StreamMessageHandle {
  abort: () => void;
}

/**
 * `POST /api/v1/copilot/conversations:stream` — SSE consumer.
 *
 * Opens the streaming chat endpoint, parses the SSE wire format, and
 * invokes ``onEvent`` for each ``data:`` line. Returns a handle whose
 * ``abort()`` cancels the underlying fetch.
 */
export function streamMessage(
  req: CopilotChatRequest,
  onEvent: (event: CopilotStreamEvent) => void,
  tenantId: string = SEED_TENANT_ID,
): StreamMessageHandle {
  const controller = new AbortController();
  void (async () => {
    let res: Response;
    try {
      // Stream endpoint — bypass the JSON-buffering `api` client.
      // `api.ws` would attach the bearer token but the server expects
      // `?token=` AND body, which doesn't fit the WS contract.
      const streamHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'x-forge-tenant-id': tenantId ?? SEED_TENANT_ID,
      };
      res = await fetch(
        `${FORGE_API_BASE_URL}/copilot/conversations:stream`,
        {
          method: 'POST',
          headers: streamHeaders,
          body: JSON.stringify(req),
          signal: controller.signal,
        },
      );
    } catch (err) {
      onEvent({
        event: 'error',
        data: { code: 'network', message: String(err) },
      });
      return;
    }
    if (!res.body) {
      onEvent({
        event: 'error',
        data: { code: 'no_body', message: 'empty response' },
      });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = raw.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as CopilotStreamEvent);
          } catch (err) {
            console.error('copilot.stream.parse_error', err, line);
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        onEvent({
          event: 'error',
          data: { code: 'network', message: String(err) },
        });
      }
    }
  })();
  return { abort: () => controller.abort() };
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
  await api.delete<void>(`/copilot/conversations/${encodeURIComponent(id)}`, { tenantId });
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
  await api.post<void>(`/copilot/messages/${encodeURIComponent(messageId)}/feedback`, { body: JSON.stringify(body), tenantId });
}

/**
 * `GET /api/v1/copilot/conversations/{id}/cost` — running cost + budget.
 */
export async function getCost(
  conversationId: string,
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotCostRead> {
  return api.get<CopilotCostRead>(`/copilot/conversations/${encodeURIComponent(conversationId)}/cost`, { tenantId });
}

/**
 * `GET /api/v1/copilot/tools` — Steward-only list of registered tools.
 */
export async function listTools(
  tenantId: string = SEED_TENANT_ID,
): Promise<CopilotToolRead[]> {
  return api.get<CopilotToolRead[]>('/copilot/tools', { tenantId });
}