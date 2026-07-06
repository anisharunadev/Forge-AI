'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/theme-provider';
import {
  Activity,
  ArrowRight,
  Compass,
  Home,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Sun,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ICONS, searchNav, type NavItem } from './nav-config';
import { useShell } from './ShellProvider';

/**
 * Command palette — global ⌘K overlay.
 *
 * Categories (rendered in this order, sticky to the scroll container):
 *   - Jump to    — nav pages, dynamic via `searchNav()`
 *   - Run        — frequent invocations (open copilot, open runs, etc.)
 *   - Create     — new resource actions
 *   - Toggle     — UI state switches (theme, sidebar, palette itself)
 *   - Help       — links to docs / shortcuts / changelog
 *
 * Keyboard model:
 *   - ↑/↓         navigate items (provided by `cmdk`)
 *   - Enter       select (provided by `cmdk`)
 *   - Esc         close the palette
 *   - ⌘K (Ctrl+K) toggle from anywhere (registered globally in ShellProvider)
 */
type Category = 'jump' | 'run' | 'create' | 'toggle' | 'help';

interface PaletteAction {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly keywords?: ReadonlyArray<string>;
  readonly icon: LucideIcon;
  readonly category: Category;
  readonly run: (helpers: PaletteHelpers) => void;
}

interface PaletteHelpers {
  readonly push: (href: string) => void;
  readonly toggleTheme: () => void;
  readonly toggleSidebar: () => void;
  readonly close: () => void;
}

const CATEGORY_LABELS: Record<Category, string> = {
  jump: 'Jump to',
  run: 'Run',
  create: 'Create',
  toggle: 'Toggle',
  help: 'Help',
};

