/goal


Wire the Workflows center to the real backend — the visual builder, templates, runs, triggers, and live execution. Replace all dummy data with real API calls. Build on Phase 1 (auth) + Phase 2 (React Query) + Phase 3 (Connectors). Read .claude/design-system/ first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "React Flow custom nodes edges handles save load JSON" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "WebSocket live updates run progress event stream" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "cron schedule expression parser recurrence next run" --domain ux-guideline -f markdown


Adopt every rule. Then build:


==========================================================

ZONE 1 — TYPE DEFINITIONS

==========================================================


Add to src/lib/api/types.ts:


```typescript

// WORKFLOWS

export type NodeType = 

  | 'trigger.manual' | 'trigger.webhook' | 'trigger.schedule' | 'trigger.event'

  | 'command' | 'agent' | 'llm' | 'http' | 'approval'

  | 'condition' | 'wait' | 'end' | 'parallel' | 'merge';


export type NodeCategory = 'trigger' | 'core' | 'logic' | 'integration' | 'human';


export interface WorkflowNode {

  id: string;

  type: NodeType;

  category: NodeCategory;

  position: { x: number; y: number };

  data: {

    label: string;

    config: Record<string, any>;   // type-specific config

    inputs?: string[];

    outputs?: string[];

  };

}


export interface WorkflowEdge {

  id: string;

  source: string;            // source node id

  target: string;            // target node id

  sourceHandle?: string | null;

  targetHandle?: string | null;

  data?: {

    condition?: string;       // for condition edges (e.g., "true", "false", "case-1")

    label?: string;

  };

}


export interface WorkflowVariable {

  name: string;

  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'secret';

  default?: any;

  description?: string;

  required?: boolean;

}


export type WorkflowStatus = 'draft' | 'published' | 'archived' | 'disabled';

export type WorkflowVisibility = 'private' | 'team' | 'tenant';


export interface Workflow {

  id: string;

  tenant_id: string;

  project_id?: string;

  name: string;

  description?: string;

  version: string;

  status: WorkflowStatus;

  visibility: WorkflowVisibility;

  

  nodes: WorkflowNode[];

  edges: WorkflowEdge[];

  variables: WorkflowVariable[];

  

  // Triggers

  trigger_config: {

    type: 'manual' | 'webhook' | 'schedule' | 'event';

    config: Record<string, any>;   // schedule: { cron: '0 9 * * *' }, webhook: { path: '/hook' }, etc.

  };

  

  // Settings

  timeout_seconds: number;

  retry_policy: { max_retries: number; backoff: 'fixed' | 'exponential' };

  rate_limit_per_hour?: number;

  

  // Permissions

  permissions: {

    run: string[];                // role list

    edit: string[];

    view: string[];

  };

  

  // Metadata

  category: string;

  tags: string[];

  is_template: boolean;

  template_description?: string;

  

  created_by: string;

  created_at: string;

  updated_at: string;

  last_run_at: string | null;

  run_count: number;

  avg_duration_seconds: number | null;

  success_rate: number | null;

}


// RUNS

export type RunStatus = 

  | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused' | 'waiting_approval';


export interface WorkflowRun {

  id: string;

  workflow_id: string;

  workflow_version: string;

  status: RunStatus;

  triggered_by: 'manual' | 'webhook' | 'schedule' | 'event';

  triggered_by_user_id?: string;

  inputs: Record<string, any>;

  outputs: Record<string, any>;

  

  started_at: string;

  completed_at: string | null;

  duration_seconds: number | null;

  

  // Per-node execution

  node_executions: {

    node_id: string;

    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

    started_at: string | null;

    completed_at: string | null;

    duration_ms: number | null;

    inputs: any;

    outputs: any;

    error: string | null;

    logs: string[];

    cost_usd: number | null;

    tokens_input: number | null;

    tokens_output: number | null;

  }[];

  

  // Overall metrics

  total_tokens_input: number;

  total_tokens_output: number;

  total_cost_usd: number;

  

  // Error info

  error: string | null;

  failed_node_id: string | null;

  

  // Audit

  tenant_id: string;

  project_id?: string;

}


export interface RunLog {

  id: string;

  run_id: string;

  node_id?: string;

  level: 'debug' | 'info' | 'warn' | 'error';

  message: string;

  timestamp: string;

  metadata?: Record<string, any>;

}


// TRIGGERS

export interface WorkflowTrigger {

  id: string;

  workflow_id: string;

  type: 'webhook' | 'schedule' | 'event';

  config: Record<string, any>;

  status: 'active' | 'paused';

  last_triggered_at: string | null;

  next_run_at: string | null;       // for schedule

}


// TEMPLATES

export interface WorkflowTemplate {

  id: string;

  slug: string;

  name: string;

  description: string;

  category: string;

  tags: string[];

  thumbnail_url?: string;

  nodes: WorkflowNode[];

  edges: WorkflowEdge[];

  variables: WorkflowVariable[];

  install_count: number;

  rating: number;

  is_official: boolean;

  is_featured: boolean;

  created_at: string;

}


// Query keys

export const queryKeys = {

  workflows: {

    all: ['workflows'] as const,

    list: (filter?: any) => [...queryKeys.workflows.all, 'list', filter] as const,

    detail: (id: string) => [...queryKeys.workflows.all, 'detail', id] as const,

    templates: (category?: string) => [...queryKeys.workflows.all, 'templates', category] as const,

  },

  runs: {

    all: ['runs'] as const,

    list: (workflowId?: string) => [...queryKeys.runs.all, workflowId || 'all'] as const,

    detail: (id: string) => [...queryKeys.runs.all, 'detail', id] as const,

    logs: (id: string) => [...queryKeys.runs.all, 'detail', id, 'logs'] as const,

    live: (id: string) => [...queryKeys.runs.all, 'detail', id, 'live'] as const,

  },

  triggers: {

    all: ['triggers'] as const,

    list: (workflowId: string) => [...queryKeys.triggers.all, workflowId] as const,

  },

};
========================================================== ZONE 2 — REACT QUERY HOOKS
Add to src/lib/query/hooks.ts:

typescript

Copy
import { WebSocket } from 'ws'; // or browser native WebSocket


// WORKFLOWS

export function useWorkflows(filter?: { status?: WorkflowStatus; is_template?: boolean; search?: string }) {

  return useQuery({

    queryKey: queryKeys.workflows.list(filter),

    queryFn: () => {

      const params = new URLSearchParams();

      if (filter?.status) params.set('status', filter.status);

      if (filter?.is_template !== undefined) params.set('is_template', String(filter.is_template));

      if (filter?.search) params.set('search', filter.search);

      return api.get<Workflow[]>(`/workflows?${params}`);

    },

  });

}


export function useWorkflow(id: string) {

  return useQuery({

    queryKey: queryKeys.workflows.detail(id),

    queryFn: () => api.get<Workflow>(`/workflows/${id}`),

    enabled: !!id,

  });

}


export function useCreateWorkflow() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Workflow>) => api.post<Workflow>('/workflows', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workflows.all }),

  });

}


export function useUpdateWorkflow() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, ...data }: Partial<Workflow> & { id: string }) =>

      api.patch<Workflow>(`/workflows/${id}`, data),

    onSuccess: (_, { id }) => {

      qc.invalidateQueries({ queryKey: queryKeys.workflows.all });

      qc.invalidateQueries({ queryKey: queryKeys.workflows.detail(id) });

    },

  });

}


export function useDeleteWorkflow() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/workflows/${id}`),

    onMutate: async (id) => {

      await qc.cancelQueries({ queryKey: queryKeys.workflows.list() });

      const previous = qc.getQueryData<Workflow[]>(queryKeys.workflows.list());

      qc.setQueryData<Workflow[]>(queryKeys.workflows.list(), old => 

        old?.filter(w => w.id !== id) ?? []

      );

      return { previous };

    },

    onError: (err, id, context) => {

      qc.setQueryData(queryKeys.workflows.list(), context?.previous);

    },

    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.workflows.all }),

  });

}


