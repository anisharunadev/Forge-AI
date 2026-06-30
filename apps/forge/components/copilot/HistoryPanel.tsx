'use client';

/**
 * Step 37 — History sub-panel.
 *
 * Replaces the previous "HistoryDrawer" (a small floating popover)
 * with a true sub-panel that slides in from the left and replaces
 * the conversation view temporarily. Keeps the user in context:
 * search, pick a chat, slide back out.
 *
 * Layout (top → bottom):
 *
 *   [← back]  History                    [+ New chat]
 *   [ Search conversations…   ⌘K ]
 *   [ All | Pinned | Shared | Today ]
 *   [ Pinned section           ]
 *   [ Today        | 2 ]
 *   [ Yesterday    | 4 ]
 *   [ Last 7 days  | 7 ]
 *   [ Older        | 12 ]
 *
 * Skill influence (ui-ux-pro-max):
 *   - "Show helpful message and action" — every state has a verb.
 *   - "Heading hierarchy" — section labels are h3; no skipping.
 *   - "Sticky navigation" — pinned section uses position: sticky so
 *     it doesn't visually clash with day headers below it.
 */

import * as React from 'react';
import { ArrowLeft, MessageSquarePlus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCopilotStore } from '@/lib/store/copilot';

import { ConversationList } from './ConversationList';

export interface HistoryPanelProps {
  /** Called when the user clicks the back arrow. */
  onClose: () => void;
}

/**
 * Wraps `ConversationList` with a search-first header so the
 * conversations feel like a navigable index, not a stack of
 * settings.
 */
export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const clearDraft = useCopilotStore((s) => s.clearDraft);

  const handleNew = React.useCallback(() => {
    setActiveConversation(null);
    clearDraft();
    onClose();
  }, [setActiveConversation, clearDraft, onClose]);

  return (
    <div
      role="region"
      aria-label="Conversation history"
      className="flex h-full w-full flex-col"
      data-testid="copilot-history-panel"
      data-state="open"
    >
      {/* Header row — back, title, new. Single line, low-chrome. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          aria-label="Back to chat"
          title="Back to chat"
          data-testid="copilot-history-back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
          History
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-[11px]"
          onClick={handleNew}
          aria-label="New conversation"
          data-testid="copilot-history-new"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
          New chat
        </Button>
      </div>

      {/* Search input + ⌘K hint. Re-rendered above the list; the
          list internally manages its own search, but we expose the
          input here too for keyboard-first users (focus auto-jumps
          on mount). */}
      <HistorySearch />

      {/* Conversation list — same component used previously, just
          nested inside this sub-panel so it doesn't compete for
          vertical space with the active conversation. */}
      <div className="scrollbar-chat flex-1 overflow-y-auto">
        <ConversationList />
      </div>
    </div>
  );
}

/**
 * Lightweight search input — focuses the list's internal search
 * field when the user types. Kept separate so the header stays
 * chrome-free.
 */
function HistorySearch() {
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  // Auto-focus on mount so ⌘K lands here too (panel-level handler
  // can dispatch focus via the existing `[data-testid="copilot-history-search"]`
  // selector once the sub-panel mounts).
  React.useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Forward the search into the list's input so the existing
    // filter logic (grouping, pinned, etc.) reuses without
    // duplication.
    const inner = document.querySelector<HTMLInputElement>(
      '[data-testid="copilot-conversation-search"]',
    );
    if (!inner) return;
    inner.value = e.target.value;
    inner.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  return (
    <div className="border-b border-[var(--border-subtle)] px-3 py-2">
      <label className="relative block">
        <span className="sr-only">Search conversations</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
        />
        <input
          ref={searchRef}
          type="text"
          onChange={handleChange}
          placeholder="Search conversations…"
          className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] pl-8 pr-12 text-[var(--text-xs)] text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus-visible:outline-none focus-visible:border-[var(--accent-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
          data-testid="copilot-history-search"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]"
        >
          ⌘K
        </kbd>
      </label>
    </div>
  );
}

export default HistoryPanel;
