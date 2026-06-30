

Copy
/goal


Wire the Agents Center + Model Providers sections to the real backend. Replace all dummy data with real API calls. Build on the Phase 1 OIDC auth foundation. The backend already has: agent_registry, agent_assignment, agent_runtime, __litellm_tools services. Read .claude/design-system/ first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "TanStack Query data fetching mutation cache invalidation" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "form dirty state autosave debounce optimistic update" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Zustand store selector subscription re-render performance" --domain ux-guideline -f markdown


Adopt every rule. Then build:


==========================================================

ZONE 1 — REACT QUERY SETUP (the data layer)

==========================================================


Install TanStack Query (already in stack):


src/lib/query/client.ts:


```typescript

import { QueryClient } from '@tanstack/react-query';


export const queryClient = new QueryClient({

  defaultOptions: {

    queries: {

      staleTime: 30_000,        // 30s

      gcTime: 5 * 60_000,       // 5m

      retry: (failureCount, error: any) => {

        // Don't retry 4xx errors

        if (error?.status >= 400 && error?.status < 500) return false;

        return failureCount < 3;

      },

      refetchOnWindowFocus: false,

    },

    mutations: {

      retry: false,

    },

  },

});
src/app/providers.tsx (wrap app):

typescript

Copy
'use client';

import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/lib/query/client';


export function Providers({ children }: { children: React.ReactNode }) {

  return (

    <QueryClientProvider client={queryClient}>

      {children}

    </QueryClientProvider>

  );

}
src/lib/query/hooks.ts — typed query hooks for agents:

typescript

Copy
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';


// Types

export interface Agent {

  id: string;

  tenant_id: string;

  name: string;

  type: 'cli' | 'mcp' | 'webhook' | 'custom';

  runtime: 'claude-code' | 'codex' | 'aider' | 'kiro' | 'gemini' | 'custom';

  provider_id: string | null;

  model: string | null;

  version: string;

  status: 'active' | 'paused' | 'error' | 'disabled';

  description?: string;

  capabilities: string[];

  last_active_at: string | null;

  created_at: string;

  updated_at: string;

}


export interface ModelProvider {

  id: string;

  tenant_id: string;

  name: 'anthropic' | 'openai' | 'bedrock' | 'vertex' | 'azure' | 'custom';

  display_name: string;

  api_base: string;

  status: 'connected' | 'error' | 'disconnected';

  models: string[];             // available models from this provider

  default_model: string | null;

  rate_limit_rpm: number | null;

  spend_cap_daily: number | null;

  last_test_at: string | null;

  last_test_status: 'ok' | 'error' | null;

  created_at: string;

}


export interface Runtime {

  id: string;

  tenant_id: string;

  name: string;

  type: 'local-docker' | 'kubernetes' | 'cloud-sandbox' | 'custom';

  config: Record<string, any>;  // type-specific config

  status: 'active' | 'paused' | 'error';

  created_at: string;

}


export interface Assignment {

  id: string;

  agent_id: string;

  project_id: string;

  role: 'default' | 'reviewer' | 'specialist';

  created_at: string;

}


// Query keys (centralized for cache management)

export const queryKeys = {

  agents: {

    all: ['agents'] as const,

    list: () => [...queryKeys.agents.all, 'list'] as const,

    detail: (id: string) => [...queryKeys.agents.all, 'detail', id] as const,

  },

  providers: {

    all: ['providers'] as const,

    list: () => [...queryKeys.providers.all, 'list'] as const,

    models: (id: string) => [...queryKeys.providers.all, 'models', id] as const,

  },

  runtimes: {

    all: ['runtimes'] as const,

    list: () => [...queryKeys.runtimes.all, 'list'] as const,

  },

  assignments: {

    all: ['assignments'] as const,

    list: (projectId?: string) => 

      [...queryKeys.assignments.all, projectId || 'all'] as const,

  },

};


// AGENTS

export function useAgents() {

  return useQuery({

    queryKey: queryKeys.agents.list(),

    queryFn: () => api.get<Agent[]>('/agents'),

  });

}


export function useAgent(id: string) {

  return useQuery({

    queryKey: queryKeys.agents.detail(id),

    queryFn: () => api.get<Agent>(`/agents/${id}`),

    enabled: !!id,

  });

}


export function useCreateAgent() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Agent>) => api.post<Agent>('/agents', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.all }),

  });

}


export function useUpdateAgent() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, ...data }: Partial<Agent> & { id: string }) =>

      api.patch<Agent>(`/agents/${id}`, data),

    onSuccess: (_, { id }) => {

      qc.invalidateQueries({ queryKey: queryKeys.agents.all });

      qc.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });

    },

  });

}


export function useDeleteAgent() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/agents/${id}`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.all }),

  });

}