export function usePublishWorkflow() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post<Workflow>(`/workflows/${id}/publish`),

    onSuccess: (_, id) => {

      qc.invalidateQueries({ queryKey: queryKeys.workflows.all });

      qc.invalidateQueries({ queryKey: queryKeys.workflows.detail(id) });

    },

  });

}


export function useDuplicateWorkflow() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post<Workflow>(`/workflows/${id}/duplicate`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workflows.all }),

  });

}


// TEMPLATES

export function useWorkflowTemplates(category?: string) {

  return useQuery({

    queryKey: queryKeys.workflows.templates(category),

    queryFn: () => api.get<WorkflowTemplate[]>(

      category ? `/workflows/templates?category=${category}` : '/workflows/templates'

    ),

    staleTime: 10 * 60_000,

  });

}


export function useInstallTemplate() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (templateId: string) => 

      api.post<Workflow>(`/workflows/templates/${templateId}/install`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workflows.all }),

  });

}


// RUNS

export function useRuns(workflowId?: string, filter?: { status?: RunStatus; limit?: number }) {

  return useQuery({

    queryKey: queryKeys.runs.list(workflowId),

    queryFn: () => {

      const params = new URLSearchParams();

      if (workflowId) params.set('workflow_id', workflowId);

      if (filter?.status) params.set('status', filter.status);

      if (filter?.limit) params.set('limit', String(filter.limit));

      return api.get<WorkflowRun[]>(`/runs?${params}`);

    },

    refetchInterval: 5_000,        // poll for active runs

  });

}


