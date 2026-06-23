'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

import { cn } from '@/lib/utils';
import {
  toneClasses,
  runStateTone,
  agentStateGlyph,
} from '@/lib/design-system/status';
import type { NodeApprovalData } from './types';

/**
 * React Flow node renderer for approval workflow gates
 * (Architecture / Security / Deployment).
 *
 * Tone derives from run state: waiting_approval=review, approved=success,
 * rejected=danger. The phase label is rendered as an eyebrow so a user
 * can scan a workflow graph and see exactly which gate is blocking.
 */
export type ApprovalNodeProps = NodeProps<NodeApprovalData>;

export function ApprovalNode({ data, selected }: ApprovalNodeProps) {
  const tone = toneClasses[runStateTone[data.runState] ?? 'idle'];
  const glyph = (() => {
    if (data.runState === 'approved') return agentStateGlyph('completed');
    if (data.runState === 'rejected') return agentStateGlyph('failed');
    return '◑';
  })();
  return (
    <div
      data-testid="graph-node"
      data-node-kind="approval"
      data-phase={data.phase}
      data-run-state={data.runState}
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
        <span aria-hidden="true" className="text-base leading-none">
          {glyph}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-2xs uppercase tracking-wider opacity-80">
            {data.phase}
          </span>
          <span className="truncate text-13 font-semibold">{data.label}</span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-2xs opacity-80">
        <span className="font-mono">requested by {data.requestedBy}</span>
        <span className="font-mono">{data.runState}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}
