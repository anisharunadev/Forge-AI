'use client';

/**
 * Settings — Keyboard Shortcuts tab (Step-47 Enterprise section).
 *
 * Categorized list (Global / Navigation / Dashboard / Terminal /
 * Story management). Search input at top filters rows. "Reset to
 * defaults" reverts in-progress keybind edits. "Printable
 * cheatsheet" opens a Dialog with all shortcuts in copyable form.
 *
 * All bindings are mocked; customizations persist to localStorage
 * keyed by shortcut id.
 */

import * as React from 'react';
import { Search, RotateCcw, Printer, Copy, Check, KeyboardIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Category = 'global' | 'navigation' | 'dashboard' | 'terminal' | 'story';

interface Shortcut {
  id: string;
  keys: string; // ⌘K
  description: string;
  category: Category;
  customizable: boolean;
}

const DEFAULTS: ReadonlyArray<Shortcut> = [
  // Global
  { id: 'global.command-palette', keys: '⌘K', description: 'Open command palette', category: 'global', customizable: false },
  { id: 'global.copilot',         keys: '⌘J', description: 'Open Co-pilot', category: 'global', customizable: true },
  { id: 'global.shortcuts',       keys: '⌘/', description: 'Show keyboard shortcuts', category: 'global', customizable: false },
  // Navigation
  { id: 'nav.center-1',  keys: '⌘1', description: 'Go to Dashboard',     category: 'navigation', customizable: true },
  { id: 'nav.center-2',  keys: '⌘2', description: 'Go to Co-pilot',      category: 'navigation', customizable: true },
  { id: 'nav.center-3',  keys: '⌘3', description: 'Go to Connector Center', category: 'navigation', customizable: true },
  { id: 'nav.center-9',  keys: '⌘9', description: 'Go to Admin',         category: 'navigation', customizable: true },
  { id: 'nav.back',      keys: '⌘[', description: 'Back',                category: 'navigation', customizable: true },
  { id: 'nav.forward',   keys: '⌘]', description: 'Forward',             category: 'navigation', customizable: true },
  // Dashboard
  { id: 'dash.go',       keys: 'g d', description: 'Go to Dashboard',     category: 'dashboard', customizable: true },
  { id: 'dash.copilot',  keys: 'g c', description: 'Go to Co-pilot',      category: 'dashboard', customizable: true },
  // Terminal
  { id: 'term.new',      keys: '⌘T',   description: 'New session',         category: 'terminal', customizable: true },
  { id: 'term.close',    keys: '⌘⇧T', description: 'Close session',       category: 'terminal', customizable: true },
  { id: 'term.clear',    keys: '⌘L',  description: 'Clear output',        category: 'terminal', customizable: true },
  { id: 'term.palette',  keys: '⌘⇧P', description: 'Command palette',     category: 'terminal', customizable: true },
  // Story management
  { id: 'story.new',     keys: 's n', description: 'New story',           category: 'story', customizable: true },
  { id: 'story.edit',    keys: 's e', description: 'Edit current story',  category: 'story', customizable: true },
  { id: 'story.done',    keys: 's d', description: 'Mark story done',     category: 'story', customizable: true },
];

const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
  { id: 'global',     label: 'Global' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'terminal',   label: 'Terminal' },
  { id: 'story',      label: 'Story management' },
];

const STORAGE_KEY = 'forge.shortcuts.v1';

