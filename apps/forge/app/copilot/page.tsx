'use client';

/**
 * `/copilot` — fullscreen Co-pilot route (Step 24 polish).
 *
 * Three-pane layout:
 *   ┌──────────────┬──────────────────────────────┬──────────────┐
 *   │ LEFT 320px   │ MAIN flex-1                  │ RIGHT 320px  │
 *   │ conversation │ message list                 │ about-this   │
 *   │ list         │ composer                     │ conversation │
 *   ├──────────────┴──────────────────────────────┴──────────────┤
 *   │ TOP BAR (64px) — breadcrumb · title · actions              │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The right pane hides below 1280px so mid-size laptops still get
 * a usable chat surface.
 *
 * All panel state, hotkeys, and mutations are owned by the panel +
 * zustand store — the page is just layout.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Home, Plus, Settings as SettingsIcon, SidebarClose, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConversationList } from '@/components/copilot/ConversationList';
import { CopilotHeader } from '@/components/copilot/CopilotHeader';
import { ComposerInput } from '@/components/copilot/ComposerInput';
import { EmptyState } from '@/components/copilot/EmptyState';
import { MessageList } from '@/components/copilot/MessageList';
import { PermissionDeniedBanner } from '@/components/copilot/PermissionDeniedBanner';
import { useConversation, useCost} from '@/hooks/use-copilot';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

import { CommandConfirmModal } from '@/components/copilot/CommandConfirmModal';
import { DraftReviewModal } from '@/components/copilot/DraftReviewModal';

import type { CopilotSuggestedAction } from '@/lib/api/copilot';

export default function CopilotRoutePage() {
  return (
    <main
      id="main-content"
      className="flex min-h-0 flex-1 flex-col p-3 md:p-4"
      data-testid="copilot-route-page"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <CopilotFullscreenLayout />
      </div>
    </main>
  );
}

function CopilotFullscreenLayout() {
  const router = useRouter();
  const streamingFromStore = useCopilotStore((s) => s.streaming);
  const streamingMessage = useCopilotStore((s) => s.streamingMessage);
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const clearDraft = useCopilotStore((s) => s.clearDraft);
  const permissionDenied = useCopilotStore((s) => s.permissionDenied);

  const conversation = useConversation(activeConversationId);
  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(true);

  // ── Modal state (mounted once so they survive message re-renders) ──
  const [draftAction, setDraftAction] = React.useState<CopilotSuggestedAction | null>(null);
  const [commandAction, setCommandAction] = React.useState<CopilotSuggestedAction | null>(null);
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

  const handleNew = React.useCallback(() => {
    setActiveConversation(null);
    clearDraft();
  }, [setActiveConversation, clearDraft]);

  // Close handler for the in-pane header. The /copilot route is not
  // wrapped in a Sheet, so we can't use <SheetClose> here — that
  // would throw "DialogClose must be used within Dialog". Instead,
  // hand the header a regular callback that returns to the dashboard.
  const handleHeaderClose = React.useCallback(() => {
    router.push('/dashboard');
  }, [router]);

  // ── Bridge to listen for deep-action events from MessageBubble ──
  React.useEffect(() => {
    function handleDraftEvent(e: Event) {
      const detail = (e as CustomEvent<CopilotSuggestedAction>).detail;
      if (detail) handleDraft(detail);
    }
    function handleCommandEvent(e: Event) {
      const detail = (e as CustomEvent<CopilotSuggestedAction>).detail;
      if (detail) handleRunCommand(detail);
    }
    if (typeof window === 'undefined') return;
    window.addEventListener('copilot:open_draft', handleDraftEvent);
    window.addEventListener('copilot:run_command', handleCommandEvent);
    return () => {
      window.removeEventListener('copilot:open_draft', handleDraftEvent);
      window.removeEventListener('copilot:run_command', handleCommandEvent);
    };
  }, [handleDraft, handleRunCommand]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── TOP BAR ─────────────────────────────────────────── */}
      <header
        className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4"
        data-testid="copilot-fullscreen-topbar"
      >
        <div className="flex min-w-0 items-center gap-2 text-[var(--text-sm)]">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Back to dashboard"
          >
            <Link href="/dashboard">
              <Home className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <ChevronRight className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <span className="flex items-center gap-1.5 text-[var(--fg-secondary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
            <span className="font-semibold text-[var(--fg-primary)]">Forge Co-pilot</span>
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[var(--text-xs)]"
            onClick={handleNew}
            data-testid="copilot-fullscreen-new"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New chat
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Collapse left sidebar"
            title={leftOpen ? 'Hide conversations' : 'Show conversations'}
            onClick={() => setLeftOpen((v) => !v)}
            data-testid="copilot-fullscreen-toggle-left"
          >
            <SidebarClose
              className={cn('h-4 w-4 transition-transform', !leftOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Collapse right sidebar"
            title={rightOpen ? 'Hide details' : 'Show details'}
            onClick={() => setRightOpen((v) => !v)}
            data-testid="copilot-fullscreen-toggle-right"
          >
            <SidebarClose
              className={cn('h-4 w-4 transition-transform', !rightOpen && '-rotate-180')}
              aria-hidden="true"
            />
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Settings"
            title="Settings"
          >
            <Link href="/admin/settings">
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Back to dashboard"
            title="Back to dashboard"
          >
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>

      {/* ── BODY (3 panes) ──────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT — conversation list (pinned open in fullscreen) */}
        {leftOpen ? (
          <aside
            className="flex w-[320px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)]"
            data-testid="copilot-fullscreen-left"
          >
            <CopilotHeader onClose={handleHeaderClose} />
            <div className="flex-1 overflow-y-auto">
              <ConversationList />
            </div>
          </aside>
        ) : null}

        {/* MAIN — chat panel */}
        <section
          className="flex min-w-0 flex-1 flex-col bg-[var(--bg-surface)]"
          data-testid="copilot-fullscreen-main"
        >
          {permissionDenied ? <PermissionDeniedBanner /> : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeConversationId ? (
              conversation.isLoading ? (
                <div className="flex flex-1 items-center justify-center text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                  Loading conversation…
                </div>
              ) : conversation.isError ? (
                <div
                  role="alert"
                  className="m-4 rounded-md border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 p-3 text-[var(--text-xs)] text-[var(--accent-rose)]"
                >
                  Failed to load conversation.
                </div>
              ) : (
                <MessageList
                  messages={conversation.data?.messages ?? []}
                  streaming={streamingFromStore}
                  streamingMessage={streamingMessage}
                />
              )
            ) : (
              <EmptyState />
            )}
            <ComposerInput />
          </div>
        </section>

        {/* RIGHT — about-this-conversation (hidden <1280px) */}
        {rightOpen ? (
          <aside
            className="hidden w-[320px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-base)] xl:flex"
            data-testid="copilot-fullscreen-right"
          >
            <RightPane
              conversationTitle={conversation.data?.title ?? null}
              conversation={conversation.data ?? null}
            />
          </aside>
        ) : null}
      </div>

      {/* ── Modals ─────────────────────────────────────────── */}
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
    </div>
  );
}

