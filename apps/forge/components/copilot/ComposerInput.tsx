'use client';

/**
 * F-800 — Co-pilot composer input.
 *
 * Bottom-pinned textarea + send button. Enter sends, Shift+Enter
 * inserts a newline. The textarea auto-grows up to 6 rows. Send
 * dispatches `useSendMessage` and on success:
 *   - sets the active conversation id from the response
 *   - clears the draft
 *   - invalidates the conversations list + cost query
 *
 * Footer row carries `ContextChip` + `CostBadge` (Plan 5 spec).
 */

import * as React from 'react';
import { Loader2, Send } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useSendMessage } from '@/hooks/use-copilot-mutations';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

import { ContextChip } from './ContextChip';
import { CostBadge } from './CostBadge';

const MAX_ROWS = 6;

export function ComposerInput() {
  const draft = useCopilotStore((s) => s.draft);
  const setDraft = useCopilotStore((s) => s.setDraft);
  const clearDraft = useCopilotStore((s) => s.clearDraft);
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const setError = useCopilotStore((s) => s.setError);

  const sendMessage = useSendMessage();
  const pathname = usePathname() ?? '/';
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow up to MAX_ROWS.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * MAX_ROWS;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft]);

  const handleSend = React.useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || sendMessage.isPending) return;
    setError(null);

    sendMessage.mutate(
      {
        conversation_id: activeConversationId,
        project_id: null,
        message: trimmed,
        context: {
          current_page: pathname,
          current_center: null,
          current_artifact_id: null,
          recent_actions: [],
        },
      },
      {
        onSuccess: (response) => {
          setActiveConversation(response.conversation_id);
          clearDraft();
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Send failed');
        },
      },
    );
  }, [
    draft,
    sendMessage,
    activeConversationId,
    pathname,
    setError,
    setActiveConversation,
    clearDraft,
  ]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = draft.trim().length > 0 && !sendMessage.isPending;

  return (
    <div className="border-t p-3">
      <div className={cn('mb-2 flex items-center justify-between gap-2')}>
        <ContextChip className="flex-1" />
        <CostBadge conversationId={activeConversationId} />
      </div>

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the Co-pilot anything…"
          rows={1}
          className="flex min-h-[36px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Co-pilot message"
          data-testid="copilot-composer-input"
        />
        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          data-testid="copilot-send-button"
        >
          {sendMessage.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
