'use client';

/**
 * CommandPalette — ZONE 12 of the brief.
 *
 * ⌘K palette. Fuzzy-search across forge-* skills + tickets + specs.
 * Up/Down/Enter navigation; Esc closes.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, ArrowRight, X, Command } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Icon } from '@/lib/command-center/icons';
import { useCommandCenter } from '@/lib/command-center/store';
import {
  FORGE_SKILLS,
  type ForgeSkill,
} from '@/lib/forge-core/manifest';
import { PHASE_ACCENT } from '@/lib/command-center/theme';
import { SAMPLE_SPECS, SAMPLE_TICKETS } from '@/lib/command-center/sample-data';

type PaletteItem =
  | { kind: 'skill'; skill: ForgeSkill }
  | { kind: 'ticket'; id: string; title: string }
  | { kind: 'spec'; id: string; title: string };

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, setMode } =
    useCommandCenter();
  const [query, setQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setHighlight(0);
      // Defer focus to next tick so the dialog mounts first.
      const id = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [commandPaletteOpen]);

  const items: PaletteItem[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [
        ...FORGE_SKILLS.slice(0, 5).map((s) => ({ kind: 'skill' as const, skill: s })),
        ...SAMPLE_TICKETS.slice(0, 3).map((t) => ({
          kind: 'ticket' as const,
          id: t.id,
          title: t.title,
        })),
        ...SAMPLE_SPECS.slice(0, 3).map((s) => ({
          kind: 'spec' as const,
          id: s.id,
          title: s.title,
        })),
      ];
    }
    const out: PaletteItem[] = [];
    for (const s of FORGE_SKILLS) {
      if (
        s.id.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      ) {
        out.push({ kind: 'skill', skill: s });
        if (out.length >= 8) break;
      }
    }
    for (const t of SAMPLE_TICKETS) {
      if (
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q)
      ) {
        out.push({ kind: 'ticket', id: t.id, title: t.title });
        if (out.length >= 12) break;
      }
    }
    for (const s of SAMPLE_SPECS) {
      if (
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q)
      ) {
        out.push({ kind: 'spec', id: s.id, title: s.title });
        if (out.length >= 16) break;
      }
    }
    return out;
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[highlight];
      if (!item) return;
      if (item.kind === 'skill') {
        setMode('catalog');
        setCommandPaletteOpen(false);
        return;
      }
      if (item.kind === 'ticket') {
        setMode('ticket');
        setCommandPaletteOpen(false);
        return;
      }
      setMode('spec');
      setCommandPaletteOpen(false);
    } else if (e.key === 'Escape') {
      setCommandPaletteOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {commandPaletteOpen ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={() => setCommandPaletteOpen(false)}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-24 z-[61] w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-3">
              <Search className="h-4 w-4 text-[var(--fg-tertiary)]" aria-hidden />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onKey}
                placeholder="Search commands, tickets, specs..."
                className="border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                data-testid="fcc-palette-input"
              />
              <span className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
                <Command className="h-3 w-3" aria-hidden />K
              </span>
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(false)}
                aria-label="Close palette"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <ul
              role="listbox"
              className="max-h-[60vh] overflow-y-auto p-1"
              data-testid="fcc-palette-list"
            >
              {items.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-[var(--fg-tertiary)]">
                  No matches. Try a different query.
                </li>
              ) : null}
              {items.map((item, i) => {
                const isActive = i === highlight;
                if (item.kind === 'skill') {
                  const accent = PHASE_ACCENT[item.skill.phase];
                  return (
                    <li key={`s-${item.skill.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => {
                          setMode('catalog');
                          setCommandPaletteOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors',
                          isActive
                            ? 'bg-[var(--accent-primary)]/10'
                            : 'hover:bg-[var(--bg-inset)]',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)]',
                              accent.bg,
                              accent.fg,
                            )}
                            aria-hidden
                          >
                            <Icon name={item.skill.icon} className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--fg-primary)]">
                              {item.skill.label}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
                              /{item.skill.id}
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span
                            className={cn(
                              'rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                              accent.chip,
                            )}
                          >
                            {accent.label}
                          </span>
                          <ArrowRight className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden />
                        </span>
                      </button>
                    </li>
                  );
                }
                if (item.kind === 'ticket') {
                  return (
                    <li key={`t-${item.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => {
                          setMode('ticket');
                          setCommandPaletteOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors',
                          isActive
                            ? 'bg-[var(--accent-primary)]/10'
                            : 'hover:bg-[var(--bg-inset)]',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]">
                            <Icon name="Ticket" className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--fg-primary)]">
                              {item.title}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
                              {item.id}
                            </span>
                          </span>
                        </span>
                        <ArrowRight className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden />
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={`sp-${item.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => {
                        setMode('spec');
                        setCommandPaletteOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors',
                        isActive
                          ? 'bg-[var(--accent-primary)]/10'
                          : 'hover:bg-[var(--bg-inset)]',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-violet)]/15 text-[var(--accent-violet)]">
                          <Icon name="FileText" className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[var(--fg-primary)]">
                            {item.title}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
                            {item.id}
                          </span>
                        </span>
                      </span>
                      <ArrowRight className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            <footer className="border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--fg-tertiary)]">
              <span className="flex items-center gap-2">
                <kbd className="rounded bg-[var(--bg-inset)] px-1 font-mono">↑↓</kbd>
                navigate
                <kbd className="rounded bg-[var(--bg-inset)] px-1 font-mono">↵</kbd>
                select
                <kbd className="rounded bg-[var(--bg-inset)] px-1 font-mono">esc</kbd>
                close
              </span>
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
