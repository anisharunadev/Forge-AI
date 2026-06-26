'use client';

/**
 * Step 37 — Compact conversation list.
 *
 * The error state no longer lives here — it moved to the panel-level
 * `ErrorBanner` (small dismissible banner just below the header).
 * The empty state stays inline because it doubles as a quick-action
 * surface when the panel first opens.
 *
 * Three distinct visual states:
 *
 *   1. ERROR  — null (handled by the panel via ErrorBanner so the
 *               welcome state can stay visible underneath).
 *
 *   2. EMPTY  — fetch OK, zero rows. Compact "Your conversations
 *               will appear here" + "Start chatting →" link that
 *               focuses the composer.
 *
 *   3. LOADED — fetch OK, >= 1 row. Search input (⌘K hint) + filter
 *               pills + sticky pinned section (top 5) + grouped list
 *               (Today / Yesterday / Last 7 days / Older). Each row
 *               has title + preview + timestamp + 3-dot menu. Active
 *               row gets a 2px indigo left rail.
 *
 * Skill influence (ui-ux-pro-max style + ux-guideline):
 *   - "Show helpful message and action" (08-empty-ux.md) — every
 *     state has a verb the user can act on.
 *   - "Heading hierarchy" (04-ux-guideline.md) — h3 in error state,
 *     h2 in empty state, no headings in the loaded list (rows are
 *     buttons, not sections).
 *   - "Sticky navigation should not obscure content" — pinned
 *     section uses position: sticky with a small backdrop so it
 *     doesn't visually clash with day headers below it.
 *   - "Dark mode low-light contrast" — uses --bg-elevated + border
 *     --border-subtle so rows are readable in low light.
 *
 * Backwards-compat: the existing `onSelect` and `className` props
 * are preserved so callers (e.g. CopilotPanel) need no changes.
 * We additively extend the row markup; nothing breaks.
 */

import * as React from 'react';
import {
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConversations } from '@/hooks/use-copilot';
import { useDeleteConversation } from '@/hooks/use-copilot-mutations';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

import type { CopilotConversationSummary } from '@/lib/api/copilot';