export function useRun(id: string) {

  return useQuery({

    queryKey: queryKeys.runs.detail(id),

    queryFn: () => api.get<WorkflowRun>(`/runs/${id}`),

    refetchInterval: (query) => {

      const data = query.state.data as WorkflowRun | undefined;

      // Poll faster if running, stop polling if completed

      if (!data) return false;

      return ['running', 'queued', 'paused', 'waiting_approval'].includes(data.status) ? 2000 : false;

    },

  });

}


export function useRunLogs(runId: string) {

  return useQuery({

    queryKey: queryKeys.runs.logs(runId),

    queryFn: () => api.get<RunLog[]>(`/runs/${runId}/logs`),

    enabled: !!runId,

    refetchInterval: 1000,         // near-realtime for active runs

  });

}


export function useTriggerWorkflow() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, inputs }: { id: string; inputs?: Record<string, any> }) =>

      api.post<WorkflowRun>(`/workflows/${id}/run`, { inputs }),

    onSuccess: (run) => {

      qc.invalidateQueries({ queryKey: queryKeys.runs.all });

      toast.success(`Run started: ${run.id.slice(0, 8)}`);

    },

  });

}


export function useCancelRun() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post(`/runs/${id}/cancel`),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: queryKeys.runs.all });

      toast.info('Run cancelled');

    },

  });

}


export function useRetryRun() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, fromNodeId }: { id: string; fromNodeId?: string }) =>

      api.post<WorkflowRun>(`/runs/${id}/retry`, { from_node_id: fromNodeId }),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.runs.all }),

  });

}


// TRIGGERS

export function useTriggers(workflowId: string) {

  return useQuery({

    queryKey: queryKeys.triggers.list(workflowId),

    queryFn: () => api.get<WorkflowTrigger[]>(`/workflows/${workflowId}/triggers`),

    enabled: !!workflowId,

  });

}


export function useCreateTrigger() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ workflowId, ...data }: Partial<WorkflowTrigger> & { workflowId: string }) =>

      api.post<WorkflowTrigger>(`/workflows/${workflowId}/triggers`, data),

    onSuccess: (_, { workflowId }) => {

      qc.invalidateQueries({ queryKey: queryKeys.triggers.list(workflowId) });

    },

  });

}


export function useUpdateTrigger() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, workflowId, ...data }: Partial<WorkflowTrigger> & { id: string; workflowId: string }) =>

      api.patch<WorkflowTrigger>(`/workflows/${workflowId}/triggers/${id}`, data),

    onSuccess: (_, { workflowId }) => {

      qc.invalidateQueries({ queryKey: queryKeys.triggers.list(workflowId) });

    },

  });

}


export function useDeleteTrigger() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, workflowId }: { id: string; workflowId: string }) =>

      api.delete(`/workflows/${workflowId}/triggers/${id}`),

    onSuccess: (_, { workflowId }) => {

      qc.invalidateQueries({ queryKey: queryKeys.triggers.list(workflowId) });

    },

  });

}


// WEBSOCKET for live run updates

export function useRunLiveUpdates(runId: string | null) {

  const [events, setEvents] = useState<RunLog[]>([]);

  const [run, setRun] = useState<WorkflowRun | null>(null);

  

  useEffect(() => {

    if (!runId) return;

    

    const ws = new WebSocket(`${WS_BASE}/runs/${runId}/stream?token=${auth.getToken()}`);

    

    ws.onmessage = (e) => {

      const event = JSON.parse(e.data);

      if (event.type === 'log') {

        setEvents(prev => [...prev, event.data]);

      } else if (event.type === 'run.update') {

        setRun(event.data);

      }

    };

    

    return () => ws.close();

  }, [runId]);

  

  return { events, run };

}
========================================================== ZONE 3 — WORKFLOWS CENTER (list page)
In src/components/workflows/workflows-center.tsx:

typescript

Copy
'use client';

import { useWorkflows, useWorkflowTemplates, useInstallTemplate } from '@/lib/query/hooks';

import { useState } from 'react';


