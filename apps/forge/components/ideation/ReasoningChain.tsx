'use client';

/**
 * `<ReasoningChain>` — Step 28.
 *
 * Vertical timeline of AI reasoning steps. Used in:
 *   - <IdeaDetailPanel>  — "Why this score?"
 *   - <PRDViewer>        — "How this PRD was drafted"
 *   - <PipelineView>     — Live agent run state
 *
 * Each step renders:
 *   - Step number + icon (semantic color per `kind`)
 *   - Title (e.g., "Clustered 4 similar tickets")
 *   - Content (LLM explanation)
 *   - Confidence badge (emerald / amber / rose)
 *   - Source references (chips)
 *
 * Steps are expandable on click. The component is purely presentational
 * — orchestration / SSE live-updates live in the parent.
 */

import * as React from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Layers,
  Lightbulb,
  Link2,
  Scale,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ReasoningChain as ReasoningChainData, ReasoningStep, ReasoningStepKind } from '@/lib/ideation/pipeline-data';

export interface ReasoningChainProps {
  readonly chain: ReasoningChainData;
  /** All collapsed by default when `false`. */
  readonly defaultOpen?: boolean;
  /** Surface a "final score" footer. */
  readonly showFooter?: boolean;
  /** Optional class for the root. */
  className?: string;
}

function iconForKind(kind: ReasoningStepKind): LucideIcon {
  switch (kind) {
    case 'read':
      return BookOpen;
    case 'cluster':
      return Layers;
    case 'match':
      return Link2;
    case 'score':
      return Scale;
    case 'impact':
      return Target;
    case 'final':
      return Sparkles;
  }
}

function accentForKind(kind: ReasoningStepKind): {
  dot: string;
  ring: string;
  bar: string;
  label: string;
} {
  switch (kind) {
    case 'read':
      return {
        dot: 'bg-[var(--accent-cyan)]',
        ring: 'ring-[rgba(34,211,238,0.25)]',
        bar: 'bg-[var(--accent-cyan)]',
        label: 'text-[var(--accent-cyan)]',
      };
    case 'cluster':
      return {
        dot: 'bg-[var(--accent-violet)]',
        ring: 'ring-[rgba(168,85,247,0.25)]',
        bar: 'bg-[var(--accent-violet)]',
        label: 'text-[var(--accent-violet)]',
      };
    case 'match':
      return {
        dot: 'bg-[var(--accent-primary)]',
        ring: 'ring-[rgba(99,102,241,0.25)]',
        bar: 'bg-[var(--accent-primary)]',
        label: 'text-[var(--accent-primary)]',
      };
    case 'score':
      return {
        dot: 'bg-[var(--accent-amber)]',
        ring: 'ring-[rgba(245,158,11,0.25)]',
        bar: 'bg-[var(--accent-amber)]',
        label: 'text-[var(--accent-amber)]',
      };
    case 'impact':
      return {
        dot: 'bg-[var(--accent-emerald)]',
        ring: 'ring-[rgba(16,185,129,0.25)]',
        bar: 'bg-[var(--accent-emerald)]',
        label: 'text-[var(--accent-emerald)]',
      };
    case 'final':
      return {
        dot: 'bg-[var(--accent-rose)]',
        ring: 'ring-[rgba(244,63,94,0.25)]',
        bar: 'bg-[var(--accent-rose)]',
        label: 'text-[var(--accent-rose)]',
      };
  }
}

function confidenceBadge(confidence: ReasoningStep['confidence']): {
  cls: string;
  label: string;
} {
  if (confidence === 'high')
    return {
      cls: 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]',
      label: 'High confidence',
    };
  if (confidence === 'medium')
    return {
      cls: 'bg-[rgba(245,158,11,0.12)] text-[var(--accent-amber)]',
      label: 'Medium',
    };
  return {
    cls: 'bg-[rgba(244,63,94,0.12)] text-[var(--accent-rose)]',
    label: 'Low confidence',
  };
}

interface StepRowProps {
  readonly step: ReasoningStep;
  readonly index: number;
  readonly total: number;
  readonly defaultOpen: boolean;
}

function StepRow({ step, index, total, defaultOpen }: StepRowProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const Icon = iconForKind(step.kind);
  const accent = accentForKind(step.kind);
  const conf = confidenceBadge(step.confidence);
  const isLast = index === total - 1;

  return (
    <li
      data-testid="reasoning-step"
      data-step-kind={step.kind}
      className="relative flex gap-3"
    >
      {/* Rail */}
      <div className="relative flex flex-col items-center" aria-hidden="true">
        <span
          className={cn(
            'mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-4',
            accent.dot,
            accent.ring,
          )}
        >
          {index + 1}
        </span>
        {!isLast ? (
          <span className={cn('mt-1 h-full w-px flex-1', accent.bar, 'opacity-30')} />
        ) : null}
      </div>

      {/* Body */}
      <div className="flex-1 pb-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-start justify-between gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <span className="flex items-start gap-2">
            <Icon
              className={cn('mt-0.5 h-4 w-4 shrink-0', accent.label)}
              aria-hidden="true"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium text-[var(--fg-primary)]">
                {step.title}
              </span>
              {open ? null : (
                <span className="line-clamp-1 text-xs text-[var(--fg-tertiary)]">
                  {step.detail}
                </span>
              )}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-medium',
                conf.cls,
              )}
            >
              {step.confidence === 'high' ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              ) : step.confidence === 'medium' ? (
                <Lightbulb className="h-3 w-3" aria-hidden="true" />
              ) : (
                <CircleAlert className="h-3 w-3" aria-hidden="true" />
              )}
              {conf.label}
            </span>
            {open ? (
              <ChevronDown className="h-4 w-4 text-[var(--fg-muted)]" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[var(--fg-muted)]" aria-hidden="true" />
            )}
          </span>
        </button>

        {open ? (
          <div className="mt-2 space-y-2 pl-6">
            <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">
              {step.detail}
            </p>
            {step.sources.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {step.sources.map((src) => (
                  <span
                    key={src}
                    className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]"
                  >
                    {src}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function ReasoningChain({
  chain,
  defaultOpen = false,
  showFooter = true,
  className,
}: ReasoningChainProps) {
  return (
    <section
      data-testid="reasoning-chain"
      data-chain-id={chain.id}
      aria-label={`Reasoning chain for ${chain.ideaTitle}`}
      className={cn('rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4', className)}
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
          <Sparkles className="h-4 w-4 text-[var(--accent-amber)]" aria-hidden="true" />
          AI reasoning chain
        </h3>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {chain.steps.length} steps · {chain.generatedAt}
        </span>
      </header>

      <ol className="space-y-0">
        {chain.steps.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            index={i}
            total={chain.steps.length}
            defaultOpen={defaultOpen || i === chain.steps.length - 1}
          />
        ))}
      </ol>

      {showFooter ? (
        <footer className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <span className="text-xs text-[var(--fg-tertiary)]">Final composite score</span>
          <span
            className="rounded-[var(--radius-sm)] bg-[rgba(168,85,247,0.12)] px-2 py-0.5 font-mono text-xs text-[var(--accent-violet)]"
            data-testid="reasoning-final-score"
          >
            {chain.finalScore.toFixed(1)} / 10
          </span>
        </footer>
      ) : null}
    </section>
  );
}