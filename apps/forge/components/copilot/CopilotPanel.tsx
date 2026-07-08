'use client';

/**
 * Step 37 — Co-pilot panel polish.
 *
 * Two render modes:
 *   - `"panel"` (default) — renders inside a custom sheet
 *     (`CoPanelSheet`) that slides in from the right edge of the
 *     viewport. Backdrop is hidden on desktop (≥1024px) and shown
 *     on mobile so the panel gets full focus on small screens.
 *   - `"fullscreen"` — renders as a page-level layout (no sheet).
 *     Used by `/copilot`.
 *
 * Open state is sourced from `useCopilotStore.open` so the FAB, the
 * ⌘J hotkey, and the `/copilot` page all stay in sync.
 *
 * Vertical composition (panel mode):
 *
 *   [CopilotHeader]               — minimal: title + More + Close
 *   [ErrorBanner]   (when 403/err) — compact dismissible
 *   [PermissionDeniedBanner] (when 403)
 *   ┌──────────────────────────────┐
 *   │  Chat view:                  │
 *   │    EmptyState | MessageList  │
 *   │    ComposerInput             │
 *   │                              │
 *   │  History view (sub-panel):   │
 *   │    HistoryPanel              │
 *   └──────────────────────────────┘
 *
 * Two CopilotPanels can be alive at once — one mounted globally by
 * `ShellProvider` (mode="panel") and one mounted by the `/copilot`
 * page (mode="fullscreen"). When the user is on `/copilot`, the
 * global panel returns null so the page-level fullscreen instance
 * owns the UI.
 */

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConversation, useConversations } from '@/hooks/use-copilot';
import { useCopilotEnabled } from '@/lib/feature-flags';
import {
  useCopilotStore,
  useHydrateCopilotFlags,
} from '@/lib/store/copilot';
import { useSendMessageStream } from '@/hooks/use-copilot-mutations';
import type { CopilotSuggestedAction } from '@/lib/api/copilot';
import { cn } from '@/lib/utils';

import { CoPanelSheet } from './CoPanelSheet';
import { CommandConfirmModal } from './CommandConfirmModal';
import { ComposerInput } from './ComposerInput';
import { CopilotHeader } from './CopilotHeader';
import { DraftReviewModal } from './DraftReviewModal';
import { EmptyState } from './EmptyState';
import { ErrorBanner, GuardrailDenialToast, RateLimitToast } from './ErrorBanner';
import { HistoryPanel } from './HistoryPanel';
import { MessageList } from './MessageList';
import { PermissionDeniedBanner } from './PermissionDeniedBanner';
import { useCopilotToasts } from '@/hooks/use-copilot-toasts';

export interface CopilotPanelProps {
  /** `"panel"` (default) renders inside a right-side sheet.
   *  `"fullscreen"` renders as a full-page layout (used by `/copilot`). */
  readonly mode?: 'panel' | 'fullscreen';
  /** Optional back-link href for the fullscreen header. */
  readonly backHref?: string;
}

type View = 'chat' | 'history';

