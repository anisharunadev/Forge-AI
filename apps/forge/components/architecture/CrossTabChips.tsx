/**
 * CrossTabChips — Zone 13 (Inter-tab connections).
 * Compact strip showing counts of related entities (ADRs, APIs, Tasks, Risks)
 * for the currently selected entity. Each chip is a button that jumps
 * to the relevant tab and selects the related entity.
 *
 * Skill influence: 02-visualization-patterns (chips), 04-data-display (badges).
 */

'use client';

import * as React from 'react';
import { FileText, Workflow, AlertTriangle, Plug } from 'lucide-react';
import { cn } from '@/lib/utils';

type TabId = 'overview' | 'adrs' | 'contracts' | 'tasks' | 'risks' | 'trace' | 'versions' | 'radar' | 'diagrams';

export interface CrossTabChipsProps {
  counts: {
    adrs: number;
    apis: number;
    tasks: number;
    risks: number;
  };
  onJump: (tab: TabId, id?: string) => void;
  scope?: string;
}

interface ChipDef {
  tab: TabId;
  label: string;
  count: number;
  icon: React.ReactNode;
  testId: string;
}

export function CrossTabChips({ counts, onJump, scope }: CrossTabChipsProps) {
  const chips: ChipDef[] = [
    { tab: 'adrs', label: 'ADRs', count: counts.adrs, icon: <FileText className="h-3 w-3" aria-hidden="true" />, testId: 'chip-adrs' },
    { tab: 'contracts', label: 'APIs', count: counts.apis, icon: <Plug className="h-3 w-3" aria-hidden="true" />, testId: 'chip-apis' },
    { tab: 'tasks', label: 'Tasks', count: counts.tasks, icon: <Workflow className="h-3 w-3" aria-hidden="true" />, testId: 'chip-tasks' },
    { tab: 'risks', label: 'Risks', count: counts.risks, icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />, testId: 'chip-risks' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2 text-xs" data-testid="cross-tab-chips">
      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
        References{scope ? ` · ${scope}` : ''}
      </span>
      {chips.map((c) => (
        <button
          key={c.tab}
          type="button"
          onClick={() => onJump(c.tab)}
          disabled={c.count === 0}
          data-testid={c.testId}
          className={cn(
            'inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            c.count === 0
              ? 'text-[var(--fg-muted)] opacity-50'
              : 'text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]',
          )}
          aria-label={`Jump to ${c.label}: ${c.count}`}
        >
          {c.icon}
          <span className="font-mono">{c.count}</span>
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}