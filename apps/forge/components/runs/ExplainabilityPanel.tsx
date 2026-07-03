'use client';

/**
 * ExplainabilityPanel — Step-64 Sub-step A.
 *
 * Renders the CodeRabbit 5-question explainability bundle for a
 * single run. Reads from `useRunExplainability(runId)`, which fans out
 * to `GET /api/v1/runs/{id}/explainability` on the FastAPI backend.
 *
 * Layout: 5 stacked cards (Q1 → Q5), plus a header with the
 * overall letter grade and a "computed at" timestamp. The header's
 * grade badge is colored against the same rubric as the tab dot in
 * `WorkflowRunDetail`.
 */

import * as React from 'react';
import { FileText, ListChecks, AlertTriangle, Gauge, GitBranch } from 'lucide-react';

import { useRunExplainability } from '@/lib/hooks/useRuns';
import { ErrorState } from '@/components/error-state';
import { cn } from '@/lib/utils';
import type {
  CheckEntry,
  Q4ConfidenceScore,
  RunExplainability,
  RunExplainabilityGrade,
} from '@/lib/api/runs-types';

// ---------------------------------------------------------------------------
// Grade styling
// ---------------------------------------------------------------------------

const GRADE_TONE: Record<RunExplainabilityGrade, 'emerald' | 'cyan' | 'amber' | 'rose'> = {
  A: 'emerald',
  B: 'cyan',
  C: 'amber',
  D: 'rose',
  F: 'rose',
};

const OUTCOME_TONE: Record<CheckEntry['outcome'], 'emerald' | 'amber' | 'rose' | 'idle'> = {
  pass: 'emerald',
  warn: 'amber',
  fail: 'rose',
  skip: 'idle',
};

const CALIBRATION_LABEL: Record<Q4ConfidenceScore['calibration'], string> = {
  validation_passes: 'from validation passes',
  token_logprob: 'from token logprobs',
  heuristic: 'heuristic — no real calibration yet',
  human_only: 'human-only — no automated signal',
};

function coverageTone(pct: number): 'emerald' | 'amber' | 'rose' {
  if (pct >= 70) return 'emerald';
  if (pct >= 40) return 'amber';
  return 'rose';
}

