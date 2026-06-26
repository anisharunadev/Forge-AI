'use client';

/**
 * Step 24 — Slash command popover.
 *
 * Shown above the composer whenever the user types "/" — either as a
 * bare trigger or with a partial query. Categories: Navigation / Run
 * / Create / Toggles / Help. Up/Down arrows navigate, Enter selects,
 * Esc closes, Tab accepts.
 *
 * The popover is "context-aware" — when the user types text after
 * "/", we filter the list and surface a preview pane to the right of
 * each row so they can read the description without selecting.
 *
 * Skill influence (ui-ux-pro-max):
 *   - "AI-Native UI" — segmented command palette mirrors Linear /
 *     Raycast / Claude. Vertical list, 2-column preview, keyboard
 *     first.
 *   - "Heading hierarchy" — h3 category labels, no skipped levels.
 *   - "Show helpful message and action" — every command has a
 *     description AND a shortcut hint.
 */

import * as React from 'react';
import {
  ArrowRight,
  Bot,
  Compass,
  FileText,
  History,
  HelpCircle,
  ListChecks,
  Pin,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface SlashCommand {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  icon: LucideIcon;
  category: 'Navigation' | 'Run' | 'Create' | 'Toggles' | 'Help';
  /** What to insert into the composer on select. */
  insertion: string;
}

const COMMANDS: ReadonlyArray<SlashCommand> = [
  {
    id: 'help',
    label: '/help',
    description: 'Show all commands',
    shortcut: '?',
    icon: HelpCircle,
    category: 'Help',
    insertion: '/help',
  },
  {
    id: 'clear',
    label: '/clear',
    description: 'Clear conversation',
    icon: Trash2,
    category: 'Toggles',
    insertion: '/clear',
  },
  {
    id: 'new',
    label: '/new',
    description: 'Start new conversation',
    shortcut: '⌘⇧N',
    icon: Plus,
    category: 'Create',
    insertion: '/new',
  },
  {
    id: 'export',
    label: '/export',
    description: 'Export conversation',
    icon: Share2,
    category: 'Create',
    insertion: '/export',
  },
  {
    id: 'agents',
    label: '/agents',
    description: 'Talk to a specific agent',
    icon: Bot,
    category: 'Run',
    insertion: '/agents ',
  },
  {
    id: 'run',
    label: '/run',
    description: 'Run a forge command',
    icon: ListChecks,
    category: 'Run',
    insertion: '/run ',
  },
  {
    id: 'summarize',
    label: '/summarize',
    description: 'Summarize current page',
    icon: FileText,
    category: 'Run',
    insertion: '/summarize',
  },
  {
    id: 'navigate',
    label: '/navigate',
    description: 'Navigate to a page',
    icon: Compass,
    category: 'Navigation',
    insertion: '/navigate ',
  },
  {
    id: 'search',
    label: '/search',
    description: 'Search the knowledge base',
    icon: Search,
    category: 'Navigation',
    insertion: '/search ',
  },
  {
    id: 'model',
    label: '/model',
    description: 'Switch model mid-conversation',
    icon: Sparkles,
    category: 'Toggles',
    insertion: '/model ',
  },
  {
    id: 'pin',
    label: '/pin',
    description: 'Pin current conversation',
    icon: Pin,
    category: 'Toggles',
    insertion: '/pin',
  },
  {
    id: 'history',
    label: '/history',
    description: 'Open conversation history',
    icon: History,
    category: 'Navigation',
    insertion: '/history',
  },
];

const CATEGORY_ORDER: ReadonlyArray<SlashCommand['category']> = [
  'Navigation',
  'Run',
  'Create',
  'Toggles',
  'Help',
];

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export interface SlashCommandPopoverProps {
  query: string;
  onSelect: (insertion: string) => void;
  onClose: () => void;
}

export function SlashCommandPopover({ query, onSelect, onClose }: SlashCommandPopoverProps) {
  const setDraft = useCopilotStore((s) => s.setDraft);
  const clearDraft = useCopilotStore((s) => s.clearDraft);

  // Filter commands by query (case-insensitive substring on label).
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  }, [query]);

  // Group by category.
  const grouped = React.useMemo(() => {
    const out: Record<SlashCommand['category'], SlashCommand[]> = {
      Navigation: [],
      Run: [],
      Create: [],
      Toggles: [],
      Help: [],
    };
    for (const cmd of filtered) out[cmd.category].push(cmd);
    return out;
  }, [filtered]);

  // Flat list for keyboard navigation (only over visible commands).
  const flat = React.useMemo(() => {
    const out: SlashCommand[] = [];
    for (const cat of CATEGORY_ORDER) {
      out.push(...grouped[cat]);
    }
    return out;
  }, [grouped]);

  const [activeIndex, setActiveIndex] = React.useState(0);

  // Reset active index when filter changes.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keyboard navigation.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
      } else if (e.key === 'Enter') {
        const cmd = flat[activeIndex];
        if (cmd) {
          e.preventDefault();
          if (cmd.id === 'clear') {
            // Special — `/clear` actually clears the composer instead
            // of inserting text.
            clearDraft();
            onClose();
            return;
          }
          onSelect(cmd.insertion);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [flat, activeIndex, onSelect, onClose, clearDraft]);

  const active = flat[activeIndex];

  // Reset composer to "/" via empty insertion? No — the parent
  // already replaces the trailing "/<query>" with our insertion. We
  // simply call onSelect and let the parent compose the new value.

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      data-testid="copilot-slash-popover"
      className={cn(
        'absolute bottom-[calc(100%+4px)] left-0 z-30 flex w-[480px] max-w-[calc(100vw-32px)]',
        'overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]',
      )}
    >
      {/* Command list (left) */}
      <div className="flex w-1/2 flex-col gap-0.5 border-r border-[var(--border-subtle)] p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-[var(--text-xs)] text-[var(--fg-tertiary)]">
            No commands match “{query}”.
          </p>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const rows = grouped[cat];
            if (rows.length === 0) return null;
            return (
              <React.Fragment key={cat}>
                <h3 className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                  {cat}
                </h3>
                <ul role="group" aria-label={cat} className="flex flex-col gap-0.5">
                  {rows.map((cmd) => {
                    const isActive = active?.id === cmd.id;
                    const Icon = cmd.icon;
                    return (
                      <li key={cmd.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            if (cmd.id === 'clear') {
                              clearDraft();
                              onClose();
                              return;
                            }
                            onSelect(cmd.insertion);
                          }}
                          onMouseEnter={() => {
                            const idx = flat.findIndex((c) => c.id === cmd.id);
                            if (idx >= 0) setActiveIndex(idx);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[var(--text-xs)] transition-colors',
                            isActive
                              ? 'bg-[var(--accent-primary)]/15 text-[var(--fg-primary)]'
                              : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
                          )}
                          data-testid={`copilot-slash-cmd-${cmd.id}`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate font-medium">{cmd.label}</span>
                          {cmd.shortcut ? (
                            <span className="ml-auto rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 text-[10px] text-[var(--fg-tertiary)]">
                              {cmd.shortcut}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Preview pane (right) */}
      <div className="flex w-1/2 flex-col gap-2 p-3">
        {active ? (
          <>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)] text-[var(--accent-cyan)]"
              >
                <active.icon className="h-4 w-4" />
              </span>
              <span className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
                {active.label}
              </span>
            </div>
            <p className="text-[var(--text-xs)] text-[var(--fg-secondary)]">
              {active.description}
            </p>
            <div className="mt-auto flex items-center gap-1 text-[10px] text-[var(--fg-tertiary)]">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 font-mono">
                Enter
              </kbd>{' '}
              to select ·{' '}
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 font-mono">
                Esc
              </kbd>{' '}
              to close
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-center text-[var(--text-xs)] text-[var(--fg-tertiary)]">
            <div className="flex flex-col items-center gap-2">
              <Sparkles className="h-5 w-5 text-[var(--accent-cyan)]" aria-hidden="true" />
              <p>Type to filter commands.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Tiny helper re-export so callers can easily import Send or other
// icons from this module's barrel if needed.
export { Send, ArrowRight };