function loadBindings(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function KeyboardShortcutsTab() {
  const [bindings, setBindings] = React.useState<Record<string, string>>({});
  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [cheatsheetOpen, setCheatsheetOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    setBindings(loadBindings());
  }, []);

  const resolve = (s: Shortcut): string => bindings[s.id] ?? s.keys;

  const onSave = () => {
    if (!editing || !draft.trim()) {
      setEditing(null);
      return;
    }
    const next = { ...bindings, [editing]: draft.trim() };
    setBindings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* noop */
    }
    setEditing(null);
    setDraft('');
  };

  const onResetAll = () => {
    setBindings({});
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  };

  const matchesSearch = (s: Shortcut) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      s.description.toLowerCase().includes(q) ||
      s.keys.toLowerCase().includes(q) ||
      resolve(s).toLowerCase().includes(q)
    );
  };

  const visible = DEFAULTS.filter(matchesSearch);

  const cheatsheet = visible
    .map((s) => `${resolve(s).padEnd(10)}  ${s.description}`)
    .join('\n');

  const onCopyCheatsheet = async () => {
    try {
      await navigator.clipboard.writeText(cheatsheet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="shortcuts-tab">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
            Keyboard shortcuts
          </h2>
          <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Forge uses vim-style "g" + letter combos for navigation. Click any customizable
            shortcut to rebind it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onResetAll} data-testid="shortcuts-reset">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset to defaults
          </Button>
          <Button size="sm" onClick={() => setCheatsheetOpen(true)} data-testid="shortcuts-print">
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Printable cheatsheet
          </Button>
        </div>
      </header>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-tertiary)]"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shortcuts..."
          className="pl-9"
          data-testid="shortcuts-search"
        />
      </div>

      {CATEGORIES.map((cat) => {
        const items = visible.filter((s) => s.category === cat.id);
        if (items.length === 0) return null;
        return (
          <section
            key={cat.id}
            className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            data-testid={`shortcuts-cat-${cat.id}`}
          >
            <header className="border-b border-[var(--border-subtle)] px-5 py-3">
              <h3 className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
                {cat.label}
              </h3>
            </header>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {items.map((s) => {
                const editingThis = editing === s.id;
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                    data-testid={`shortcut-${s.id}`}
                  >
                    <span className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
                      {s.description}
                    </span>
                    <div className="flex items-center gap-2">
                      {editingThis ? (
                        <>
                          <Input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') onSave();
                              if (e.key === 'Escape') {
                                setEditing(null);
                                setDraft('');
                              }
                            }}
                            placeholder="press keys"
                            className="h-8 w-32 font-mono text-xs"
                            data-testid="shortcut-edit-input"
                          />
                          <Button size="sm" onClick={onSave} data-testid="shortcut-edit-save">
                            Save
                          </Button>
                        </>
                      ) : (
                        <>
                          <KbdCombo combo={resolve(s)} />
                          {s.customizable ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(s.id);
                                setDraft(resolve(s));
                              }}
                              className="text-[var(--text-xs)] text-[var(--accent-primary)] underline-offset-2 hover:underline"
                              data-testid={`shortcut-edit-${s.id}`}
                            >
                              Edit
                            </button>
                          ) : (
                            <span className="text-[11px] text-[var(--fg-tertiary)]">View only</span>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Dialog open={cheatsheetOpen} onOpenChange={setCheatsheetOpen}>
        <DialogContent className="max-w-[560px]" data-testid="shortcuts-cheatsheet">
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-2">
                <KeyboardIcon className="h-4 w-4" aria-hidden="true" />
                Printable cheatsheet
              </span>
            </DialogTitle>
            <DialogDescription>
              All visible shortcuts, formatted for printing or pasting into docs.
            </DialogDescription>
          </DialogHeader>
          <pre
            className="max-h-80 overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4 font-mono text-[var(--text-xs)] text-[var(--fg-secondary)]"
            data-testid="shortcuts-cheatsheet-body"
          >
            {cheatsheet || 'No shortcuts match your search.'}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={onCopyCheatsheet} data-testid="shortcuts-cheatsheet-copy">
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button onClick={() => setCheatsheetOpen(false)} data-testid="shortcuts-cheatsheet-close">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Kbd combo ---------------- */

function KbdCombo({ combo }: { combo: string }) {
  // Split "⌘⇧P" into ["⌘", "⇧", "P"]
  const parts = combo.match(/[⌘⇧⌥⌃]|[A-Za-z0-9]+|\[[\]]/g) ?? [combo];
  return (
    <span className="inline-flex items-center gap-1" aria-label={combo}>
      {parts.map((p, idx) => (
        <kbd
          key={`${p}-${idx}`}
          className={cn(
            'inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-1.5 font-mono text-[11px] font-semibold text-[var(--fg-primary)] shadow-[0_1px_0_var(--border-default)]',
          )}
          data-testid="shortcut-kbd"
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}
