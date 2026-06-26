'use client';

import * as React from 'react';
import {
  Bot,
  PlugZap,
  Server,
  Link2,
  Sparkles,
} from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AgentCenterBento } from '@/components/agent-center/AgentCenterBento';
import { ModelProviderList } from '@/components/agent-center/ModelProviderList';
import { AgentAssignmentMatrix } from '@/components/agent-center/AgentAssignmentMatrix';
import { RuntimeStatus } from '@/components/agent-center/RuntimeStatus';
import { CreateAgentDialog } from '@/components/agent-center/CreateAgentDialog';
import { AgentDetailPanel } from '@/components/agent-center/AgentDetailPanel';
import { AgentCenterExplainerHero } from '@/components/agent-center/AgentCenterExplainerHero';
import { AgentMentalModelDiagram } from '@/components/agent-center/AgentMentalModelDiagram';
import { AgentOnboardingWizard } from '@/components/agent-center/AgentOnboardingWizard';
import { FirstTimeTooltip } from '@/components/agent-center/FirstTimeTooltip';
import { AgentCenterEmptyState } from '@/components/agent-center/AgentCenterEmptyState';
import {
  CommonAgentPatterns,
  COMMON_AGENT_PATTERNS,
  type AgentPattern,
} from '@/components/agent-center/CommonAgentPatterns';
import { Button } from '@/components/ui/button';
import { SegmentedControl, FilterBar } from '@/components/agent-center/AgentCenterControls';
import { useApiData } from '@/hooks/use-api-data';
import { useToast } from '@/hooks/use-toast';
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
  const [tab, setTab] = React.useState<'agents' | 'providers' | 'assignments' | 'runtimes'>('agents');
  const [typeFilter, setTypeFilter] = React.useState<AgentType | 'all'>('all');
  const [statusFilter, setStatusFilter] = React.useState<AgentStatus | 'all'>('all');
  const [selected, setSelected] = React.useState<Agent | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const { toast } = useToast();

  const agentsRes = useApiData<ReadonlyArray<Agent>>('/v1/agent-center/agents');
  const providersRes = useApiData<ReadonlyArray<ModelProvider>>('/v1/agent-center/providers');
  const assignmentsRes = useApiData<ReadonlyArray<AgentAssignment>>('/v1/agent-center/assignments');
  const runtimesRes = useApiData<ReadonlyArray<Runtime>>('/v1/agent-center/runtimes');

  const agents: ReadonlyArray<Agent> = agentsRes.data ?? [];
  const providers: ReadonlyArray<ModelProvider> = providersRes.data ?? [];
  const assignments: ReadonlyArray<AgentAssignment> = assignmentsRes.data ?? [];
  const runtimes: ReadonlyArray<Runtime> = runtimesRes.data ?? [];

  // First-run state — drives explainer hero, diagram, and rich tab copy.
  const isFirstRun =
    agents.length === 0 &&
    providers.length === 0 &&
    runtimes.length === 0 &&
    assignments.length === 0;

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

  const openGuidedSetup = React.useCallback(() => setWizardOpen(true), []);
  const skipToCatalog = React.useCallback(
    () => setTab('agents'),
    [],
  );

  const handleWizardFinish = React.useCallback(() => {
    toast({
      title: 'Your first agent is set up and ready to work',
      description: 'Pulse animation lands on the new agent below.',
    });
  }, [toast]);

  const handleUsePattern = React.useCallback(
    (pattern: AgentPattern) => {
      // Pre-fill via localStorage hint and open the wizard.
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(
            'forge.agent-center.onboarding-wizard.pattern.v1',
            JSON.stringify({ id: pattern.id, startedAt: new Date().toISOString() }),
          );
        }
      } catch {
        /* ignore quota errors */
      }
      toast({
        title: `Pattern: ${pattern.name}`,
        description: 'Wizard opened with this pattern pre-filled.',
      });
      setWizardOpen(true);
    },
    [toast],
  );

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="agent-center">
        {isFirstRun ? (
          <>
            <AgentCenterExplainerHero
              onGuidedSetup={openGuidedSetup}
              onSkipToCatalog={skipToCatalog}
            />
            <FirstTimeTooltip
              enabled={isFirstRun}
              onActivate={openGuidedSetup}
            />
            <AgentMentalModelDiagram />
          </>
        ) : (
          <PageHeader
            eyebrow="Center"
            title="Agent Center"
            icon={<Bot className="h-4 w-4" aria-hidden="true" />}
            description="Manage the AI agents, model providers, and task assignments available to this tenant."
            action={
              <div className="flex items-center gap-2" data-testid="post-first-run-actions">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openGuidedSetup}
                  data-testid="add-another"
                  className="border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Add another
                </Button>
                <CreateAgentDialog
                  onCreate={(input) => {
                    // M2 — live wiring pending. Local-only acknowledgement.
                    // eslint-disable-next-line no-console
                    console.info('[agent-center] register', input);
                  }}
                />
              </div>
            }
          />
        )}

        <SegmentedControl
          ariaLabel="Agent Center sections"
          value={tab}
          onChange={(v) => setTab(v as 'agents' | 'providers' | 'assignments' | 'runtimes')}
          options={[
            { value: 'agents', label: 'Agents', testId: 'tab-agents' },
            { value: 'providers', label: 'Model Providers', testId: 'tab-providers' },
            { value: 'assignments', label: 'Assignments', testId: 'tab-assignments' },
            { value: 'runtimes', label: 'Runtimes', testId: 'tab-runtimes' },
          ]}
        />

        {tab === 'agents' ? (
          <div className="space-y-4" data-testid="panel-agents">
            <FilterBar
              statusOptions={STATUS_VALUES.map((s) => ({
                value: s,
                label: s === 'all' ? 'All' : s,
                count: s === 'all' ? agents.length : agents.filter((a) => a.status === s).length,
              }))}
              statusValue={statusFilter}
              onStatusChange={(v) => setStatusFilter(v as AgentStatus | 'all')}
              typeOptions={TYPE_VALUES.map((t) => ({ value: t, label: t === 'all' ? 'All types' : t }))}
              typeValue={typeFilter}
              onTypeChange={(v) => setTypeFilter(v as AgentType | 'all')}
              activeFilterCount={
                (typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)
              }
              onClearAll={() => {
                setTypeFilter('all');
                setStatusFilter('all');
              }}
            />
            {agents.length === 0 ? (
              <AgentCenterEmptyState
                testId="tab-empty-agents"
                icon={<Bot className="h-5 w-5" aria-hidden="true" />}
                title="No agents registered yet"
                description="Agents are AI workers that execute forge-* commands — code review, refactor, deploy, and more. Without one, your workflows can't run. Register your first agent to get started."
                primary={{
                  label: 'Register Agent',
                  onClick: openGuidedSetup,
                  icon: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />,
                }}
                secondary={{ label: 'Browse agent templates', onClick: openGuidedSetup }}
                learnMoreHref="/docs/agents"
              />
            ) : (
              <AgentCenterBento
                agents={filteredAgents}
                providers={providers}
                onSelectAgent={handleSelect}
                onRegisterAgent={() => {
                  // routed via CreateAgentDialog action — kept here for hook
                }}
              />
            )}
          </div>
        ) : null}

        {tab === 'providers' ? (
          <div className="space-y-4" data-testid="panel-providers">
            <header className="card flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-primary)]">
                  Get connected
                </p>
                <h2 className="mt-1 text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
                  Connect a provider
                </h2>
                <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                  Plug in OpenAI, Anthropic, or any OpenAI-compatible endpoint. {providers.length} connected.
                </p>
              </div>
              <Button
                type="button"
                data-testid="providers-connect"
                onClick={openGuidedSetup}
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                Connect Provider
              </Button>
            </header>
            {providers.length === 0 && isFirstRun ? (
              <AgentCenterEmptyState
                testId="tab-empty-providers"
                icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
                title="No model providers connected"
                description="Model providers are the LLM backends (Anthropic, OpenAI, Bedrock) that power your agents. Connect at least one to enable agent execution."
                primary={{
                  label: 'Connect Provider',
                  onClick: openGuidedSetup,
                  icon: <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />,
                }}
                secondary={{ label: 'See all supported providers', href: '/docs/providers' }}
                learnMoreHref="/docs/providers"
              />
            ) : (
              <ModelProviderList
                providers={providers}
                onConnect={openGuidedSetup}
                onReadDocs={() => {
                  if (typeof window !== 'undefined') window.location.href = '/docs/providers';
                }}
              />
            )}
          </div>
        ) : null}

        {tab === 'assignments' ? (
          <div className="space-y-4" data-testid="panel-assignments">
            <header className="card flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-primary)]">
                  Orchestrate
                </p>
                <h2 className="mt-1 text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
                  Assignments
                </h2>
                <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                  Map task types to the right agent + provider. {assignments.length} active assignments.
                </p>
              </div>
              <Button
                type="button"
                data-testid="assignments-new"
                onClick={openGuidedSetup}
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                New Assignment
              </Button>
            </header>
            {assignments.length === 0 && isFirstRun ? (
              <AgentCenterEmptyState
                testId="tab-empty-assignments"
                icon={<Link2 className="h-5 w-5" aria-hidden="true" />}
                title="No assignments yet"
                description="Assignments map agents to projects. Without one, your agent has no work to do. Assign your agent to a project to start orchestrating tasks."
                primary={{
                  label: 'New Assignment',
                  onClick: openGuidedSetup,
                  icon: <Link2 className="h-3.5 w-3.5" aria-hidden="true" />,
                }}
                secondary={{ label: 'How assignments work', href: '/docs/assignments' }}
                learnMoreHref="/docs/assignments"
              />
            ) : (
              <AgentAssignmentMatrix
                agents={agents}
                providers={providers}
                assignments={assignments}
                taskTypes={TASK_TYPES}
                onCreateAssignment={openGuidedSetup}
              />
            )}
          </div>
        ) : null}

        {tab === 'runtimes' ? (
          <div className="space-y-4" data-testid="panel-runtimes">
            <header className="card flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-primary)]">
                  Execution
                </p>
                <h2 className="mt-1 text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
                  Runtimes
                </h2>
                <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                  Sandboxes where agents execute. {runtimes.length} active runtimes.
                </p>
              </div>
              <Button
                type="button"
                data-testid="runtimes-register"
                onClick={openGuidedSetup}
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                Register Runtime
              </Button>
            </header>
            {runtimes.length === 0 && isFirstRun ? (
              <AgentCenterEmptyState
                testId="tab-empty-runtimes"
                icon={<Server className="h-5 w-5" aria-hidden="true" />}
                title="No runtimes registered"
                description="Runtimes are execution environments — local Docker for development, Kubernetes for production. This is where your agents actually do the work. Configure your first runtime to enable agent execution."
                primary={{
                  label: 'Register Runtime',
                  onClick: openGuidedSetup,
                  icon: <Server className="h-3.5 w-3.5" aria-hidden="true" />,
                }}
                secondary={{ label: 'How runtimes work', href: '/docs/runtimes' }}
                learnMoreHref="/docs/runtimes"
              />
            ) : (
              <RuntimeStatus
                runtimes={runtimes}
                agents={agents}
                onRegisterRuntime={openGuidedSetup}
              />
            )}
          </div>
        ) : null}

        {/* Always-visible inspiration grid (Addition 6). */}
        <CommonAgentPatterns onUsePattern={handleUsePattern} />

        {/* Common-pattern catalog anchor — the empty-state "Browse
            agent templates" CTA scrolls here. */}
        <div id="patterns-catalog" className="sr-only" aria-hidden="true">
          {COMMON_AGENT_PATTERNS.map((p) => p.name).join(' · ')}
        </div>

        <AgentDetailPanel
          agent={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />

        <AgentOnboardingWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onFinish={handleWizardFinish}
        />

        {/* Dev-only acknowledgement so we know the patterns grid is wired. */}
        <span className="sr-only" aria-hidden="true" data-testid="agent-center-page-version">
          step-43
        </span>
      </div>
    </AdminShell>
  );
}
