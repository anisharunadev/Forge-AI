'use client';

/**
 * Agent Center page (step-54 — Phase 2 Agents + Providers wiring).
 *
 * Wires the Agents / Model Providers / Assignments / Runtimes tabs to
 * the real FastAPI backend. Every list, create, delete, and test call
 * goes through the typed React Query hooks in `lib/query/hooks.ts`
 * (TanStack Query, see `components/providers.tsx`).
 *
 * Adapters in `lib/agent-center/adapter.ts` translate the lean
 * backend shapes into the richer UI shapes the existing card
 * components already expect. This keeps the Step 4 + Step 43 visual
 * design intact while the data layer is now live.
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — every API call flows through
 *     `lib/api/client.ts` which automatically attaches
 *     `Authorization: Bearer …` and `x-forge-tenant-id` headers.
 *   - **Auditability (Rule 6)** — the backend `@audit()` decorator
 *     logs every mutation; the UI just shows a toast.
 *   - **Empty states explain (Rule 15)** — every empty state has
 *     a clear value proposition + primary action, never bare
 *     "No data".
 *   - **No emoji icons (Design System)** — Lucide only.
 */

import * as React from 'react';
import { Bot, PlugZap, Server, Link2, Sparkles, Plus } from 'lucide-react';

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
import { useToast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/shell';
import {
  useAgents,
  useProviders,
  useRuntimes,
  useDeleteAgent,
  useTestAgent,
} from '@/lib/query/hooks';
import {
  agentsToUi,
  providersToUi,
  runtimesToUi,
  TASK_TYPES,
} from '@/lib/agent-center/adapter';
import type {
  Agent,
  AgentStatus,
  AgentType,
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

  // ------------------------------------------------------------------
  // Real backend wiring (step-54 Phase 2)
  // ------------------------------------------------------------------
  const agentsRes = useAgents();
  const providersRes = useProviders();
  const runtimesRes = useRuntimes();
  const deleteAgent = useDeleteAgent();

  // Map backend shapes → UI shapes via the adapter.
  const agents: ReadonlyArray<Agent> = React.useMemo(
    () => agentsToUi(agentsRes.data),
    [agentsRes.data],
  );
  const providers = React.useMemo(
    () => providersToUi(providersRes.data),
    [providersRes.data],
  );
  const runtimes = React.useMemo(
    () => runtimesToUi(runtimesRes.data),
    [runtimesRes.data],
  );

  // Assignments are read-only peek queries; we surface one per task type.
  // For now we don't fetch them all to avoid N+1; we keep an empty array
  // so the matrix renders its empty state (the wizard handles the full
  // assignment flow).
  const assignments: ReadonlyArray<never> = [];

  const isFirstRun =
    agents.length === 0 &&
    providers.length === 0 &&
    runtimes.length === 0;

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
  const skipToCatalog = React.useCallback(() => setTab('agents'), []);

  const handleWizardFinish = React.useCallback(() => {
    toast({
      title: 'Your first agent is set up and ready to work',
      description: 'Pulse animation lands on the new agent below.',
    });
  }, [toast]);

  const handleUsePattern = React.useCallback(
    (pattern: AgentPattern) => {
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

  // ------------------------------------------------------------------
  // Loading + error states (Rule 15 / Zone 8)
  // ------------------------------------------------------------------
  const anyLoading = agentsRes.isLoading || providersRes.isLoading || runtimesRes.isLoading;
  const anyError = agentsRes.error || providersRes.error || runtimesRes.error;
  const refetchAll = React.useCallback(() => {
    void agentsRes.refetch();
    void providersRes.refetch();
    void runtimesRes.refetch();
  }, [agentsRes, providersRes, runtimesRes]);

  if (anyLoading && agents.length === 0 && providers.length === 0 && runtimes.length === 0) {
    return (
      <AdminShell>
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-sm text-[var(--fg-secondary)]">
          <Bot className="h-6 w-6 animate-pulse text-[var(--accent-primary)]" aria-hidden="true" />
          Loading Agent Center…
        </div>
      </AdminShell>
    );
  }

  if (anyError && agents.length === 0 && providers.length === 0 && runtimes.length === 0) {
    return (
      <AdminShell>
        <div className="card mx-auto mt-12 max-w-xl p-6 text-center">
          <h2 className="text-base font-semibold text-[var(--fg-primary)]">
            Couldn&apos;t reach the Agent Center
          </h2>
          <p className="mt-2 text-sm text-[var(--fg-secondary)]">
            {(anyError as { message?: string })?.message ??
              'Network error. Check your connection and try again.'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button type="button" onClick={refetchAll}>
              Retry
            </Button>
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="agent-center">
        {isFirstRun ? (
          <>
            <AgentCenterExplainerHero
              onGuidedSetup={openGuidedSetup}
              onSkipToCatalog={skipToCatalog}
            />
            <FirstTimeTooltip enabled={isFirstRun} onActivate={openGuidedSetup} />
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
                <CreateAgentDialog />
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
                onRegisterAgent={openGuidedSetup}
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
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
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
                  Map task types to the right agent + provider. {agents.length} agents available.
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
            {agents.length === 0 ? (
              <AgentCenterEmptyState
                testId="tab-empty-assignments"
                icon={<Link2 className="h-5 w-5" aria-hidden="true" />}
                title="No agents to assign"
                description="Register an agent before assigning it to tasks. Assignments map agents to projects."
                primary={{
                  label: 'Register Agent',
                  onClick: openGuidedSetup,
                  icon: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />,
                }}
                learnMoreHref="/docs/assignments"
              />
            ) : (
              <AgentAssignmentMatrix
                agents={agents}
                providers={providers}
                assignments={assignments as ReadonlyArray<import('@/lib/agent-center/data').AgentAssignment>}
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
            {runtimes.length === 0 ? (
              <AgentCenterEmptyState
                testId="tab-empty-runtimes"
                icon={<Server className="h-5 w-5" aria-hidden="true" />}
                title="No runtimes registered"
                description="Runtimes are execution environments — local subprocesses or Kubernetes pods — where agents actually do the work. Configure your first runtime to enable agent execution."
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
          step-54
        </span>
      </div>
    </AdminShell>
  );
}