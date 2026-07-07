import * as React from 'react';
/**
 * F-800 — Co-pilot mutation hooks (TanStack Query).
 *
 * Plan 3 — write-side layer. Three mutations:
 *   - `useSendMessage` — POST /copilot/conversations; invalidates
 *     the conversations list, the active conversation, and the cost
 *     query on success.
 *   - `useSubmitFeedback` — POST /copilot/messages/{id}/feedback;
 *     invalidates the active conversation so the assistant message's
 *     `feedback_rating` updates optimistically.
 *   - `useDeleteConversation` — DELETE /copilot/conversations/{id};
 *     invalidates the list and clears the active id locally.
 *
 * Errors are surfaced via `error` on the mutation result; we don't
 * toast here — let the component decide whether to surface them
 * (most do, via the `PermissionDeniedBanner` or the composer).
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  deleteConversation,
  sendMessage,
  streamMessage,
  submitFeedback,
  type CopilotChatRequest,
  type CopilotChatResponse,
  type CopilotFeedbackRating,
  type CopilotStreamEvent,
  type StreamMessageHandle,
} from '@/lib/api/copilot';
import { useTenantId } from '@/hooks/use-tenant-id';
import { useCopilotStore } from '@/lib/store/copilot';

/**
 * Send a message (or start a new conversation). On success, the
 * returned `CopilotChatResponse` carries `conversation_id` and
 * `message_id`; we invalidate the conversations list, the active
 * conversation, and the cost query so the UI re-fetches.
 */
export function useSendMessage(): UseMutationResult<
  CopilotChatResponse,
  Error,
  CopilotChatRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CopilotChatRequest) => sendMessage(req),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['copilot', 'conversations'] });
      queryClient.invalidateQueries({
        queryKey: ['copilot', 'conversation', response.conversation_id],
      });
      queryClient.invalidateQueries({
        queryKey: ['copilot', 'cost', response.conversation_id],
      });
    },
  });
}


/**
 * F-800 Phase 1 — streaming variant of `useSendMessage`.
 *
 * POSTs `/copilot/conversations:stream` via the SSE consumer in
 * `lib/api/copilot.ts#streamMessage`. The caller owns the AbortController
 * (typically via `useRef`) so the Stop button can cancel mid-flight;
 * we expose `handle.stop()` and the live `abortController` ref so the
 * component can wire both buttons without re-rendering.
 *
 * SSE events are folded into the Zustand store — `start` allocates a
 * streaming bubble id, `token` appends to the assistant draft,
 * `finish` finalises the bubble and invalidates the conversations
 * query so the side panels refresh, `error` surfaces a typed failure
 * so the composer can dispatch the same toasts the JSON path emits.
 *
 * Returns a stable `stop()` function that aborts the underlying fetch;
 * the React tree re-renders when `setStreaming(false)` lands.
 */
export interface UseSendMessageStreamResult {
  /** Imperatively start a streaming turn. Returns a stop handle. */
  send: (req: CopilotChatRequest) => StreamMessageHandle;
  /** True while the SSE connection is open. */
  streaming: boolean;
  /** Latest streamed error message (null when healthy). */
  lastError: string | null;
  /** Cancel the in-flight stream (no-op when idle). */
  stop: () => void;
}