function RightPane({
  conversationTitle,
  conversation,
}: {
  conversationTitle: string | null;
  // Phase 5 — RightPane reads the conversation id for the cost
  // query. We type the minimum shape we actually use rather than
  // pulling in the full `CopilotConversationRead` so the component
  // stays decoupled from the schema.
  conversation: {
    id: string;
    messages: { tool_calls: unknown[] }[];
  } | null;
}) {

  // Phase 5 — live cost + token count. Polls every 5s while a
  // conversation is active so the right pane stays in sync with the
  // cost badge the composer invalidates on stream completion.
  const cost = useCost(conversation?.id ?? null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4">
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
          About this conversation
        </h2>
      </header>

      <div className="flex flex-col gap-4 p-4 text-[var(--text-xs)] text-[var(--fg-secondary)]">
        <Section title="Context">
          <p className="text-[var(--fg-tertiary)]">
            What the Co-pilot can see right now:
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" />
              <span>@Forge Platform</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
              <span>3 agents active</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
              <span>1 run in progress</span>
            </li>
          </ul>
        </Section>

        <Section title="Title">
          <p className="truncate text-[var(--fg-primary)]">
            {conversationTitle ?? 'New conversation'}
          </p>
        </Section>

        <Section title="Tools used">
          {conversation && conversation.messages.some((m) => m.tool_calls.length > 0) ? (
            <ul className="mt-1 flex flex-col gap-1 font-mono text-[11px] text-[var(--fg-tertiary)]">
              {conversation.messages
                .flatMap((m) => m.tool_calls as { tool: string }[])
                .map((tc, i) => (
                  <li key={i}>forge-cli {tc.tool}</li>
                ))}
            </ul>
          ) : (
            <p className="text-[var(--fg-tertiary)]">No forge-* tools invoked yet.</p>
          )}
        </Section>

        <Section title="Tokens + cost">
          {cost.data ? (
            <dl className="grid grid-cols-2 gap-y-1 text-[11px]" data-testid="copilot-cost-pane">
              <dt className="text-[var(--fg-tertiary)]">Total cost</dt>
              <dd className="text-right tabular-nums">
                ${cost.data.total_cost_usd.toFixed(4)}
              </dd>
              <dt className="text-[var(--fg-tertiary)]">Tokens in</dt>
              <dd className="text-right tabular-nums">{cost.data.total_tokens_in}</dd>
              <dt className="text-[var(--fg-tertiary)]">Tokens out</dt>
              <dd className="text-right tabular-nums">{cost.data.total_tokens_out}</dd>
              {cost.data.budget_status ? (
                <>
                  <dt className="text-[var(--fg-tertiary)]">Budget</dt>
                  <dd className="text-right">
                    {cost.data.budget_remaining_usd !== null
                      ? `$${cost.data.budget_remaining_usd.toFixed(2)} remaining`
                      : cost.data.budget_status}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : cost.isLoading ? (
            <p className="text-[var(--fg-tertiary)]">Loading usage…</p>
          ) : (
            <p className="text-[var(--fg-tertiary)]">No usage yet.</p>
          )}
        </Section>

        <Section title="Export">
          <div className="mt-1 flex flex-col gap-1.5">
            <button
              type="button"
              className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-left text-[11px] hover:border-[var(--border-default)]"
              data-testid="copilot-export-markdown"
            >
              Download as Markdown
            </button>
            <button
              type="button"
              className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-left text-[11px] hover:border-[var(--border-default)]"
              data-testid="copilot-export-copy"
            >
              Copy to clipboard
            </button>
            <button
              type="button"
              className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-left text-[11px] hover:border-[var(--border-default)]"
              data-testid="copilot-export-share"
            >
              Share link
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
        {title}
      </h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
