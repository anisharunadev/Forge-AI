'use client';

/**
 * Co-pilot right-side sheet panel.
 *
 * Mounted once at the ShellProvider boundary. Visibility is driven
 * by `useCopilotStore.open`. Renders header + empty-state (when no
 * active conversation) + composer.
 *
 * Focus trap and ESC-to-close are handled by Radix (via Sheet).
 */

import * as React from 'react';

import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { useCopilotStore } from '@/lib/store/copilot';

import { CopilotHeader } from './CopilotHeader';
import { ComposerInput } from './ComposerInput';
import { EmptyState } from './EmptyState';

export function CopilotPanel() {
  const open = useCopilotStore((s) => s.open);
  const setOpen = useCopilotStore((s) => s.setOpen);
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[420px]"
        data-testid="copilot-panel"
      >
        {/* SheetTitle is required by Radix for a11y; visually hidden. */}
        <SheetTitle className="sr-only">Forge Co-pilot</SheetTitle>

        <CopilotHeader />

        <div className="flex flex-1 flex-col overflow-hidden">
          {activeConversationId ? (
            <div className="flex-1 overflow-y-auto p-4 text-sm text-muted-foreground">
              {/* Conversation view lands in Plan 3. */}
              Conversation view coming soon.
            </div>
          ) : (
            <EmptyState />
          )}
          <ComposerInput />
        </div>
      </SheetContent>
    </Sheet>
  );
}
