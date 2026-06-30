'use client';

/**
 * WorkflowRunDetail — Step-56 (Phase 4).
 *
 * FastAPI-backed run detail page. Replaces the FORA orchestrator
 * `runs/[id]/page.tsx` (7-stage model) with the workflow-run model
 * (state.stepResults envelope).
 *
 * Sections:
 *   - Header: status + actions (cancel / resume)
 *   - Node execution timeline (from state.stepResults + live SSE)
 *   - Run metrics (tokens, cost, duration)
 *   - Live log feed (SSE)
 */

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Pause, Play, RefreshCw, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/error-state';
import {
  useCancelWorkflowRun,
  useResumeWorkflowRun,
  useRunLiveEvents,
  useWorkflowBudget,
  useWorkflowRun,
} from '@/lib/hooks/useWorkflows';
import type {
  WorkflowBudget,
  WorkflowRun,
  WorkflowStepResult,
} from '@/lib/workflows/types';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'cyan' | 'idle'> = {
  queued: 'idle',
  running: 'cyan',
  waiting_approval: 'amber',
  paused: 'amber',
  succeeded: 'emerald',
  failed: 'rose',
  cancelled: 'idle',
};

const STEP_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'cyan' | 'idle'> = {
  pending: 'idle',
  running: 'cyan',
  waiting_approval: 'amber',
  succeeded: 'emerald',
  failed: 'rose',
  skipped: 'idle',
};

const BUDGET_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'idle'> = {
  active: 'emerald',
  exhausted: 'rose',
  closed: 'idle',
  no_budget: 'idle',
};

export function WorkflowRunDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const { data: run, isLoading, error, refetch } = useWorkflowRun(id);
  const cancel = useCancelWorkflowRun();
  const resume = useResumeWorkflowRun();
  const { events, status: streamStatus } = useRunLiveEvents(id);
  const { data: budget } = useWorkflowBudget(run?.workflow_id ?? null);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-[var(--fg-tertiary)]">
        Loading run…
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <ErrorState
          title="Run not found"
          description={error?.message}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const isTerminal = ['succeeded', 'failed', 'cancelled'].includes(run.status);
  const isPaused = run.status === 'paused' || run.status === 'waiting_approval';

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-6" data-testid="run-detail">
      <header className="card flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/runs"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
            aria-label="Back to runs"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
              Run
            </p>
            <h1 className="font-mono text-base text-[var(--fg-primary)]">{run.id}</h1>
            <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
              workflow <Link href={`/workflows/${run.workflow_id}`} className="underline">{run.workflow_id.slice(0, 8)}</Link>
              {' · '}tenant <code className="font-mono">{run.tenant_id.slice(0, 8)}</code>
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge tone={STATUS_TONE[run.status] ?? 'idle'}>{run.status}</Badge>
          <LiveStreamPill status={streamStatus} />
          <div className="flex items-center gap-2">
            {isPaused ? (
              <Button
                size="sm"
                onClick={() => resume.mutate(run.id)}
                disabled={resume.isPending}
                data-testid={run.status === 'waiting_approval' ? 'run-approve' : 'run-resume'}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {run.status === 'waiting_approval' ? 'Approve & continue' : 'Resume'}
              </Button>
            ) : !isTerminal ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancel.mutate(run.id)}
                disabled={cancel.isPending}
                data-testid="run-cancel"
              >
                <Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
            {isPaused && run.status !== 'waiting_approval' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancel.mutate(run.id)}
                disabled={cancel.isPending}
                data-testid="run-reject"
              >
                <Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Reject
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <BudgetMeter budget={budget} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* Left: node timeline */}
        <section
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
          data-testid="run-timeline"
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            Node execution
          </h2>
          <NodeTimeline run={run} />
        </section>

        {/* Right: metrics + live log */}
        <div className="flex flex-col gap-4">
          <section
            className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
            data-testid="run-metrics"
          >
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Metrics
            </h2>
            <RunMetrics run={run} />
          </section>
          <section
            className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
            data-testid="run-log"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                Live log
              </h2>
              <span className="text-[11px] text-[var(--fg-tertiary)]">{events.length} events</span>
            </div>
            <LiveLog events={events} />
          </section>
        </div>
      </div>
    </div>
  );
}

function LiveStreamPill({ status }: { status: 'idle' | 'connecting' | 'open' | 'closed' | 'error' }) {
  const dot = status === 'open'
    ? 'bg-[var(--accent-emerald)]'
    : status === 'connecting'
      ? 'bg-[var(--accent-amber)] animate-pulse'
      : status === 'error'
        ? 'bg-[var(--accent-rose)]'
        : 'bg-[var(--fg-tertiary)]';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] text-[var(--fg-tertiary)]"
      data-testid="run-stream-pill"
      data-status={status}
    >
      <span aria-hidden="true" className={cn('inline-block h-1.5 w-1.5 rounded-full', dot)} />
      stream: {status}
    </span>
  );
}

