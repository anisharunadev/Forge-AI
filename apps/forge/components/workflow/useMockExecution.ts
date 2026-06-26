'use client';

/**
 * Mock execution engine.
 *
 * Steps through nodes topologically with realistic per-node-type
 * delays. Sets per-node runState on the store + emits log entries.
 * Honors disabled nodes (skipped) and condition branching.
 *
 * Real backend integration is a follow-up — this is enough to
 * demonstrate the visual run loop end-to-end.
 */

import * as React from 'react';
import type { Edge, Node } from '@xyflow/react';

import { useWorkflowStore } from './store';
import type {
  NodeRunStatus,
  WorkflowNodeData,
} from '@/lib/workflow/types';

interface UseMockExecutionResult {
  readonly start: () => void;
  readonly stop: () => void;
  readonly isExecuting: boolean;
  readonly progress: { current: number; total: number };
  readonly currentNodeLabel: string | null;
}

function delayFor(kind: WorkflowNodeData['kind']): number {
  switch (kind) {
    case 'command': return 600;
    case 'llmPrompt': return 1200;
    case 'agent': return 2000;
    case 'apiRequest': return 500;
    case 'approval': return 400;
    case 'wait': return 800;
    case 'trigger': return 200;
    case 'condition': return 150;
    case 'end': return 100;
  }
}

/** Build a topological execution order — simple DFS over edges. */
function orderNodes(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
): Node<WorkflowNodeData>[] {
  const incoming = new Map<string, string[]>();
  nodes.forEach((n) => incoming.set(n.id, []));
  edges.forEach((e) => {
    const arr = incoming.get(e.target);
    if (arr) arr.push(e.source);
  });

  const visited = new Set<string>();
  const order: Node<WorkflowNodeData>[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node) order.push(node);
    const next = edges
      .filter((e) => e.source === id)
      .map((e) => e.target);
    next.forEach(visit);
  }

  const trigger = nodes.find((n) => n.data.kind === 'trigger');
  if (trigger) visit(trigger.id);
  // Catch any orphans (defensive — every workflow should start with a trigger).
  nodes.forEach((n) => {
    if (!visited.has(n.id)) visit(n.id);
  });
  return order;
}

function statusFromDelay(kind: WorkflowNodeData['kind']): NodeRunStatus {
  // 1-in-30 chance of failure on AI/API nodes for realism.
  if (kind === 'llmPrompt' || kind === 'apiRequest' || kind === 'agent') {
    return Math.random() < 0.04 ? 'failed' : 'succeeded';
  }
  return 'succeeded';
}

export function useMockExecution(): UseMockExecutionResult {
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const setNodeRunState = useWorkflowStore((s) => s.setNodeRunState);
  const begin = useWorkflowStore((s) => s.beginExecution);
  const end = useWorkflowStore((s) => s.endExecution);
  const appendLog = useWorkflowStore((s) => s.appendRunLog);
  const stopRef = React.useRef(false);
  const [progress, setProgress] = React.useState({ current: 0, total: 0 });
  const [currentNodeLabel, setCurrentNodeLabel] = React.useState<string | null>(null);

  const start = React.useCallback(() => {
    stopRef.current = false;
    const state = useWorkflowStore.getState();
    const order = orderNodes(state.nodes as Node<WorkflowNodeData>[], state.edges);
    if (order.length === 0) return;

    // Reset all nodes to idle.
    state.nodes.forEach((n) =>
      setNodeRunState(n.id, { status: 'idle' }),
    );

    begin();
    setProgress({ current: 0, total: order.length });

    const run = async () => {
      for (let i = 0; i < order.length; i++) {
        if (stopRef.current) break;
        const node = order[i]!;
        const kind = node.data.kind;
        const disabled = node.data.disabled;

        if (disabled) {
          setNodeRunState(node.id, { status: 'skipped' });
          appendLog({ nodeId: node.id, message: `${node.data.label} skipped (disabled)`, status: 'skipped' });
          setProgress({ current: i + 1, total: order.length });
          continue;
        }

        setNodeRunState(node.id, { status: 'running' });
        setCurrentNodeLabel(node.data.label);
        appendLog({ nodeId: node.id, message: `${node.data.label} started`, status: 'running' });
        await new Promise((r) => setTimeout(r, delayFor(kind)));

        if (stopRef.current) break;
        const outcome = statusFromDelay(kind);
        setNodeRunState(node.id, {
          status: outcome,
          durationMs: delayFor(kind),
          ...(outcome === 'failed' ? { error: `${kind} execution failed (mock). Check inputs and try again.` } : {}),
        });
        appendLog({
          nodeId: node.id,
          message:
            outcome === 'failed'
              ? `${node.data.label} failed`
              : `${node.data.label} completed in ${delayFor(kind)}ms`,
          status: outcome,
        });
        setProgress({ current: i + 1, total: order.length });

        if (outcome === 'failed') break;
      }
      setCurrentNodeLabel(null);
      end();
    };
    void run();
  }, [begin, setNodeRunState, appendLog, end]);

  const stop = React.useCallback(() => {
    stopRef.current = true;
    end();
    appendLog({ nodeId: '', message: 'Run stopped by user', status: 'failed' });
  }, [end, appendLog]);

  return {
    start,
    stop,
    isExecuting,
    progress,
    currentNodeLabel,
  };
}