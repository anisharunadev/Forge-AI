/**
 * Typed API client for the Workflows center.
 *
 * Step-56: Wire the Workflows center to the real FastAPI backend.
 * Mirrors `backend/app/api/v1/workflows.py`.
 *
 * All endpoints require:
 *   - `Authorization: Bearer <token>` — attached automatically by
 *     the shared client in `lib/api/client.ts`.
 *   - `x-forge-tenant-id` — attached automatically from the auth
 *     store. Backend enforces tenant isolation (Rule 2).
 */

import { api } from '@/lib/api/client';
import type {
  Workflow,
  WorkflowBudget,
  WorkflowCreate,
  WorkflowRun,
  WorkflowUpdate,
} from './types';

/* ---------- Workflows CRUD ---------- */

export function listWorkflows(params?: {
  search?: string;
  status?: string;
}): Promise<Workflow[]> {
  const search = new URLSearchParams();
  if (params?.search) search.set('search', params.search);
  if (params?.status) search.set('status', params.status);
  const q = search.toString();
  return api.get<Workflow[]>(`/workflows${q ? `?${q}` : ''}`);
}

export function getWorkflow(id: string): Promise<Workflow> {
  return api.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);
}

export function createWorkflow(input: WorkflowCreate): Promise<Workflow> {
  return api.post<Workflow>('/workflows', input);
}

export function updateWorkflow(
  id: string,
  patch: WorkflowUpdate,
): Promise<Workflow> {
  return api.patch<Workflow>(`/workflows/${encodeURIComponent(id)}`, patch);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await api.delete<void>(`/workflows/${encodeURIComponent(id)}`);
}

export function publishWorkflow(id: string): Promise<Workflow> {
  return api.post<Workflow>(`/workflows/${encodeURIComponent(id)}/publish`);
}

export function duplicateWorkflow(id: string): Promise<Workflow> {
  return api.post<Workflow>(`/workflows/${encodeURIComponent(id)}/duplicate`);
}

/* ---------- Runs ---------- */

/**
 * Flat tenant-scoped list of every workflow run across every workflow.
 *
 * Step-56 Zone 6: backing the Runs Center page so the table renders
 * `WorkflowRun` rows (Step-56 FastAPI surface) rather than the SDLC
 * `RunRecord` rows from `/v1/runs`. The Runs Center page expects an
 * unfiltered, unprojected list — filtering by status / agent / date
 * happens client-side via the page's filter bar.
 *
 * Mirrors `backend/app/api/v1/workflows.py::list_all_runs`.
 */
export function listAllWorkflowRuns(): Promise<WorkflowRun[]> {
  return api.get<WorkflowRun[]>(`/workflows/runs`);
}

export function listWorkflowRuns(workflowId: string): Promise<WorkflowRun[]> {
  return api.get<WorkflowRun[]>(`/workflows/${encodeURIComponent(workflowId)}/runs`);
}

export function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  return api.get<WorkflowRun>(`/workflows/runs/${encodeURIComponent(runId)}`);
}

export function startWorkflowRun(workflowId: string): Promise<WorkflowRun> {
  return api.post<WorkflowRun>(
    `/workflows/${encodeURIComponent(workflowId)}/runs`,
    {},
  );
}

export function cancelWorkflowRun(runId: string): Promise<WorkflowRun> {
  return api.post<WorkflowRun>(
    `/workflows/runs/${encodeURIComponent(runId)}/cancel`,
    {},
  );
}

export function resumeWorkflowRun(runId: string): Promise<WorkflowRun> {
  return api.post<WorkflowRun>(
    `/workflows/runs/${encodeURIComponent(runId)}/resume`,
    {},
  );
}

/* ---------- Budget (NFR-044) ---------- */

export function getWorkflowBudget(workflowId: string): Promise<WorkflowBudget> {
  return api.get<WorkflowBudget>(
    `/workflows/${encodeURIComponent(workflowId)}/budget`,
  );
}
