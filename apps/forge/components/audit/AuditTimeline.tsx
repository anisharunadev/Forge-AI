'use client';

import * as React from 'react';
import { Activity, Shield } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/src/components/empty-state';
import type { AuditRecord } from '@/lib/audit/data';

const ACTION_TONE: Record<AuditRecord['action'], string> = {
  login: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  logout: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  command_run: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  artifact_created: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  artifact_published: 'border-violet-500/60 bg-violet-500/20 text-violet-200',
  terminal_command: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  approval_decided: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  role_changed: 'border-pink-500/40 bg-pink-500/10 text-pink-300',
  policy_updated: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  connector_attached: 'border-teal-500/40 bg-teal-500/10 text-teal-300',
};

export interface AuditTimelineProps {
  records: ReadonlyArray<AuditRecord>;
  onSelect?: (record: AuditRecord) => void;
  selectedId?: string;
  emptyMessage?: string;
}

export function AuditTimeline({
  records,
  onSelect,
  selectedId,
  emptyMessage,
}: AuditTimelineProps) {
  if (records.length === 0) {
    return (
      <div data-testid="audit-timeline-empty" className="card">
        <EmptyState
          compact
          illustration={emptyMessage ? <Activity size={28} strokeWidth={1.5} /> : <Shield size={28} strokeWidth={1.5} />}
          title={emptyMessage ? 'No audit records match the current filters' : 'Audit trail is empty'}
          description={
            emptyMessage
              ? 'Try clearing your filters to see every audit record.'
              : 'Agent activity, approvals, and policy decisions will appear here as they happen.'
          }
        />
      </div>
    );
  }

  return (
    <ol
      aria-label="Audit timeline"
      className="relative ml-3 border-l border-forge-700/40"
      data-testid="audit-timeline"
    >
      {records.map((r) => (
        <li
          key={r.id}
          className="mb-3 ml-6"
          data-testid="audit-timeline-item"
          data-record-id={r.id}
        >
          <span
            className={cn(
              'absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full border border-forge-700 bg-forge-800 text-[10px]',
            )}
            aria-hidden="true"
          >
            <Activity className="h-2 w-2 text-forge-300" />
          </span>
          <button
            type="button"
            onClick={() => onSelect?.(r)}
            className={cn(
              'flex w-full flex-col gap-2 rounded-md border p-3 text-left text-sm transition-colors',
              selectedId === r.id
                ? 'border-forge-300 bg-forge-800/60'
                : 'border-forge-700/40 hover:border-forge-500',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-forge-700 bg-forge-800 font-mono text-[10px]">
                {r.actor.avatar}
              </span>
              <span className="font-medium">{r.actor.name}</span>
              <span
                className={cn(
                  'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  ACTION_TONE[r.action],
                )}
              >
                {r.action.replace('_', ' ')}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {r.target.type}
              </Badge>
              <span className="text-xs text-forge-200">{r.target.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-forge-400">
              <span>{new Date(r.timestamp).toLocaleString()}</span>
              <span>·</span>
              <span className="font-mono">tenant {r.tenantName}</span>
              <span>·</span>
              <span>hash {r.hash.slice(0, 12)}…</span>
            </div>
          </button>
        </li>
      ))}
    </ol>
  );
}
