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
  submitFeedback,
  type CopilotChatRequest,
  type CopilotChatResponse,
  type CopilotFeedbackRating,
} from '@/lib/api/copilot';
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