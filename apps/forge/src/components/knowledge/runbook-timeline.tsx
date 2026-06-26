'use client';

/**
 * Runbooks tab (F-004) — vertical timeline of executable steps.
 *
 * Each step can be a manual action, a shell command, or a check. The
 * "Run this step" button is a no-op stub for now (real implementation
 * would call the Forge terminal API). Test run / Run for real toggle the
 * dry-run flag.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  PlayCircle,
  CheckCircle2,
  Terminal,
  ListChecks,
  FlaskConical,
  Rocket,
  AlertTriangle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { RUNBOOKS, type Runbook, type RunbookStep } from './sample-data';

const STATUS_TONE: Record<Runbook['status'], { dot: string; label: string; pill: string }> = {
  draft: { dot: 'var(--accent-amber)', label: 'Draft', pill: 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]' },
  tested: { dot: 'var(--accent-cyan)', label: 'Tested', pill: 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]' },
  production: { dot: 'var(--accent-emerald)', label: 'Production', pill: 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]' },
  outdated: { dot: 'var(--fg-muted)', label: 'Outdated', pill: 'bg-[var(--fg-muted)]/15 text-[var(--fg-muted)]' },
};

const KIND_ICON: Record<RunbookStep['kind'], React.ComponentType<{ className?: string }>> = {
  manual: ListChecks,
  command: Terminal,
  check: CheckCircle2,
};

function StepCard({ step, index }: { step: RunbookStep; index: number }) {
  const Icon = KIND_ICON[step.kind];
  return (
    <li className="relative pl-10" data-testid="ok-runbook-step">
      <span
        aria-hidden="true"
        className="absolute left-2 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--accent-primary)]/40 bg-[var(--bg-base)] font-mono text-[10px] font-semibold text-[var(--accent-primary)]"
      >
        {index + 1}
      </span>
      <span
        aria-hidden="true"
        className="absolute left-[14px] top-9 bottom-0 w-px bg-[var(--border-subtle)]"
      />
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-[var(--fg-primary)]">{step.title}</h4>
          </div>
          <button
            type="button"
            data-testid="ok-runbook-step-run"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            <PlayCircle className="h-2.5 w-2.5" aria-hidden="true" /> Run this step
          </button>
        </header>
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">{step.description}</p>
        {step.command ? (
          <pre
            className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] text-[var(--accent-cyan)]"
            data-testid="ok-runbook-command"
          >
            <span className="select-none pr-2 text-[var(--fg-tertiary)]">$</span>
            {step.command}
          </pre>
        ) : null}
        {step.expectedOutput ? (
          <p className="mt-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
            expected: <span className="text-[var(--accent-emerald)]">{step.expectedOutput}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function RunbookTimeline() {
  const [dryRun, setDryRun] = React.useState(true);
  const [open, setOpen] = React.useState<string | null>(RUNBOOKS[0]?.id ?? null);

  return (
    <div className="flex flex-col gap-4" data-testid="ok-runbooks">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--fg-secondary)]">
        <span className="font-medium text-[var(--fg-primary)]">Runbooks</span>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{RUNBOOKS.length} total</span>
        <span className="ml-auto inline-flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">Mode</span>
          <button
            type="button"
            data-testid="ok-runbook-dry-run"
            onClick={() => setDryRun(true)}
            aria-pressed={dryRun}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-medium transition-colors',
              dryRun
                ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
            )}
          >
            <FlaskConical className="h-2.5 w-2.5" aria-hidden="true" /> Test run
          </button>
          <button
            type="button"
            data-testid="ok-runbook-real"
            onClick={() => setDryRun(false)}
            aria-pressed={!dryRun}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-medium transition-colors',
              !dryRun
                ? 'border-[var(--accent-rose)] bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
            )}
          >
            <Rocket className="h-2.5 w-2.5" aria-hidden="true" /> Run for real
          </button>
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {RUNBOOKS.map((rb) => {
          const tone = STATUS_TONE[rb.status];
          const isOpen = open === rb.id;
          return (
            <motion.li
              key={rb.id}
              layout
              data-testid="ok-runbook-card"
              className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <button
                type="button"
                onClick={() => setOpen((curr) => (curr === rb.id ? null : rb.id))}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-4 p-4 text-left hover:bg-[var(--bg-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: tone.dot }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{rb.title}</h3>
                    <span
                      className={cn(
                        'rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                        tone.pill,
                      )}
                    >
                      {tone.label}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{rb.id}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{rb.summary}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-[var(--fg-tertiary)]">
                    <span>{rb.steps.length} steps</span>
                    <span>·</span>
                    <span>
                      Success rate:{' '}
                      <span className="text-[var(--accent-emerald)]">
                        {Math.round(rb.successRate * 100)}%
                      </span>
                    </span>
                    {rb.lastRunAt ? (
                      <>
                        <span>·</span>
                        <span>Last run: {new Date(rb.lastRunAt).toLocaleDateString()}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {rb.status === 'production' && rb.lastRunStatus === 'failure' ? (
                  <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent-rose)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent-rose)]">
                    <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" /> Last run failed
                  </span>
                ) : null}
              </button>
              {isOpen ? (
                <ol className="flex flex-col gap-3 border-t border-[var(--border-subtle)] p-4">
                  {rb.steps.map((s, i) => (
                    <StepCard key={s.id} step={s} index={i} />
                  ))}
                </ol>
              ) : null}
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}