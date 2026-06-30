'use client';

/**
 * ConfirmationHistory — Board confirmation history timeline rows
 * with collapsible diff expansion.
 *
 * Step-59 migration: was reading the `BoardConfirmation` type from
 * `@/lib/governance/data`. The Board confirmation endpoint isn't on
 * the LiteLLM-backed governance surface yet, so the type now lives in
 * `useForgeFixtures.ts` alongside the inline fixture array. Once
 * `/v1/governance/board-confirmations` ships on the backend, this
 * component should consume a TanStack Query hook (mirroring
 * `useAuditEvents`).
 *
 * Uses the existing shadcn <Accordion> primitive (Radix-based) for
 * expand/collapse — same a11y and keyboard semantics as shadcn
 * Collapsible. Each row shows: timestamp · outcome · actor · diff
 * summary · chevron to expand.
 */

import * as React from 'react';
import { ChevronRight } from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { StatusPill } from '@/components/shell';
import { FIXTURE_BOARD_CONFIRMATIONS, type BoardConfirmation } from '@/lib/hooks/useForgeFixtures';

export interface ConfirmationHistoryProps {
  confirmations?: ReadonlyArray<BoardConfirmation>;
}

function diffSummary(c: BoardConfirmation): string {
  if (c.outcome === 'accepted') return `Accepted ${c.subject.identifier} on plan ${c.planRev}.`;
  if (c.outcome === 'declined') return `Declined ${c.subject.identifier} on plan ${c.planRev}.`;
  return `Pending review of ${c.subject.identifier}.`;
}

function diffBody(c: BoardConfirmation): string {
  return [
    `subject: ${c.subject.identifier}`,
    `planRev: ${c.planRev}`,
    `idempotencyKey: ${c.idempotencyKey}`,
    `prompt: ${c.prompt}`,
    c.reason ? `reason: ${c.reason}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function toneFor(outcome: BoardConfirmation['outcome']) {
  if (outcome === 'accepted') return 'success' as const;
  if (outcome === 'declined') return 'danger' as const;
  return 'idle' as const;
}

function glyphFor(outcome: BoardConfirmation['outcome']) {
  if (outcome === 'accepted') return '✓' as const;
  if (outcome === 'declined') return '✕' as const;
  return '○' as const;
}

export function ConfirmationHistory({ confirmations }: ConfirmationHistoryProps) {
  const rows = confirmations ?? FIXTURE_BOARD_CONFIRMATIONS;
  if (rows.length === 0) return null;

  return (
    <Accordion
      type="single"
      collapsible
      className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid="board-history-accordion"
    >
      {rows.map((c) => (
        <AccordionItem
          key={c.id}
          value={c.id}
          className="border-b border-[var(--border-subtle)] last:border-0"
          data-testid={`board-row-${c.id}`}
          data-outcome={c.outcome}
        >
          <AccordionTrigger
            className="px-4 py-3 hover:no-underline"
            data-testid={`board-row-trigger-${c.id}`}
          >
            <div className="flex flex-1 items-center gap-3 text-left">
              <span className="w-36 shrink-0 font-mono text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                {c.decidedAt ?? '—'}
              </span>
              <StatusPill
                tone={toneFor(c.outcome)}
                glyph={glyphFor(c.outcome)}
                label={c.outcome}
                size="sm"
              />
              <span className="hidden flex-1 truncate text-[var(--text-sm)] text-[var(--fg-secondary)] md:block">
                {diffSummary(c)}
              </span>
              <span className="ml-auto hidden font-mono text-[var(--text-xs)] text-[var(--fg-tertiary)] md:block">
                {c.decider?.displayName ?? '—'}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-3 px-4 pb-4 md:grid-cols-[1fr_240px]">
              <pre className="overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 font-mono text-[11px] leading-relaxed text-[var(--fg-secondary)]">
                {diffBody(c)}
              </pre>
              <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-[var(--text-xs)] text-[var(--fg-secondary)]">
                <div className="flex justify-between">
                  <span>Actor</span>
                  <span className="font-mono text-[var(--fg-primary)]">
                    {c.decider?.displayName ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Decided at</span>
                  <span className="font-mono text-[var(--fg-primary)]">
                    {c.decidedAt ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>PlanRev</span>
                  <span className="font-mono text-[var(--fg-primary)]">
                    {c.planRev}
                  </span>
                </div>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[var(--text-xs)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)]"
                  data-testid={`board-row-open-${c.id}`}
                >
                  Open detail
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}