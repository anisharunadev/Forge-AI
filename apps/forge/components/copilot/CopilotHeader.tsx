'use client';

/**
 * Step 37 — Minimal Co-pilot header.
 *
 * Replaces Step 24's six-icon header with three essentials:
 *
 *   - Sparkles + "Forge Co-pilot" + (optional) conversation title
 *   - Pin (only when conversation is active AND pinned)
 *   - More (3-dot) — menu of less-critical actions
 *   - Close (X)
 *
 * The "More" menu holds: Pin/Unpin · Share · History · Settings ·
 * Fullscreen · New conversation. Cleaner chrome around the actual
 * conversation, fewer distractions.
 *
 * Skill influence (ui-ux-pro-max):
 *   - "AI-Native UI" — minimal chrome, single accent on the active
 *     state. Header reads like a modern chat-app toolbar.
 *   - "Focus States" + "Keyboard Navigation" — every button has an
 *     aria-label; menu is keyboard-navigable.
 *   - "Heading hierarchy" — `h1`-like title preserved as a span with
 *     proper weight; no skipped levels.
 *
 * Backwards-compat: data-testids from Step 19/24 (copilot-close,
 * copilot-new-conversation, copilot-back, copilot-settings-button,
 * copilot-history-button, copilot-pin-toggle, copilot-share-button)
 * are all preserved so existing tests continue to find them — they
 * just live inside the More menu now.
 */

import * as React from 'react';
import {
  ChevronDown,
  History,
  Maximize2,
  MoreHorizontal,
  Pin,
  Settings,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SheetClose } from '@/components/ui/sheet';
import { useConversation } from '@/hooks/use-copilot';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

export interface CopilotHeaderProps {
  /** Whether to show the "Expand" button (true when in panel mode). */
  showExpand?: boolean;
  /** Called when the user clicks Expand — the parent decides where to go. */
  onExpand?: () => void;
  /**
   * Optional custom close handler. When provided, the header renders
   * a regular close button that invokes this callback (used by the
   * `/copilot` fullscreen page, which is not wrapped in a Sheet).
   * When omitted, the header falls back to `<SheetClose asChild>`,
   * which closes the surrounding Co-pilot sheet in panel mode.
   */
  onClose?: () => void;
}

