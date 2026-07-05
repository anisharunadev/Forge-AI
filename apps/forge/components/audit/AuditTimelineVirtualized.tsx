'use client';

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Activity, Shield } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { toneClasses, type StatusTone } from '@/lib/design-system/status';
import { EmptyState } from '@/src/components/empty-state';
import type { AuditRecord, AuditAction } from '@/lib/audit/data';

/**
 * Virtualized audit timeline (Phase 0.5-06).
 *
 * Replaces the render-everything `AuditTimeline` for any page that
 * may show >1000 events (PILOT-04 + OPS-20). Uses @tanstack/react-virtual
 * with overscan so scrolling stays smooth at 10k+ records.
 *
 * Styling is semantic: action -> tone via `toneClasses`. No direct
 * hex literals; no `bg-emerald-500/15`-style classes.
 */
export interface AuditTimelineVirtualizedProps {
  readonly records: ReadonlyArray<AuditRecord>;
  readonly height?: number;
  readonly itemHeight?: number;
  readonly onSelect?: (record: AuditRecord) => void;
  readonly selectedId?: string;
  readonly emptyMessage?: string;
}

const ACTION_TONE: Record<AuditAction, StatusTone> = {
  login: 'success',
  logout: 'idle',
  command_run: 'execution',
  artifact_created: 'info',
  artifact_published: 'success',
  terminal_command: 'info',
  approval_decided: 'review',
  role_changed: 'warn',
  policy_updated: 'review',
  connector_attached: 'agent',
};

const ACTION_LABEL: Record<AuditAction, string> = {
  login: 'login',
  logout: 'logout',
  command_run: 'command',
  artifact_created: 'created',
  artifact_published: 'published',
  terminal_command: 'terminal',
  approval_decided: 'approval',
  role_changed: 'role',
  policy_updated: 'policy',
  connector_attached: 'connector',
};

export function AuditTimelineVirtualized({
  records,
  height = 560,
  itemHeight = 96,
  onSelect,
  selectedId,
  emptyMessage,
}: AuditTimelineVirtualizedProps) {
  const parentRef = React.useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 8,
  });

  if (records.length === 0) {
    return (
      <div
        data-testid="audit-timeline-virtualized-empty"
        className="rounded-md border bg-card"
      >
        <EmptyState
          compact
          illustration={emptyMessage ? <Activity size={28} strokeWidth={1.5} /> : <Shield size={28} strokeWidth={1.5} />}
          title={emptyMessage ? 'No audit records match the current filters' : 'Audit trail is empty'}
          description={
            emptyMessage
              ?? 'Agent activity, approvals, and policy decisions will appear here as they happen.'
          }
        />
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      data-testid="audit-timeline-virtualized"
      data-records={records.length}
      className="overflow-auto rounded-md border bg-card"
      style={{ height }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const record = records[virtualRow.index];
          if (!record) return null;
          const tone = toneClasses[ACTION_TONE[record.action]];
          return (
            <div
              key={virtualRow.key}
              data-testid="audit-timeline-virtualized-row audit-row"
              data-record-id={record.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                padding: '8px 12px',
              }}
            >
              <button
                type="button"
                onClick={() => onSelect?.(record)}
                className={cn(
                  'flex w-full flex-col gap-2 rounded-md border bg-card p-3 text-left text-13 transition-colors',
                  selectedId === record.id
                    ? 'border-primary bg-hover'
                    : 'border-border hover:border-muted-foreground',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface font-mono text-2xs"
                    aria-hidden="true"
                  >
                    {record.actor.avatar}
                  </span>
                  <span className="font-medium text-foreground">
                    {record.actor.name}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
                      tone.bg,
                      tone.fg,
                    )}
                  >
                    <Activity className="h-2.5 w-2.5" aria-hidden="true" />
                    {ACTION_LABEL[record.action]}
                  </span>
                  <Badge variant="outline" className="text-2xs">
                    {record.target.type}
                  </Badge>
                  <span className="truncate text-xs text-muted-foreground">
                    {record.target.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-2xs text-muted-foreground">
                  <span>{new Date(record.timestamp).toLocaleString()}</span>
                  <span>·</span>
                  <span>tenant {record.tenantName}</span>
                  <span>·</span>
                  <span>hash {record.hash.slice(0, 12)}…</span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
