'use client';

/**
 * RunIndexTable — dense list view for the Runs Center.
 *
 * Renders one row per `RunRecord` with: status pill, goal/ID
 * (with seed alias when present), current stage, cost
 * (spent/ceiling), triggered-by, started timestamp, and a
 * "View" link to the detail page.
 *
 * Mirrors the persona-dashboard table density of
 * `apps/forge/components/intelligence/EpicCard.tsx` but uses
 * the shell-primitive table classes so the chrome stays
 * consistent with the other centers.
 */

import Link from 'next/link';
import { Activity } from 'lucide-react';

import { RunStatusBadge } from '@/components/RunStatusBadge';
import { RunBudgetBadge } from '@/components/runs/RunBudgetBadge';
import { seedAliasFor } from '@/lib/api';
import { EmptyState } from '@/src/components/empty-state';
import type { RunRecord } from '@/lib/types';

export interface RunIndexTableProps {
  runs: ReadonlyArray<RunRecord>;
  onClearFilters?: () => void;
}

function formatStarted(iso: string | null): string {
  if (!iso) return '—';
  // Strip the iso to a short relative-or-absolute label.
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function RunIndexTable({ runs, onClearFilters }: RunIndexTableProps) {
  if (runs.length === 0) {
    return (
      <div data-testid="runs-empty-row" className="rounded-md border border-dashed border-border bg-card/40">
        <EmptyState
          compact
          illustration={<Activity size={28} strokeWidth={1.5} />}
          title="No runs match the current filter"
          description="Clear your filters to see every run, or dispatch a new one to populate the timeline."
          primaryAction={
            onClearFilters
              ? { label: 'Clear filters', onClick: onClearFilters }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card" data-testid="runs-table">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Goal / ID</th>
            <th className="px-3 py-2 text-left font-medium">Stage</th>
            <th className="px-3 py-2 text-left font-medium">Cost</th>
            <th className="px-3 py-2 text-left font-medium">Triggered by</th>
            <th className="px-3 py-2 text-left font-medium">Started</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map((r) => {
            const alias = seedAliasFor(r.id);
            return (
              <tr
                key={r.id}
                className="hover:bg-muted/30"
                data-testid="runs-row"
                data-run-id={r.id}
              >
                <td className="px-3 py-2">
                  <RunStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    <code className="font-mono text-xs text-foreground">{r.goal_id}</code>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.id}
                      {alias ? <span className="ml-1" data-testid="seed-alias">({alias})</span> : null}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="rounded bg-muted px-2 py-0.5 font-mono text-foreground">
                    {r.current_stage}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-foreground">
                  {/* M6-G2 — wire the per-RUN RunBudgetBadge into the index row.
                      Replaces the previous plain-text "${spent} / ${ceiling}"
                      with the badge so the 0.80 warn threshold flips at $40
                      of a $50 ceiling. Live feed (per-RUN polling) lives in
                      the drawer via useRunBudget (T-B1); the index table
                      uses the row's last-known figures so 200 rows don't
                      hammer the budget endpoint. */}
                  <RunBudgetBadge
                    ceilingUsd={Number(r.cost_ceiling_usd)}
                    spentUsd={Number(r.cost_spent_usd)}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-mono">
                    {r.triggered_by.type}/{r.triggered_by.actor}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatStarted(r.started_at)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/runs/${r.id}`}
                    className="text-xs text-foreground underline-offset-2 hover:underline"
                    data-testid="runs-view-link"
                  >
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