export function useTestAgent() {

  return useMutation({

    mutationFn: (id: string) => api.post<{ status: 'ok' | 'error'; message: string }>(`/agents/${id}/test`),

  });

}


// PROVIDERS

export function useProviders() {

  return useQuery({

    queryKey: queryKeys.providers.list(),

    queryFn: () => api.get<ModelProvider[]>('/providers'),

  });

}


export function useProviderModels(id: string) {

  return useQuery({

    queryKey: queryKeys.providers.models(id),

    queryFn: () => api.get<{ models: string[] }>(`/providers/${id}/models`),

    enabled: !!id,

  });

}


export function useCreateProvider() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<ModelProvider> & { api_key: string }) =>

      api.post<ModelProvider>('/providers', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.providers.all }),

  });

}


export function useTestProvider() {

  return useMutation({

    mutationFn: (id: string) =>

      api.post<{ status: 'ok' | 'error'; message: string; models?: string[] }>(`/providers/${id}/test`),

  });

}


// RUNTIMES

export function useRuntimes() {

  return useQuery({

    queryKey: queryKeys.runtimes.list(),

    queryFn: () => api.get<Runtime[]>('/runtimes'),

  });

}


export function useCreateRuntime() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Runtime>) => api.post<Runtime>('/runtimes', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.runtimes.all }),

  });

}


// ASSIGNMENTS

export function useAssignments(projectId?: string) {

  return useQuery({

    queryKey: queryKeys.assignments.list(projectId),

    queryFn: () => api.get<Assignment[]>(

      projectId ? `/assignments?project_id=${projectId}` : '/assignments'

    ),

  });

}


export function useCreateAssignment() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Assignment>) => api.post<Assignment>('/assignments', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assignments.all }),

  });

}


