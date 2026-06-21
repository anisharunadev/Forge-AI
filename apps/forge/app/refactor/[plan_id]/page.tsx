'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Wand2 } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PhaseTimeline } from '@/components/refactor/PhaseTimeline';
import { RiskRegister } from '@/components/refactor/RiskRegister';
import { PushToJiraButton } from '@/components/refactor/PushToJiraButton';
import { useMigrationPlan } from '@/lib/hooks/useMigrationPlans';
import type { MigrationPlan } from '@/lib/api';
import { cn } from '@/lib/utils';

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

/**
 * Local fallback used while the orchestrator is unreachable so the
 * phased view still renders in dev. Mirrors the shape returned by
 * `/v1/refactor/plans/{planId}`.
 */
const DEMO_PLANS: Record<string, MigrationPlan> = {
  'plan-001': {
    planId: 'plan-001',
    projectId: 'project-forge-demo',
    tenantId: '00000000-0000-4000-8000-000000000ace',
    source: 'postgres-14',
    target: 'postgres-17',
    title: 'Postgres 14 → 17 cutover',
    summary:
      'Migrate the primary OLTP cluster from Postgres 14 to 17, leveraging logical replication and the new pg_basebackup streaming improvements.',
    createdAt: '2026-06-15T09:00:00Z',
    updatedAt: '2026-06-20T17:20:00Z',
    status: 'in_progress',
    phases: [
      {
        id: 'phase-001-1',
        index: 1,
        title: 'Compatibility scan',
        summary: 'Run pg_upgrade --check across all replicas.',
        effort: 'S',
        estimateHours: 4,
        status: 'complete',
        tasks: ['Run check tool', 'Capture extension inventory'],
      },
      {
        id: 'phase-001-2',
        index: 2,
        title: 'Replica provisioning',
        summary: 'Stand up a fresh PG17 cluster behind the load balancer.',
        effort: 'M',
        estimateHours: 16,
        status: 'in_progress',
        tasks: ['Provision nodes', 'Configure replication slots'],
      },
      {
        id: 'phase-001-3',
        index: 3,
        title: 'Cutover',
        summary: 'Flip read traffic; pause writes; promote replica.',
        effort: 'L',
        estimateHours: 24,
        status: 'pending',
        tasks: ['Maintenance window', 'Promote replica', 'Decommission old primary'],
      },
    ],
    risks: [
      {
        id: 'risk-001-1',
        phaseId: 'phase-001-3',
        title: 'Long-running transactions block promotion',
        severity: 'high',
        mitigation: 'Pre-flight advisory lock audit + cancel blocked sessions.',
        owner: 'Priya Shah',
      },
      {
        id: 'risk-001-2',
        phaseId: 'phase-001-2',
        title: 'Replication lag spikes during snapshot',
        severity: 'medium',
        mitigation: 'Throttle writes during snapshot; resume post-promotion.',
        owner: 'Diego Romero',
      },
    ],
  },
  'plan-002': {
    planId: 'plan-002',
    projectId: 'project-forge-demo',
    tenantId: '00000000-0000-4000-8000-000000000ace',
    source: 'airflow-2.4',
    target: 'airflow-3.0',
    title: 'Airflow 2 → 3 migration',
    summary: 'Adopt Airflow 3 with task SDK + dynamic task mapping changes.',
    createdAt: '2026-06-18T14:30:00Z',
    updatedAt: '2026-06-21T08:15:00Z',
    status: 'pending_approval',
    phases: [
      {
        id: 'phase-002-1',
        index: 1,
        title: 'DAG audit',
        summary: 'Identify deprecated operators and trigger rules.',
        effort: 'M',
        estimateHours: 12,
        status: 'pending',
        tasks: ['Scan DAGs', 'Document gaps'],
      },
      {
        id: 'phase-002-2',
        index: 2,
        title: 'Provider upgrades',
        summary: 'Bump provider packages; resolve breaking changes.',
        effort: 'L',
        estimateHours: 32,
        status: 'pending',
        tasks: ['Bump providers', 'Test in staging'],
      },
    ],
    risks: [],
  },
};

interface PageProps {
  readonly params: Promise<{ plan_id: string }>;
}

export default function MigrationPlanDetailPage({ params }: PageProps) {
  const router = useRouter();
  const resolvedParams = React.use(params);
  const planId = resolvedParams?.plan_id ?? '';
  const query = useMigrationPlan(planId);

  const plan: MigrationPlan | undefined = query.data ?? DEMO_PLANS[planId];

  React.useEffect(() => {
    if (!planId) {
      router.push('/refactor');
    }
  }, [planId, router]);

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="refactor-plan-detail">
        <nav className="text-xs text-forge-300" aria-label="Breadcrumb">
          <Link
            href="/refactor"
            className="inline-flex items-center gap-1 hover:text-forge-100"
            data-testid="refactor-plan-back"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Refactor Center
          </Link>
        </nav>

        {query.isLoading ? (
          <div className="card text-sm text-forge-300" data-testid="refactor-plan-loading">
            Loading migration plan…
          </div>
        ) : null}

        {query.isError ? (
          <div
            role="alert"
            className="card border-amber-500/40 bg-amber-500/5 text-sm text-amber-200"
            data-testid="refactor-plan-error"
          >
            Orchestrator unreachable — showing seed data. ({query.error?.message})
          </div>
        ) : null}

        {plan ? (
          <>
            <header className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Wand2 className="h-5 w-5 text-forge-300" aria-hidden="true" />
                <h1 className="text-2xl font-semibold">{plan.title}</h1>
                <span
                  data-testid="refactor-plan-status"
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    STATUS_TONE[plan.status],
                  )}
                >
                  {STATUS_LABEL[plan.status]}
                </span>
              </div>
              <p className="text-sm text-forge-200">{plan.summary}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-forge-300">
                <span className="font-mono">{plan.planId}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{plan.source}</span>
                <span aria-hidden="true">→</span>
                <span className="font-mono">{plan.target}</span>
                <span aria-hidden="true">·</span>
                <span>Updated {new Date(plan.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <PushToJiraButton planId={plan.planId} />
              </div>
            </header>

            <section
              aria-labelledby="phases-h"
              className="space-y-3"
              data-testid="refactor-plan-phases"
            >
              <h2 id="phases-h" className="text-lg font-semibold">
                Phased plan
              </h2>
              <PhaseTimeline phases={plan.phases} />
            </section>

            <section
              aria-labelledby="risks-h"
              className="space-y-3"
              data-testid="refactor-plan-risks"
            >
              <h2 id="risks-h" className="text-lg font-semibold">
                Risks
              </h2>
              <RiskRegister risks={plan.risks} phases={plan.phases} />
            </section>
          </>
        ) : (
          !query.isLoading && (
            <div
              className="card border-rose-500/40 bg-rose-500/5 text-sm text-rose-200"
              data-testid="refactor-plan-empty"
            >
              Migration plan <span className="font-mono">{planId}</span> not found.
            </div>
          )
        )}
      </div>
    </AdminShell>
  );
}