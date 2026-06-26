'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  CheckCircle2,
  CircleDot,
  Clock,
  Copy,
  Loader2,
  MoreHorizontal,
  PowerOff,
  Trash2,
  XCircle,
  Plus,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { NodeRunStatus, WorkflowNodeData } from '@/lib/workflow/types';

/**
 * BaseNode — shared chrome for all 9 workflow node variants.
 *
 * Step-23 polish: bumped from 220px → 320px wide, larger type tokens,
 * bigger handles (14px), proper header/body/footer structure,
 * hover lift via transform (UX rule: never animate width/top/left).
 */

export interface BaseNodeProps extends Pick<NodeProps, 'id' | 'selected'> {
  readonly data: WorkflowNodeData;
  readonly accentVar: string;
  readonly icon: LucideIcon;
  readonly kindLabel: string;
  readonly children?: React.ReactNode;
  readonly showInputHandle?: boolean;
  readonly showOutputHandle?: boolean;
  readonly inputHandleId?: string;
  readonly outputHandleId?: string;
  readonly extraOutputHandles?: ReadonlyArray<{ id: string; label?: string }>;
  readonly footer?: React.ReactNode;
  readonly onDuplicate?: () => void;
  readonly onDelete?: () => void;
  readonly onDisable?: () => void;
  readonly onShowError?: () => void;
}

const RUN_STATUS_RING: Record<NodeRunStatus, string> = {
  idle: '',
  pending: 'ring-1 ring-[var(--border-default)]',
  running: 'ring-2 ring-[var(--accent-cyan)] shadow-[0_0_0_4px_rgba(6,182,212,0.18)] animate-pulse motion-reduce:animate-none',
  succeeded: 'ring-2 ring-[var(--accent-emerald)]',
  failed: 'ring-2 ring-[var(--accent-rose)]',
  skipped: 'opacity-50',
  waiting: 'ring-2 ring-[var(--accent-amber)]',
};

const RUN_STATUS_OVERLAY_ICON: Record<NodeRunStatus, { Icon: LucideIcon; cls: string } | null> = {
  idle: null,
  pending: { Icon: CircleDot, cls: 'text-[var(--fg-tertiary)]' },
  running: { Icon: Loader2, cls: 'text-[var(--accent-cyan)] animate-spin motion-reduce:animate-none' },
  succeeded: { Icon: CheckCircle2, cls: 'text-[var(--accent-emerald)]' },
  failed: { Icon: XCircle, cls: 'text-[var(--accent-rose)]' },
  skipped: { Icon: PowerOff, cls: 'text-[var(--fg-tertiary)]' },
  waiting: { Icon: Clock, cls: 'text-[var(--accent-amber)] animate-pulse motion-reduce:animate-none' },
};