export function CopilotPanel({ mode = 'panel', backHref = '/dashboard' }: CopilotPanelProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Two CopilotPanels can be alive at once — bail on `/copilot` so
  // the page-level fullscreen instance owns the UI.
  if (mode === 'panel' && pathname !== null && (pathname === '/copilot' || pathname.startsWith('/copilot/'))) {
    return null;
  }

  // Plan 6 — master toggle.
  const copilotEnabled = useCopilotEnabled();
  const open = useCopilotStore((s) => s.open);
  const streamingFromStore = useCopilotStore((s) => s.streaming);
  const streamingMessage = useCopilotStore((s) => s.streamingMessage);


  const setOpen = useCopilotStore((s) => s.setOpen);
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const permissionDenied = useCopilotStore((s) => s.permissionDenied);
  const setPermissionDenied = useCopilotStore((s) => s.setPermissionDenied);


  // Close handler used by the fullscreen X button.
  const handleFullscreenClose = React.useCallback(() => {
    if (mode === 'fullscreen') {
      setOpen(false);
      router.push(backHref);
    } else {
      setOpen(false);
    }
  }, [mode, backHref, router, setOpen]);

  // Hydrate client-only flags from localStorage.
  useHydrateCopilotFlags();

  // Conversations fetch — moved up here so we can show the
  // ErrorBanner at the panel level instead of inside ConversationList.
  // This keeps the welcome state visible underneath while the error
  // is being addressed (Step 37 FIX 1).
  const conversations = useConversations();
  const conversation = useConversation(activeConversationId);

  // Phase 5 — wire the regenerate listener. The MessageBubble action
  // dispatches `copilot:regenerate` with the assistant messageId; we
  // find the prior user message and re-send it through the streaming
  // path so the response replaces the last bubble in place.
  const { send: sendStream } = useSendMessageStream();
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onRegenerate(event: Event) {
      const custom = event as CustomEvent<{ messageId?: string }>;
      const targetId = custom.detail?.messageId;
      if (!targetId) return;
      const messages = conversation.data?.messages ?? [];
      const assistantIdx = messages.findIndex((m) => m.id === targetId);
      if (assistantIdx <= 0) return;
      const priorUser = messages[assistantIdx - 1];
      if (!priorUser || priorUser.role !== 'user') return;
      sendStream({
        conversation_id: activeConversationId,
        project_id: null,
        message: priorUser.content,
        context: {
          current_page: pathname,
          current_center: null,
          current_artifact_id: null,
          recent_actions: ['regenerate'],
        },
      });
    }
    window.addEventListener('copilot:regenerate', onRegenerate);
    return () => window.removeEventListener('copilot:regenerate', onRegenerate);
  }, [conversation.data, activeConversationId, pathname, sendStream]);

  React.useEffect(() => {
    if (
      conversation.isError &&
      // forgeFetch throws ForgeApiError with `.status === 403`.
      (conversation.error as { status?: number } | null)?.status === 403
    ) {
      setPermissionDenied(true);
    }
  }, [conversation.isError, conversation.error, setPermissionDenied]);

  if (!copilotEnabled) return null;

  // Modal state — owned by the panel so the modals persist across
  // message list re-renders and suggested-action re-dispatches.
  const [draftAction, setDraftAction] =
    React.useState<CopilotSuggestedAction | null>(null);
  // M10 Track B — rate-limit + guardrail-denial toast queue. The
  // composer dispatches window events; we subscribe here and render
  // them inline so the user gets a structured action surface for
  // these specialized failure modes (not the generic error banner).
  const { toasts, dismissRateLimit, dismissGuardrail } = useCopilotToasts();
  const [commandAction, setCommandAction] =
    React.useState<CopilotSuggestedAction | null>(null);
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);
  // Step 37 — local view state for the History sub-panel.
  const [view, setView] = React.useState<View>('chat');

  const handleRunCommand = React.useCallback((action: CopilotSuggestedAction) => {
    setCommandAction(action);
    setCommandOpen(true);
  }, []);

  const handleDraft = React.useCallback((action: CopilotSuggestedAction) => {
    setDraftAction(action);
    setDraftOpen(true);
  }, []);

  // Step 37 — listen for the "open_history" / "open_settings" custom
  // events dispatched from the More menu in CopilotHeader. Keeping
  // them as window events avoids prop-drilling through the header
  // when the panel needs to react.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    function onHistory() {
      setView('history');
    }
    function onSettings() {
      // Settings used to be a popover anchored to the header. Step
      // 37 moves it into the More menu (no separate surface). We
      // intentionally no-op here so the menu stays open for tweaks.
    }
    window.addEventListener('copilot:open_history', onHistory);
    window.addEventListener('copilot:open_settings', onSettings);
    return () => {
      window.removeEventListener('copilot:open_history', onHistory);
      window.removeEventListener('copilot:open_settings', onSettings);
    };
  }, []);

  // Fullscreen mode forces the panel open once on mount.
  React.useEffect(() => {
    if (mode === 'fullscreen') {
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ─── Body ────────────────────────────────────────────────────────
  const conversationsError = conversations.isError;
  const conversationsLoading = conversations.isLoading;

  const errorBanner = conversationsError ? (
    <ErrorBanner
      message="Couldn't load conversations"
      detail="Your chats are safe."
      actionLabel="Retry"
      secondaryLabel="Start new"
      onAction={() => conversations.refetch()}
      onSecondary={() => useCopilotStore.getState().setActiveConversation(null)}
      testId="copilot-conversations-error"
    />
  ) : null;

  const loadingStrip = conversationsLoading ? (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 px-3 py-1.5 text-[10px] text-[var(--fg-tertiary)]"
      data-testid="copilot-conversation-list-loading"
    >
      <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-cyan)]" />
      Loading conversations…
    </div>
  ) : null;

  const chatBody = (
    <>
      {errorBanner}
      {permissionDenied ? <PermissionDeniedBanner /> : null}
      {toasts.rateLimit ? (
        <RateLimitToast
          key={toasts.rateLimit.key}
          retryAfter={toasts.rateLimit.retryAfter}
          onDismiss={dismissRateLimit}
        />
      ) : null}
      {toasts.guardrail ? (
        <GuardrailDenialToast
          key={toasts.guardrail.key}
          inline
          onDismiss={dismissGuardrail}
        />
      ) : null}
      {loadingStrip}

      <div className="flex flex-1 flex-col overflow-hidden">
        {activeConversationId ? (
          conversation.isLoading ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              Loading conversation…
            </div>
          ) : conversation.isError ? (
            <ErrorBanner
              message="Couldn't load this conversation"
              actionLabel="Retry"
              onAction={() => conversation.refetch?.()}
              testId="copilot-conversation-load-error"
            />
          ) : (
            <MessageList
              messages={conversation.data?.messages ?? []}
              streaming={streamingFromStore}
            />
          )
        ) : (
          <EmptyState />
        )}
        <ComposerInput />
      </div>
    </>
  );

  const historyBody = (
    <HistoryPanel onClose={() => setView('chat')} />
  );

  const body = view === 'history' ? historyBody : chatBody;

  return (
    <>
      {mode === 'panel' ? (
        <CoPanelSheet
          open={open}
          onOpenChange={setOpen}
          aria-describedby={undefined}
          data-testid="copilot-panel"
        >
          <CopilotHeader />
          {body}
        </CoPanelSheet>
      ) : (
        // Fullscreen mode — used by `/copilot`.
        <div
          className={cn(
            'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
            'rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]',
          )}
          data-testid="copilot-panel-fullscreen"
          role="region"
          aria-labelledby="copilot-title"
        >
          {/* Fullscreen header — back link + title + close. Distinct
              from the slide-out header because we don't need a "new
              conversation" button next to a screen-wide layout. */}
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Back to dashboard"
            >
              <Link href={backHref}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <h1
              id="copilot-title"
              className="flex items-center gap-2 text-base font-semibold text-[var(--fg-primary)]"
            >
              <Sparkles
                className="h-5 w-5 text-[var(--accent-cyan)]"
                aria-hidden="true"
              />
              Forge Co-pilot
            </h1>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8"
              onClick={handleFullscreenClose}
              aria-label="Close Co-pilot and return to dashboard"
              data-testid="copilot-fullscreen-close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </header>

          <div className="flex min-h-0 flex-1 overflow-hidden">{body}</div>
        </div>
      )}

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