export function CopilotHeader({
  showExpand = false,
  onExpand,
  onClose,
}: CopilotHeaderProps) {
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const clearDraft = useCopilotStore((s) => s.clearDraft);
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const setPinned = useCopilotStore((s) => s.setPinned ?? (() => {}));
  const isPinned = useCopilotStore((s) => s.isPinned ?? false);
  const streaming = useCopilotStore((s) => s.streaming);

  const conversation = useConversation(activeConversationId);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const titleInputRef = React.useRef<HTMLInputElement | null>(null);
  const moreRef = React.useRef<HTMLDivElement | null>(null);

  // Sync title draft when the active conversation changes.
  React.useEffect(() => {
    setTitleDraft(conversation.data?.title ?? '');
    setTitleEditing(false);
  }, [activeConversationId, conversation.data?.title]);

  // Close the More menu when the user clicks outside.
  React.useEffect(() => {
    if (!moreOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-copilot-more-menu]')) return;
      if (target.closest('[data-testid="copilot-more-button"]')) return;
      setMoreOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [moreOpen]);

  const showBack = activeConversationId !== null;
  const title = conversation.data?.title ?? 'New conversation';

  const handleBack = React.useCallback(() => {
    setActiveConversation(null);
  }, [setActiveConversation]);

  const handleNew = React.useCallback(() => {
    setActiveConversation(null);
    clearDraft();
    setMoreOpen(false);
  }, [setActiveConversation, clearDraft]);

  const handleTogglePin = React.useCallback(() => {
    if (!activeConversationId) return;
    setPinned(!isPinned);
    setMoreOpen(false);
  }, [activeConversationId, isPinned, setPinned]);

  const handleTitleSubmit = React.useCallback(() => {
    setTitleEditing(false);
    // Renaming is a local-only affordance for now — the backend
    // doesn't expose a PATCH endpoint yet, but the UI surface is in
    // place so we can wire it in one place when the API grows.
  }, []);

  const handleShare = React.useCallback(() => {
    if (typeof window === 'undefined' || !activeConversationId) return;
    const url = `${window.location.origin}/copilot?c=${activeConversationId}`;
    void navigator.clipboard?.writeText(url).catch(() => {
      // Clipboard write failed — fall back silently.
    });
    setMoreOpen(false);
  }, [activeConversationId]);

  const handleOpenHistory = React.useCallback(() => {
    // Opens the conversation list as a sub-panel within the
    // Co-pilot panel (Step 37 FIX 7) rather than the previous
    // separate drawer. The parent listens for this event.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('copilot:open_history'));
    }
    setMoreOpen(false);
  }, []);

  const handleOpenSettings = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('copilot:open_settings'));
    }
    setMoreOpen(false);
  }, []);

  return (
    <div className="relative flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3">
      {/* LEFT cluster ─────────────────────────────────────────── */}
      <div className="flex min-w-0 items-center gap-2">
        {showBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleBack}
            aria-label="Back to conversations"
            title="Back to conversations"
            data-testid="copilot-back"
          >
            <ChevronDown className="h-4 w-4 -rotate-90" aria-hidden="true" />
          </Button>
        ) : null}

        <Sparkles
          className="h-[18px] w-[18px] shrink-0 text-[var(--accent-cyan)]"
          aria-hidden="true"
        />
        <span className="shrink-0 text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
          Forge Co-pilot
        </span>

        {showBack ? (
          <>
            <span aria-hidden="true" className="text-[var(--fg-tertiary)]">
              ·
            </span>
            {titleEditing ? (
              <input
                ref={titleInputRef}
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleTitleSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleTitleSubmit();
                  } else if (e.key === 'Escape') {
                    setTitleEditing(false);
                    setTitleDraft(conversation.data?.title ?? '');
                  }
                }}
                autoFocus
                aria-label="Rename conversation"
                className="h-6 min-w-[120px] max-w-[200px] rounded border border-[var(--accent-primary)] bg-[var(--bg-inset)] px-1.5 text-[var(--text-sm)] text-[var(--fg-primary)] focus-visible:outline-none"
                data-testid="copilot-title-input"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className={cn(
                  'flex min-w-0 items-center gap-1 truncate rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--text-sm)] text-[var(--fg-secondary)]',
                  'hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
                )}
                aria-label="Rename conversation"
                title="Rename"
                data-testid="copilot-title"
              >
                <span className="truncate">{title || 'New conversation'}</span>
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
            )}
          </>
        ) : null}

        {/* Status dot */}
        <StatusDot
          state={
            streaming ? 'thinking' : isPinned ? 'synced' : 'idle'
          }
        />
      </div>

      {/* RIGHT cluster ────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Pin only when conversation is pinned AND active. Hidden
            otherwise — unclutters the header for the new-chat path. */}
        {isPinned && activeConversationId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[var(--accent-amber)]"
            onClick={handleTogglePin}
            aria-label="Unpin conversation"
            aria-pressed={isPinned}
            title="Unpin"
            data-testid="copilot-pin-toggle"
          >
            <Pin className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          </Button>
        ) : null}

        {/* More menu (3-dot). Houses every non-essential action. */}
        <div ref={moreRef} className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setMoreOpen((v) => !v)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="More"
            data-testid="copilot-more-button"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
          {moreOpen ? (
            <MoreMenu
              isPinned={isPinned}
              hasActiveConversation={!!activeConversationId}
              showExpand={showExpand}
              onTogglePin={handleTogglePin}
              onShare={handleShare}
              onOpenHistory={handleOpenHistory}
              onOpenSettings={handleOpenSettings}
              onNewConversation={handleNew}
              onExpand={onExpand ?? (() => {})}
              onClose={() => setMoreOpen(false)}
            />
          ) : null}
        </div>

        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="Close Co-pilot"
            title="Close (Esc)"
            data-testid="copilot-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Close Co-pilot"
              title="Close (Esc)"
              data-testid="copilot-close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </SheetClose>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// More menu — secondary action cluster (Pin / Share / History /
// Settings / Fullscreen / New conversation). Single component so the
// header stays compact and adding a new item is a one-line change.
// ─────────────────────────────────────────────────────────────────────

interface MoreMenuProps {
  isPinned: boolean;
  hasActiveConversation: boolean;
  showExpand: boolean;
  onTogglePin: () => void;
  onShare: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onNewConversation: () => void;
  onExpand: () => void;
  onClose: () => void;
}

