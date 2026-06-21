'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SyncRecord } from '@/lib/connector-center/data';

const STATUS_TONE: Record<SyncRecord['status'], string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  partial: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

const TRIGGER_LABEL: Record<SyncRecord['triggeredBy'], string> = {
  schedule: 'Schedule',
  manual: 'Manual',
  webhook: 'Webhook',
};

export interface SyncHistoryTableProps {
  records: ReadonlyArray<SyncRecord>;
  emptyMessage?: string;
}

export function SyncHistoryTable({
  records,
  emptyMessage,
}: SyncHistoryTableProps) {
  if (records.length === 0) {
    return (
      <div
        className="card text-xs text-forge-300"
        data-testid="sync-history-empty"
      >
        {emptyMessage ?? 'No sync history recorded for this connector.'}
      </div>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded-md border border-forge-800"
      data-testid="sync-history-table"
    >
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-forge-800 text-left text-[10px] uppercase tracking-wider text-forge-300">
            <th className="px-2 py-1.5">Started</th>
            <th className="px-2 py-1.5">Status</th>
            <th className="px-2 py-1.5 text-right">Records</th>
            <th className="px-2 py-1.5">Trigger</th>
            <th className="px-2 py-1.5">Error</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.id}
              className="border-t border-forge-800"
              data-testid="sync-row"
              data-sync-id={r.id}
            >
              <td className="px-2 py-1.5 font-mono text-forge-100">
                {r.startedAt}
              </td>
              <td className="px-2 py-1.5">
                <span
                  className={cn(
                    'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    STATUS_TONE[r.status],
                  )}
                >
                  {r.status}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-forge-100">
                {r.recordsSynced}
              </td>
              <td className="px-2 py-1.5 text-forge-200">
                {TRIGGER_LABEL[r.triggeredBy]}
              </td>
              <td className="px-2 py-1.5 max-w-[200px] truncate text-forge-300">
                {r.errorMessage ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