export function useDeleteAssignment() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/assignments/${id}`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assignments.all }),

  });

}
========================================================== ZONE 2 — REPLACE AGENTS TAB (list + register dialog)
In src/app/(workspace)/agents/page.tsx — replace all dummy data with real hooks:

typescript

Copy
'use client';

import { useAgents, useCreateAgent, useDeleteAgent, useTestAgent } from '@/lib/query/hooks';

import { useProviders } from '@/lib/query/hooks';


export default function AgentsPage() {

  const { data: agents, isLoading, error, refetch } = useAgents();

  const { data: providers } = useProviders();

  const createAgent = useCreateAgent();

  const deleteAgent = useDeleteAgent();

  const testAgent = useTestAgent();

  const [search, setSearch] = useState('');

  const [statusFilter, setStatusFilter] = useState<Agent['status'] | 'all'>('all');

  const [registerOpen, setRegisterOpen] = useState(false);

  

  // Filtered agents

  const filtered = useMemo(() => {

    if (!agents) return [];

    return agents.filter(a => {

      if (statusFilter !== 'all' && a.status !== statusFilter) return false;

      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;

      return true;

    });

  }, [agents, search, statusFilter]);

  

  // KPIs

  const kpis = useMemo(() => {

    if (!agents) return { total: 0, active: 0, paused: 0, error: 0 };

    return {

      total: agents.length,

      active: agents.filter(a => a.status === 'active').length,

      paused: agents.filter(a => a.status === 'paused').length,

      error: agents.filter(a => a.status === 'error').length,

    };

  }, [agents]);

  

  if (isLoading) return <FullPageSpinner />;

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  

  return (

    <div>

      {/* Hero band (keep, but make "Register Agent" open real dialog) */}

      <HeroBand>

        <h1>Agent Center</h1>

        <p>Manage the AI agents, model providers, and task assignments...</p>

        <Button onClick={() => setRegisterOpen(true)}>

          <Plus /> Register Agent

        </Button>

      </HeroBand>

      

      {/* Tabs (keep) */}

      <Tabs value={activeTab} onChange={setActiveTab}>

        <Tab value="agents">Agents</Tab>

        <Tab value="providers">Model Providers</Tab>

        <Tab value="assignments">Assignments</Tab>

        <Tab value="runtimes">Runtimes</Tab>

      </Tabs>

      

      {/* AGENTS TAB */}

      {activeTab === 'agents' && (

        <>

          {/* KPI strip (use real numbers) */}

          <KpiStrip>

            <KpiTile label="Total" value={kpis.total} icon={Bot} />

            <KpiTile label="Active" value={kpis.active} icon={CheckCircle} color="emerald" />

            <KpiTile label="Paused" value={kpis.paused} icon={Pause} color="amber" />

            <KpiTile label="Error" value={kpis.error} icon={AlertTriangle} color="rose" />

          </KpiStrip>

          

          {/* Filter bar */}

          <FilterBar>

            <Input

              placeholder="Search agents..."

              value={search}

              onChange={(e) => setSearch(e.target.value)}

            />

            <StatusFilter value={statusFilter} onChange={setStatusFilter} />

          </FilterBar>

          

          {/* Agent grid (render real agents) */}

          {filtered.length === 0 ? (

            <EmptyState

              icon={Bot}

              title="No agents registered"

              description="Register your first agent to start building your AI workforce."

              action={{ label: 'Register Agent', onClick: () => setRegisterOpen(true) }}

            />

          ) : (

            <AgentGrid>

              {filtered.map(agent => (

                <AgentCard

                  key={agent.id}

                  agent={agent}

                  onTest={() => testAgent.mutateAsync(agent.id).then(res => 

                    toast[res.status === 'ok' ? 'success' : 'error'](res.message)

                  )}

                  onDelete={() => {

                    if (confirm(`Delete ${agent.name}?`)) {

                      deleteAgent.mutate(agent.id);

                    }

                  }}

                />

              ))}

            </AgentGrid>

          )}

        </>

      )}

      

      {/* PROVIDERS TAB */}

      {activeTab === 'providers' && <ProvidersTab />}

      

      {/* ASSIGNMENTS TAB */}

      {activeTab === 'assignments' && <AssignmentsTab />}

      

      {/* RUNTIMES TAB */}

      {activeTab === 'runtimes' && <RuntimesTab />}

      

      {/* Register Agent dialog */}

      {registerOpen && (

        <RegisterAgentDialog

          providers={providers || []}

          onClose={() => setRegisterOpen(false)}

          onSubmit={async (data) => {

            await createAgent.mutateAsync(data);

            setRegisterOpen(false);

            toast.success(`Agent ${data.name} registered`);

          }}

        />

      )}

    </div>

  );

}
========================================================== ZONE 3 — REGISTER AGENT DIALOG (real form)
In src/components/agents/register-agent-dialog.tsx:

typescript

Copy
'use client';

import { useForm } from 'react-hook-form';

import { ModelProvider, Agent } from '@/lib/query/hooks';


export function RegisterAgentDialog({

  providers,

  onClose,

  onSubmit,

}: {

  providers: ModelProvider[];

  onClose: () => void;

  onSubmit: (data: Partial<Agent>) => Promise<void>;

}) {

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Partial<Agent>>({

    defaultValues: {

      type: 'cli',

      runtime: 'claude-code',

      version: '1.0.0',

      capabilities: [],

    },

  });

  

  const selectedProviderId = watch('provider_id');

  const selectedProvider = providers.find(p => p.id === selectedProviderId);

  const { data: models } = useProviderModels(selectedProviderId || '');

  

  return (

    <Dialog open onOpenChange={(o) => !o && onClose()}>

      <DialogContent>

        <DialogHeader>

          <DialogTitle>Register a new agent</DialogTitle>

          <DialogDescription>

            Agents run inside Forge runtimes. Choose a name, type, and default model provider.

          </DialogDescription>

        </DialogHeader>

        

        <form onSubmit={handleSubmit(onSubmit)}>

          <Field>

            <Label>Name *</Label>

            <Input

              {...register('name', { required: 'Name is required' })}

              placeholder="e.g. Refactor Agent"

            />

            {errors.name && <ErrorMessage>{errors.name.message}</ErrorMessage>}

          </Field>

          

          <FieldRow>

            <Field>

              <Label>Type *</Label>

              <Select {...register('type', { required: true })}>

                <option value="cli">CLI</option>

                <option value="mcp">MCP Server</option>

                <option value="webhook">Webhook</option>

                <option value="custom">Custom</option>

              </Select>

            </Field>

            

            <Field>

              <Label>Version</Label>

              <Input {...register('version')} placeholder="1.0.0" />

            </Field>

          </FieldRow>

          

          <Field>

            <Label>Default provider</Label>

            <Select {...register('provider_id')}>

              <option value="">Select a provider...</option>

              {providers.map(p => (

                <option key={p.id} value={p.id}>

                  {p.display_name} {p.status !== 'connected' && '(not connected)'}

                </option>

              ))}

            </Select>

          </Field>

          

          {selectedProvider && models?.models && (

            <Field>

              <Label>Default model</Label>

              <Select {...register('model')}>

                <option value="">Select a model...</option>

                {models.models.map(m => (

                  <option key={m} value={m}>{m}</option>

                ))}

              </Select>

            </Field>

          )}

          

          <Field>

            <Label>Description</Label>

            <Textarea {...register('description')} placeholder="What does this agent do?" rows={3} />

          </Field>

          

          <Field>

            <Label>Capabilities (comma-separated)</Label>

            <Input

              {...register('capabilities', {

                setValueAs: (v: string) => v.split(',').map(s => s.trim()).filter(Boolean),

              })}

              placeholder="code-review, refactor, test"

            />

          </Field>

          

          <DialogFooter>

            <Button variant="ghost" onClick={onClose}>Cancel</Button>

            <Button type="submit" disabled={isSubmitting}>

              {isSubmitting ? 'Registering...' : 'Register'}

            </Button>

          </DialogFooter>

        </form>

      </DialogContent>

    </Dialog>

  );

}
========================================================== ZONE 4 — MODEL PROVIDERS TAB
In src/components/agents/providers-tab.tsx:

typescript

Copy
'use client';

import { useProviders, useCreateProvider, useTestProvider, useProviderModels } from '@/lib/query/hooks';


export function ProvidersTab() {

  const { data: providers, isLoading } = useProviders();

  const createProvider = useCreateProvider();

  const testProvider = useTestProvider();

  const [addOpen, setAddOpen] = useState(false);

  

  if (isLoading) return <Spinner />;

  

  return (

    <div>

      <SectionHeader>

        <h2>Model providers</h2>

        <p>LLM providers available to this tenant. Toggle to enable or disable.</p>

        <Button onClick={() => setAddOpen(true)}>

          <Plus /> Add provider

        </Button>

      </SectionHeader>

      

      {providers?.length === 0 ? (

        <EmptyState

          icon={Plug}

          title="No providers configured"

          description="Add a model provider to start routing agent traffic."

          action={{ label: 'Add Provider', onClick: () => setAddOpen(true) }}

        />

      ) : (

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {providers?.map(p => (

            <ProviderCard

              key={p.id}

              provider={p}

              onTest={() => testProvider.mutateAsync(p.id).then(res =>

                toast[res.status === 'ok' ? 'success' : 'error'](res.message)

              )}

            />

          ))}

        </div>

      )}

      

      {addOpen && (

        <AddProviderDialog

          onClose={() => setAddOpen(false)}

          onSubmit={async (data) => {

            await createProvider.mutateAsync(data);

            setAddOpen(false);

            toast.success('Provider added');

          }}

        />

      )}

    </div>

  );

}


function ProviderCard({ provider, onTest }: { provider: ModelProvider; onTest: () => void }) {

  return (

    <Card>

      <CardHeader>

        <ProviderIcon name={provider.name} />

        <div>

          <CardTitle>{provider.display_name}</CardTitle>

          <CardDescription>{provider.api_base}</CardDescription>

        </div>

        <StatusBadge status={provider.status} />

      </CardHeader>

      <CardContent>

        <div className="text-sm text-fg-secondary">

          {provider.models.length} models available

        </div>

        <div className="text-sm text-fg-secondary">

          Last test: {provider.last_test_at 

            ? new Date(provider.last_test_at).toLocaleString() 

            : 'Never'}

        </div>

      </CardContent>

      <CardFooter>

        <Button variant="ghost" size="sm" onClick={onTest}>

          <Play /> Test connection

        </Button>

        <Button variant="ghost" size="sm">

          <Settings /> Configure

        </Button>

      </CardFooter>

    </Card>

  );

}
========================================================== ZONE 5 — ASSIGNMENTS TAB
In src/components/agents/assignments-tab.tsx:

typescript

Copy
'use client';

import { useAssignments, useAgents, useProjects, useCreateAssignment, useDeleteAssignment } from '@/lib/query/hooks';


export function AssignmentsTab() {

  const { data: agents } = useAgents();

  const { data: projects } = useProjects();

  const { data: assignments } = useAssignments();

  const create = useCreateAssignment();

  const remove = useDeleteAssignment();

  const [addOpen, setAddOpen] = useState(false);

  

  // Group by project

  const byProject = useMemo(() => {

    if (!assignments || !projects) return {};

    return projects.map(project => ({

      project,

      assignments: assignments.filter(a => a.project_id === project.id),

    }));

  }, [assignments, projects]);

  

  return (

    <div>

      <SectionHeader>

        <h2>Assignments</h2>

        <p>Map task types to the right agent + provider.</p>

        <Button onClick={() => setAddOpen(true)}>

          <Plus /> New assignment

        </Button>

      </SectionHeader>

      

      {byProject.length === 0 ? (

        <EmptyState

          icon={Users}

          title="No assignments yet"

          description="Assign agents to projects to start orchestrating work."

          action={{ label: 'New Assignment', onClick: () => setAddOpen(true) }}

        />

      ) : (

        byProject.map(({ project, assignments }) => (

          <div key={project.id}>

            <h3>{project.name}</h3>

            <AssignmentList

              assignments={assignments}

              agents={agents || []}

              onRemove={(id) => remove.mutate(id)}

            />

          </div>

        ))

      )}

      

      {addOpen && (

        <AddAssignmentDialog

          agents={agents || []}

          projects={projects || []}

          onClose={() => setAddOpen(false)}

          onSubmit={async (data) => {

            await create.mutateAsync(data);

            setAddOpen(false);

          }}

        />

      )}

    </div>

  );

}
========================================================== ZONE 6 — RUNTIMES TAB
Same pattern — use useRuntimes + useCreateRuntime, render real data.

========================================================== ZONE 7 — BACKEND ENDPOINTS (verify they exist)
Check the FastAPI backend for these endpoints (add if missing):

python

Copy
# backend/app/api/v1/agents.py

@router.get("/agents")

async def list_agents(...): -> list[Agent]: ...


@router.post("/agents")

async def create_agent(...): -> Agent: ...


@router.get("/agents/{id}")

async def get_agent(id: str, ...): -> Agent: ...


@router.patch("/agents/{id}")

async def update_agent(id: str, ...): -> Agent: ...


@router.delete("/agents/{id}")

async def delete_agent(id: str, ...): -> None: ...


@router.post("/agents/{id}/test")

async def test_agent(id: str, ...): -> TestResult: ...


# backend/app/api/v1/providers.py

@router.get("/providers")

async def list_providers(...): -> list[ModelProvider]: ...


@router.post("/providers")

async def create_provider(...): -> ModelProvider: ...


@router.get("/providers/{id}/models")

async def list_provider_models(id: str, ...): -> ModelsResponse: ...


@router.post("/providers/{id}/test")

async def test_provider(id: str, ...): -> TestResult: ...


# backend/app/api/v1/runtimes.py

@router.get("/runtimes")

async def list_runtimes(...): -> list[Runtime]: ...

@router.post("/runtimes")

async def create_runtime(...): -> Runtime: ...


# backend/app/api/v1/assignments.py

@router.get("/assignments")

async def list_assignments(project_id: str | None = None, ...): -> list[Assignment]: ...

@router.post("/assignments")

async def create_assignment(...): -> Assignment: ...

@router.delete("/assignments/{id}")

async def delete_assignment(id: str, ...): -> None: ...
These should all use the tenant_id from the JWT (Rule 2) for scoping.

========================================================== ZONE 8 — LOADING + ERROR + EMPTY STATES
For every hook usage, handle the 3 states:

typescript

Copy
function AgentsTab() {

  const { data, isLoading, error, refetch, isFetching } = useAgents();

  

  if (isLoading) return <FullPageSpinner />;

  if (error) return (

    <ErrorState

      icon={AlertCircle}

      title="Couldn't load agents"

      description={error.message}

      onRetry={refetch}

    />

  );

  if (!data || data.length === 0) return (

    <EmptyState ... />

  );

  

  return (

    <>

      {isFetching && <RefreshIndicator />}

      <AgentGrid agents={data} />

    </>

  );

}
========================================================== ZONE 9 — OPTIMISTIC UPDATES
For better UX, use optimistic updates for common actions:

typescript

Copy
export function useDeleteAgent() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/agents/${id}`),

    onMutate: async (id) => {

      await qc.cancelQueries({ queryKey: queryKeys.agents.list() });

      const previous = qc.getQueryData<Agent[]>(queryKeys.agents.list());

      qc.setQueryData<Agent[]>(queryKeys.agents.list(), old => 

        old?.filter(a => a.id !== id) ?? []

      );

      return { previous };

    },

    onError: (err, id, context) => {

      qc.setQueryData(queryKeys.agents.list(), context?.previous);

      toast.error('Delete failed — restored');

    },

    onSettled: () => {

      qc.invalidateQueries({ queryKey: queryKeys.agents.list() });

    },

  });

}
========================================================== ZONE 10 — REMOVE DUMMY DATA
Search the codebase for any remaining hardcoded agent/provider data:

