'use client';

import * as React from 'react';
import Link from 'next/link';
import { Wand2, Plus } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MigrationPlanList } from '@/components/refactor/MigrationPlanCard';
import { useMigrationPlans } from '@/lib/hooks/useMigrationPlans';
import type { MigrationPlan } from '@/lib/api';

/**
 * Static fallback when the orchestrator stub isn't running. Mirrors
 * the shape returned by `/v1/refactor/projects/{projectId}/plans` so
 * the UI can render without a backend.
 */
const SEED_PROJECT_ID = 'project-forge-demo';

const DEMO_PLANS: ReadonlyArray<MigrationPlan> = [
  {
    planId: 'plan-001',
    projectId: SEED_PROJECT_ID,
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
    ],
  },
  {
    planId: 'plan-002',
    projectId: SEED_PROJECT_ID,
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
];

export default function RefactorCenterPage() {
  const [projectId, setProjectId] = React.useState<string>(SEED_PROJECT_ID);
  const query = useMigrationPlans(projectId);

  // Fall back to the demo dataset when the orchestrator isn't reachable
  // so the list still renders in dev.
  const plans = query.data && query.data.length > 0 ? query.data : DEMO_PLANS;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="refactor-center">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Wand2 className="h-5 w-5" aria-hidden="true" />
              Refactor Center
            </h1>
            <Button asChild data-testid="refactor-new-trigger">
              <Link href="/refactor/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New analysis
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Browse recent migration plans per project, drill into the phased
            breakdown, and trigger new refactor analyses against the
            orchestrator.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56" data-testid="refactor-project-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEED_PROJECT_ID}>{SEED_PROJECT_ID}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {query.isLoading ? (
          <div className="card text-sm text-forge-300" data-testid="refactor-loading">
            Loading migration plans…
          </div>
        ) : null}

        {query.isError ? (
          <div
            role="alert"
            className="card border-amber-500/40 bg-amber-500/5 text-sm text-amber-200"
            data-testid="refactor-error"
          >
            Orchestrator unreachable — showing seed data. ({query.error?.message})
          </div>
        ) : null}

        <MigrationPlanList
          plans={plans}
          emptyMessage="No migration plans yet. Trigger a refactor analysis to generate one."
        />
      </div>
    </AdminShell>
  );
}