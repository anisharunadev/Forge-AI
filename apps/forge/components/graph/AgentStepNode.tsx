'use client';

import * as React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';
import {
  toneClasses,
  agentStateToTone,
  agentStateGlyph,
  agentStatePulse,
} from '@/lib/design-system/status';
import type { NodeAgentStepData } from './types';

/**
 * React Flow node renderer for a single agent pipeline step.
 *
 * Uses the canonical AgentState -> tone/glyph/pulse mappings so a
 * thinking step reads as slow-pulse blue, executing as spinning
 * violet, completed as static green, failed as a one-shot red pulse.
 */
export type AgentStepNodeProps = NodeProps<Node<NodeAgentStepData & Record<string, unknown>, 'agentStep'>>;

const PULSE_CLASS: Record<ReturnType<typeof agentStatePulse>, string> = {
  none: '',
  slow: 'animate-pulse-agent',
  active: 'animate-spin-execution',
  'fast-to-static': 'animate-pulse',
};

export function AgentStepNode({ data, selected }: AgentStepNodeProps) {
  const tone = toneClasses[agentStateToTone(data.state)];
  const glyph = agentStateGlyph(data.state);
  const pulseClass = PULSE_CLASS[agentStatePulse(data.state)];
  return (
    <div
      data-testid="graph-node"
      data-node-kind="agentStep"
      data-state={data.state}
      className={cn(
        'rounded-md border px-3 py-2 text-foreground shadow-elev-xs min-w-[180px]',
        tone.bg,
        tone.fg,
        'ring-1',
        tone.ring,
        selected && 'ring-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full border border-current/40 bg-background/50 text-[11px] leading-none',
            pulseClass,
          )}
        >
          {glyph}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-2xs uppercase tracking-wider opacity-80">
            {data.agent}
          </span>
          <span className="truncate text-13 font-semibold">{data.label}</span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-2xs opacity-80">
        <span className="font-mono">{data.state}</span>
        {data.durationMs !== undefined ? (
          <span className="font-mono">{data.durationMs}ms</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}
