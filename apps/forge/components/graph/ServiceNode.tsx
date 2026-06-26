'use client';

import * as React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';
import { toneClasses } from '@/lib/design-system/status';
import type { NodeServiceData } from './types';

/**
 * React Flow node renderer for a service / datastore / component.
 *
 * Tone derives from health status (healthy/success, degraded/warn,
 * down/danger, idle/idle). Region is shown as an eyebrow when present.
 */
export type ServiceNodeProps = NodeProps<Node<NodeServiceData & Record<string, unknown>, 'service'>>;

const STATUS_TONE = {
  healthy: 'success',
  degraded: 'warn',
  down: 'danger',
  idle: 'idle',
} as const;

const KIND_GLYPH: Record<NodeServiceData['serviceKind'], string> = {
  service: '◉',
  datastore: '▥',
  component: '▣',
  external: '⇄',
};

export function ServiceNode({ data, selected }: ServiceNodeProps) {
  const toneKey = STATUS_TONE[data.status];
  const tone = toneClasses[toneKey];
  const glyph = KIND_GLYPH[data.serviceKind];
  return (
    <div
      data-testid="graph-node"
      data-node-kind="service"
      data-service-kind={data.serviceKind}
      data-status={data.status}
      className={cn(
        'rounded-md border px-3 py-2 text-foreground shadow-elev-xs min-w-[160px]',
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
            {data.serviceKind}
            {data.region ? ` · ${data.region}` : ''}
          </span>
          <span className="truncate text-13 font-semibold">{data.label}</span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-2xs opacity-80">
        <span className="font-mono">{data.status}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}