export function WorkflowsCenter() {

  const [activeTab, setActiveTab] = useState<'my' | 'templates' | 'shared' | 'drafts'>('my');

  const [search, setSearch] = useState('');

  

  return (

    <div>

      <HeroBand

        title="Workflows"

        description="Compose multi-step AI workflows. Connect commands, approvals, and custom logic into a DAG your team can run, schedule, or trigger from events."

        action={{ label: 'From scratch', onClick: () => createBlankWorkflow() }}

      />

      

      <KpiStrip>

        <KpiTile label="Workflows" value={useWorkflows().data?.length ?? 0} delta="+3 this week" />

        <KpiTile label="Runs today" value={useRuns(undefined, { limit: 100 }).data?.length ?? 0} delta="+12% vs. yesterday" />

        <KpiTile label="Avg duration" value={computeAvgDuration()} delta="-22s vs. last week" color="amber" />

        <KpiTile label="Success rate" value={computeSuccessRate() + '%'} delta="+1.2pp" color="emerald" />

      </KpiStrip>

      

      <Tabs value={activeTab} onChange={setActiveTab}>

        <Tab value="templates" badge={6}>Templates</Tab>

        <Tab value="my" badge={4}>My workflows</Tab>

        <Tab value="shared" badge={2}>Shared with me</Tab>

        <Tab value="drafts" badge={2}>Drafts</Tab>

      </Tabs>

      

      {activeTab === 'templates' && <TemplatesTab />}

      {activeTab === 'my' && <MyWorkflowsTab search={search} onSearchChange={setSearch} />}

      {activeTab === 'shared' && <SharedWorkflowsTab />}

      {activeTab === 'drafts' && <DraftsTab />}

    </div>

  );

}


function MyWorkflowsTab({ search, onSearchChange }: { search: string; onSearchChange: (s: string) => void }) {

  const { data: workflows, isLoading } = useWorkflows({ search });

  

  if (isLoading) return <Spinner />;

  if (!workflows?.length) return <EmptyState ... />;

  

  return (

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

      {workflows.map(w => <WorkflowCard key={w.id} workflow={w} />)}

    </div>

  );

}


function WorkflowCard({ workflow }: { workflow: Workflow }) {

  return (

    <Card>

      <CardHeader>

        <CardIcon type={workflow.nodes[0]?.type || 'command'} />

        <div>

          <CardTitle>{workflow.name}</CardTitle>

          <CardDescription>{workflow.description || `${workflow.nodes.length} nodes`}</CardDescription>

        </div>

        <StatusBadge status={workflow.status} />

      </CardHeader>

      <CardContent>

        <div className="flex gap-2">

          {workflow.tags.map(t => <Chip key={t}>{t}</Chip>)}

        </div>

        <Metrics>

          <span>Last run: {timeAgo(workflow.last_run_at)}</span>

          <span>{workflow.run_count} runs total</span>

          <span>{workflow.success_rate}% success</span>

        </Metrics>

      </CardContent>

      <CardFooter>

        <Button variant="ghost" onClick={() => router.push(`/workflows/${workflow.id}`)}>

          <Pencil /> Edit

        </Button>

        <Button onClick={() => triggerRun(workflow.id)}>

          <Play /> Run

        </Button>

      </CardFooter>

    </Card>

  );

}
========================================================== ZONE 4 — VISUAL WORKFLOW EDITOR (the big one)
In src/components/workflows/visual-editor.tsx:

typescript

Copy
'use client';

import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, addEdge } from 'reactflow';

import { useWorkflow, useUpdateWorkflow, useTriggerWorkflow, useRunLiveUpdates } from '@/lib/query/hooks';


