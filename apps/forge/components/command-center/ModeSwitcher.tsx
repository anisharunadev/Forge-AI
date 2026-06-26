'use client';

/**
 * ModeSwitcher — ZONE 2 of the brief.
 *
 * Segmented control with three top-level modes. The rail uses
 * `layoutId` so the active indicator animates between tabs without
 * remounting. Wrapped in a high-contrast pill on `--bg-elevated`.
 *
 * Skill: `06-keyboard-ux.md` — focus rings + z-index scale.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import { Ticket, FileText, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommandCenterMode } from '@/lib/command-center/store';

const MODES: ReadonlyArray<{
  id: CommandCenterMode;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  hint: string;
}> = [
  { id: 'ticket', label: 'Ticket', icon: Ticket, hint: 'I have a ticket, help me work it' },
  { id: 'spec', label: 'Spec', icon: FileText, hint: 'I have an idea, let\'s spec it out' },
  { id: 'catalog', label: 'Catalog', icon: LayoutGrid, hint: 'Browse the forge-* command catalog' },
];

export interface ModeSwitcherProps {
  value: CommandCenterMode;
  onChange: (mode: CommandCenterMode) => void;
}

export function ModeSwitcher({ value, onChange }: ModeSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="Command Center mode"
      className="inline-flex items-center gap-1 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-md)]"
    >
      {MODES.map((m) => {
        const isActive = value === m.id;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`${m.label} mode — ${m.hint}`}
            data-testid={`fcc-mode-${m.id}`}
            onClick={() => onChange(m.id)}
            className={cn(
              'relative inline-flex items-center gap-2 rounded-[var(--radius-lg)] px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out-soft',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
              isActive
                ? 'text-white'
                : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
            )}
          >
            {isActive ? (
              <motion.span
                layoutId="fcc-mode-pill"
                className="absolute inset-0 -z-0 rounded-[var(--radius-lg)] bg-[var(--accent-primary)] shadow-[var(--shadow-md)]"
                transition={{ duration: 0.2 }}
                aria-hidden
              />
            ) : null}
            <Icon className="relative z-10 h-4 w-4" aria-hidden />
            <span className="relative z-10">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
