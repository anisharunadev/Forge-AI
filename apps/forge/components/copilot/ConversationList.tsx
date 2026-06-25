'use client';

/**
 * F-800 — Conversation list.
 *
 * Left rail of the Co-pilot panel. Renders the user's conversations
 * as a vertical list with title + message count + cost. Click sets
 * the active conversation. New-conversation button at the top.
 */

import * as React from 'react';
import { Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConversations } from '@/hooks/use-copilot';
import { useDeleteConversation } from '@/hooks/use-copilot-mutations';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

export interface ConversationListProps {
  /** Optional click handler override — defaults to setActiveConversation + clearDraft. */
  onSelect?: (conversationId: string) => void;
  className?: string;
}

/**
 * Renders a compact list of conversation summaries. The header
 * always exposes a "new conversation" button. Each row shows the
 * title (or a fallback), message count, total cost, and a delete
 * affordance on hover.
 */
export function ConversationList({
  onSelect,
  className,
}: ConversationListProps) {
  const conversations = useConversations();
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const clearDraft = useCopilotStore((s) => s.clearDraft);
  const remove = useDeleteConversation();

  const handleSelect = React.useCallback(
    (id: string) => {
      if (onSelect) {
        onSelect(id);
      } else {
        setActiveConversation(id);
        clearDraft();
      }
    },
    [onSelect, setActiveConversation, clearDraft],
  );

  const handleNew = React.useCallback(() => {
    setActiveConversation(null);
    clearDraft();
  }, [setActiveConversation, clearDraft]);

  const handleDelete = React.useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      remove.mutate(id);
    },
    [remove],
  );

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-1 border-b border-border bg-background/40',
        className,
      )}
      data-testid="copilot-conversation-list"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Conversations
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={handleNew}
          data-testid="copilot-conversation-list-new"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          New
        </Button>
      </div>

      {conversations.isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      ) : conversations.isError ? (
        <div className="px-3 py-2 text-xs text-destructive">
          Failed to load conversations.
        </div>
      ) : (conversations.data?.length ?? 0) === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No conversations yet.
        </div>
      ) : (
        <ul role="list" className="flex flex-col gap-0.5 px-1 pb-2">
          {(conversations.data ?? []).map((c) => {
            const isActive = c.id === activeConversationId;
            return (
              <li key={c.id} role="listitem">
                <button
                  type="button"
                  onClick={() => handleSelect(c.id)}
                  className={cn(
                    'group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/40',
                    isActive && 'bg-accent/60',
                  )}
                  data-testid="copilot-conversation-row"
                  data-conversation-id={c.id}
                  data-active={isActive ? 'true' : 'false'}
                >
                  <MessageSquare
                    className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {c.title ?? 'New conversation'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.message_count} msg · ${c.total_cost_usd.toFixed(4)}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => handleDelete(e, c.id)}
                    className="invisible flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:visible"
                    aria-label="Delete conversation"
                    data-testid="copilot-conversation-delete"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}