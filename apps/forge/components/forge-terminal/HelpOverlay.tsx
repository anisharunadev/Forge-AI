'use client';

/**
 * Terminal — Help overlay (Step 36 / Fix 1).
 *
 * Replaces the always-visible TIPS + KEYBOARD cards. Opens via:
 *   - the toolbar help icon
 *   - ⌘+? (Cmd/Ctrl + ?) globally
 *   - the help indicator on the status bar
 *
 * Three tabs:
 *   - Tips     — what was on the static TIPS card.
 *   - Keyboard — searchable, copyable, grouped shortcut list.
 *   - About    — sidecar status, version, "How to start the sidecar".
 *
 * Skill influence:
 *   - ux-guideline (focus states) — Radix Dialog traps focus; Esc closes.
 *   - ux-guideline (loading indicators) — empty-state copy for the
 *     search-no-results case.
 */

import * as React from 'react';
import {
  BookOpen,
  Copy,
  Check,
  Keyboard as KeyboardIcon,
  Lightbulb,
  Info,
  Search as SearchIcon,
  X,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface Shortcut {
  keys: string;
  label: string;
  category: 'Sessions' | 'Search & Edit' | 'Rails & Help' | 'Layout';
}

const SHORTCUTS: ReadonlyArray<Shortcut> = [
  // Sessions
  { keys: 'Ctrl+Shift+T',     label: 'New session',          category: 'Sessions' },
  { keys: 'Ctrl+Shift+W',     label: 'Close active session', category: 'Sessions' },
  { keys: 'Ctrl+Tab',         label: 'Next session',         category: 'Sessions' },
  { keys: 'Ctrl+Shift+Tab',   label: 'Previous session',     category: 'Sessions' },
  { keys: 'Ctrl+1..9',        label: 'Jump to session N',    category: 'Sessions' },

  // Search & Edit
  { keys: 'Ctrl+Shift+F',     label: 'Search scrollback',    category: 'Search & Edit' },
  { keys: 'Ctrl+Shift+C',     label: 'Copy selection',       category: 'Search & Edit' },
  { keys: 'Ctrl+Shift+V',     label: 'Paste from clipboard', category: 'Search & Edit' },
  { keys: 'Ctrl+L',           label: 'Clear scrollback',     category: 'Search & Edit' },

  // Rails & Help
  { keys: '⌘1 / Ctrl+1',      label: 'Toggle Sessions rail', category: 'Rails & Help' },
  { keys: '⌘2 / Ctrl+2',      label: 'Toggle Context rail',  category: 'Rails & Help' },
  { keys: '⌘3 / Ctrl+3',      label: 'Toggle Skills rail',   category: 'Rails & Help' },
  { keys: '⌘4 / Ctrl+4',      label: 'Toggle Commands rail', category: 'Rails & Help' },
  { keys: '⌘5 / Ctrl+5',      label: 'Toggle Audit rail',    category: 'Rails & Help' },
  { keys: '⌘0 / Ctrl+0',      label: 'Collapse all rails',   category: 'Rails & Help' },
  { keys: '⌘Shift+0',         label: 'Expand all rails',     category: 'Rails & Help' },
  { keys: '⌘? / Ctrl+?',      label: 'Open this Help dialog',category: 'Rails & Help' },
  { keys: 'Ctrl+Shift+P',     label: 'Forge Command Palette',category: 'Rails & Help' },

  // Layout
  { keys: 'Ctrl+Shift+M',     label: 'Toggle focus mode (Zen)', category: 'Layout' },
  { keys: 'Esc',              label: 'Exit focus mode',      category: 'Layout' },
];

const SHORTCUT_CATEGORIES: ReadonlyArray<Shortcut['category']> = [
  'Sessions',
  'Search & Edit',
  'Rails & Help',
  'Layout',
];

interface Tip {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}

const TIPS: ReadonlyArray<Tip> = [
  {
    icon: Lightbulb,
    text: 'Drag session tabs to reorder — the same drag handles work on touch and keyboard.',
  },
  {
    icon: BookOpen,
    text: 'Click any row in the Audit rail to jump that session and flash the matching command in the terminal.',
  },
  {
    icon: KeyboardIcon,
    text: 'Press ⌘0 to collapse every rail — terminal-only mode for focused work. Press ⌘? any time for shortcuts.',
  },
  {
    icon: Info,
    text: 'Right-click a rail icon to pin/unpin that section open.',
  },
];

interface HelpOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sidecar endpoint to surface in the About tab. */
  endpoint?: string;
}

