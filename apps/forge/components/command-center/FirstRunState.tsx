'use client';

/**
 * FirstRunState — ZONE 13 of the brief.
 *
 * Welcome screen for new Command Center users. Three cards:
 * paste-a-ticket / new-spec / browse-commands. Skill: `08-empty-ux.md`
 * — never a blank screen, always a helpful action.
 */

import * as React from 'react';
import { Ticket, FileText, LayoutGrid, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { CommandCenterMode } from '@/lib/command-center/store';

interface FirstRunStateProps {
  onPick: (mode: CommandCenterMode) => void;
  onDismiss: () => void;
}

const CARDS: ReadonlyArray<{
  mode: CommandCenterMode;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  cta: string;
  accent: string;
}> = [
  {
    mode: 'ticket',
    icon: Ticket,
    title: 'Paste a ticket',
    body: 'Forge reads Jira, GitHub, or Linear tickets and orchestrates the rest of the SDLC.',
    cta: 'Open Ticket mode',
    accent: 'text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/15',
  },
  {
    mode: 'spec',
    icon: FileText,
    title: 'Start a new spec',
    body: 'Capture an idea, generate an AI plan, and execute phase-by-phase.',
    cta: 'Open Spec mode',
    accent: 'text-[var(--accent-violet)] bg-[var(--accent-violet)]/15',
  },
  {
    mode: 'catalog',
    icon: LayoutGrid,
    title: 'Browse commands',
    body: 'All forge-* skills grouped by phase. Power-user view.',
    cta: 'Open Catalog mode',
    accent: 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/15',
  },
];

export function FirstRunState({ onPick, onDismiss }: FirstRunStateProps) {
  return (
    <motion.section
      role="region"
      aria-labelledby="first-run-title"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      data-testid="fcc-first-run"
      className="space-y-5 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-violet)]">
            <Sparkles className="h-3 w-3" aria-hidden />
            Welcome to your workbench
          </p>
          <h2
            id="first-run-title"
            className="text-xl font-bold text-[var(--fg-primary)]"
          >
            Pick a starting point
          </h2>
          <p className="max-w-xl text-sm text-[var(--fg-secondary)]">
            Forge AI turns tickets, specs, and ideas into typed artifacts that
            move through a spec-driven pipeline. Choose how you want to begin.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="text-[var(--fg-tertiary)]"
        >
          Skip tour
        </Button>
      </header>

      <ul
        role="list"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        data-testid="fcc-first-run-cards"
      >
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <li key={c.mode}>
              <button
                type="button"
                onClick={() => onPick(c.mode)}
                data-testid={`fcc-first-run-${c.mode}`}
                className={cn(
                  'group flex h-full w-full flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 text-left transition-[border,transform,box-shadow] duration-200 ease-out-soft',
                  'hover:-translate-y-0.5 hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                )}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]',
                    c.accent,
                  )}
                  aria-hidden
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="text-md font-semibold text-[var(--fg-primary)]">
                  {c.title}
                </h3>
                <p className="text-sm text-[var(--fg-secondary)]">{c.body}</p>
                <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)]">
                  {c.cta} →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
