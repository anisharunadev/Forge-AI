'use client';

/**
 * RunCenterPage — the client component backing `/runs`.
 *
 * Mirrors the `apps/forge/app/ideation/page.tsx` chrome:
 * `<AdminShell>`, `<PageHeader>`, `<Tabs>`, status filter,
 * `<EmptyState>`. Uses TanStack Query for the data fetch and
 * `useRealtime` to subscribe to `run.*` WS frames.
 */

import * as React from 'react';
import { Activity } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState,
  PageContainer,
  PageHeader,
  SectionCard,
} from '@/components/shell';
import { NewRunDialog } from '@/components/runs/NewRunDialog';
import { RunIndexTable } from '@/components/runs/RunIndexTable';
import { OrchestratorUnreachable } from '@/components/OrchestratorNotice';
import { useRunsIndex } from '@/lib/hooks/useRuns';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RunStatusBadge } from '@/components/RunStatusBadge';
import type { RunRecord, RunStatus } from '@/lib/types';

const STATUS_OPTIONS: ReadonlyArray<RunStatus | 'all'> = [
  'all',
  'created',
  'running',
  'waiting_approval',
  'paused',
  'aborted',
  'finished',
  'done',
];

function isActive(s: RunStatus): boolean {
  return s === 'created' || s === 'running' || s === 'waiting_approval' || s === 'paused';
}

function isArchived(s: RunStatus): boolean {
  return s === 'aborted' || s === 'finished' || s === 'done';
}

export function RunCenterPage() {
  const [statusFilter, setStatusFilter] = React.useState<RunStatus | 'all'>('all');
  const [tab, setTab] = React.useState<'all' | 'active' | 'archived'>('all');

  const res = useRunsIndex();

  const runs: ReadonlyArray<RunRecord> =
    res.data?.state === 'ok' ? res.data.runs : [];

  const filteredByStatus = React.useMemo(
    () => (statusFilter === 'all' ? runs : runs.filter((r) => r.status === statusFilter)),
    [runs, statusFilter],
  );

  const filteredByTab = React.useMemo(
    () =>
      filteredByStatus.filter((r) => {
        if (tab === 'active') return isActive(r.status);
        if (tab === 'archived') return isArchived(r.status);
        return true;
      }),
    [filteredByStatus, tab],
  );

  const counts = React.useMemo(() => {
    let active = 0;
    let archived = 0;
    for (const r of runs) {
      if (isActive(r.status)) active += 1;
      else if (isArchived(r.status)) archived += 1;
    }
    return { all: runs.length, active, archived };
  }, [runs]);

  return (
    <AdminShell>
      <PageContainer>
        <div className="flex flex-col gap-6" data-testid="runs-center">
          <PageHeader
            eyebrow="Center"
            title="Runs Center"
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            description="Browse every run, see which agent is currently driving it, and inspect production details (cost, stage, trigger, agent ownership)."
            action={<NewRunDialog />}
          />

          {res.isLoading ? (
            <div
              className="rounded-md border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground"
              data-testid="runs-loading"
            >
              Loading runs…
            </div>
          ) : res.data?.state === 'unreachable' ? (
            <OrchestratorUnreachable
              error={res.data.error}
              status={res.data.status}
            />
          ) : (
            <SectionCard
              title="Runs"
              description={`${counts.all} run${counts.all === 1 ? '' : 's'} visible to the seeded tenant.`}
              headerRight={
                <Select
                  value={statusFilter}
                  onValueChange={(v: string) => setStatusFilter(v as RunStatus | 'all')}
                >
                  <SelectTrigger className="w-44" data-testid="runs-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2">
                          {s === 'all' ? (
                            'All statuses'
                          ) : (
                            <RunStatusBadge status={s} />
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              <Tabs value={tab} onValueChange={(v: string) => setTab(v as 'all' | 'active' | 'archived')}>
                <TabsList aria-label="Runs Center sections">
                  <TabsTrigger value="all" data-testid="runs-tab-all">
                    All ({counts.all})
                  </TabsTrigger>
                  <TabsTrigger value="active" data-testid="runs-tab-active">
                    Active ({counts.active})
                  </TabsTrigger>
                  <TabsTrigger value="archived" data-testid="runs-tab-archived">
                    Archived ({counts.archived})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value={tab} className="mt-4">
                  {filteredByTab.length === 0 ? (
                    <EmptyState
                      icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                      title={tab === 'all' ? 'No runs yet' : `No ${tab} runs`}
                      description={
                        tab === 'all'
                          ? 'Click "New run" to create the first run, or seed demo-run-001 via the orchestrator stub.'
                          : 'No runs match the current filter — try a different status or tab.'
                      }
                      testId="runs-empty"
                    />
                  ) : (
                    <RunIndexTable runs={filteredByTab} />
                  )}
                </TabsContent>
              </Tabs>
            </SectionCard>
          )}
        </div>
      </PageContainer>
    </AdminShell>
  );
}
