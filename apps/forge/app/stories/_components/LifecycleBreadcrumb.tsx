'use client';

/**
 * Lifecycle breadcrumb (Step 38, Fix 6).
 *
 * Renders the full provenance chain for a story as a horizontal row of
 * clickable chips, ending at the current story. Each chip shows the
 * module icon + ID + label. The current (rightmost) chip is non-link
 * with a subtle glow so the user can tell where they are.
 *
 *     🎫 ACME-123 → 💡 IDEA-042 → 📋 PRD-001 → 📜 ADR-005 → 📋 ST-123 (current)
 *
 * Skill influence:
 *   - ux-guideline (breadcrumb) — show user location in the artifact chain
 *   - ux-guideline (active state) — current item visually distinct
 *   - ux-guideline (focus ring) — every chip keyboard-accessible
 */

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ClipboardList,
  FileText,
  GitBranch,
  Lightbulb,
  Sparkles,
  Ticket,
} from 'lucide-react';

import type { Story } from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface LifecycleStep {
  readonly kind: 'ticket' | 'idea' | 'prd' | 'adr' | 'story';
  readonly id: string;
  readonly label: string;
  readonly href?: string;
}

export interface LifecycleBreadcrumbProps {
  readonly story: Story;
  /** Optional override chain. Defaults to a synthetic chain derived from
   *  `story.linkedItems` + the story itself. */
  readonly steps?: ReadonlyArray<LifecycleStep>;
  readonly className?: string;
}

const KIND_ICON = {
  ticket: Ticket,
  idea: Lightbulb,
  prd: ClipboardList,
  adr: GitBranch,
  story: Sparkles,
} as const;

const KIND_TONE: Record<LifecycleStep['kind'], string> = {
  ticket: 'var(--accent-amber)',
  idea: 'var(--accent-cyan)',
  prd: 'var(--accent-violet)',
  adr: 'var(--accent-primary)',
  story: 'var(--accent-emerald)',
};

function defaultStepsFor(story: Story): ReadonlyArray<LifecycleStep> {
  const steps: LifecycleStep[] = [
    {
      kind: 'ticket',
      id: `ACME-${story.identifier.replace(/\D/g, '') || '123'}`,
      label: 'Zendesk ticket',
      href: '/connector-center',
    },
  ];
  if (story.epicId) {
    steps.push({
      kind: 'idea',
      id: `IDEA-${story.epicId.replace(/[^0-9]/g, '') || '042'}`,
      label: 'Idea · Forge OS',
      href: '/ideation',
    });
  }
  steps.push({
    kind: 'prd',
    id: 'PRD-001',
    label: 'Forge OS · Auth & PKCE',
    href: '/ideation',
  });
  for (const link of story.linkedItems) {
    if (link.kind === 'adr') {
      steps.push({
        kind: 'adr',
        id: link.id.toUpperCase(),
        label: link.label,
        href: '/architecture',
      });
    }
  }
  steps.push({
    kind: 'story',
    id: story.identifier,
    label: story.title,
  });
  return steps;
}

export function LifecycleBreadcrumb({
  story,
  steps,
  className,
}: LifecycleBreadcrumbProps) {
  const chain = steps ?? defaultStepsFor(story);
  return (
    <nav
      aria-label="Story lifecycle chain"
      data-testid="lifecycle-breadcrumb"
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)]',
        'bg-[var(--bg-base)] px-3 py-2 text-[11px]',
        className,
      )}
    >
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
        Journey
      </span>
      {chain.map((step, idx) => {
        const Icon = KIND_ICON[step.kind];
        const tone = KIND_TONE[step.kind];
        const isCurrent = step.kind === 'story';
        const inner = (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1',
              'transition-colors duration-fast ease-out-soft',
              isCurrent
                ? 'bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            )}
            style={
              isCurrent
                ? { boxShadow: `inset 0 0 0 1px ${tone}` }
                : undefined
            }
          >
            <Icon size={11} aria-hidden="true" style={{ color: tone }} />
            <span className="font-mono text-[10px] uppercase tracking-wider">{step.kind}</span>
            <span className="font-semibold">{step.id}</span>
            <span className="hidden truncate text-[var(--fg-tertiary)] md:inline">· {step.label}</span>
          </span>
        );
        return (
          <React.Fragment key={`${step.kind}-${step.id}`}>
            {step.href && !isCurrent ? (
              <Link href={step.href} className="rounded-[var(--radius-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
                {inner}
              </Link>
            ) : (
              <span aria-current={isCurrent ? 'page' : undefined}>{inner}</span>
            )}
            {idx < chain.length - 1 ? (
              <ArrowRight
                size={10}
                aria-hidden="true"
                className="shrink-0 text-[var(--fg-tertiary)]"
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

/**
 * Compact badge used on the KanbanCard. Shows "→ ST-123" when a story
 * is being implemented in a terminal session (Step 38, Fix 5).
 */
export function ImplementationPill({
  agent,
  sessionId,
}: {
  agent: string;
  sessionId: string;
}) {
  return (
    <Link
      href={`/forge-terminal?sessionId=${sessionId}`}
      data-testid="implementation-pill"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border',
        'border-[var(--accent-emerald)]/40 bg-[rgba(34,197,94,0.10)]',
        'px-2 py-0.5 text-[10px] font-medium text-[var(--accent-emerald)]',
        'transition-colors duration-fast ease-out-soft',
        'hover:bg-[rgba(34,197,94,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald)]',
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-emerald)] opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
      </span>
      <FileText size={10} aria-hidden="true" />
      <span>Live · {agent}</span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
