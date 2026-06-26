'use client';

/**
 * IdeaCard — Step 5 base + Step 28 additive enrichments.
 *
 * Step 5 fields:
 *   - Score chip tier colors (0–3 muted, 4–6 amber, 7–8 emerald, 9–10 violet).
 *   - Owner avatar + comment count.
 *
 * Step 28 enrichments (opt-in via props so the Step 5 kanban card is
 * untouched):
 *   - Source badge (top-right) — where the idea came from
 *   - Synced-to chips (footer) — Jira ✓ · Confluence ✓ · IDE →
 *   - AI reasoning button — opens the detail drawer
 */

import * as React from 'react';
import {
  Brain,
  Check,
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  MessageSquare,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { findEnrichment, type IdeaSyncStatus } from '@/lib/ideation/pipeline-data';
import type { Idea } from '@/lib/ideation/data';

function scoreChipClass(score: number): string {
  if (score <= 3) return 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]';
  if (score <= 6) return 'bg-[rgba(245,158,11,0.12)] text-[var(--accent-amber)]';
  if (score <= 8) return 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]';
  return 'bg-[rgba(168,85,247,0.12)] text-[var(--accent-violet)]';
}

function sourceAccentClasses(accent: 'cyan' | 'indigo' | 'violet' | 'amber' | 'rose'): {
  ring: string;
  bg: string;
  text: string;
} {
  switch (accent) {
    case 'cyan':
      return { ring: 'ring-[rgba(34,211,238,0.35)]', bg: 'bg-[rgba(34,211,238,0.10)]', text: 'text-[var(--accent-cyan)]' };
    case 'indigo':
      return { ring: 'ring-[rgba(99,102,241,0.35)]', bg: 'bg-[rgba(99,102,241,0.10)]', text: 'text-[var(--accent-primary)]' };
    case 'violet':
      return { ring: 'ring-[rgba(168,85,247,0.35)]', bg: 'bg-[rgba(168,85,247,0.10)]', text: 'text-[var(--accent-violet)]' };
    case 'amber':
      return { ring: 'ring-[rgba(245,158,11,0.35)]', bg: 'bg-[rgba(245,158,11,0.10)]', text: 'text-[var(--accent-amber)]' };
    case 'rose':
      return { ring: 'ring-[rgba(244,63,94,0.35)]', bg: 'bg-[rgba(244,63,94,0.10)]', text: 'text-[var(--accent-rose)]' };
  }
}

function syncChip(
  state: 'created' | 'syncing' | 'failed' | 'none' | 'running' | 'queued' | 'completed',
): { Icon: React.ComponentType<{ className?: string }>; cls: string; label: string } {
  if (state === 'created' || state === 'completed')
    return { Icon: Check, cls: 'text-[var(--accent-emerald)]', label: '✓' };
  if (state === 'running' || state === 'syncing' || state === 'queued')
    return { Icon: CircleAlert, cls: 'text-[var(--accent-cyan)]', label: '⟳' };
  if (state === 'failed')
    return { Icon: XCircle, cls: 'text-[var(--accent-rose)]', label: '✕' };
  return { Icon: Check, cls: 'text-[var(--fg-muted)] opacity-40', label: '·' };
}

export interface IdeaCardProps {
  idea: Idea;
  onSelect?: (idea: Idea) => void;
  /** Step 28: show source badge in top-right. */
  showSourceChip?: boolean;
  /** Step 28: show "Synced to" footer chips. */
  showSyncChips?: boolean;
  /** Step 28: show AI reasoning button (Brain icon). */
  showReasoningButton?: boolean;
  /** Click handler for the AI reasoning button. */
  onShowReasoning?: (idea: Idea) => void;
}

export function IdeaCard({
  idea,
  onSelect,
  showSourceChip = false,
  showSyncChips = false,
  showReasoningButton = false,
  onShowReasoning,
}: IdeaCardProps) {
  const enrichment = findEnrichment(idea.id);
  const sync: IdeaSyncStatus | undefined = enrichment?.sync;

  return (
    <article
      data-testid="idea-card"
      data-idea-id={idea.id}
      data-idea-status={idea.status}
      className="card flex flex-col gap-3 transition-[border,transform,box-shadow] duration-200 ease-out-soft hover:-translate-y-px hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
            <Lightbulb className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="line-clamp-2 text-sm font-medium leading-tight text-[var(--fg-primary)]">
              {idea.title}
            </h3>
            <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">{idea.id}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono',
              scoreChipClass(idea.score),
            )}
            data-testid="idea-card-score"
            data-score={idea.score}
            aria-label={`Score ${idea.score.toFixed(1)}`}
          >
            <span>{idea.score.toFixed(1)}</span>
          </span>
          {showSourceChip && enrichment ? (
            <span
              data-testid="idea-card-source"
              className={cn(
                'inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono ring-1',
                sourceAccentClasses(enrichment.source.accent).bg,
                sourceAccentClasses(enrichment.source.accent).text,
                sourceAccentClasses(enrichment.source.accent).ring,
              )}
            >
              {enrichment.source.label}
            </span>
          ) : null}
        </div>
      </header>

      <p className="line-clamp-2 text-xs text-[var(--fg-secondary)]">{idea.summary}</p>

      {showSyncChips && sync ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-[10px]">
          <span className="text-[var(--fg-tertiary)]">Synced to:</span>
          {[
            { key: 'jira', label: 'Jira' },
            { key: 'confluence', label: 'Confluence' },
            { key: 'ide', label: 'IDE' },
          ].map(({ key, label }) => {
            const state = sync[key as keyof IdeaSyncStatus]?.state ?? 'none';
            const chip = syncChip(state);
            const Icon = chip.Icon;
            return (
              <span
                key={key}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono',
                  chip.cls,
                )}
                title={`${label}: ${state}`}
              >
                <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                {label}
                {state === 'created' || state === 'completed' ? (
                  <Check className="h-2.5 w-2.5" aria-hidden="true" />
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}

      <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <div className="flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] font-mono text-[10px] text-[var(--fg-primary)]"
            aria-label={`Owner ${idea.owner}`}
          >
            {idea.ownerAvatar}
          </span>
          <span>{idea.owner}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {idea.tags.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {showReasoningButton ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onShowReasoning?.(idea)}
              data-testid="idea-card-reasoning"
              aria-label={`Why this score for ${idea.title}`}
              className="text-[var(--accent-amber)] hover:bg-[rgba(245,158,11,0.10)] hover:text-[var(--accent-amber)]"
            >
              <Brain className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSelect?.(idea)}
            data-testid="idea-card-open"
            className="text-[var(--accent-primary)] hover:bg-[rgba(99,102,241,0.08)] hover:text-[var(--accent-primary)]"
          >
            Open
          </Button>
        </div>
      </footer>
    </article>
  );
}