export function useSendMessageStream(): UseSendMessageStreamResult {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const setStreaming = useCopilotStore((s) => s.setStreaming);
  const setError = useCopilotStore((s) => s.setError);
  const setPermissionDenied = useCopilotStore((s) => s.setPermissionDenied);
  const setStreamingMessage = useCopilotStore((s) => s.setStreamingMessage);
  const appendStreamToken = useCopilotStore((s) => s.appendStreamToken);
  const appendStreamReasoning = useCopilotStore((s) => s.appendStreamReasoning);
  const pushStreamToolCall = useCopilotStore((s) => s.pushStreamToolCall);
  const streaming = useCopilotStore((s) => s.streaming);

  // Latest handle so the Stop button can abort even when the component
  // re-renders mid-stream. Stored in a ref so changing it doesn't
  // trigger a re-render.
  const handleRef = React.useRef<StreamMessageHandle | null>(null);

  const send = React.useCallback(
    (req: CopilotChatRequest) => {
      // Defensive: cancel any previous handle that's still alive.
      handleRef.current?.abort();

      setError(null);
      setPermissionDenied(false);
      setStreaming(true);

      const handle = streamMessage(
        req,
        (event: CopilotStreamEvent) => {
          if (event.event === 'start') {
            setStreamingMessage({
              id: `stream-${Date.now()}`,
              conversationId: event.data.conversation_id,
              content: '',
              reasoning: '',
              toolCalls: [],
            });
            return;
          }
          if (event.event === 'token') {
            appendStreamToken(event.data);
            return;
          }
          if (event.event === 'reasoning') {
            appendStreamReasoning(event.data);
            return;
          }
          if (event.event === 'tool_call') {
            pushStreamToolCall(event.data);
            return;
          }
          if (event.event === 'error') {
            const code = event.data?.code ?? 'unknown';
            const message = event.data?.message ?? 'stream failed';
            if (code === 'http_403') setPermissionDenied(true);
            else setError(`${code}: ${message}`);
            setStreamingMessage(null);
            setStreaming(false);
            return;
          }
          if (event.event === 'finish') {
            const finish = event.data;
            setActiveConversation(finish.conversation_id);
            setStreamingMessage(null);
            setStreaming(false);
            queryClient.invalidateQueries({
              queryKey: ['copilot', 'conversations'],
            });
            queryClient.invalidateQueries({
              queryKey: ['copilot', 'conversation', finish.conversation_id],
            });
            queryClient.invalidateQueries({
              queryKey: ['copilot', 'cost', finish.conversation_id],
            });
          }
          // `usage` is intentionally unconsumed here — cost lands via
          // the invalidated `copilot.cost` query once the conversation
          // settles (single source of truth on the cost badge).
        },
        tenantId,
      );
      handleRef.current = handle;
      return handle;
    },
    [
      queryClient,
      setActiveConversation,
      setError,
      setPermissionDenied,
      setStreaming,
      setStreamingMessage,
      appendStreamToken,
      appendStreamReasoning,
      pushStreamToolCall,
      tenantId,
    ],
  );

  const stop = React.useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
    setStreaming(false);
  }, [setStreaming]);

  // Cleanup on unmount so a closed composer doesn't leave a fetch
  // running in the background.
  React.useEffect(() => {
    return () => {
      handleRef.current?.abort();
      handleRef.current = null;
    };
  }, []);

  const lastError = useCopilotStore((s) => s.lastError);
  return { send, streaming, lastError, stop };
}


export interface SubmitFeedbackArgs {
  messageId: string;
  rating: CopilotFeedbackRating;
  comment?: string;
  /** Conversation id — used to narrow the invalidation. */
  conversationId?: string | null;
}

/**
 * Submit thumbs up/down with optional comment. Invalidates the
 * conversation so the message's `feedback_rating` field refreshes.
 */
export function useSubmitFeedback(): UseMutationResult<
  void,
  Error,
  SubmitFeedbackArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, rating, comment }: SubmitFeedbackArgs) =>
      submitFeedback(messageId, rating, comment),
    onSuccess: (_, { conversationId }) => {
      if (conversationId) {
        queryClient.invalidateQueries({
          queryKey: ['copilot', 'conversation', conversationId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['copilot'] });
    },
  });
}

/**
 * Hard-delete a conversation. Invalidates the list and clears the
 * active conversation locally if it was the one we just deleted.
 */
export function useDeleteConversation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_void, id) => {
      queryClient.invalidateQueries({ queryKey: ['copilot', 'conversations'] });
      queryClient.invalidateQueries({
        queryKey: ['copilot', 'conversation', id],
      });
      setActiveConversation(null);
    },
  });
}