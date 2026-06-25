'use client';

/**
 * F-800 — Co-pilot right-side sheet panel.
 *
 * Mounted once at the ShellProvider boundary. Visibility is driven
 * by `useCopilotStore.open`. Renders header + conversation list +
 * messages (or empty state) + composer + modal outlets for the
 * draft + command confirm flows.
 *
 * Plan 3 wires the full vertical:
 *   - `ConversationList` (top)
 *   - `MessageList` (middle) when a conversation is active
 *   - `EmptyState` when no conversation is active
 *   - `ComposerInput` (bottom)
 *   - `PermissionDeniedBanner` mounted at root for 403s
 *   - `DraftReviewModal` + `CommandConfirmModal` mounted once,
 *     opened by `SuggestedActions` handlers.
 *
 * Focus trap and ESC-to-close are handled by Radix (via Sheet).
 */

import * as React from 'react';

import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { useConversation } from '@/hooks/use-copilot';
import { useCopilotEnabled } from '@/lib/feature-flags';
import { useCopilotStore } from '@/lib/store/copilot';
import type { CopilotSuggestedAction } from '@/lib/api/copilot';

import { CommandConfirmModal } from './CommandConfirmModal';
import { ComposerInput } from './ComposerInput';
import { ConversationList } from './ConversationList';
import { CopilotHeader } from './CopilotHeader';
import { DraftReviewModal } from './DraftReviewModal';
import { EmptyState } from './EmptyState';
import { MessageList } from './MessageList';
import { PermissionDeniedBanner } from './PermissionDeniedBanner';

export function CopilotPanel() {
  // Plan 6 — master toggle. When ``COPILOT_ENABLED`` is off
  // (server-side flag flip or the user is in a tenant that has
  // disabled Co-pilot), we render nothing so the panel cannot
  // appear even if the store says ``open === true``. The Cmd+J
  // hotkey is also gated (see ShellProvider) so this is a
  // defense-in-depth check.
  const copilotEnabled = useCopilotEnabled();
  const open = useCopilotStore((s) => s.open);
  const setOpen = useCopilotStore((s) => s.setOpen);
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const lastError = useCopilotStore((s) => s.lastError);

  const conversation = useConversation(activeConversationId);

  if (!copilotEnabled) return null;

  // Modal state — owned by the panel so the modals persist across
  // message list re-renders and suggested-action re-dispatches.
  const [draftAction, setDraftAction] =
    React.useState<CopilotSuggestedAction | null>(null);
  const [commandAction, setCommandAction] =
    React.useState<CopilotSuggestedAction | null>(null);
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);

  const handleRunCommand = React.useCallback((action: CopilotSuggestedAction) => {
    setCommandAction(action);
    setCommandOpen(true);
  }, []);

  const handleDraft = React.useCallback((action: CopilotSuggestedAction) => {
    setDraftAction(action);
    setDraftOpen(true);
  }, []);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[420px]"
          data-testid="copilot-panel"
        >
          {/* SheetTitle is required by Radix for a11y; visually hidden. */}
          <SheetTitle className="sr-only">Forge Co-pilot</SheetTitle>

          <CopilotHeader />

          <PermissionDeniedBanner
            className={lastError && lastError.includes('403') ? '' : 'hidden'}
            message={
              lastError && lastError.includes('403')
                ? lastError
                : undefined
            }
          />

          <div className="flex flex-1 flex-col overflow-hidden">
            <ConversationList />

            <div className="flex flex-1 flex-col overflow-hidden">
              {activeConversationId ? (
                conversation.isLoading ? (
                  <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                    Loading conversation…
                  </div>
                ) : conversation.isError ? (
                  <div
                    role="alert"
                    className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    Failed to load conversation.
                  </div>
                ) : (
                  <MessageList
                    messages={conversation.data?.messages ?? []}
                  />
                )
              ) : (
                <EmptyState />
              )}
              <ComposerInput />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Modal outlets — mounted once so they survive message list re-renders. */}
      <DraftReviewModal
        open={draftOpen}
        onOpenChange={setDraftOpen}
        action={draftAction}
      />
      <CommandConfirmModal
        open={commandOpen}
        onOpenChange={setCommandOpen}
        action={commandAction}
      />

      {/* The SuggestedActions handler needs to reach into the panel's
          state, so we expose handlers via a tiny custom event so the
          component (which lives inside MessageBubble) doesn't need
          direct prop wiring. */}
      <CopilotActionBridge
        onRunCommand={handleRunCommand}
        onDraft={handleDraft}
      />
    </>
  );
}

/**
 * Tiny bridge that listens for `copilot:open_draft` /
 * `copilot:run_command` window events and forwards them to the
 * parent panel's handlers. Lets `SuggestedActions` (rendered deep
 * in MessageBubble) open modals owned by the panel without prop
 * drilling.
 *
 * Hidden — has no DOM output.
 */
interface CopilotActionBridgeProps {
  onRunCommand: (action: CopilotSuggestedAction) => void;
  onDraft: (action: CopilotSuggestedAction) => void;
}

function CopilotActionBridge({ onRunCommand, onDraft }: CopilotActionBridgeProps) {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    function handleDraft(e: Event) {
      const detail = (e as CustomEvent<CopilotSuggestedAction>).detail;
      if (detail) onDraft(detail);
    }
    function handleCommand(e: Event) {
      const detail = (e as CustomEvent<CopilotSuggestedAction>).detail;
      if (detail) onRunCommand(detail);
    }
    window.addEventListener('copilot:open_draft', handleDraft);
    window.addEventListener('copilot:run_command', handleCommand);
    return () => {
      window.removeEventListener('copilot:open_draft', handleDraft);
      window.removeEventListener('copilot:run_command', handleCommand);
    };
  }, [onRunCommand, onDraft]);

  return null;
}