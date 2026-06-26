'use client';

/**
 * Keyboard shortcuts help modal (Step 38, Fix 10).
 *
 * ⌘/  → opens this dialog.
 *
 * Renders every platform-aware shortcut (⌘ on macOS, Ctrl elsewhere)
 * in a three-column grid. The dialog is uncontrolled so the keyboard
 * layer above can flip `open` from anywhere in the tree.
 */

import * as React from 'react';
import { Keyboard, Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ShortcutsHelpProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

interface ShortcutEntry {
  readonly id: string;
  readonly label: string;
  readonly keys: ReadonlyArray<readonly [boolean, string]>; // [isMac, key]
  readonly hint?: string;
}

const ENTRIES: ReadonlyArray<ShortcutEntry> = [
  { id: 'pal', label: 'Open command palette', keys: [[true, '⌘'], [true, 'K']] },
  { id: 'cpl', label: 'Open co-pilot', keys: [[true, '⌘'], [true, 'J']] },
  { id: 'ter', label: 'Open terminal', keys: [[true, '⌘'], [true, '`']] },
  { id: 'hme', label: 'Go to dashboard', keys: [[true, 'G'], [true, 'H']] },
  { id: 'pjt', label: 'New project', keys: [[true, '⌘'], [true, '⇧'], [true, 'P']] },
  { id: 'sto', label: 'New story', keys: [[true, '⌘'], [true, '⇧'], [true, 'S']] },
  { id: 'imp', label: 'Start implementation', keys: [[true, '⌘'], [true, '⇧'], [true, 'T']], hint: 'On a focused story card' },
  { id: 'shh', label: 'Open this help', keys: [[true, '⌘'], [true, '/']], hint: 'You are here' },
  { id: 'sb', label: 'Toggle sidebar', keys: [[true, '⌘'], [true, '[']] },
  { id: 'esc', label: 'Close drawer / dialog', keys: [[true, 'Esc']] },
];

function renderKey(token: readonly [boolean, string]): string {
  return token[1];
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const [query, setQuery] = React.useState('');
  const [mac, setMac] = React.useState(true);

  React.useEffect(() => {
    setMac(isMacPlatform());
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ENTRIES;
    return ENTRIES.filter((e) => e.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[min(640px,calc(100vw-32px))] max-h-[min(560px,calc(100vh-64px))] gap-0 overflow-hidden p-0',
          'border border-[var(--border-default)] bg-[var(--bg-surface)]',
        )}
        data-testid="shortcuts-help"
      >
        <DialogHeader className="border-b border-[var(--border-subtle)] px-6 py-4">
          <DialogTitle className="inline-flex items-center gap-2 text-base font-semibold text-[var(--fg-primary)]">
            <Keyboard size={14} aria-hidden="true" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--fg-secondary)]">
            Every shortcut in Forge. {mac ? 'Showing ⌘ bindings (macOS).' : 'Showing Ctrl bindings.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-11 items-center gap-2 border-b border-[var(--border-subtle)] px-4">
          <Search size={12} aria-hidden="true" className="text-[var(--fg-tertiary)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            autoFocus
            className="flex-1 bg-transparent text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
          />
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
            Esc
          </kbd>
        </div>

        <ul className="thin-scrollbar grid max-h-[400px] grid-cols-1 gap-0.5 overflow-y-auto p-2 md:grid-cols-2">
          {filtered.length === 0 ? (
            <li className="col-span-2 px-3 py-8 text-center text-xs text-[var(--fg-tertiary)]">
              No shortcuts match "{query}"
            </li>
          ) : null}
          {filtered.map((e) => (
            <li
              key={e.id}
              data-testid={`shortcut-${e.id}`}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2',
                'hover:bg-[var(--hover)]',
              )}
            >
              <span className="flex-1 truncate text-xs text-[var(--fg-primary)]">
                {e.label}
                {e.hint ? (
                  <span className="ml-1 text-[10px] text-[var(--fg-tertiary)]">· {e.hint}</span>
                ) : null}
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5">
                {e.keys.map((token, i) => {
                  const isMod = token[0] && (token[1] === '⌘' || token[1] === 'Ctrl');
                  const display = !isMod && mac ? token[1] : token[1];
                  // For non-mac, swap ⌘ for Ctrl
                  const shown = mac ? token[1] : token[1].replace('⌘', 'Ctrl');
                  return (
                    <React.Fragment key={i}>
                      <kbd
                        className={cn(
                          'inline-flex min-w-[22px] items-center justify-center rounded border bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono',
                          isMod
                            ? 'border-[var(--accent-primary)]/40 text-[var(--accent-primary)]'
                            : 'border-[var(--border-subtle)] text-[var(--fg-secondary)]',
                        )}
                      >
                        {shown}
                      </kbd>
                      {i < e.keys.length - 1 ? (
                        <span aria-hidden="true" className="text-[10px] text-[var(--fg-tertiary)]">
                          +
                        </span>
                      ) : null}
                      {/* unused-var lint */}
                      {renderKey(token) /* eslint-disable-line @typescript-eslint/no-unused-vars */}
                    </React.Fragment>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
