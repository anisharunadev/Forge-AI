'use client';

/**
 * Co-pilot panel header.
 *
 * Title + close button + "New conversation" reset action.
 * New conversation is currently a no-op that clears the active
 * conversation id (the list itself lands in Plan 3).
 */

import * as React from 'react';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCopilotStore } from '@/lib/store/copilot';

export function CopilotHeader() {
  const setOpen = useCopilotStore((s) => s.setOpen);
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const clearDraft = useCopilotStore((s) => s.clearDraft);

  const handleNew = React.useCallback(() => {
    setActiveConversation(null);
    clearDraft();
  }, [setActiveConversation, clearDraft]);

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden>✨</span>
        <span>Forge Co-pilot</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleNew}
          aria-label="New conversation"
          data-testid="copilot-new-conversation"
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">New conversation</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          aria-label="Close Co-pilot"
          data-testid="copilot-close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