function coverageFillClass(tone: 'emerald' | 'amber' | 'rose'): string {
  switch (tone) {
    case 'emerald':
      return 'bg-[var(--accent-emerald)]';
    case 'amber':
      return 'bg-[var(--accent-amber)]';
    case 'rose':
      return 'bg-[var(--accent-rose)]';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ExplainabilityPanelProps {
  runId: string;
}

export function ExplainabilityPanel({ runId }: ExplainabilityPanelProps) {
  const { data, isLoading, error, refetch } = useRunExplainability(runId);

  if (isLoading) {
    return (
      <div
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-sm text-[var(--fg-tertiary)]"
        data-testid="explain-loading"
      >
        Loading explainability…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
        <ErrorState
          title="Explainability unavailable"
          description={error?.message ?? 'Bundle not returned by the backend.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="explainability-panel">
      <BundleHeader bundle={data} />
      <Q1Card data={data.what_changed} />
      <Q2Card data={data.what_checked} />
      <Q3Card data={data.coverage_gaps} />
      <Q4Card data={data.confidence} />
      <Q5Card data={data.counterfactual} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function BundleHeader({ bundle }: { bundle: RunExplainability }) {
  const tone = GRADE_TONE[bundle.grade];
  return (
    <header
      className="flex flex-wrap items-end justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="explain-header"
    >
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
          Explainability bundle
        </span>
        <span className="text-sm text-[var(--fg-secondary)]">{bundle.grade_rationale}</span>
        <span className="mt-1 font-mono text-[11px] text-[var(--fg-tertiary)]">
          Computed at {bundle.computed_at} · refresh in 30s · schema v{bundle.schema_version}
        </span>
      </div>
      <div
        className={cn(
          'flex h-24 w-24 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border-2 text-6xl font-bold tabular-nums',
          tone === 'emerald' && 'border-[var(--accent-emerald)]/60 text-[var(--accent-emerald)]',
          tone === 'cyan' && 'border-[var(--accent-cyan)]/60 text-[var(--accent-cyan)]',
          tone === 'amber' && 'border-[var(--accent-amber)]/60 text-[var(--accent-amber)]',
          tone === 'rose' && 'border-[var(--accent-rose)]/60 text-[var(--accent-rose)]',
        )}
        data-testid="explain-grade"
        data-grade={bundle.grade}
      >
        {bundle.grade}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Q1 — What did you change and why?
// ---------------------------------------------------------------------------

function Q1Card({ data }: { data: RunExplainability['what_changed'] }) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="explain-q1"
    >
      <CardHeader
        icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
        number="Q1"
        title="What did you change and why?"
      />
      <p className="mt-2 text-sm text-[var(--fg-secondary)]">{data.summary}</p>
      {data.changes.length === 0 ? (
        <p className="mt-3 text-xs italic text-[var(--fg-tertiary)]">
          No file-level changes surfaced from the command-run ledger or commit audit events.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          {data.changes.slice(0, 25).map((c) => (
            <li key={c.file} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <span
                className={cn(
                  'inline-flex w-16 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest',
                  c.change_kind === 'added' && 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]',
                  c.change_kind === 'removed' && 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]',
                  c.change_kind === 'modified' && 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]',
                  c.change_kind === 'renamed' && 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]',
                )}
              >
                {c.change_kind}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[var(--fg-primary)]">{c.file}</span>
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                +{c.lines_added}/-{c.lines_removed}
              </span>
              {c.rationale ? (
                <span className="basis-full text-[11px] text-[var(--fg-secondary)]">{c.rationale}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data.citations.length > 0 ? (
        <p className="mt-2 font-mono text-[10px] text-[var(--fg-tertiary)]">
          Citations: {data.citations.length}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Q2 — What did you check?
// ---------------------------------------------------------------------------

function Q2Card({ data }: { data: RunExplainability['what_checked'] }) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="explain-q2"
    >
      <CardHeader
        icon={<ListChecks className="h-3.5 w-3.5" aria-hidden="true" />}
        number="Q2"
        title="What did you check?"
      />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={data.total_checks} />
        <Stat label="Passed" value={data.passed} tone="emerald" />
        <Stat label="Failed" value={data.failed} tone="rose" />
        <Stat label="Skipped" value={data.skipped} tone="idle" />
      </div>
      {data.entries.length === 0 ? (
        <p className="mt-3 text-xs italic text-[var(--fg-tertiary)]">
          No checks recorded — the run produced no validator reports and no run.* audit events.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.entries.slice(0, 12).map((entry, idx) => {
            const tone = OUTCOME_TONE[entry.outcome];
            return (
              <li
                key={`${entry.name}-${idx}`}
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full',
                    tone === 'emerald' && 'bg-[var(--accent-emerald)]',
                    tone === 'amber' && 'bg-[var(--accent-amber)]',
                    tone === 'rose' && 'bg-[var(--accent-rose)]',
                    tone === 'idle' && 'bg-[var(--fg-tertiary)]',
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] text-[var(--fg-primary)]">{entry.name}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--fg-secondary)]">
                    {entry.category} · {entry.source}
                    {entry.detail ? ` — ${entry.detail}` : ''}
                  </p>
                </div>
              </li>
            );
          })}
          {data.entries.length > 12 ? (
            <li className="text-[11px] text-[var(--fg-tertiary)]">
              + {data.entries.length - 12} more check(s)
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Q3 — What did you NOT check?
// ---------------------------------------------------------------------------

function Q3Card({ data }: { data: RunExplainability['coverage_gaps'] }) {
  const tone = coverageTone(data.coverage_pct);
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="explain-q3"
    >
      <CardHeader
        icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
        number="Q3"
        title="What did you NOT check?"
      />
      <div className="mt-3 flex items-center gap-3">
        <div className="font-mono text-2xl tabular-nums text-[var(--fg-primary)]">
          {data.coverage_pct.toFixed(0)}%
        </div>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-inset)]">
          <div
            className={cn('h-full rounded-full transition-all', coverageFillClass(tone))}
            style={{ width: `${Math.max(0, Math.min(100, data.coverage_pct))}%` }}
            aria-hidden="true"
            data-testid="explain-q3-bar"
            data-tone={tone}
          />
        </div>
      </div>
      {data.explicit_gaps.length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">Explicit gaps</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-[var(--fg-secondary)]">
            {data.explicit_gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.implicit_gaps.length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
            Always-disclosed limits
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-[var(--fg-secondary)]">
            {data.implicit_gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Q4 — Confidence + calibration
// ---------------------------------------------------------------------------

function Q4Card({ data }: { data: RunExplainability['confidence'] }) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="explain-q4"
    >
      <CardHeader
        icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
        number="Q4"
        title="Confidence + calibration"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="font-mono text-3xl tabular-nums text-[var(--fg-primary)]">
          {data.raw_score.toFixed(0)}%
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest',
            data.would_escalate
              ? 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]'
              : 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]',
          )}
          data-testid="explain-q4-escalate"
          data-would-escalate={data.would_escalate}
        >
          {data.would_escalate ? 'Escalate to human' : 'Auto-OK'}
        </span>
        <span className="text-[11px] text-[var(--fg-tertiary)]">
          threshold {data.threshold.toFixed(0)}%
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--fg-secondary)]">
        <span className="font-mono text-[var(--fg-tertiary)]">calibration:</span>{' '}
        {CALIBRATION_LABEL[data.calibration]}
      </p>
      {Object.keys(data.bands_observed).length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">Bands observed</p>
          <ul className="mt-1 grid grid-cols-5 gap-1 text-[11px]">
            {Object.entries(data.bands_observed).map(([band, count]) => (
              <li
                key={band}
                className="flex flex-col items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1"
              >
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{band}</span>
                <span className="font-mono text-sm text-[var(--fg-primary)]">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Q5 — Counterfactual
// ---------------------------------------------------------------------------

function Q5Card({ data }: { data: RunExplainability['counterfactual'] }) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="explain-q5"
    >
      <CardHeader
        icon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}
        number="Q5"
        title="What would change your recommendation?"
      />
      {data.conditions.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 text-xs text-[var(--fg-secondary)]">
          {data.conditions.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="text-[var(--accent-amber)]">•</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs italic text-[var(--fg-tertiary)]">
          No conditions surfaced.
        </p>
      )}
      {data.counter_recommendation ? (
        <blockquote
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--accent-indigo)]/40 bg-[var(--accent-indigo)]/10 px-3 py-2 text-xs italic text-[var(--accent-indigo)]"
          data-testid="explain-q5-recommendation"
        >
          {data.counter_recommendation}
        </blockquote>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function CardHeader({
  icon,
  number,
  title,
}: {
  icon: React.ReactNode;
  number: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[var(--fg-tertiary)]">
      <span className="font-mono text-[10px] uppercase tracking-widest">{number}</span>
      <span aria-hidden="true">{icon}</span>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--fg-secondary)]">
        {title}
      </h3>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'idle',
}: {
  label: string;
  value: number;
  tone?: 'emerald' | 'rose' | 'idle';
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2">
      <span className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
        {label}
      </span>
      <span
        className={cn(
          'mt-1 font-mono text-lg tabular-nums',
          tone === 'emerald' && 'text-[var(--accent-emerald)]',
          tone === 'rose' && 'text-[var(--accent-rose)]',
          tone === 'idle' && 'text-[var(--fg-primary)]',
        )}
      >
        {value}
      </span>
    </div>
  );
}