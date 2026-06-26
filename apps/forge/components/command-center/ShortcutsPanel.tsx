'use client';

/**
 * ShortcutsPanel — ZONE 12 of the brief.
 *
 * Keyboard shortcut reference sheet. Opened from the header
 * sparkles icon or ⌘/. Modal dialog with grouped shortcuts.
 *
 * Skill influence: `06-keyboard-ux.md`.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCommandCenter } from '@/lib/command-center/store';

interface Shortcut {
  keys: string[];
  description: string;
}
interface Group {
  label: string;
  shortcuts: Shortcut[];
}

const GROUPS: Group[] = [
  {
    label: 'Global',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open command palette' },
      { keys: ['⌘', '/'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close drawer / dialog' },
    ],
  },
  {
    label: 'Modes',
    shortcuts: [
      { keys: ['⌘', '1'], description: 'Switch to Ticket mode' },
      { keys: ['⌘', '2'], description: 'Switch to Spec mode' },
      { keys: ['⌘', '3'], description: 'Switch to Catalog mode' },
    ],
  },
  {
    label: 'Actions',
    shortcuts: [
      { keys: ['⌘', 'T'], description: 'New ticket' },
      { keys: ['⌘', '⇧', 'S'], description: 'New spec' },
      { keys: ['⌘', 'R'], description: 'Run last command' },
      { keys: ['⌘', '⇧', 'P'], description: 'Forge-specific command palette' },
    ],
  },
  {
    label: 'Phases',
    shortcuts: [
      { keys: ['⌘', '1'], description: 'Spike / Discovery' },
      { keys: ['⌘', '2'], description: 'Plan' },
      { keys: ['⌘', '3'], description: 'Execute' },
      { keys: ['⌘', '4'], description: 'Verify' },
      { keys: ['⌘', '5'], description: 'Validate' },
      { keys: ['⌘', '6'], description: 'Audit' },
      { keys: ['⌘', '7'], description: 'Deploy' },
    ],
  },
];

export function ShortcutsPanel() {
  const { shortcutsOpen, setShortcutsOpen } = useCommandCenter();
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!shortcutsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShortcutsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen, setShortcutsOpen]);

  return (
    <AnimatePresence>
      {shortcutsOpen ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setShortcutsOpen(false)}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-1/2 z-50 w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]"
          >
            <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5 py-4">
              <span className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden />
                <h2
                  id="shortcuts-title"
                  className="text-md font-semibold text-[var(--fg-primary)]"
                >
                  Keyboard shortcuts
                </h2>
              </span>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close shortcuts"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>
            <div className="grid max-h-[70vh] gap-6 overflow-y-auto p-5 md:grid-cols-2">
              {GROUPS.map((g) => (
                <section key={g.label} className="space-y-2">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                    {g.label}
                  </h3>
                  <ul role="list" className="space-y-1">
                    {g.shortcuts.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
                      >
                        <span className="flex items-center gap-1">
                          {s.keys.map((k, ki) => (
                            <kbd
                              key={ki}
                              className={cn(
                                'inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-1.5 font-mono text-[10px] text-[var(--fg-primary)]',
                              )}
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                        <span className="text-xs text-[var(--fg-secondary)]">
                          {s.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="border-t border-[var(--border-subtle)] px-5 py-3 text-[10px] text-[var(--fg-tertiary)]">
              Press <kbd className="rounded bg-[var(--bg-inset)] px-1 font-mono">⌘/</kbd>{' '}
              anywhere to reopen this sheet.
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