export function BaseNode(props: BaseNodeProps) {
  const {
    data,
    accentVar,
    icon: Icon,
    kindLabel,
    children,
    showInputHandle = true,
    showOutputHandle = true,
    inputHandleId,
    outputHandleId,
    extraOutputHandles,
    footer,
    onDuplicate,
    onDelete,
    onDisable,
    onShowError,
  } = props;
  const selected = props.selected;

  const [menuOpen, setMenuOpen] = React.useState(false);
  const runState = (data as { runState?: NodeRunStatus }).runState ?? 'idle';
  const ringClass = RUN_STATUS_RING[runState];
  const overlay = RUN_STATUS_OVERLAY_ICON[runState];
  const error = (data as { runState?: NodeRunStatus; error?: string }).error;

  // Step-23: bigger handles (16px) with subtle outer ring on hover.
  const handleClass =
    '!h-4 !w-4 !rounded-full !border-2 !border-[var(--bg-base)] transition-[box-shadow,transform] duration-150 hover:scale-110 hover:shadow-[0_0_0_4px_rgba(99,102,241,0.30)] motion-reduce:transition-none motion-reduce:hover:scale-100';

  return (
    <div
      data-testid="workflow-node"
      data-node-kind={(data as { kind: string }).kind}
      data-node-id={(data as { id?: string }).id}
      data-run-status={runState}
      data-disabled={data.disabled ? 'true' : 'false'}
      className={cn(
        // Step-23: 220px → 320px; min-height 100px; hover lifts via transform (UX rule).
        'group relative w-[320px] min-h-[100px] rounded-[var(--radius-lg)] border-2 bg-[var(--bg-elevated)] text-left shadow-[var(--shadow-sm)]',
        'transition-[transform,box-shadow,border-color] duration-200 ease-out-soft motion-reduce:transition-none',
        'hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] motion-reduce:hover:translate-y-0',
        selected
          ? 'border-[var(--accent-primary)] shadow-[0_0_0_4px_rgba(99,102,241,0.15)]'
          : 'border-[var(--border-default)]',
        ringClass,
        data.disabled && 'opacity-50',
      )}
      style={{ borderColor: selected ? undefined : `var(${accentVar})` }}
    >
      {showInputHandle ? (
        <Handle
          type="target"
          position={Position.Left}
          id={inputHandleId}
          className={handleClass}
          style={{ background: `var(${accentVar})` }}
        />
      ) : null}

      {/* Header — icon + type label + 3-dot menu, p-16px, border-b */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-inset)]"
            style={{ color: `var(${accentVar})` }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
            {kindLabel}
          </span>
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Node menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus:opacity-100 focus:outline-none group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-7 z-30 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-md)]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <MenuItem onClick={() => { setMenuOpen(false); onDuplicate?.(); }} icon={Copy} label="Duplicate" />
              <MenuItem onClick={() => { setMenuOpen(false); onDisable?.(); }} icon={PowerOff} label={data.disabled ? 'Enable' : 'Disable'} />
              <MenuItem onClick={() => { setMenuOpen(false); onDelete?.(); }} icon={Trash2} label="Delete" danger />
            </div>
          ) : null}
        </div>
      </div>

      {/* Body — p-16px, gap-2, larger text tokens */}
      <div className="flex flex-col gap-2 px-4 py-4">
        <p className="truncate text-base font-semibold leading-tight text-[var(--fg-primary)]">{data.label}</p>
        {data.subtitle ? (
          <p className="truncate text-sm text-[var(--fg-tertiary)]">{data.subtitle}</p>
        ) : null}
        {data.summary ? (
          <p className="line-clamp-3 text-sm text-[var(--fg-secondary)]">{data.summary}</p>
        ) : null}
        {children}
      </div>

      {/* Footer (optional) — status / timing row */}
      {footer ? (
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] px-4 py-2.5 text-[11px] text-[var(--fg-tertiary)]">
          {footer}
        </div>
      ) : null}

      {overlay ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]',
            overlay.cls,
            runState === 'failed' && 'cursor-pointer',
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (runState === 'failed') onShowError?.();
          }}
          title={runState === 'failed' && error ? error : undefined}
        >
          <overlay.Icon className="h-4 w-4" />
        </span>
      ) : null}

      {showOutputHandle ? (
        <Handle
          type="source"
          position={Position.Right}
          id={outputHandleId}
          className={handleClass}
          style={{ background: `var(${accentVar})` }}
        />
      ) : null}

      {extraOutputHandles?.map((h, i) => (
        <Handle
          key={h.id}
          type="source"
          id={h.id}
          position={Position.Right}
          className={cn(handleClass)}
          style={{
            background: h.label?.toLowerCase().includes('false') ? 'var(--accent-rose)' : 'var(--accent-emerald)',
            top: `${50 + (i + 1) * 18}%`,
          }}
        />
      ))}

      {/* Step-23 Fix 11: tiny "+" icon inside handle on hover (CSS-only via sibling + group-hover). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[-12px] top-1/2 hidden -translate-y-1/2 text-[10px] text-[var(--accent-primary)] opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Plus className="h-2.5 w-2.5" />
      </span>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-xs',
        danger ? 'text-[var(--accent-rose)] hover:bg-[var(--bg-inset)]' : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}