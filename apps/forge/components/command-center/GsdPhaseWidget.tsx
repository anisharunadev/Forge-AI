'use client';

/**
 * GsdPhaseWidget — ZONE 7 of the brief.
 *
 * Floating beacon (bottom-left) that shows the current GSD phase
 * + a mini pipeline indicator. Click expands a small panel with the
 * full phase list. Designed to feel like a Slack / HelpScout beacon.
 *
 * Skill influence:
 *   - `02-typography.md` — mono for IDs.
 *   - `06-keyboard-ux.md` — Esc closes, focus rings.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp, X, Sparkles, ListChecks } from 'lucide-react';
import { Icon } from '@/lib/command-center/icons';
import { cn } from '@/lib/utils';
import { FORGE_PHASES } from '@/lib/forge-core/manifest';
import { PHASE_ACCENT } from '@/lib/command-center/theme';
import { useCommandCenter } from '@/lib/command-center/store';

export function GsdPhaseWidget() {
  const { activePhase, setActivePhase } = useCommandCenter();
  const [expanded, setExpanded] = React.useState(false);

  const currentMeta = FORGE_PHASES.find((p) => p.id === activePhase)!;
  const accent = PHASE_ACCENT[activePhase];

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-30 flex flex-col items-start gap-2"
      data-testid="fcc-phase-widget"
    >
      <AnimatePresence>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-label="GSD Phase widget"
            className="pointer-events-auto w-[320px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]"
          >
            <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
              <span className="flex items-center gap-2">
                <Sparkles className="h-3 w-3 text-[var(--accent-violet)]" aria-hidden />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                  GSD Pipeline
                </p>
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Collapse widget"
                className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </header>
            <ol role="list" className="space-y-1 p-2">
              {FORGE_PHASES.map((p) => {
                const isActive = p.id === activePhase;
                const a = PHASE_ACCENT[p.id];
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActivePhase(p.id);
                        setExpanded(false);
                      }}
                      data-testid={`fcc-widget-phase-${p.id}`}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors',
                        isActive
                          ? cn('bg-[var(--bg-inset)]', a.fg)
                          : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)]',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full',
                          a.bg,
                          a.fg,
                        )}
                        aria-hidden
                      >
                        <Icon name={p.icon} className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{p.label}</p>
                        <p className="truncate text-[10px] text-[var(--fg-tertiary)]">
                          {p.description}
                        </p>
                      </span>
                      {isActive ? (
                        <span className="rounded-full bg-[var(--accent-cyan)]/15 px-2 py-0.5 font-mono text-[10px] text-[var(--accent-cyan)]">
                          ⌘{FORGE_PHASES.findIndex((x) => x.id === p.id) + 1}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-[var(--fg-tertiary)] opacity-0 group-hover:opacity-100">
                          ⌘{FORGE_PHASES.findIndex((x) => x.id === p.id) + 1}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
            <footer className="border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--fg-tertiary)]">
              <span className="flex items-center gap-1">
                <ListChecks className="h-3 w-3" aria-hidden />
                All work routes through the pipeline.
              </span>
            </footer>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`Current phase: ${currentMeta.label}. Click to expand.`}
        data-testid="fcc-phase-widget-toggle"
        className={cn(
          'pointer-events-auto flex items-center gap-3 rounded-full border bg-[var(--bg-elevated)] py-1.5 pl-1.5 pr-4 shadow-[var(--shadow-md)] transition-[box-shadow,transform] duration-200 ease-out-soft',
          'hover:shadow-[0_8px_24px_rgba(0,0,0,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          accent.ring,
        )}
      >
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full',
            accent.bg,
            accent.fg,
          )}
          aria-hidden
        >
          <Icon name={currentMeta.icon} className="h-4 w-4" />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            GSD · {currentMeta.label}
          </span>
          <span className="text-xs font-semibold text-[var(--fg-primary)]">
            {currentMeta.short}{' '}
            <span className="font-mono text-[10px] font-normal text-[var(--fg-tertiary)]">
              · ⌘1-7 to jump
            </span>
          </span>
        </span>
        <ChevronUp
          className={cn(
            'h-3.5 w-3.5 text-[var(--fg-tertiary)] transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}