function NodeTimeline({ run }: { run: WorkflowRun }) {
  const results = extractStepResults(run);
  if (results.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-tertiary)]">
        No node executions yet. The executor will publish step results as the run progresses.
      </p>
    );
  }
  return (
    <ol className="relative ml-3 flex flex-col gap-3 border-l border-dashed border-[var(--border-subtle)] pl-6">
      {results.map((r) => (
        <li key={r.step_id} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              'absolute -left-[33px] inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--bg-base)]',
              r.status === 'succeeded' && 'bg-[var(--accent-emerald)]/20 text-[var(--accent-emerald)]',
              r.status === 'failed' && 'bg-[var(--accent-rose)]/20 text-[var(--accent-rose)]',
              r.status === 'running' && 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]',
              (r.status === 'pending' || r.status === 'skipped') && 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
              r.status === 'waiting_approval' && 'bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]',
            )}
          >
            <Zap className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
          <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
                {r.step_id}
              </p>
              {r.error ? (
                <p className="mt-0.5 truncate text-[11px] text-[var(--accent-rose)]">
                  {r.error}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {r.duration_ms != null ? (
                <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">
                  {formatDuration(r.duration_ms)}
                </span>
              ) : null}
              <Badge tone={STEP_TONE[r.status] ?? 'idle'} size="sm">
                {r.status}
              </Badge>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function extractStepResults(run: WorkflowRun): WorkflowStepResult[] {
  // The backend's `WorkflowRunRead.state` is a free-form dict that
  // carries `stepResults` (a dict keyed by step_id). Older runs may
  // already be on the legacy array shape; the shape can flip without
  // a schema bump, so we accept both.
  if (Array.isArray(run.step_results)) return run.step_results;
  const state = run.state ?? {};
  const fromState = state.stepResults ?? state.step_results;
  if (Array.isArray(fromState)) return fromState as WorkflowStepResult[];
  if (fromState && typeof fromState === 'object') {
    return Object.entries(fromState).map(([step_id, value]) => ({
      step_id,
      ...((value as object) ?? {}),
    })) as WorkflowStepResult[];
  }
  return [];
}

function RunMetrics({ run }: { run: WorkflowRun }) {
  const state = (run.state ?? {}) as Record<string, unknown>;
  const totalTokensIn = (state.totalTokensInput as number) ?? 0;
  const totalTokensOut = (state.totalTokensOutput as number) ?? 0;
  const totalCost = (state.totalCostUsd as number) ?? 0;
  const durationMs =
    run.started_at && run.finished_at
      ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
      : null;
  return (
    <dl className="grid grid-cols-2 gap-3 text-xs">
      <div>
        <dt className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">Duration</dt>
        <dd className="mt-1 text-sm tabular-nums text-[var(--fg-primary)]">
          {durationMs == null ? '—' : formatDuration(durationMs)}
        </dd>
      </div>
      <div>
        <dt className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">Cost</dt>
        <dd className="mt-1 text-sm tabular-nums text-[var(--fg-primary)]">${totalCost.toFixed(3)}</dd>
      </div>
      <div>
        <dt className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">Tokens in</dt>
        <dd className="mt-1 text-sm tabular-nums text-[var(--fg-primary)]">
          {totalTokensIn.toLocaleString()}
        </dd>
      </div>
      <div>
        <dt className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">Tokens out</dt>
        <dd className="mt-1 text-sm tabular-nums text-[var(--fg-primary)]">
          {totalTokensOut.toLocaleString()}
        </dd>
      </div>
    </dl>
  );
}

function LiveLog({ events }: { events: ReadonlyArray<{ type: string; data: unknown; timestamp: string }> }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length]);
  if (events.length === 0) {
    return (
      <p className="text-xs text-[var(--fg-tertiary)]">
        No live events yet. Events appear as the run progresses.
      </p>
    );
  }
  return (
    <div
      ref={ref}
      className="thin-scrollbar max-h-[400px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[11px] leading-relaxed"
      data-testid="run-log-stream"
    >
      {events.map((e, i) => (
        <div key={i} className="flex gap-2">
          <span className="shrink-0 text-[var(--fg-tertiary)]">+{i}</span>
          <span className="shrink-0 font-semibold text-[var(--accent-cyan)]">{e.type}</span>
          <span className="truncate text-[var(--fg-secondary)]">{summarize(e.data)}</span>
        </div>
      ))}
    </div>
  );
}

function summarize(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data).slice(0, 160);
  } catch {
    return String(data);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  return `${Math.floor(m)}m ${Math.floor(s % 60)}s`;
}

function BudgetMeter({ budget }: { budget?: WorkflowBudget }) {
  if (!budget || !budget.ceiling_usd || budget.ceiling_usd <= 0) return null;
  const pctRaw = budget.headroom_pct ?? 0;
  const spentPct = Math.max(
    0,
    Math.min(100, 100 - pctRaw),
  );
  const tone =
    spentPct >= 90 ? 'rose' : spentPct >= 70 ? 'amber' : 'emerald';
  const fillClass =
    tone === 'rose'
      ? 'bg-[var(--accent-rose)]'
      : tone === 'amber'
        ? 'bg-[var(--accent-amber)]'
        : 'bg-[var(--accent-emerald)]';
  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="run-budget-meter"
      data-status={budget.status}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
            Budget
          </span>
          <span className="font-mono text-xs tabular-nums text-[var(--fg-primary)]">
            ${budget.spent_usd.toFixed(2)} / ${budget.ceiling_usd.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-[var(--fg-tertiary)]">
            {budget.headroom_pct != null
              ? `${budget.headroom_pct.toFixed(1)}% headroom`
              : '—'}
          </span>
          <Badge tone={BUDGET_TONE[budget.status] ?? 'idle'} size="sm">
            {budget.status}
          </Badge>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
        <div
          className={cn('h-full rounded-full transition-all', fillClass)}
          style={{ width: `${spentPct}%` }}
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