export interface ConversationListProps {
  /** Optional click handler override — defaults to setActiveConversation + clearDraft. */
  onSelect?: (conversationId: string) => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Lightweight relative-time formatter — no date-fns dep. Returns a
 * compact string for the row's right-hand timestamp. Pure function;
 * falls back to a short ISO slice if `date` is missing/invalid so
 * callers can pass any string-like input from the API.
 */
function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`;
  // Older — use short month + day (e.g. "Jun 12").
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Derive a "day bucket" key for the conversation list grouping.
 * Buckets are: today | yesterday | last7 | older. Pure function —
 * gracefully returns "older" if no timestamp is available so we
 * still render every row even before the API grows `created_at`.
 */
type DayBucket = 'today' | 'yesterday' | 'last7' | 'older';

function bucketFor(date: string | Date | null | undefined): DayBucket {
  if (!date) return 'older';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return 'older';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400 * 1000;
  const diff = startOfToday - d.getTime();
  if (diff <= 0) return 'today';
  if (diff <= day) return 'yesterday';
  if (diff <= 7 * day) return 'last7';
  return 'older';
}

const DAY_LABELS: Record<DayBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  older: 'Older',
};

const DAY_ORDER: DayBucket[] = ['today', 'yesterday', 'last7', 'older'];

type Filter = 'all' | 'pinned' | 'shared' | 'today';

interface FilterPill {
  id: Filter;
  label: string;
}

const FILTER_PILLS: ReadonlyArray<FilterPill> = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'shared', label: 'Shared' },
  { id: 'today', label: 'Today' },
];

// Pinned conversation ids — persisted client-side only. The backend
// doesn't yet expose a `pinned_at` column on `CopilotConversation`,
// so we treat pinning as a UI affordance (mirrors how Linear AI
// surfaces pinned chats). Stored under `forge.copilot.pinned` so
// the user's pinning decisions survive reloads.
const PINNED_STORAGE_KEY = 'forge.copilot.pinned.v1';

function readPinnedSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writePinnedSet(set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable — silently ignore.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function ConversationList({ onSelect, className }: ConversationListProps) {
  const conversations = useConversations();
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const setActiveConversation = useCopilotStore((s) => s.setActiveConversation);
  const clearDraft = useCopilotStore((s) => s.clearDraft);
  const setDraft = useCopilotStore((s) => s.setDraft);
  const remove = useDeleteConversation();

  // Local UI state — search query, filter pill, pinned ids, menu open
  // row id. Kept in component state (not the store) because none of
  // these need to leak outside the list.
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [pinnedIds, setPinnedIds] = React.useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);

  // Hydrate pinned ids from localStorage once on mount.
  React.useEffect(() => {
    setPinnedIds(readPinnedSet());
  }, []);

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

  // Close any open 3-dot menu when the user clicks elsewhere on the
  // page. Using a window mousedown listener is cheap and avoids the
  // need for a Portal + outside-click library.
  React.useEffect(() => {
    if (!openMenuId) return;
    function handleDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-conversation-menu]')) return;
      if (target.closest('[data-conversation-menu-trigger]')) return;
      setOpenMenuId(null);
    }
    window.addEventListener('mousedown', handleDown);
    return () => window.removeEventListener('mousedown', handleDown);
  }, [openMenuId]);

  // ─── Filtering ──────────────────────────────────────────────────
  const filtered: CopilotConversationSummary[] = React.useMemo(() => {
    const rows = conversations.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'pinned' && !pinnedIds.has(row.id)) return false;
      // The API doesn't yet expose `shared` or `created_at`. We render
      // the "shared" pill so the UI surface is in place for the
      // backend to grow into, but it just shows the same list as All.
      if (filter === 'today') {
        // Without `created_at`, this collapses to "all" — once the
        // API exposes the field, swap in bucketFor(row.created_at) === 'today'.
      }
      if (!q) return true;
      const title = (row.title ?? '').toLowerCase();
      return title.includes(q);
    });
  }, [conversations.data, filter, pinnedIds, search]);

  // ─── Grouping (pinned first, then by day bucket) ────────────────
  const pinnedRows = React.useMemo(
    () => filtered.filter((r) => pinnedIds.has(r.id)).slice(0, 5),
    [filtered, pinnedIds],
  );

  const grouped = React.useMemo(() => {
    const buckets: Record<DayBucket, CopilotConversationSummary[]> = {
      today: [],
      yesterday: [],
      last7: [],
      older: [],
    };
    for (const row of filtered) {
      if (pinnedIds.has(row.id)) continue; // pinned shown in sticky section
      buckets[bucketFor((row as { created_at?: string }).created_at)].push(row);
    }
    return buckets;
  }, [filtered, pinnedIds]);

  const togglePin = React.useCallback(
    (id: string) => {
      setPinnedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        writePinnedSet(next);
        return next;
      });
    },
    [],
  );

  const handleDelete = React.useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setOpenMenuId(null);
      remove.mutate(id);
    },
    [remove],
  );

  const handleStartNewChat = React.useCallback(() => {
    // The "Start chatting →" link in the empty state focuses the
    // composer input rather than creating a conversation up-front —
    // matches the rest of the app's "compose first, send to create"
    // flow.
    handleNew();
    setDraft('');
    if (typeof document !== 'undefined') {
      const ta = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="copilot-composer-input"]',
      );
      ta?.focus();
    }
  }, [handleNew, setDraft]);

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────

  // ── ERROR STATE ─────────────────────────────────────────────────
  // Step 37 — error rendering moved out of this component into the
  // panel-level `ErrorBanner` so the welcome state can stay visible
  // underneath. We render a near-empty placeholder here so the
  // layout doesn't collapse while the banner is showing.
  if (conversations.isError) {
    return (
      <div
        className={cn('flex flex-col gap-2 px-3 py-3', className)}
        data-testid="copilot-conversation-list"
        data-state="error"
      >
        <p className="text-[11px] text-[var(--fg-tertiary)]">
          Your conversations couldn&apos;t load. You can still start a new chat below.
        </p>
        <button
          type="button"
          onClick={handleNew}
          className="self-start text-[11px] font-medium text-[var(--accent-cyan)] transition-colors hover:text-[var(--accent-primary)]"
          data-testid="copilot-conversation-start-new"
        >
          Start new chat →
        </button>
      </div>
    );
  }

  // ── LOADING STATE ───────────────────────────────────────────────
  if (conversations.isLoading) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 px-4 py-3 text-[var(--text-xs)] text-[var(--fg-tertiary)]',
          className,
        )}
        data-testid="copilot-conversation-list"
        data-state="loading"
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Loading conversations…
      </div>
    );
  }

  // ── EMPTY STATE ─────────────────────────────────────────────────
  if ((conversations.data?.length ?? 0) === 0) {
    return (
      <div
        className={cn(
          'mx-4 my-3 flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 px-3 py-2 text-[var(--text-xs)]',
          className,
        )}
        data-testid="copilot-conversation-list"
        data-state="empty"
      >
        <span className="text-[var(--fg-tertiary)]">
          Your conversations will appear here.
        </span>
        <button
          type="button"
          onClick={handleStartNewChat}
          className="font-medium text-[var(--accent-cyan)] transition-colors hover:text-[var(--accent-primary)] focus-visible:outline-none focus-visible:underline"
          data-testid="copilot-conversation-empty-cta"
        >
          Start chatting →
        </button>
      </div>
    );
  }

  // ── LOADED STATE ────────────────────────────────────────────────
  // Counts for filter pills — derived from current data. "All" is
  // total; the others narrow by client-side rules (pinned / today).
  const counts = React.useMemo(() => {
    const rows = conversations.data ?? [];
    return {
      all: rows.length,
      pinned: pinnedRows.length,
      shared: 0,
      today: rows.length, // collapses to all until API exposes created_at
    };
  }, [conversations.data, pinnedRows.length]);

  return (
    <div
      className={cn(
        'flex w-full flex-col border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40',
        className,
      )}
      data-testid="copilot-conversation-list"
      data-state="loaded"
    >
      {/* Search ─────────────────────────────────────────────────── */}
      <div className="px-3 pt-3">
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className={cn(
              'h-8 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] pl-8 pr-12 text-[var(--text-xs)] text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
              'transition-colors duration-150',
              'focus-visible:outline-none focus-visible:border-[var(--accent-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
            )}
            data-testid="copilot-conversation-search"
          />
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]"
          >
            ⌘K
          </kbd>
        </label>
      </div>

      {/* Filter pills ──────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Conversation filters"
        className="flex items-center gap-1 overflow-x-auto px-3 pt-2"
      >
        {FILTER_PILLS.map((pill) => {
          const isActive = filter === pill.id;
          const count = counts[pill.id];
          return (
            <button
              key={pill.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter(pill.id)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors',
                isActive
                  ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                  : 'text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-secondary)]',
              )}
              data-testid={`copilot-conversation-filter-${pill.id}`}
            >
              {pill.label}
              <span
                className={cn(
                  'rounded-full px-1 text-[10px] tabular-nums',
                  isActive
                    ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                    : 'bg-[var(--bg-inset)] text-[var(--fg-muted)]',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Pinned section (sticky) ──────────────────────────────── */}
      {pinnedRows.length > 0 ? (
        <section
          aria-label="Pinned conversations"
          className="sticky top-0 z-[1] mt-2 border-y border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 px-1 py-1 backdrop-blur"
        >
          <ul role="list" className="flex flex-col gap-0.5">
            {pinnedRows.map((row) => (
              <ConversationRow
                key={`pin-${row.id}`}
                row={row}
                isActive={row.id === activeConversationId}
                pinned
                isMenuOpen={openMenuId === row.id}
                onSelect={handleSelect}
                onTogglePin={togglePin}
                onDelete={handleDelete}
                onToggleMenu={(id) => setOpenMenuId(openMenuId === id ? null : id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Grouped list ────────────────────────────────────────── */}
      <ul role="list" className="flex flex-col gap-0.5 px-1 pb-2 pt-1">
        {DAY_ORDER.map((bucket) => {
          const rows = grouped[bucket];
          if (rows.length === 0) return null;
          return (
            <li key={bucket} role="presentation">
              <h3 className="sticky top-0 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {DAY_LABELS[bucket]}
              </h3>
              <ul role="list" className="flex flex-col gap-0.5">
                {rows.map((row) => (
                  <ConversationRow
                    key={row.id}
                    row={row}
                    isActive={row.id === activeConversationId}
                    pinned={false}
                    isMenuOpen={openMenuId === row.id}
                    onSelect={handleSelect}
                    onTogglePin={togglePin}
                    onDelete={handleDelete}
                    onToggleMenu={(id) => setOpenMenuId(openMenuId === id ? null : id)}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      {filtered.length === 0 ? (
        <div className="px-4 pb-3 text-center text-[var(--text-xs)] text-[var(--fg-tertiary)]">
          No conversations match your search.
        </div>
      ) : null}

      {/* Footer — "+ New conversation" ────────────────────────── */}
      <button
        type="button"
        onClick={handleNew}
        className={cn(
          'mx-2 mb-3 mt-1 flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text-xs)] font-medium text-[var(--fg-secondary)]',
          'transition-colors duration-150',
          'hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]',
          'focus-visible:outline-none focus-visible:border-[var(--accent-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
        )}
        data-testid="copilot-conversation-new"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
        New conversation
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Conversation row — extracted as its own component so the same
// markup can be used in the pinned section and the day-grouped list.
// ─────────────────────────────────────────────────────────────────────

interface ConversationRowProps {
  row: CopilotConversationSummary;
  isActive: boolean;
  pinned: boolean;
  isMenuOpen: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onToggleMenu: (id: string) => void;
}

function ConversationRow({
  row,
  isActive,
  pinned,
  isMenuOpen,
  onSelect,
  onTogglePin,
  onDelete,
  onToggleMenu,
}: ConversationRowProps) {
  const title = row.title ?? 'New conversation';
  // The backend doesn't expose a `last_message_preview` field yet.
  // We compose a soft preview from the message_count + cost so the
  // row still feels informative. Once the API grows that field, swap
  // the preview source in one place.
  const preview =
    row.message_count > 0
      ? `${row.message_count} msg · $${row.total_cost_usd.toFixed(4)}`
      : 'No messages yet';

  return (
    <li role="listitem" className="relative">
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        className={cn(
          'group relative flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors duration-150',
          isActive
            ? 'bg-[rgba(99,102,241,0.10)]'
            : 'hover:bg-[rgba(255,255,255,0.04)]',
        )}
        data-testid="copilot-conversation-row"
        data-conversation-id={row.id}
        data-active={isActive ? 'true' : 'false'}
        data-pinned={pinned ? 'true' : 'false'}
      >
        {/* Active left rail */}
        {isActive ? (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-[var(--accent-primary)]"
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            {pinned ? (
              <Pin
                aria-hidden="true"
                className="h-3 w-3 shrink-0 -rotate-45 text-[var(--accent-amber)]"
              />
            ) : null}
            <span className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              {title}
            </span>
          </div>
          <span className="truncate text-[var(--text-xs)] text-[var(--fg-tertiary)]">
            {preview}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* 3-dot menu trigger — appears on row hover OR when open. */}
          <button
            type="button"
            data-conversation-menu-trigger
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu(row.id);
            }}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--fg-primary)]',
              (isMenuOpen || isActive) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            aria-label={`Conversation actions for ${title}`}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            data-testid="copilot-conversation-menu-trigger"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </button>

      {/* Menu — rendered inline (no portal needed). Closes on
          outside click via the window listener in the parent. */}
      {isMenuOpen ? (
        <div
          data-conversation-menu
          role="menu"
          aria-label="Conversation actions"
          className="absolute right-2 top-9 z-10 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-lg)]"
          data-testid="copilot-conversation-menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(row.id);
              onToggleMenu(row.id);
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[var(--text-xs)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
          >
            <Pin className="h-3 w-3" aria-hidden="true" />
            {pinned ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[var(--text-xs)] text-[var(--fg-tertiary)] opacity-60"
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[var(--text-xs)] text-[var(--fg-tertiary)] opacity-60"
          >
            Share
          </button>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          <button
            type="button"
            role="menuitem"
            onClick={(e) => onDelete(e, row.id)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[var(--text-xs)] text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.08)]"
          >
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}

// Re-export Plus so existing imports keep working.
export { Plus };