function MoreMenu({
  isPinned,
  hasActiveConversation,
  showExpand,
  onTogglePin,
  onShare,
  onOpenHistory,
  onOpenSettings,
  onNewConversation,
  onExpand,
  onClose,
}: MoreMenuProps) {
  // Persisted settings — style + slash commands enabled (kept
  // local-only because they're a personal preference, not a backend
  // contract yet).
  const [style, setStyle] = React.useState<'concise' | 'balanced' | 'detailed'>(
    () => (readLS('forge.copilot.style.v1') as 'concise' | 'balanced' | 'detailed') || 'balanced',
  );
  const [slashEnabled, setSlashEnabled] = React.useState<boolean>(
    () => readLS('forge.copilot.slashEnabled.v1') !== '0',
  );

  React.useEffect(() => {
    writeLS('forge.copilot.style.v1', style);
  }, [style]);
  React.useEffect(() => {
    writeLS('forge.copilot.slashEnabled.v1', slashEnabled ? '1' : '0');
  }, [slashEnabled]);

  return (
    <div
      data-copilot-more-menu
      role="menu"
      aria-label="Co-pilot more actions"
      className="absolute right-0 top-[calc(100%+4px)] z-40 w-64 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]"
      data-testid="copilot-more-menu"
    >
      <MenuItem
        icon={<Pin className="h-3.5 w-3.5" aria-hidden="true" />}
        label={isPinned ? 'Unpin conversation' : 'Pin conversation'}
        disabled={!hasActiveConversation}
        onClick={onTogglePin}
        testId="copilot-pin-toggle"
      />
      <MenuItem
        icon={<Share2 className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Share"
        disabled={!hasActiveConversation}
        onClick={onShare}
        testId="copilot-share-button"
      />
      <MenuItem
        icon={<History className="h-3.5 w-3.5" aria-hidden="true" />}
        label="History"
        onClick={onOpenHistory}
        testId="copilot-history-button"
      />
      <MenuItem
        icon={<Settings className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Settings"
        onClick={onOpenSettings}
        testId="copilot-settings-button"
      />

      <div className="my-1 h-px bg-[var(--border-subtle)]" />

      {/* Style + slash-commands sub-controls — kept inside the menu
          so the header stays minimal. Clicking them does NOT close
          the menu (it's a tweak surface, not a navigation action). */}
      <div className="px-2 pb-2 pt-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
          Style
        </p>
        <div className="mt-1 flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
          {(['concise', 'balanced', 'detailed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              className={cn(
                'flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] capitalize transition-colors',
                style === s
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-secondary)]',
              )}
              data-testid={`copilot-settings-style-${s}`}
            >
              {s}
            </button>
          ))}
        </div>

        <label className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--fg-secondary)]">
          <span>Slash commands</span>
          <input
            type="checkbox"
            checked={slashEnabled}
            onChange={(e) => setSlashEnabled(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
            data-testid="copilot-settings-slash-enabled"
          />
        </label>
      </div>

      <div className="my-1 h-px bg-[var(--border-subtle)]" />

      <MenuItem
        icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
        label="New conversation"
        onClick={onNewConversation}
        testId="copilot-new-conversation"
      />
      {showExpand ? (
        <MenuItem
          icon={<Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
          label="Expand"
          onClick={() => {
            onExpand();
            onClose();
          }}
          testId="copilot-expand-button"
        />
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[var(--text-xs)] text-[var(--fg-secondary)]',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
      )}
    >
      <span className="text-[var(--fg-tertiary)]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function StatusDot({ state }: { state: 'thinking' | 'synced' | 'idle' }) {
  const dotClass = {
    thinking: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)] animate-pulse',
    synced: 'bg-[var(--accent-emerald)] shadow-[0_0_4px_var(--accent-emerald)]',
    idle: 'bg-[var(--fg-muted)]',
  }[state];
  const label = {
    thinking: 'Generating',
    synced: 'Saved',
    idle: 'Idle',
  }[state];
  return (
    <span
      aria-label={`Status: ${label}`}
      title={label}
      className={cn('ml-1 inline-block h-1.5 w-1.5 rounded-full', dotClass)}
      data-testid="copilot-status-dot"
      data-state={state}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function readLS(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