export function HelpOverlay({ open, onOpenChange, endpoint }: HelpOverlayProps) {
  const [query, setQuery] = React.useState('');
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  // Reset the search filter when the dialog reopens.
  React.useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUTS;
    return SHORTCUTS.filter(
      (s) =>
        s.keys.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q),
    );
  }, [query]);

  const copyKey = React.useCallback((keys: string) => {
    void navigator.clipboard.writeText(keys).then(() => {
      setCopiedKey(keys);
      window.setTimeout(() => setCopiedKey(null), 1100);
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl gap-0 p-0"
        data-testid="terminal-help-overlay"
      >
        <DialogHeader className="border-b border-[var(--border-subtle)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            Forge Terminal — Help
          </DialogTitle>
          <DialogDescription className="text-xs">
            Tips, keyboard shortcuts, and sidecar info — all in one place.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="tips" className="w-full">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5">
            <TabsList className="h-9 bg-transparent">
              <TabsTrigger value="tips" className="gap-1.5 text-xs" data-testid="help-tab-tips">
                <Lightbulb className="h-3 w-3" aria-hidden="true" />
                Tips
              </TabsTrigger>
              <TabsTrigger
                value="keyboard"
                className="gap-1.5 text-xs"
                data-testid="help-tab-keyboard"
              >
                <KeyboardIcon className="h-3 w-3" aria-hidden="true" />
                Keyboard
              </TabsTrigger>
              <TabsTrigger value="about" className="gap-1.5 text-xs" data-testid="help-tab-about">
                <Info className="h-3 w-3" aria-hidden="true" />
                About
              </TabsTrigger>
            </TabsList>
            <span className="font-mono text-[10px] text-[var(--fg-muted)]">⌘?</span>
          </div>

          <ScrollArea className="max-h-[60vh]">
            {/* TIPS TAB */}
            <TabsContent value="tips" className="m-0 px-5 py-4">
              <ul className="space-y-3" data-testid="help-tips-list">
                {TIPS.map((tip, i) => {
                  const Icon = tip.icon;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5"
                    >
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--accent-cyan)]">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">
                        {tip.text}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>

            {/* KEYBOARD TAB */}
            <TabsContent value="keyboard" className="m-0">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 py-2">
                <div className="relative">
                  <SearchIcon
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--fg-muted)]"
                    aria-hidden="true"
                  />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search shortcuts…"
                    data-testid="help-search-input"
                    className={cn(
                      'h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-7 pr-2',
                      'text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]',
                      'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
                    )}
                  />
                </div>
              </div>
              <div className="px-5 py-3" data-testid="help-shortcuts">
                {filtered.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[var(--fg-muted)]">
                    No shortcuts match “{query}”.
                  </p>
                ) : (
                  SHORTCUT_CATEGORIES.map((cat) => {
                    const rows = filtered.filter((s) => s.category === cat);
                    if (rows.length === 0) return null;
                    return (
                      <section key={cat} className="mb-4">
                        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
                          {cat}
                        </h3>
                        <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 text-xs">
                          {rows.map((s) => (
                            <React.Fragment key={s.keys + s.label}>
                              <dt className="font-mono text-[var(--fg-primary)]">{s.keys}</dt>
                              <dd className="text-[var(--fg-secondary)]">{s.label}</dd>
                              <dd className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => copyKey(s.keys)}
                                  aria-label={`Copy ${s.keys}`}
                                  data-testid={`help-copy-${s.keys}`}
                                  className="rounded p-0.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
                                >
                                  {copiedKey === s.keys ? (
                                    <Check className="h-3 w-3 text-[var(--accent-emerald)]" aria-hidden="true" />
                                  ) : (
                                    <Copy className="h-3 w-3" aria-hidden="true" />
                                  )}
                                </button>
                              </dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      </section>
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* ABOUT TAB */}
            <TabsContent value="about" className="m-0 px-5 py-4" data-testid="help-about">
              <AboutPanel endpoint={endpoint} onClose={() => onOpenChange(false)} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AboutPanel({
  endpoint,
  onClose,
}: {
  endpoint?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const copyEndpoint = () => {
    if (!endpoint) return;
    void navigator.clipboard.writeText(endpoint).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    });
  };

  return (
    <div className="space-y-4 text-xs">
      <section>
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
          Sidecar
        </h3>
        <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
          <code className="font-mono text-[var(--fg-primary)]">{endpoint ?? 'ws://localhost:4001'}</code>
          <Button
            size="sm"
            variant="ghost"
            onClick={copyEndpoint}
            disabled={!endpoint}
            className="h-7 px-2 text-xs"
            data-testid="help-about-copy-endpoint"
          >
            {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
          </Button>
        </div>
        <p className="mt-1.5 text-[var(--fg-tertiary)]">
          The Forge Terminal connects to a local PTY sidecar. If you see a
          “disconnected” status, the sidecar isn’t running yet.
        </p>
      </section>

      <section>
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
          How to start the sidecar
        </h3>
        <ul className="space-y-1.5 font-mono text-[11px] text-[var(--fg-secondary)]">
          <li className="rounded-md bg-[var(--bg-surface)] px-2.5 py-1.5">
            <span className="text-[var(--fg-muted)]"># sidecar only</span>
            <br />
            <span className="text-[var(--accent-emerald)]">pnpm dev:terminal</span>
          </li>
          <li className="rounded-md bg-[var(--bg-surface)] px-2.5 py-1.5">
            <span className="text-[var(--fg-muted)]"># full stack (API + sidecar + UI)</span>
            <br />
            <span className="text-[var(--accent-emerald)]">pnpm dev:stack</span>
          </li>
        </ul>
      </section>

      <section className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-[10px] text-[var(--fg-muted)]">
        <span>Forge Terminal · v2.0.0 · xterm.js</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-7 gap-1 px-2 text-xs"
          data-testid="help-about-close"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          Close
        </Button>
      </section>
    </div>
  );
}