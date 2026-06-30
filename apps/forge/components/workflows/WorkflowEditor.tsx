'use client';

/**
 * WorkflowEditor — Step-56 (Phase 4).
 *
 * The FastAPI-backed visual editor. Hydrates the canvas from
 * `useWorkflow(id)`, debounces PATCH calls to `/workflows/{id}`, and
 * uses `useStartWorkflowRun` for the "Run" CTA.
 *
 * Defers to the existing Step-22/23 `<WorkflowCanvas>` for the
 * React Flow experience so the visual editor design is preserved
 * (per step-56 CONSTRAINTS).
 */

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Play, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/error-state';
import { Spinner } from '@/components/ui/spinner';
import { WorkflowCanvas } from '@/components/workflow/WorkflowCanvas';
import {
  useStartWorkflowRun,
  useUpdateWorkflow,
  useWorkflow,
} from '@/lib/hooks/useWorkflows';
import { wireToCanvas } from '@/lib/workflows/adapter';
import { useWorkflowStore } from '@/components/workflow/store';
import type { WorkflowNodeData } from '@/lib/workflow/types';

export function WorkflowEditor() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const { data: workflow, isLoading, error } = useWorkflow(id);
  const update = useUpdateWorkflow(id);
  const startRun = useStartWorkflowRun();
  const setDoc = useWorkflowStore((s) => s.setDoc);
  const hydrateFromTemplate = useWorkflowStore((s) => s.hydrateFromTemplate);

  // Hydrate the canvas once when the workflow loads.
  const hydratedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!workflow) return;
    if (hydratedRef.current === workflow.id) return;
    hydratedRef.current = workflow.id;
    setDoc({ name: workflow.name, description: workflow.description ?? '' });
    const def = workflow.definition ?? { nodes: [], edges: [], settings: {} };
    const canvasNodes = (def.nodes ?? []).map((n) => ({
      ...wireToCanvas(n),
      position: n.position,
    })) as unknown as ReadonlyArray<WorkflowNodeData & { position: { x: number; y: number } }>;
    hydrateFromTemplate({
      nodes: canvasNodes,
      edges: (def.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
      name: workflow.name,
      description: workflow.description ?? '',
    });
  }, [workflow, hydrateFromTemplate, setDoc]);

  // Auto-save the definition whenever the canvas changes.
  // We debounce 1s per the step-56 CONSTRAINTS section.
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  React.useEffect(() => {
    if (!workflow) return;
    if (hydratedRef.current !== workflow.id) return;
    const t = setTimeout(() => {
      const definition = {
        nodes: nodes.map((n) => ({
          id: n.id,
          position: n.position,
          data: canvasNodeToWireData(n.data as WorkflowNodeData),
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        })),
        settings: workflow.definition?.settings ?? {},
      };
      update.mutate({ definition });
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <ErrorState
          title="Workflow not found"
          description={error?.message ?? 'The workflow may have been deleted.'}
          onRetry={() => router.push('/workflows')}
        />
      </div>
    );
  }

  const handleRun = async () => {
    try {
      const run = await startRun.mutateAsync(workflow.id);
      router.push(`/runs/${run.id}`);
    } catch {
      /* toast handled by the hook */
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header
        className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4"
        data-testid="workflow-editor-header"
      >
        <Link
          href="/workflows"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
          aria-label="Back to workflows"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-[var(--fg-primary)]">
            {workflow.name}
          </h1>
          <p className="truncate text-[11px] text-[var(--fg-tertiary)]">
            {workflow.description || 'No description'}
          </p>
        </div>
        <Badge tone={workflow.status === 'published' ? 'emerald' : 'amber'}>
          {workflow.status}
        </Badge>
        <SaveIndicator status={update.isPending ? 'saving' : update.isError ? 'error' : 'saved'} />
        <Button
          type="button"
          size="sm"
          onClick={handleRun}
          disabled={startRun.isPending}
          data-testid="workflow-run"
        >
          <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Run
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        <WorkflowCanvas onBack={() => router.push('/workflows')} />
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: 'saving' | 'saved' | 'error' }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]"
      data-testid="workflow-save-status"
      data-status={status}
    >
      <Save className="h-3 w-3" aria-hidden="true" />
      {status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : 'Saved'}
    </span>
  );
}

function canvasNodeToWireData(d: WorkflowNodeData) {
  // Inverse of wireToCanvas in adapter.ts — keep them in sync.
  switch (d.kind) {
    case 'trigger':
      return { type: 'trigger' as const, label: d.label };
    case 'command':
      return { type: 'command' as const, command_name: d.commandName, on_error: 'fail' as const };
    case 'approval':
      return {
        type: 'approval' as const,
        label: d.label,
        timeout_hours: d.timeoutHours,
      };
    default:
      // Anything we don't have a wire type for is persisted as a script
      // so the editor never loses data.
      return {
        type: 'script' as const,
        language: 'python' as const,
        source: JSON.stringify(d, null, 2),
      };
  }
}