export function VisualWorkflowEditor({ workflowId }: { workflowId: string }) {

  const { data: workflow, isLoading } = useWorkflow(workflowId);

  const updateWorkflow = useUpdateWorkflow();

  const triggerWorkflow = useTriggerWorkflow();

  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  

  // Convert workflow nodes/edges to React Flow format

  const initialNodes = useMemo(() => 

    workflow?.nodes.map(n => ({

      id: n.id,

      type: n.type,                    // custom node types

      position: n.position,

      data: n.data,

    })) ?? [],

    [workflow]

  );

  

  const initialEdges = useMemo(() =>

    workflow?.edges.map(e => ({

      id: e.id,

      source: e.source,

      target: e.target,

      sourceHandle: e.sourceHandle,

      targetHandle: e.targetHandle,

      label: e.data?.label,

      data: e.data,

      style: e.data?.condition === 'true' ? { stroke: '#10B981' } : 

             e.data?.condition === 'false' ? { stroke: '#F43F5E' } : undefined,

    })) ?? [],

    [workflow]

  );

  

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);

  

  // Sync React Flow state to workflow state (auto-save)

  useEffect(() => {

    if (!workflow) return;

    const timeout = setTimeout(() => {

      const updated = {

        ...workflow,

        nodes: nodes.map(n => ({

          id: n.id,

          type: n.type as NodeType,

          category: getNodeCategory(n.type),

          position: n.position,

          data: n.data as any,

        })),

        edges: edges.map(e => ({

          id: e.id,

          source: e.source,

          target: e.target,

          sourceHandle: e.sourceHandle || null,

          targetHandle: e.targetHandle || null,

          data: e.data,

        })),

      };

      updateWorkflow.mutate(updated);

    }, 1000); // debounce

    

    return () => clearTimeout(timeout);

  }, [nodes, edges]);

  

  // Live run updates

  const { events: liveLogs, run: liveRun } = useRunLiveUpdates(activeRunId);

  

  if (isLoading) return <FullPageSpinner />;

  if (!workflow) return <ErrorState />;

  

  return (

    <div className="h-screen flex flex-col">

      {/* Top bar */}

      <header className="h-14 border-b flex items-center px-4 gap-3">

        <Button variant="ghost" onClick={back}>

          <ArrowLeft />

        </Button>

        <WorkflowNameEditor

          value={workflow.name}

          onSave={(name) => updateWorkflow.mutate({ id: workflow.id, name })}

        />

        <VersionBadge>v{workflow.version}</VersionBadge>

        <StatusDot status={workflow.status} />

        <SavedIndicator saved={updateWorkflow.isSuccess} />

        

        <div className="flex-1" />

        

        <Button variant="outline" onClick={() => setVariablesOpen(true)}>

          <Braces /> Variables <Badge>{workflow.variables.length}</Badge>

        </Button>

        <Button variant="outline" onClick={() => setTestRunOpen(true)}>

          <FlaskConical /> Test run

        </Button>

        <Button 

          variant={workflow.status === 'published' ? 'default' : 'primary'}

          onClick={() => runWorkflow.mutate({ id: workflow.id })}

        >

          <Play /> Run

        </Button>

        <Button variant="ghost"><MoreVertical /></Button>

      </header>

      

      {/* Main area: left rail + canvas + right panel */}

      <div className="flex-1 grid grid-cols-[56px_1fr_360px] overflow-hidden">

        {/* Left rail (node palette) */}

        <NodePalette

          collapsed={leftCollapsed}

          onToggle={() => setLeftCollapsed(!leftCollapsed)}

          onDragStart={(nodeType) => {/* prepare drag */}}

        />

        

        {/* Center: React Flow canvas */}

        <ReactFlow

          nodes={nodes}

          edges={edges}

          onNodesChange={onNodesChange}

          onEdgesChange={onEdgesChange}

          onConnect={(params) => setEdges(eds => addEdge(params, eds))}

          onNodeClick={(_, node) => setSelectedNode(node)}

          nodeTypes={customNodeTypes}

          fitView

          proOptions={{ hideAttribution: true }}

        >

          <Background variant="dots" gap={20} size={1} color="rgba(255,255,255,0.05)" />

          <Controls />

          <MiniMap

            nodeColor={(n) => getNodeColor(n.type)}

            maskColor="rgba(0,0,0,0.7)"

            style={{ background: 'rgba(20,20,22,0.9)' }}

          />

        </ReactFlow>

        

        {/* Right panel: Settings/Inspector/Log */}

        <RightPanel

          workflow={workflow}

          selectedNode={selectedNode}

          onUpdateNode={(node) => {

            setNodes(ns => ns.map(n => n.id === node.id ? { ...n, data: node.data } : n));

          }}

          onDeleteNode={(nodeId) => {

            setNodes(ns => ns.filter(n => n.id !== nodeId));

            setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));

          }}

          activeRunId={activeRunId}

          liveLogs={liveLogs}

          liveRun={liveRun}

        />

      </div>

      

      {/* Bottom status bar */}

      <StatusBar

        connectionStatus={wsStatus}

        runStatus={liveRun?.status}

        lastSaved={updateWorkflow.data?.updated_at}

      />

    </div>

  );

}
========================================================== ZONE 5 — CUSTOM NODE COMPONENTS
The 9 node types (from Step 22). Each as a custom React Flow node:

typescript

Copy
import { Handle, Position } from 'reactflow';


// Base wrapper

function NodeShell({ children, type, selected, hasError }: {

  children: React.ReactNode;

  type: NodeCategory;

  selected?: boolean;

  hasError?: boolean;

}) {

  return (

    <div className={cn(

      'rounded-lg border bg-surface shadow-sm min-w-[200px] max-w-[280px]',

      selected && 'border-accent-primary shadow-glow',

      hasError && 'border-rose-500',

    )}>

      <Handle type="target" position={Position.Left} className="!bg-accent-primary !w-3 !h-3" />

      {children}

      <Handle type="source" position={Position.Right} className="!bg-accent-primary !w-3 !h-3" />

    </div>

  );

}


// 1. TRIGGER nodes

function TriggerNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="trigger" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <Zap className="w-4 h-4 text-emerald-500" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">TRIGGER</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium">{data.label || 'Manual trigger'}</div>

        <div className="text-xs text-fg-tertiary mt-1">

          {data.config?.type === 'manual' && 'Run manually'}

          {data.config?.type === 'webhook' && `POST ${data.config?.path || '/hook'}`}

          {data.config?.type === 'schedule' && data.config?.cron || '0 9 * * *'}

          {data.config?.type === 'event' && `On ${data.config?.event || 'workflow.completed'}`}

        </div>

      </div>

    </NodeShell>

  );

}


// 2. COMMAND node

function CommandNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="core" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <Terminal className="w-4 h-4 text-cyan-500" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">COMMAND</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium">{data.config?.command || 'forge-dev-new-feature'}</div>

        <div className="text-xs text-fg-tertiary mt-1">

          {data.config?.description || 'Scaffold a new feature'}

        </div>

        <div className="flex gap-2 mt-2">

          <Chip size="sm">~{data.config?.duration || '900'}s</Chip>

          {data.config?.agent && <Chip size="sm">{data.config.agent}</Chip>}

        </div>

      </div>

    </NodeShell>

  );

}


// 3. AGENT node

function AgentNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="core" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <Bot className="w-4 h-4 text-violet-500" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">AGENT</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium">{data.config?.agent_name || 'Claude Code'}</div>

        <div className="text-xs text-fg-tertiary mt-1">

          {data.config?.model || 'claude-sonnet-4.5'}

        </div>

      </div>

    </NodeShell>

  );

}


// 4. LLM PROMPT node

function LLMPromptNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="core" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <Sparkles className="w-4 h-4 text-violet-500" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">LLM PROMPT</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium line-clamp-2">{data.config?.prompt || 'Score this idea from 0-10 across clarity, novelty, and feasibility. Output JSON.'}</div>

        <div className="flex gap-2 mt-2">

          <Chip size="sm">{data.config?.model || 'claude-sonnet'}</Chip>

          <Chip size="sm">t={data.config?.temperature || 0.2}</Chip>

        </div>

      </div>

    </NodeShell>

  );

}


// 5. HTTP REQUEST node

function HTTPRequestNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="integration" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <Globe className="w-4 h-4 text-amber-500" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">HTTP</span>

      </div>

      <div className="p-3">

        <div className="flex items-center gap-2">

          <MethodBadge method={data.config?.method || 'GET'} />

          <div className="text-sm font-mono truncate">{data.config?.url || 'https://api.example.com/...'}</div>

        </div>

      </div>

    </NodeShell>

  );

}


// 6. APPROVAL node

function ApprovalNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="human" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <ShieldCheck className="w-4 h-4 text-rose-500" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">APPROVAL</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium">{data.config?.title || 'PM approval'}</div>

        <div className="text-xs text-fg-tertiary mt-1">

          Expires in {data.config?.timeout || '24h'}

        </div>

        <div className="flex items-center gap-1 mt-2">

          {data.config?.approvers?.slice(0, 3).map((a: any) => (

            <Avatar key={a} src={getUserAvatar(a)} size="xs" />

          ))}

        </div>

      </div>

    </NodeShell>

  );

}


// 7. CONDITION node

function ConditionNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="logic" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <GitBranch className="w-4 h-4 text-muted-foreground" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">CONDITION</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium">If</div>

        <div className="text-sm font-mono text-fg-secondary mt-1">{data.config?.expression || 'score >= 7'}</div>

      </div>

      <Handle type="source" position={Position.Right} id="true" style={{ top: '40%', background: '#10B981' }} />

      <Handle type="source" position={Position.Right} id="false" style={{ top: '60%', background: '#F43F5E' }} />

    </NodeShell>

  );

}


// 8. WAIT node

function WaitNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="logic" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <Clock className="w-4 h-4 text-muted-foreground" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">WAIT</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium">{data.config?.duration || '5 minutes'}</div>

      </div>

    </NodeShell>

  );

}


// 9. END node

function EndNode({ data, selected }: NodeProps) {

  return (

    <NodeShell type="core" selected={selected}>

      <div className="px-3 py-2 border-b flex items-center gap-2">

        <CheckCircle className="w-4 h-4 text-emerald-500" />

        <span className="text-xs uppercase tracking-wider text-fg-tertiary">END</span>

      </div>

      <div className="p-3">

        <div className="text-sm font-medium">{data.label || 'Success'}</div>

        <div className="text-xs text-fg-tertiary mt-1">

          {data.config?.outcome || 'Always'}

        </div>

      </div>

    </NodeShell>

  );

}


