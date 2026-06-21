'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Wand2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { MigrationPlan } from '@/lib/api';
import { EffortEstimate } from './EffortEstimate';

const STATUS_TONE: Record<MigrationPlan['status'], string> = {
  draft: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  pending_approval: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  in_progress: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  complete: 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200',
  archived: 'border-forge-700/60 bg-forge-800/40 text-forge-400',
};

const STATUS_LABEL: Record<MigrationPlan['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  in_progress: 'In progress',
  complete: 'Complete',
  archived: 'Archived',
};

export interface MigrationPlanCardProps {
  plan: MigrationPlan;
  onSelect?: (plan: MigrationPlan) => void;
}

/**
 * Phased plan summary card. Renders the source → target migration
 * pairing, the lifecycle status pill, a stack of `<EffortEstimate>`
 * badges per phase, and an "Open" link to the per-plan detail page.
 */
export function MigrationPlanCard({ plan, onSelect }: MigrationPlanCardProps) {
  const completedPhases = plan.phases.filter((p) => p.status === 'complete').length;
  const totalHours = plan.phases.reduce((sum, p) => sum + p.estimateHours, 0);
  const criticalRisks = plan.risks.filter(
    (r) => r.severity === 'critical' || r.severity === 'high',
  ).length;

  return (
    <article
      data-testid="migration-plan-card"
      data-plan-id={plan.planId}
      data-plan-status={plan.status}
      className="card flex flex-col gap-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
            <Wand2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">{plan.title}</h3>
            <p className="font-mono text-xs text-forge-300">{plan.planId}</p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[plan.status],
          )}
        >
          {STATUS_LABEL[plan.status]}
        </span>
      </header>

      <p className="text-xs text-forge-200">{plan.summary}</p>

      <div className="flex flex-wrap items-center gap-2 text-xs text-forge-300">
        <span className="font-mono">{plan.source}</span>
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
        <span className="font-mono">{plan.target}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {plan.phases.map((p) => (
          <EffortEstimate
            key={p.id}
            effort={p.effort}
            estimateHours={p.estimateHours}
            className="text-[10px]"
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-forge-300">
        <span data-testid="migration-plan-phase-progress">
          {completedPhases}/{plan.phases.length} phases complete
        </span>
        <span aria-hidden="true">·</span>
        <span data-testid="migration-plan-total-hours">{totalHours}h total</span>
        {criticalRisks > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span
              data-testid="migration-plan-critical-risks"
              className="inline-flex items-center gap-1 text-rose-300"
            >
              {criticalRisks} high-risk item{criticalRisks === 1 ? '' : 's'}
            </span>
          </>
        ) : null}
      </div>

      <footer className="flex items-center justify-between border-t border-forge-800 pt-3">
        <time className="text-[10px] text-forge-400">
          Updated {new Date(plan.updatedAt).toLocaleDateString()}
        </time>
        <Link
          href={`/refactor/${plan.planId}`}
          onClick={() => onSelect?.(plan)}
          data-testid="migration-plan-open"
          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
        >
          Open plan
        </Link>
      </footer>
    </article>
  );
}

export interface MigrationPlanListProps {
  plans: ReadonlyArray<MigrationPlan>;
  onSelect?: (plan: MigrationPlan) => void;
  emptyMessage?: string;
}

/** Grid wrapper that renders one `<MigrationPlanCard>` per plan. */
export function MigrationPlanList({ plans, onSelect, emptyMessage }: MigrationPlanListProps) {
  if (plans.length === 0) {
    return (
      <div className="card text-sm text-forge-300" data-testid="migration-plan-list-empty">
        {emptyMessage ?? 'No migration plans yet. Trigger a refactor analysis to generate one.'}
      </div>
    );
  }

  return (
    <ul
      role="list"
      aria-label="Migration plans"
      data-testid="migration-plan-list"
      data-plan-count={plans.length}
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {plans.map((plan) => (
        <li key={plan.planId}>
          <MigrationPlanCard plan={plan} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}