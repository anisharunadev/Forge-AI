'use client';

/**
 * TanStack Query hooks for the Workflows center (Phase 4, step-56).
 *
 * Pattern mirrors `useConnectorLifecycle` (canonical example in this
 * codebase) and `useSettings` (CRUD with invalidate-after-mutate).
 *
 *   - `useWorkflows` / `useWorkflow`     — list + detail queries
 *   - `useCreateWorkflow` / `useUpdateWorkflow` / `useDeleteWorkflow`
 *   - `usePublishWorkflow` / `useDuplicateWorkflow`
 *   - `useWorkflowRuns` / `useWorkflowRun`
 *   - `useStartWorkflowRun` / `useCancelWorkflowRun` / `useResumeWorkflowRun`
 *   - `useRunLiveEvents`                 — SSE stream subscription
 *
 * `useRunLiveEvents` does NOT use TanStack Query — the SSE stream is
 * a long-lived subscription that lives outside the query cache.
 */

import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, FORGE_API_BASE_URL } from '@/lib/api/client';
import { useAuth } from '@/lib/api/auth';

import {
  cancelWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  getWorkflow,
  getWorkflowBudget,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  publishWorkflow,
  resumeWorkflowRun,
  startWorkflowRun,
  updateWorkflow,
} from '@/lib/workflows/data';
import {
  workflowQueryKeys,
  type RunStreamEvent,
  type Workflow,
  type WorkflowBudget,
  type WorkflowCreate,
  type WorkflowRun,
  type WorkflowStatus,
  type WorkflowUpdate,
} from '@/lib/workflows/types';

/* ---------- List / detail ---------- */

export function useWorkflows(filter?: {
  search?: string;
  status?: WorkflowStatus;
}) {
  return useQuery<Workflow[]>({
    queryKey: workflowQueryKeys.list(filter),
    queryFn: () => listWorkflows(filter),
    staleTime: 30_000,
  });
}

export function useWorkflow(id: string | null) {
  return useQuery<Workflow>({
    queryKey: id ? workflowQueryKeys.detail(id) : ['workflows', 'detail', 'none'],
    queryFn: () => getWorkflow(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

/* ---------- Mutations ---------- */

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation<Workflow, Error, WorkflowCreate>({
    mutationFn: (input) => createWorkflow(input),
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.all });
      toast.success('Workflow created', { description: wf.name });
    },
    onError: (err) => toast.error('Failed to create workflow', { description: err.message }),
  });
}

export function useUpdateWorkflow(id: string) {
  const qc = useQueryClient();
  return useMutation<Workflow, Error, WorkflowUpdate>({
    mutationFn: (patch) => updateWorkflow(id, patch),
    // Optimistic merge so the canvas reflects the change immediately.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: workflowQueryKeys.detail(id) });
      const previous = qc.getQueryData<Workflow>(workflowQueryKeys.detail(id));
      if (previous) {
        qc.setQueryData<Workflow>(workflowQueryKeys.detail(id), {
          ...previous,
          ...patch,
          updated_at: new Date().toISOString(),
        });
      }
      return { previous };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(workflowQueryKeys.detail(id), ctx.previous);
      }
      toast.error('Save failed', { description: err.message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.detail(id) });
      qc.invalidateQueries({ queryKey: workflowQueryKeys.all });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteWorkflow(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: workflowQueryKeys.all });
      const previous = qc.getQueryData<Workflow[]>(workflowQueryKeys.list());
      qc.setQueryData<Workflow[]>(workflowQueryKeys.list(), (old) =>
        (old ?? []).filter((w) => w.id !== id),
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(workflowQueryKeys.list(), ctx.previous);
      }
      toast.error('Delete failed', { description: err.message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.all });
    },
  });
}

export function usePublishWorkflow() {
  const qc = useQueryClient();
  return useMutation<Workflow, Error, string>({
    mutationFn: (id) => publishWorkflow(id),
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.all });
      qc.setQueryData(workflowQueryKeys.detail(wf.id), wf);
      toast.success('Workflow published');
    },
  });
}

export function useDuplicateWorkflow() {
  const qc = useQueryClient();
  return useMutation<Workflow, Error, string>({
    mutationFn: (id) => duplicateWorkflow(id),
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.all });
      toast.success('Workflow duplicated', { description: wf.name });
    },
  });
}

/* ---------- Runs ---------- */