// Node type registry

export const customNodeTypes = {

  'trigger.manual': TriggerNode,

  'trigger.webhook': TriggerNode,

  'trigger.schedule': TriggerNode,

  'trigger.event': TriggerNode,

  'command': CommandNode,

  'agent': AgentNode,

  'llm': LLMPromptNode,

  'http': HTTPRequestNode,

  'approval': ApprovalNode,

  'condition': ConditionNode,

  'wait': WaitNode,

  'end': EndNode,

};
========================================================== ZONE 6 — NODE PALETTE (left rail)
In src/components/workflows/node-palette.tsx:

typescript

Copy
function NodePalette({ collapsed, onToggle, onDragStart }: NodePaletteProps) {

  const categories: { name: NodeCategory; label: string; icon: any; nodes: NodeType[] }[] = [

    {

      name: 'trigger', label: 'Triggers', icon: Zap, nodes: ['trigger.manual', 'trigger.webhook', 'trigger.schedule', 'trigger.event'],

    },

    {

      name: 'core', label: 'Forge Commands', icon: Terminal, nodes: ['command', 'agent', 'llm'],

    },

    {

      name: 'integration', label: 'Integrations', icon: Plug, nodes: ['http'],

    },

    {

      name: 'human', label: 'Human', icon: Users, nodes: ['approval'],

    },

    {

      name: 'logic', label: 'Logic', icon: GitBranch, nodes: ['condition', 'wait', 'end'],

    },

  ];

  

  if (collapsed) {

    return (

      <aside className="bg-base border-r flex flex-col items-center py-4 gap-2 w-14">

        <Button variant="ghost" size="icon" onClick={onToggle}><ChevronRight /></Button>

        {categories.map(c => (

          <Tooltip key={c.name} content={c.label}>

            <Button variant="ghost" size="icon"><c.icon /></Button>

          </Tooltip>

        ))}

      </aside>

    );

  }

  

  return (

    <aside className="bg-base border-r w-64 p-4 overflow-y-auto">

      <div className="flex items-center justify-between mb-4">

        <Input placeholder="Search nodes..." />

        <Button variant="ghost" size="icon" onClick={onToggle}><ChevronLeft /></Button>

      </div>

      

      {categories.map(c => (

        <div key={c.name} className="mb-4">

          <h3 className="text-xs uppercase tracking-wider text-fg-tertiary mb-2 flex items-center gap-2">

            <c.icon className="w-3 h-3" />

            {c.label} <span className="ml-auto">{c.nodes.length}</span>

          </h3>

          {c.nodes.map(nodeType => (

            <DraggableNodeItem

              key={nodeType}

              type={nodeType}

              onDragStart={onDragStart}

            />

          ))}

        </div>

      ))}

    </aside>

  );

}
========================================================== ZONE 7 — RIGHT PANEL (Settings/Inspector/Log)
Tab between Settings, Inspector, and Log:

typescript

Copy
function RightPanel({ workflow, selectedNode, onUpdateNode, onDeleteNode, activeRunId, liveLogs, liveRun }: RightPanelProps) {

  const [tab, setTab] = useState<'settings' | 'inspector' | 'log'>('settings');

  

  return (

    <aside className="bg-surface border-l w-[360px] overflow-y-auto">

      <Tabs value={tab} onChange={setTab}>

        <Tab value="settings"><Settings className="w-3 h-3" /> Settings</Tab>

        <Tab value="inspector"><Box className="w-3 h-3" /> Inspector</Tab>

        <Tab value="log"><Activity className="w-3 h-3" /> Log</Tab>

      </Tabs>

      

      {tab === 'settings' && <SettingsTab workflow={workflow} />}

      {tab === 'inspector' && selectedNode && (

        <InspectorTab 

          node={selectedNode} 

          onUpdate={onUpdateNode} 

          onDelete={onDeleteNode} 

        />

      )}

      {tab === 'log' && (

        <LogTab runId={activeRunId} liveLogs={liveLogs} liveRun={liveRun} />

      )}

    </aside>

  );

}
========================================================== ZONE 8 — RUNS TAB (the runs list)
In src/components/runs/runs-tab.tsx:

typescript

Copy
function RunsList({ workflowId }: { workflowId?: string }) {

  const { data: runs } = useRuns(workflowId);

  

  return (

    <div>

      <FilterBar>

        <StatusFilter />

        <DateRangeFilter />

      </FilterBar>

      

      <Table>

        <thead>

          <tr>

            <th>Run ID</th>

            <th>Workflow</th>

            <th>Status</th>

            <th>Started</th>

            <th>Duration</th>

            <th>Cost</th>

            <th>Triggered by</th>

            <th></th>

          </tr>

        </thead>

        <tbody>

          {runs?.map(run => (

            <RunRow key={run.id} run={run} />

          ))}

        </tbody>

      </Table>

    </div>

  );

}