const ACTIONS: ReadonlyArray<PaletteAction> = [
  // ---- Run ----
  {
    id: 'run-copilot',
    label: 'Open co-pilot',
    hint: '⌘J',
    keywords: ['ai', 'chat', 'assistant'],
    icon: Sparkles,
    category: 'run',
    run: ({ push, close }) => {
      push('/copilot');
      close();
    },
  },
  {
    id: 'run-runs',
    label: 'Open runs',
    hint: '⌘R',
    keywords: ['activity', 'history', 'log'],
    icon: Activity,
    category: 'run',
    run: ({ push, close }) => {
      push('/runs');
      close();
    },
  },
  {
    id: 'run-terminal',
    label: 'Open terminal',
    hint: '⌘`',
    keywords: ['shell', 'cli'],
    icon: TerminalSquare,
    category: 'run',
    run: ({ push, close }) => {
      push('/forge-terminal');
      close();
    },
  },
  {
    id: 'run-approvals',
    label: 'Open approvals queue',
    icon: Shield,
    category: 'run',
    keywords: ['governance', 'pending', 'review'],
    run: ({ push, close }) => {
      push('/governance-center');
      close();
    },
  },

  // ---- Create ----
  {
    id: 'create-agent',
    label: 'New agent',
    hint: 'N · A',
    keywords: ['bot', 'new'],
    icon: Sparkles,
    category: 'create',
    run: ({ push, close }) => {
      push('/agent-center');
      close();
    },
  },
  {
    id: 'create-connector',
    label: 'New connector',
    hint: 'N · C',
    keywords: ['integration', 'mcp'],
    icon: PlugZap,
    category: 'create',
    run: ({ push, close }) => {
      push('/connector-center');
      close();
    },
  },
  {
    id: 'create-idea',
    label: 'New idea',
    hint: 'N · I',
    keywords: ['prd', 'roadmap'],
    icon: Plus,
    category: 'create',
    run: ({ push, close }) => {
      push('/ideation');
      close();
    },
  },

  // ---- Toggle ----
  {
    id: 'toggle-theme',
    label: 'Toggle theme',
    icon: Sun,
    category: 'toggle',
    keywords: ['dark', 'light', 'appearance'],
    run: ({ toggleTheme, close }) => {
      toggleTheme();
      close();
    },
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle sidebar',
    icon: PanelLeftClose,
    category: 'toggle',
    keywords: ['collapse', 'expand', 'nav'],
    run: ({ toggleSidebar, close }) => {
      toggleSidebar();
      close();
    },
  },
  {
    id: 'toggle-palette',
    label: 'Close palette',
    hint: 'Esc',
    icon: Compass,
    category: 'toggle',
    run: ({ close }) => close(),
  },

  // ---- Help ----
  {
    id: 'help-shortcuts',
    label: 'Keyboard shortcuts',
    hint: '?',
    icon: Compass,
    category: 'help',
    run: ({ push, close }) => {
      push('/admin');
      close();
    },
  },
  {
    id: 'help-settings',
    label: 'Open settings',
    icon: SettingsIcon,
    category: 'help',
    keywords: ['admin', 'config'],
    run: ({ push, close }) => {
      push('/admin');
      close();
    },
  },
  {
    id: 'help-home',
    label: 'Back to dashboard',
    hint: 'G · H',
    icon: Home,
    category: 'help',
    run: ({ push, close }) => {
      push('/dashboard');
      close();
    },
  },
];

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, toggleSidebar } = useShell();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Reset query + active row when the palette closes so the next open
  // starts clean.
  React.useEffect(() => {
    if (!paletteOpen) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [paletteOpen]);

  const helpers: PaletteHelpers = React.useMemo(
    () => ({
      push: (href: string) => router.push(href),
      toggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      toggleSidebar,
      close: () => setPaletteOpen(false),
    }),
    [router, resolvedTheme, setTheme, toggleSidebar, setPaletteOpen],
  );

  // Dynamic nav matches (Jump to) only appear when the user types.
  const navMatches = React.useMemo(
    () => (query.trim() ? searchNav(query) : []),
    [query],
  );

  // Filter static actions by query (label + keywords).
  const actionMatches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIONS;
    return ACTIONS.filter((a) => {
      const hay = [a.label, ...(a.keywords ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  // Group filtered items by category, in canonical render order.
  const grouped = React.useMemo(() => {
    const order: Category[] = ['jump', 'run', 'create', 'toggle', 'help'];
    const map = new Map<Category, ReadonlyArray<PaletteAction | NavItem>>();
    if (query.trim()) {
      map.set('jump', navMatches);
    }
    for (const cat of order) {
      if (cat === 'jump') continue;
      const items = actionMatches.filter((a) => a.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    // Preserve order and drop empties.
    return order
      .filter((c) => map.has(c))
      .map((c) => ({ category: c, items: map.get(c) ?? [] }));
  }, [navMatches, actionMatches, query]);

  const totalItems = grouped.reduce((acc, g) => acc + g.items.length, 0);

  // Clamp active index when the list shrinks.
  React.useEffect(() => {
    if (activeIndex > totalItems - 1) setActiveIndex(Math.max(0, totalItems - 1));
  }, [totalItems, activeIndex]);

  // Scroll active row into view when navigating via keyboard.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-palette-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Listen for ↑/↓/Enter while palette is open. cmdk already handles
  // arrow keys on the input, so we only need to compute the right
  // active index. Enter is handled by cmdk's onSelect on each item.
  const handleInputKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (totalItems === 0 ? 0 : (i + 1) % totalItems));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (totalItems === 0 ? 0 : (i - 1 + totalItems) % totalItems));
      }
    },
    [totalItems],
  );

  // Build a flat index so we can compute the activeIndex for any row.
  let flatIndex = -1;

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent
        className={[
          // Layout
          'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'w-[min(640px,calc(100vw-32px))] max-h-[min(540px,calc(100vh-64px))]',
          // Surface
          'gap-0 overflow-hidden p-0',
          'border border-[var(--border-default)]',
          'bg-[var(--bg-elevated)]',
          'rounded-[var(--radius-xl)]',
          'shadow-[var(--shadow-lg)]',
        ].join(' ')}
        style={{ backgroundColor: 'var(--bg-elevated)' }}
        data-testid="command-palette"
      >
        {/* Search input */}
        <div className="flex h-12 items-center gap-2.5 border-b border-[var(--border-subtle)] px-4">
          <Compass className="h-4 w-4 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command or search…"
            autoFocus
            className="flex-1 bg-transparent text-[15px] text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
            aria-label="Search commands"
          />
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[420px] overflow-y-auto px-2 py-2"
        >
          {grouped.length === 0 ? (
            <EmptyState onPick={(text) => setQuery(text)} />
          ) : (
            grouped.map(({ category, items }) => (
              <div key={category} className="mb-1.5 last:mb-0">
                <p className="sticky top-0 z-10 px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)] bg-[var(--bg-elevated)]">
                  {CATEGORY_LABELS[category]}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const isActive = idx === activeIndex;
                    if (category === 'jump') {
                      const nav = item as NavItem;
                      const Icon = ICONS[nav.iconName];
                      return (
                        <li key={`jump-${nav.href}-${nav.label}`}>
                          <button
                            type="button"
                            data-palette-index={idx}
                            data-active={isActive ? 'true' : 'false'}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => {
                              router.push(nav.href);
                              setPaletteOpen(false);
                            }}
                            className={[
                              'flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm',
                              'transition-colors duration-150 ease-out-soft',
                              'focus:outline-none',
                              isActive
                                ? 'bg-[rgba(255,255,255,0.06)] text-[var(--fg-primary)]'
                                : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)]',
                            ].join(' ')}
                          >
                            <Icon className="h-4 w-4 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
                            <span className="flex-1 truncate font-medium">{nav.label}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    }
                    const action = item as PaletteAction;
                    const Icon = action.icon;
                    return (
                      <li key={`${category}-${action.id}`}>
                        <button
                          type="button"
                          data-palette-index={idx}
                          data-active={isActive ? 'true' : 'false'}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => action.run(helpers)}
                          className={[
                            'flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm',
                            'transition-colors duration-150 ease-out-soft',
                            'focus:outline-none',
                            isActive
                              ? 'bg-[rgba(255,255,255,0.06)] text-[var(--fg-primary)]'
                              : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)]',
                          ].join(' ')}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
                          <span className="flex-1 truncate font-medium">{action.label}</span>
                          {action.hint ? (
                            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
                              {action.hint}
                            </kbd>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex h-9 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 text-[11px] text-[var(--fg-tertiary)]">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px]">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px]">esc</kbd>
              close
            </span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
            Forge Agent OS
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Empty state — shown when the query yields no matches OR the user
 * has not typed yet (in which case totalItems is positive, so this
 * rarely surfaces). Surfaces three suggested chips to nudge discovery.
 */
function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    'Go to dashboard',
    'Toggle theme',
    'Open co-pilot',
  ];
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="text-sm text-[var(--fg-tertiary)]">
        Type a command or search…
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s.split(' ').slice(-1)[0] ?? s)}
            className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2.5 py-1 text-xs text-[var(--fg-secondary)] transition-colors duration-150 ease-out-soft hover:border-[var(--border-default)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}