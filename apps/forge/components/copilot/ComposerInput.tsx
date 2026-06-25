'use client';

/**
 * Co-pilot composer input.
 *
 * Bottom-pinned textarea + send button. Enter sends, Shift+Enter
 * inserts a newline. The textarea auto-grows up to 6 rows.
 *
 * Plan 2: send is a console.log TODO — Plan 3 wires up the API.
 */

import * as React from 'react';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCopilotStore } from '@/lib/store/copilot';

const MAX_ROWS = 6;

export function ComposerInput() {
  const draft = useCopilotStore((s) => s.draft);
  const setDraft = useCopilotStore((s) => s.setDraft);
  const clearDraft = useCopilotStore((s) => s.clearDraft);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow up to MAX_ROWS.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20; // px — matches text-sm ~ leading-5
    const maxHeight = lineHeight * MAX_ROWS;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft]);

  const handleSend = React.useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    // TODO(F-800 Plan 3): send message via co-pilot API + stream response.
    console.log('TODO(F-800 Plan 3): send message', { message: trimmed });
    clearDraft();
  }, [draft, clearDraft]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = draft.trim().length > 0;

  return (
    <div className="border-t p-3">
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
          data-testid="copilot-composer"
        />
        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          data-testid="copilot-send"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
