/**
 * Workflow domain types — FastAPI backend wire format.
 *
 * Step-56: Wire the Workflows center to the real backend (Phase 4).
 *
 * The backend (`backend/app/schemas/workflow.py`) defines a JSONB
 * `definition` blob with 4 node kinds (trigger, command, approval,
 * script) and a discriminated `state.stepResults` envelope for runs.
 *
 * The 9 visual node types in `lib/workflow/types.ts` map to these 4
 * backend kinds in `lib/workflows/adapter.ts` so the canvas UX
 * (Step 22-23) stays intact while the wire format stays simple.
 */

export type WorkflowNodeType = 'trigger' | 'command' | 'approval' | 'script';

export type WorkflowStatus = 'draft' | 'published' | 'archived';

export interface WorkflowPosition {
  x: number;
  y: number;
}

export type WorkflowNodeData =
  | { type: 'trigger'; label: string }
  | {
      type: 'command';
      command_name: string;
      args?: Record<string, unknown>;
      on_error?: 'fail' | 'continue';
    }
  | {
      type: 'approval';
      label: string;
      approver_role?: string;
      timeout_hours?: number;
    }
  | { type: 'script'; language: 'python' | 'javascript'; source: string };

export interface WorkflowNode {
  id: string;
  position: WorkflowPosition;
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowSettings {
  cost_ceiling_usd?: number | null;
  timeout_seconds?: number | null;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  settings: WorkflowSettings;
}

export interface Workflow {
  id: string;
  tenant_id: string;
  project_id?: string;
  name: string;
  description?: string | null;
  definition: WorkflowDefinition;
  created_by: string;
  created_at: string;
  updated_at: string;
  latest_run_id?: string | null;
}

export interface WorkflowCreate {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
}

export interface WorkflowUpdate {
  name?: string;
  description?: string;
  definition?: WorkflowDefinition;
}

/* ---------- Runs ---------- */

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'waiting_approval';

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'waiting_approval';

export interface WorkflowStepResult {
  step_id: string;
  status: WorkflowStepStatus;
  output?: Record<string, unknown> | null;
  approval_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: WorkflowRunStatus;
  started_at?: string | null;
  finished_at?: string | null;
  triggered_by: string;
  current_step_id?: string | null;
  state: Record<string, unknown>;
  error?: string | null;
  tenant_id: string;
  project_id?: string;
  step_results?: WorkflowStepResult[];
}

/* ---------- Stream events ---------- */

export type RunStreamEventType =
  | 'snapshot'
  | 'workflow.step.started'
  | 'workflow.step.completed'
  | 'workflow.step.failed'
  | 'workflow.run.paused'
  | 'workflow.run.resumed'
  | 'workflow.run.completed'
  | 'workflow.run.failed'
  | 'workflow.run.cancelled';

export interface RunStreamEvent {
  type: RunStreamEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

/* ---------- Budget (NFR-044) ---------- */

export type WorkflowBudgetStatus =
  | 'active'
  | 'exhausted'
  | 'closed'
  | 'no_budget';

export interface WorkflowBudget {
  workflow_id: string;
  ceiling_usd: number;
  spent_usd: number;
  remaining_usd: number;
  status: WorkflowBudgetStatus;
  headroom_pct: number | null;
}

/* ---------- Query keys ---------- */

export const workflowQueryKeys = {
  all: ['workflows'] as const,
  list: (filter?: { search?: string; status?: WorkflowStatus }) =>
    [...workflowQueryKeys.all, 'list', filter ?? {}] as const,
  detail: (id: string) => [...workflowQueryKeys.all, 'detail', id] as const,
  runs: {
    all: ['workflow-runs'] as const,
    list: (workflowId?: string) =>
      [...workflowQueryKeys.runs.all, 'list', workflowId ?? 'all'] as const,
    detail: (id: string) =>
      [...workflowQueryKeys.runs.all, 'detail', id] as const,
  },
};
