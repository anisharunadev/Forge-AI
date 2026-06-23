'use client';

import * as React from 'react';
import { Bot, Filter } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AgentList } from '@/components/agent-center/AgentList';
import { ModelProviderList } from '@/components/agent-center/ModelProviderList';
import { AgentAssignmentMatrix } from '@/components/agent-center/AgentAssignmentMatrix';
import { RuntimeStatus } from '@/components/agent-center/RuntimeStatus';
import { CreateAgentDialog } from '@/components/agent-center/CreateAgentDialog';
import { AgentDetailPanel } from '@/components/agent-center/AgentDetailPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiData } from '@/hooks/use-api-data';
import { PageHeader } from '@/components/shell';
import {
  TASK_TYPES,
  type Agent,
  type AgentAssignment,
  type AgentStatus,
  type AgentType,
  type ModelProvider,
  type Runtime,
} from '@/lib/agent-center/data';

const STATUS_VALUES: ReadonlyArray<AgentStatus | 'all'> = [
  'all',
  'active',
  'idle',
  'degraded',
  'offline',
];
const TYPE_VALUES: ReadonlyArray<AgentType | 'all'> = [
  'all',
  'cli',
  'scaffold',
  'custom',
  'sdlc',
];

export default function AgentCenterPage() {
  const [typeFilter, setTypeFilter] = React.useState<AgentType | 'all'>('all');
  const [statusFilter, setStatusFilter] = React.useState<AgentStatus | 'all'>('all');
  const [selected, setSelected] = React.useState<Agent | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const agentsRes = useApiData<ReadonlyArray<Agent>>('/v1/agent-center/agents');
  const providersRes = useApiData<ReadonlyArray<ModelProvider>>('/v1/agent-center/providers');
  const assignmentsRes = useApiData<ReadonlyArray<AgentAssignment>>('/v1/agent-center/assignments');
  const runtimesRes = useApiData<ReadonlyArray<Runtime>>('/v1/agent-center/runtimes');

  const agents: ReadonlyArray<Agent> = agentsRes.data ?? [];
  const providers: ReadonlyArray<ModelProvider> = providersRes.data ?? [];
  const assignments: ReadonlyArray<AgentAssignment> = assignmentsRes.data ?? [];
  const runtimes: ReadonlyArray<Runtime> = runtimesRes.data ?? [];

  const filteredAgents = React.useMemo(() => {
    return agents.filter((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      return true;
    });
  }, [agents, typeFilter, statusFilter]);

  const handleSelect = (a: Agent) => {
    setSelected(a);
    setDetailOpen(true);
  };

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="agent-center">
        <PageHeader
          eyebrow="Center"
          title="Agent Center"
          icon={<Bot className="h-4 w-4" aria-hidden="true" />}
          description="Manage the AI agents, model providers, and task assignments available to this tenant."
          action={
            <CreateAgentDialog
              onCreate={(input) => {
                // M2 — live wiring pending. Local-only acknowledgement.
                // eslint-disable-next-line no-console
                console.info('[agent-center] register', input);
              }}
            />
          }
        />

        <Tabs defaultValue="agents" className="w-full">
          <TabsList aria-label="Agent Center sections">
            <TabsTrigger value="agents" data-testid="tab-agents">
              Agents
            </TabsTrigger>
            <TabsTrigger value="providers" data-testid="tab-providers">
              Model Providers
            </TabsTrigger>
            <TabsTrigger value="assignments" data-testid="tab-assignments">
              Assignments
            </TabsTrigger>
            <TabsTrigger value="runtimes" data-testid="tab-runtimes">
              Runtimes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="agents" className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Filter className="h-3 w-3" aria-hidden="true" />
                Filters
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={typeFilter}
                  onValueChange={(v) => setTypeFilter(v as AgentType | 'all')}
                >
                  <SelectTrigger className="w-32" data-testid="filter-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_VALUES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t === 'all' ? 'All types' : t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as AgentStatus | 'all')}
                >
                  <SelectTrigger className="w-32" data-testid="filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s === 'all' ? 'All status' : s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <AgentList
              agents={filteredAgents}
              onSelect={handleSelect}
              emptyMessage="No agents match the current filters."
            />
          </TabsContent>

          <TabsContent value="providers">
            <ModelProviderList providers={providers} />
          </TabsContent>

          <TabsContent value="assignments">
            <AgentAssignmentMatrix
              agents={agents}
              providers={providers}
              assignments={assignments}
              taskTypes={TASK_TYPES}
            />
          </TabsContent>

          <TabsContent value="runtimes">
            <RuntimeStatus runtimes={runtimes} agents={agents} />
          </TabsContent>
        </Tabs>

        <AgentDetailPanel
          agent={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      </div>
    </AdminShell>
  );
}