function RunRow({ run }: { run: WorkflowRun }) {

  return (

    <tr onClick={() => router.push(`/runs/${run.id}`)}>

      <td><span className="font-mono text-xs">{run.id.slice(0, 8)}</span></td>

      <td>{run.workflow_id}</td>

      <td><RunStatusBadge status={run.status} /></td>

      <td>{timeAgo(run.started_at)}</td>

      <td>{run.duration_seconds ? formatDuration(run.duration_seconds) : '—'}</td>

      <td>${run.total_cost_usd.toFixed(2)}</td>

      <td>{run.triggered_by}</td>

      <td>...</td>

    </tr>

  );

}
========================================================== ZONE 9 — RUN DETAIL (with live execution)
In src/app/(workspace)/runs/[id]/page.tsx:

typescript

Copy
function RunDetailPage() {

  const { id } = useParams();

  const { data: run, isLoading } = useRun(id);

  const { data: logs } = useRunLogs(id);

  const cancel = useCancelRun();

  const retry = useRetryRun();

  const { events: liveLogs, run: liveRun } = useRunLiveUpdates(id);

  

  // Use live run if available, fallback to fetched

  const currentRun = liveRun || run;

  const currentLogs = [...(logs || []), ...liveLogs];

  

  if (isLoading) return <Spinner />;

  if (!currentRun) return <ErrorState />;

  

  return (

    <div>

      <RunHeader run={currentRun} onCancel={() => cancel.mutate(id)} onRetry={() => retry.mutate({ id })} />

      

      <div className="grid grid-cols-[1fr_400px] gap-4">

        {/* Left: node execution timeline */}

        <NodeExecutionTimeline run={currentRun} />

        

        {/* Right: logs + metrics */}

        <div>

          <RunMetrics run={currentRun} />

          <RunLogs logs={currentLogs} />

        </div>

      </div>

    </div>

  );

}
========================================================== ZONE 10 — REMOVE DUMMY DATA
bash

Copy
grep -r "dummyWorkflows\|mockRuns\|sampleTemplates" apps/forge/

grep -r "Onboarding handoff\|Daily standup digest\|Customer churn sweep" apps/forge/  # your dummy workflow names
Remove all hardcoded workflows/runs/templates.

========================================================== ZONE 11 — BACKEND ENDPOINTS
python

Copy
# backend/app/api/v1/workflows.py

@router.get("/workflows")

@router.post("/workflows")

@router.get("/workflows/{id}")

@router.patch("/workflows/{id}")

@router.delete("/workflows/{id}")

@router.post("/workflows/{id}/publish")

@router.post("/workflows/{id}/duplicate")

@router.post("/workflows/{id}/run")

@router.get("/workflows/{id}/triggers")

@router.post("/workflows/{id}/triggers")

@router.patch("/workflows/{id}/triggers/{tid}")

@router.delete("/workflows/{id}/triggers/{tid}")

@router.get("/workflows/templates")

@router.post("/workflows/templates/{id}/install")


# backend/app/api/v1/runs.py

@router.get("/runs")

@router.get("/runs/{id}")

@router.post("/runs/{id}/cancel")

@router.post("/runs/{id}/retry")

@router.get("/runs/{id}/logs")

# WebSocket: /ws/runs/{id}/stream
All endpoints use tenant_id from JWT (Rule 2).

========================================================== CONSTRAINTS
Auto-save workflow changes (debounce 1s) — don't make users click Save
Live run updates via WebSocket (fallback to 2s polling if WS fails)
React Flow nodes are tenant-scoped (Rule 2)
Approval gates mandatory at Architecture/Security/Deployment boundaries (Rule 3)
Don't break the existing visual editor design (Step 22 + 23)
Don't break the collapsible rail pattern (Step 23)
Custom node types match the 9 from Step 22
Existing sample data: Onboarding handoff, Daily standup digest, Customer churn sweep, Quarterly OKR rollup
========================================================== DELIVERABLE
files modified, new files in src/components/workflows/ + src/lib/query/
4 tabs wired (Templates, My workflows, Shared with me, Drafts)
Visual editor with 9 custom node types
Auto-save workflow changes
Live run execution via WebSocket
Run detail page with node execution timeline + logs
All dummy data removed
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the page layout, keep the canvas-first design, keep the collapsible rails
Test: create workflow → auto-saved to DB
Test: trigger run → see live node execution via WebSocket
Test: cancel run → status updates
Test: retry from failed node → resume from that node
Test: schedule trigger → fires at cron time