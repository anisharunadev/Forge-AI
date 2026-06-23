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
import type { NodeAgentStepData } from './types';

/**
 * Per-run agent execution graph. Steps are laid out top-to-bottom
 * in time order; the currently active step (`executing` or `thinking`)
 * gets a tone that distinguishes it from the rest.
 */
export interface AgentExecutionStep {
  readonly id: string;
  readonly label: string;
  readonly agent: string;
  readonly state: NodeAgentStepData['state'];
  readonly durationMs?: number;
}

export interface AgentExecutionGraphProps {
  readonly steps: ReadonlyArray<AgentExecutionStep>;
  readonly height?: number;
}

function buildNodes(
  steps: ReadonlyArray<AgentExecutionStep>,
): Array<Node<NodeAgentStepData>> {
  return steps.map((s, i) => ({
    id: s.id,
    type: 'agentStep',
    position: { x: 0, y: i * 120 },
    data: {
      kind: 'agentStep',
      label: s.label,
      agent: s.agent,
      state: s.state,
      ...(s.durationMs !== undefined ? { durationMs: s.durationMs } : {}),
    },
  }));
}

function buildEdges(steps: ReadonlyArray<AgentExecutionStep>): Edge[] {
  return steps.slice(0, -1).map((s, i) => {
    const next = steps[i + 1];
    if (!next) {
      throw new Error('agent execution edge target missing');
    }
    return {
      id: `edge:${s.id}->${next.id}`,
      source: s.id,
      target: next.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'hsl(var(--border))' },
    };
  });
}

function AgentExecutionGraphInner({
  steps,
  height = 480,
}: AgentExecutionGraphProps) {
  const nodes = React.useMemo(() => buildNodes(steps), [steps]);
  const edges = React.useMemo(() => buildEdges(steps), [steps]);
  return (
    <div
      data-testid="agent-execution-graph"
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

export function AgentExecutionGraph(props: AgentExecutionGraphProps) {
  return (
    <ReactFlowProvider>
      <AgentExecutionGraphInner {...props} />
    </ReactFlowProvider>
  );
}
