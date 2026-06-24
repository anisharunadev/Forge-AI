'use client';

import * as React from 'react';
import { Network, AlertTriangle } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ADRSidebar } from '@/components/architecture/ADRSidebar';
import { ADRViewer } from '@/components/architecture/ADRViewer';
import { ADRCreateDialog } from '@/components/architecture/ADRCreateDialog';
import { APIContractList } from '@/components/architecture/APIContractList';
import { APIContractViewer } from '@/components/architecture/APIContractViewer';
import {
  TaskBreakdownList,
  TaskBreakdownTree,
} from '@/components/architecture/TaskBreakdownTree';
import {
  RiskRegisterList,
  RiskRegisterTable,
} from '@/components/architecture/RiskRegisterTable';
import { TraceabilityGraph } from '@/components/architecture/TraceabilityGraph';
import { VersionTimeline } from '@/components/architecture/VersionTimeline';
import { DemoStateCard } from '@/components/seeds/DemoStateCard';
import { useApiData } from '@/hooks/use-api-data';
import { PageHeader, EmptyState } from '@/components/shell';
import { Badge } from '@/components/ui/badge';
import type {
  ADR,
  APIContract,
  TaskBreakdown,
  RiskRegister,
  TraceabilityGraph as TraceabilityGraphType,
  ArchitectureVersion,
} from '@/lib/architecture/data';

const EMPTY_TRACEABILITY: TraceabilityGraphType = {
  id: 'tg-empty',
  title: 'Traceability',
  nodes: [],
  edges: [],
};

export default function ArchitectureCenterPage() {
  const adrsRes = useApiData<ReadonlyArray<ADR>>('/v1/architecture/adrs');
  const contractsRes = useApiData<ReadonlyArray<APIContract>>(
    '/v1/architecture/contracts',
  );
  const breakdownsRes = useApiData<ReadonlyArray<TaskBreakdown>>(
    '/v1/architecture/task-breakdowns',
  );
  const registersRes = useApiData<ReadonlyArray<RiskRegister>>(
    '/v1/architecture/risk-registers',
  );
  const versionsRes = useApiData<ReadonlyArray<ArchitectureVersion>>(
    '/v1/architecture/versions',
  );
  const traceabilityRes = useApiData<TraceabilityGraphType>(
    '/v1/architecture/traceability',
  );

  const adrs = adrsRes.data ?? [];
  const contracts = contractsRes.data ?? [];
  const breakdowns = breakdownsRes.data ?? [];
  const registers = registersRes.data ?? [];
  const versions = versionsRes.data ?? [];
  const traceability = traceabilityRes.data ?? EMPTY_TRACEABILITY;

  // ---------------------------------------------------------------------------
  // Demo-state (Plan G commit 4) — the acme-corp seed ships with three
  // intentional conflicts to demo the ADR-003 ("resolve drift before
  // merge") workflow. We surface the count as a header badge so the user
  // knows the seed is loaded and where to look for the conflicts. The
  // raw conflict data lives in `data/22_conflicts.json`; a dedicated
  // `/v1/architecture/conflicts` API is tracked outside Plan G's scope.
  // ---------------------------------------------------------------------------
  const DEMO_CONFLICT_COUNT = 3;

  const [selectedADR, setSelectedADR] = React.useState<ADR | null>(adrs[0] ?? null);
  const [selectedContract, setSelectedContract] = React.useState<APIContract | null>(
    contracts[0] ?? null,
  );
  const [selectedBreakdown, setSelectedBreakdown] =
    React.useState<TaskBreakdown | null>(breakdowns[0] ?? null);
  const [selectedRegister, setSelectedRegister] = React.useState<RiskRegister | null>(
    registers[0] ?? null,
  );

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="architecture-center">
        <PageHeader
          eyebrow="Center"
          title="Architecture Center"
          icon={<Network className="h-4 w-4" aria-hidden="true" />}
          description="ADRs, API contracts, task breakdowns, risk registers, and full traceability from requirement to test."
          action={
            <div className="flex items-center gap-2">
              {/*
               * Plan G commit 4 — demo conflict badge. The acme-corp
               * seed ships 3 intentional conflicts so reviewers can
               * walk through the resolve-drift workflow against
               * ADR-003 ("Resolve Drift Before Merge"). The badge
               * is a static count today; once a `/v1/architecture/
               * conflicts` API lands it can be wired to the live
               * value without touching the page.
               */}
              <Badge
                variant="destructive"
                data-testid="architecture-conflict-badge"
                aria-label={`${DEMO_CONFLICT_COUNT} intentional demo conflicts`}
              >
                <AlertTriangle
                  className="mr-1 h-3 w-3"
                  aria-hidden="true"
                />
                Demo: {DEMO_CONFLICT_COUNT} intentional conflicts
              </Badge>
              <ADRCreateDialog
                onCreate={(input) => {
                  // eslint-disable-next-line no-console
                  console.info('[architecture] create ADR', input);
                }}
              />
            </div>
          }
        />

        <DemoStateCard seedName="acme-corp" />

        <Tabs defaultValue="adrs" className="w-full">
          <TabsList aria-label="Architecture Center sections">
            <TabsTrigger value="adrs" data-testid="tab-adrs">ADRs</TabsTrigger>
            <TabsTrigger value="contracts" data-testid="tab-contracts">API Contracts</TabsTrigger>
            <TabsTrigger value="tasks" data-testid="tab-tasks">Task Breakdowns</TabsTrigger>
            <TabsTrigger value="risks" data-testid="tab-risks">Risk Registers</TabsTrigger>
            <TabsTrigger value="trace" data-testid="tab-trace">Traceability</TabsTrigger>
            <TabsTrigger value="versions" data-testid="tab-versions">Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="adrs">
            {adrs.length === 0 ? (
              <EmptyState
                icon={<Network className="h-5 w-5" aria-hidden="true" />}
                title="No ADRs yet"
                description="ADRs are produced by the architecture pipeline. Create one to get started."
                testId="adrs-empty"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
                <ADRSidebar
                  adrs={adrs}
                  selectedId={selectedADR?.id}
                  onSelect={setSelectedADR}
                />
                <div>
                  {selectedADR ? <ADRViewer adr={selectedADR} /> : (
                    <p className="text-sm text-muted-foreground">Select an ADR from the left rail.</p>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="contracts" className="space-y-4">
            <APIContractList
              contracts={contracts}
              selectedId={selectedContract?.id}
              onSelect={setSelectedContract}
            />
            {selectedContract ? <APIContractViewer contract={selectedContract} /> : null}
          </TabsContent>

          <TabsContent value="tasks" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
              <TaskBreakdownList
                breakdowns={breakdowns}
                selectedId={selectedBreakdown?.id}
                onSelect={setSelectedBreakdown}
              />
              <div>
                {selectedBreakdown ? (
                  <TaskBreakdownTree breakdown={selectedBreakdown} />
                ) : null}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="risks" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
              <RiskRegisterList
                registers={registers}
                selectedId={selectedRegister?.id}
                onSelect={setSelectedRegister}
              />
              <div>
                {selectedRegister ? (
                  <RiskRegisterTable register={selectedRegister} />
                ) : null}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="trace">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{traceability.title}</h3>
              <p className="text-xs text-muted-foreground">
                Requirement → ADR → Task → Test → Risk.
              </p>
              <TraceabilityGraph graph={traceability} />
            </div>
          </TabsContent>

          <TabsContent value="versions">
            <VersionTimeline versions={versions} />
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}