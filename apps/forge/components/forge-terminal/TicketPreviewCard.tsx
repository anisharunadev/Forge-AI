'use client';

/**
 * Ticket preview card (Step 44, Fix 6).
 *
 * Inline preview that appears when the terminal input detects a Jira /
 * GitHub / Linear ticket reference. Shows:
 *   - Ticket key + source
 *   - Title (stub — real wire would call the connector)
 *   - Status, priority, assignee
 *   - AI summary line
 *   - Suggested commands
 *
 * Pure presentation — the actual command dispatch lives in the
 * terminal input wrapper.
 */

import * as React from 'react';
import { ExternalLink, Sparkles, Ticket } from 'lucide-react';

import type { DetectedTicket } from '@/lib/tickets/detect';
import { TICKET_COMMANDS } from '@/lib/tickets/detect';
import { cn } from '@/lib/utils';

export interface TicketPreviewCardProps {
  readonly ticket: DetectedTicket;
  readonly onPickCommand?: (ticket: DetectedTicket, commandId: string) => void;
  readonly onDismiss?: () => void;
  readonly className?: string;
}

export function TicketPreviewCard({
  ticket,
  onPickCommand,
  onDismiss,
  className,
}: TicketPreviewCardProps) {
  return (
    <div
      role="region"
      aria-label="Detected ticket"
      data-testid="ticket-preview-card"
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-md)] border',
        'border-[var(--accent-primary)]/30 bg-[rgba(99,102,241,0.06)] p-3 text-xs',
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] bg-[rgba(99,102,241,0.18)] text-[var(--accent-primary)]"
        >
          <Ticket size={11} aria-hidden="true" />
        </span>
        <span className="font-mono text-[11px] font-semibold text-[var(--accent-primary)]">
          {ticket.source.toUpperCase()} · {ticket.key}
        </span>
        <a
          href={ticket.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:underline"
        >
          View <ExternalLink size={9} aria-hidden="true" />
        </a>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss ticket preview"
            className="rounded p-0.5 text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            ×
          </button>
        ) : null}
      </header>

      <p className="text-xs font-medium text-[var(--fg-primary)]">
        {/* Title is a stub until the connector wires in real metadata */}
        {ticket.key} · Detected from paste
      </p>

      <ul className="flex flex-wrap gap-3 text-[10px] text-[var(--fg-tertiary)]">
        <li>
          <span className="text-[var(--fg-muted)]">Status:</span>{' '}
          <span className="text-[var(--fg-secondary)]">Open</span>
        </li>
        <li>
          <span className="text-[var(--fg-muted)]">Priority:</span>{' '}
          <span className="text-[var(--fg-secondary)]">P1</span>
        </li>
        <li>
          <span className="text-[var(--fg-muted)]">Assignee:</span>{' '}
          <span className="text-[var(--fg-secondary)]">Unassigned</span>
        </li>
      </ul>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--fg-secondary)]">
        <Sparkles size={10} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent-violet)]" />
        <span>
          Forge will pre-inject this ticket's full context — description, acceptance criteria, comments,
          and linked entities — into the new terminal session.
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Run:
        </span>
        {TICKET_COMMANDS.map((cmd) => (
          <button
            key={cmd.id}
            type="button"
            onClick={() => onPickCommand?.(ticket, cmd.id)}
            data-testid={`ticket-cmd-${cmd.id}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5',
              'border-[var(--border-default)] bg-[var(--bg-base)] text-[11px] font-mono text-[var(--fg-secondary)]',
              'hover:border-[var(--accent-primary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            )}
            title={cmd.description}
          >
            {cmd.label}
          </button>
        ))}
      </div>
    </div>
  );
}
