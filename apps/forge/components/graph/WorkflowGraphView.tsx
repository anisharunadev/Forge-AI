'use client';

import * as React from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  type Edge,
  type Node,
} from 'reactflow';

import 'reactflow/dist/style.css';
import { forgeNodeTypes } from './index';
import type { NodeAgentStepData, NodeApprovalData } from './types';

/**
 * Workflow graph — start -> agent steps -> Architecture / Security /
 * Deployment gates -> done. The three gates are always rendered so
 * a user can see exactly where a workflow is paused.
 */
export interface WorkflowStepInput {
  readonly id: string;
  readonly label: string;
  readonly agent: string;
  readonly state: NodeAgentStepData['state'];
  readonly durationMs?: number;
}

export interface WorkflowGraphViewProps {
  readonly steps: ReadonlyArray<WorkflowStepInput>;
  readonly height?: number;
}

const GATE_PHASES = ['Architecture', 'Security', 'Deployment'] as const;

function buildNodes(
  steps: ReadonlyArray<WorkflowStepInput>,
): Array<Node<NodeAgentStepData | NodeApprovalData>> {
  const startNode: Node<NodeAgentStepData> = {
    id: 'start',
    type: 'agentStep',
    position: { x: 0, y: 0 },
    data: {
      kind: 'agentStep',
      label: 'Start',
      agent: 'forge',
      state: 'completed',
    },
  };

  const stepNodes: Array<Node<NodeAgentStepData>> = steps.map((s, i) => ({
    id: s.id,
    type: 'agentStep',
    position: { x: (i + 1) * 220, y: 0 },
    data: {
      kind: 'agentStep',
      label: s.label,
      agent: s.agent,
      state: s.state,
      ...(s.durationMs !== undefined ? { durationMs: s.durationMs } : {}),
    },
  }));

  const gateNodes: Array<Node<NodeApprovalData>> = GATE_PHASES.map((phase, i) => ({
    id: `gate:${phase}`,
    type: 'approval',
    position: { x: (steps.length + 1 + i) * 220, y: 0 },
    data: {
      kind: 'approval',
      label: `${phase} approval`,
      phase,
      runState: 'waiting_approval',
      requestedBy: 'forge-supervisor',
    },
  }));

  const doneNode: Node<NodeAgentStepData> = {
    id: 'done',
    type: 'agentStep',
    position: { x: (steps.length + 1 + GATE_PHASES.length) * 220, y: 0 },
    data: {
      kind: 'agentStep',
      label: 'Done',
      agent: 'forge',
      state: 'completed',
    },
  };

  return [startNode, ...stepNodes, ...gateNodes, doneNode];
}

function buildEdges(
  steps: ReadonlyArray<WorkflowStepInput>,
): Edge[] {
  const ids = ['start', ...steps.map((s) => s.id), ...GATE_PHASES.map((p) => `gate:${p}`), 'done'];
  return ids.slice(0, -1).map((src, i) => {
    const tgt = ids[i + 1];
    if (tgt === undefined) {
      // Unreachable due to slice(0, -1), but noUncheckedIndexedAccess
      // requires the guard.
      throw new Error('workflow edge target missing');
    }
    return {
      id: `edge:${src}->${tgt}`,
      source: src,
      target: tgt,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'hsl(var(--border))' },
    };
  });
}

function WorkflowGraphViewInner({
  steps,
  height = 280,
}: WorkflowGraphViewProps) {
  const nodes = React.useMemo(() => buildNodes(steps), [steps]);
  const edges = React.useMemo(() => buildEdges(steps), [steps]);
  return (
    <div
      data-testid="workflow-graph-view"
      data-steps={steps.length}
      style={{ height }}
      className="rounded-md border bg-card"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={forgeNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background color="hsl(var(--border))" gap={16} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function WorkflowGraphView(props: WorkflowGraphViewProps) {
  return (
    <ReactFlowProvider>
      <WorkflowGraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
