/**
 * F-829 Phase C — Top spenders table.
 *
 * Lists the top 10 users (actors) by cost, sourced from
 * `GET /api/v1/analytics/usage` `by_user` array. Read-only — the
 * per-actor budget editor ships in Phase D.
 */
'use client';

import * as React from 'react';

export interface UserUsageRow {
  actor_id: string;
  cost_usd: number;
  calls: number;
}

export interface UserUsageTableProps {
  rows: ReadonlyArray<UserUsageRow>;
}

export function UserUsageTable({ rows }: UserUsageTableProps) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="user-usage-empty"
        className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground"
      >
        No user spend recorded in window.
      </div>
    );
  }

  return (
    <div
      data-testid="user-usage-table"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-background/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2 text-right">Calls</th>
            <th className="px-3 py-2 text-right">Cost (USD)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.actor_id}
              data-actor-id={r.actor_id}
              className="border-b border-border/50 last:border-0"
            >
              <td className="px-3 py-2 font-mono text-xs text-foreground">
                {r.actor_id}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                {r.calls}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                ${r.cost_usd.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default UserUsageTable;