bash

Copy
grep -r "dummyAgents\|mockProviders\|sampleAgents\|fakeAgents" apps/forge/

grep -r "Atlas\|Aria\|Mira" apps/forge/  # your dummy agent names
Remove all of it. Every list should use the React Query hooks.

========================================================== CONSTRAINTS
All requests must include the Authorization: Bearer header (Phase 1)
All responses are tenant-scoped (backend filters by tenant_id)
Keep the existing UI design (Step 4 + Step 43 clarity)
Don't break the Agent Center clarity (Step 43)
Real-time updates: NOT in this phase (manual refetch is fine)
All forms have validation
All errors surface as toasts
========================================================== DELIVERABLE
files modified, new files in src/lib/query/ + src/components/agents/
React Query setup with typed hooks for agents/providers/runtimes/assignments
All 4 tabs (Agents, Providers, Assignments, Runtimes) wired to real API
Register Agent dialog with real form + provider dropdown
Add Provider dialog with real form + API key input
Test connection buttons (real API calls)
Optimistic delete with rollback
Loading + error + empty states everywhere
All dummy data removed
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the page layout, keep the tab structure, keep the visual design
Test: register an agent → appears in list without refresh
Test: delete an agent → disappears optimistically, rolls back on error
Test: add a provider with bad API key → "Test connection" shows error
Test: refresh page → data persists (real DB)