export function useWorkflowRuns(workflowId: string | null | undefined) {
  return useQuery<WorkflowRun[]>({
    queryKey: workflowQueryKeys.runs.list(workflowId ?? undefined),
    enabled: Boolean(workflowId),
    queryFn: () => listWorkflowRuns(workflowId),
    // Poll while there are active runs so the list self-refreshes.
    refetchInterval: (q) => {
      const data = q.state.data as WorkflowRun[] | undefined;
      if (!data) return 5_000;
      const active = data.some((r) =>
        ['queued', 'running', 'paused', 'waiting_approval'].includes(r.status),
      );
      return active ? 5_000 : 30_000;
    },
  });
}

export function useWorkflowRun(runId: string | null) {
  return useQuery<WorkflowRun>({
    queryKey: runId ? workflowQueryKeys.runs.detail(runId) : ['workflow-runs', 'detail', 'none'],
    queryFn: () => getWorkflowRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const data = q.state.data as WorkflowRun | undefined;
      if (!data) return 2_000;
      return ['queued', 'running', 'paused', 'waiting_approval'].includes(data.status)
        ? 2_000
        : false;
    },
  });
}

export function useStartWorkflowRun() {
  const qc = useQueryClient();
  return useMutation<WorkflowRun, Error, string>({
    mutationFn: (workflowId) => startWorkflowRun(workflowId),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.runs.all });
      toast.success('Run started', { description: run.id.slice(0, 8) });
    },
    onError: (err) => toast.error('Run failed to start', { description: err.message }),
  });
}

export function useCancelWorkflowRun() {
  const qc = useQueryClient();
  return useMutation<WorkflowRun, Error, string>({
    mutationFn: (runId) => cancelWorkflowRun(runId),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.runs.all });
      qc.setQueryData(workflowQueryKeys.runs.detail(run.id), run);
      toast.info('Run cancelled');
    },
  });
}

export function useResumeWorkflowRun() {
  const qc = useQueryClient();
  return useMutation<WorkflowRun, Error, string>({
    mutationFn: (runId) => resumeWorkflowRun(runId),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.runs.all });
      qc.setQueryData(workflowQueryKeys.runs.detail(run.id), run);
      toast.success('Run resumed');
    },
  });
}

/* ---------- Budget (NFR-044) ---------- */

export function useWorkflowBudget(workflowId: string | null) {
  return useQuery<WorkflowBudget>({
    queryKey: workflowId
      ? ['workflows', 'budget', workflowId]
      : ['workflows', 'budget', 'none'],
    queryFn: () => getWorkflowBudget(workflowId as string),
    enabled: Boolean(workflowId),
    staleTime: 15_000,
  });
}

/* ---------- SSE live stream ----------
 *
 * The backend exposes `GET /api/v1/workflows/runs/{id}/events` as an
 * SSE stream. We open it with `EventSource` (which the browser
 * handles natively) and surface each event to the caller.
 *
 * The token is passed as `?token=` because EventSource cannot set
 * the Authorization header.
 */

export function useRunLiveEvents(runId: string | null): {
  events: RunStreamEvent[];
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
} {
  const [events, setEvents] = useState<RunStreamEvent[]>([]);
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'open' | 'closed' | 'error'
  >('idle');

  useEffect(() => {
    if (!runId || typeof window === 'undefined') {
      setEvents([]);
      setStatus('idle');
      return;
    }

    const token = useAuth.getState().getToken() ?? '';
    const url = `${FORGE_API_BASE_URL}/workflows/runs/${encodeURIComponent(
      runId,
    )}/events?token=${encodeURIComponent(token)}`;

    let es: EventSource | null = null;
    let cancelled = false;
    try {
      es = new EventSource(url, { withCredentials: false });
      setStatus('connecting');

      es.onopen = () => {
        if (!cancelled) setStatus('open');
      };
      es.onerror = () => {
        if (!cancelled) setStatus('error');
      };
      es.onmessage = (e) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(e.data) as RunStreamEvent;
          setEvents((prev) => [...prev, parsed]);
        } catch {
          /* ignore malformed payloads */
        }
      };
    } catch {
      setStatus('error');
    }

    return () => {
      cancelled = true;
      setStatus('closed');
      if (es) {
        try {
          es.close();
        } catch {
          /* noop */
        }
      }
    };
  }, [runId]);

  return { events, status };
}
