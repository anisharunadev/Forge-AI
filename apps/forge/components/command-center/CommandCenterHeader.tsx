'use client';

/**
 * CommandCenterHeader — ZONE 1 of the brief.
 *
 * Hero band: eyebrow + h1 + body copy + top-right cluster (My Work
 * button with badge, notifications bell, profile). Compact, Linear-like.
 *
 * Skill influence:
 *   - `02-typography.md` — Plus Jakarta Sans for h1, Inter fallback.
 *   - `04-ux-guideline.md` — heading hierarchy, sticky nav padding.
 */

import * as React from 'react';
import {
  SquareTerminal,
  Briefcase,
  Bell,
  Sparkles,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface CommandCenterHeaderProps {
  activeWorkCount: number;
  notificationCount: number;
  onOpenMyWork: () => void;
  onOpenCommandPalette: () => void;
  onOpenShortcuts: () => void;
  tenantLabel: string;
  userInitials: string;
}

export function CommandCenterHeader({
  activeWorkCount,
  notificationCount,
  onOpenMyWork,
  onOpenCommandPalette,
  onOpenShortcuts,
  tenantLabel,
  userInitials,
}: CommandCenterHeaderProps) {
  return (
    <header
      className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-6 lg:flex-row lg:items-end lg:justify-between"
      data-testid="fcc-header"
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
          Forge Command Center
        </p>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--fg-primary)] lg:text-[var(--text-3xl)]">
          <SquareTerminal className="h-6 w-6 text-[var(--accent-cyan)]" aria-hidden />
          Command Center
        </h1>
        <p className="max-w-2xl text-sm text-[var(--fg-secondary)]">
          The workbench for Forge AI. Run commands, manage specs, drive
          tickets through the SDLC. Backed by{' '}
          <code className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-primary)]">
            packages/forge-core/
          </code>{' '}
          (GSD-core).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenCommandPalette}
          className="gap-2 border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
          data-testid="fcc-open-command-palette"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span>Search</span>
          <kbd className="ml-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
            ⌘K
          </kbd>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenMyWork}
          className="relative gap-2 border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
          aria-label={`My Work — ${activeWorkCount} active`}
          data-testid="fcc-open-my-work"
        >
          <Briefcase className="h-3.5 w-3.5" aria-hidden />
          <span>My Work</span>
          {activeWorkCount > 0 ? (
            <span
              className={cn(
                'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]',
              )}
            >
              {activeWorkCount}
            </span>
          ) : null}
        </Button>

        <button
          type="button"
          onClick={onOpenShortcuts}
          aria-label="Keyboard shortcuts"
          className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </button>

        <button
          type="button"
          aria-label={`Notifications — ${notificationCount} unread`}
          className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden />
          {notificationCount > 0 ? (
            <span
              className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-rose)] px-1 text-[10px] font-semibold text-white shadow-[0_0_0_2px_var(--bg-base)]"
            >
              {notificationCount}
            </span>
          ) : null}
        </button>

        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-primary)]/20 font-mono text-[10px] font-semibold text-[var(--accent-primary)]"
            aria-hidden
          >
            {userInitials}
          </span>
          <div className="hidden flex-col leading-tight md:flex">
            <span className="text-xs font-medium text-[var(--fg-primary)]">
              You
            </span>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {tenantLabel}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
