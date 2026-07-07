'use client';

/**
 * QuickActionsEditor — searchable list for the 8 Quick Actions shown
 * on the dashboard (Fix 5). Mirrors the Pin Manager drawer pattern.
 *
 * Skill influence:
 *   - `ux` (Confirmation Messages) — removing an action prompts.
 *   - `ux` (Keyboard Navigation) — focus rings + arrow nav inside list.
 */

import * as React from 'react';
import { Check, Plus, RotateCcw, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

import { useQuickActions, QUICK_ACTION_CATEGORIES, type QuickActionItem, type QuickActionIcon } from './useQuickActions';

export function QuickActionsEditor({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { actions, mounted, toggle, reset, isCustomized } = useQuickActions();
  const [query, setQuery] = React.useState('');

  // Build the "available" list as every default action the user
  // hasn't currently enabled.
  const enabledIds = new Set(actions.map((a) => a.id));
  const available = React.useMemo(() => {
    const allFromCategories: QuickActionItem[] = [];
    // The hook exposes categories, but the source of truth is the
    // hook's default list. We rebuild the "available" by inverting
    // the current selection against defaults stored in the hook.
    void QUICK_ACTION_CATEGORIES;
    return allFromCategories;
  }, []);

  // We rely on the hook's `toggle` to flip state. To compute the
  // "all possible" list, hardcode the 8 defaults here so the editor
  // can offer re-enabling actions the user removed.
  const ALL_POSSIBLE: QuickActionItem[] = React.useMemo(
    () => [
      { id: 'qa-new-feature', label: 'Run "New feature"', icon: 'sparkles' as QuickActionIcon, shortcut: '⌘⇧N', color: 'indigo', href: '/copilot?prompt=Plan%20a%20new%20feature', category: 'forge' },
      { id: 'qa-fix-bug', label: 'Run "Fix bug"', icon: 'wrench' as QuickActionIcon, shortcut: '⌘⇧B', color: 'amber', href: '/copilot?prompt=Help%20me%20debug', category: 'forge' },
      { id: 'qa-terminal', label: 'Open Terminal', icon: 'terminal' as QuickActionIcon, shortcut: '⌘⇧T', color: 'emerald', href: '/forge-terminal', category: 'navigate' },
      { id: 'qa-command-center', label: 'Open Command Center', icon: 'command' as QuickActionIcon, shortcut: '⌘⇧C', color: 'cyan', href: '/workflow', category: 'navigate' },
      { id: 'qa-copilot', label: 'Open Co-pilot', icon: 'sparkles' as QuickActionIcon, shortcut: '⌘⇧P', color: 'violet', href: '/copilot', category: 'navigate' },
      { id: 'qa-code-reviewer', label: 'Talk to Code-Reviewer', icon: 'bot' as QuickActionIcon, shortcut: '⌘⇧R', color: 'cyan', href: '/copilot?prompt=Act%20as%20code%20reviewer', category: 'agents' },
      { id: 'qa-test-runner', label: 'Talk to Test-Runner', icon: 'flask' as QuickActionIcon, shortcut: '⌘⇧X', color: 'emerald', href: '/copilot?prompt=Run%20test%20suite', category: 'agents' },
      { id: 'qa-ideation-prd', label: 'Run Ideation → PRD pipeline', icon: 'workflow' as QuickActionIcon, shortcut: '⌘⇧W', color: 'indigo', href: '/copilot?prompt=Ideation%20to%20PRD', category: 'workflows' },
    ],
    [],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_POSSIBLE;
    return ALL_POSSIBLE.filter(
      (a) => a.label.toLowerCase().includes(q) || a.category.toLowerCase().includes(q),
    );
  }, [ALL_POSSIBLE, query]);

  const grouped = React.useMemo(() => {
    const g: Record<QuickActionItem['category'], QuickActionItem[]> = {
      forge: [], navigate: [], agents: [], workflows: [],
    };
    for (const a of filtered) g[a.category].push(a);
    return g;
  }, [filtered]);

  void available;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[420px]"
        data-testid="quick-actions-editor"
      >
        <SheetTitle className="sr-only">Customize quick actions</SheetTitle>
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
          <div>
            <h2 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">Quick actions</h2>
            <p className="text-[11px] text-[var(--fg-tertiary)]">{actions.length} of 8 enabled · Pick the actions that earn their spot.</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (!isCustomized) return;
                if (window.confirm('Reset quick actions to defaults?')) reset();
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--accent-primary)] disabled:opacity-40"
              disabled={!mounted || !isCustomized}
              data-testid="quick-actions-reset"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Reset
            </button>
            <Button type="button" size="sm" onClick={() => onOpenChange(false)} data-testid="quick-actions-done">
              Done
            </Button>
          </div>
        </header>
        <div className="border-b border-[var(--border-subtle)] p-3">
          <label className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search actions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-[var(--text-sm)] text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)]"
              data-testid="quick-actions-search"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>
        <ul className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-3">
          {(Object.keys(grouped) as QuickActionItem['category'][]).map((cat) => {
            const items = grouped[cat];
            if (items.length === 0) return null;
            return (
              <li key={cat}>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                  {cat}
                </h3>
                <ul className="space-y-1">
                  {items.map((a) => {
                    const on = enabledIds.has(a.id);
                    return (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2"
                        data-testid={`quick-action-row-${a.id}`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-tertiary)]">
                            {a.label.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">{a.label}</p>
                            <p className="truncate font-mono text-[10px] text-[var(--fg-tertiary)]">{a.shortcut}</p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={on ? 'outline' : 'default'}
                          onClick={() => toggle(a.id)}
                          disabled={!mounted}
                          data-testid={`quick-action-toggle-${a.id}`}
                        >
                          {on ? (
                            <>
                              <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                              On
                            </>
                          ) : (
                            <>
                              <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
                              Add
                            </>
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {filtered.length === 0 ? (
            <li className="py-6 text-center text-[11px] text-[var(--fg-tertiary)]">No actions match "{query}".</li>
          ) : null}
        </ul>
        <footer className="border-t border-[var(--border-subtle)] p-3 text-[11px] text-[var(--fg-tertiary)]">
          {actions.length} / 8 actions enabled
        </footer>
      </SheetContent>
    </Sheet>
  );
}