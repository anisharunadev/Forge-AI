'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, Circle } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TaskBreakdown, TaskNode } from '@/lib/architecture/data';

const STATUS_TONE: Record<TaskNode['status'], string> = {
  todo: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  in_progress: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  blocked: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

function NodeRow({
  node,
  depth,
}: {
  node: TaskNode;
  depth: number;
}) {
  const [open, setOpen] = React.useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <div data-testid="task-tree-node" data-task-id={node.id}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left text-sm transition-colors',
          'hover:border-forge-700/40 hover:bg-forge-900/40',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          )
        ) : (
          <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span className="flex-1 truncate">{node.title}</span>
        <span className="font-mono text-[10px] text-forge-300">
          {node.estimateHours}h
        </span>
        <span
          className={cn(
            'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[node.status],
          )}
        >
          {node.status.replace('_', ' ')}
        </span>
      </button>
      {hasChildren && open ? (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <NodeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface TaskBreakdownTreeProps {
  breakdown: TaskBreakdown;
  className?: string;
}

export function TaskBreakdownTree({ breakdown, className }: TaskBreakdownTreeProps) {
  return (
    <article
      data-testid="task-breakdown-tree"
      data-breakdown-id={breakdown.id}
      className={cn('card flex flex-col gap-3', className)}
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold leading-tight">
            {breakdown.title}
          </h3>
          <p className="font-mono text-xs text-forge-300">
            Source: {breakdown.source}
          </p>
        </div>
        <span className="rounded-sm border border-forge-700/40 bg-forge-800 px-2 py-0.5 font-mono text-xs">
          {breakdown.totalEstimateHours}h total
        </span>
      </header>
      <div className="flex flex-col gap-1">
        <NodeRow node={breakdown.tree} depth={0} />
      </div>
    </article>
  );
}

export interface TaskBreakdownListProps {
  breakdowns: ReadonlyArray<TaskBreakdown>;
  selectedId?: string;
  onSelect?: (b: TaskBreakdown) => void;
}

export function TaskBreakdownList({
  breakdowns,
  selectedId,
  onSelect,
}: TaskBreakdownListProps) {
  return (
    <ul
      role="list"
      aria-label="Task breakdowns"
      data-testid="task-breakdown-list"
      className="flex flex-col gap-2"
    >
      {breakdowns.map((b) => (
        <li key={b.id}>
          <button
            type="button"
            onClick={() => onSelect?.(b)}
            data-testid="task-breakdown-item"
            data-breakdown-id={b.id}
            className={cn(
              'flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors',
              selectedId === b.id
                ? 'border-forge-300 bg-forge-800/60'
                : 'border-forge-700/40 hover:border-forge-500',
            )}
          >
            <div className="flex flex-col">
              <span className="font-medium">{b.title}</span>
              <span className="font-mono text-[10px] text-forge-300">
                {b.source}
              </span>
            </div>
            <span className="font-mono text-xs">{b.totalEstimateHours}h</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
