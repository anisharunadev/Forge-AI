'use client';

/**
 * DemoStateCard — per-Center demo state summary (Plan G commit 4).
 *
 * Embeds into a Center page (dashboard / architecture / etc.) and
 * shows a compact status of the active demo seed:
 *   - seed name + applied version
 *   - last run timestamp + status
 *   - total row count
 *   - checksum drift indicator
 *
 * Renders nothing when:
 *   - the hook is still loading (skeleton handled by the host Card),
 *   - the hook errors out (we don't break the surrounding Center),
 *   - or the seed has not been applied (this is not a demo tenant).
 *
 * The card lives in `components/seeds/` alongside the banner so any
 * Center page can drop it in with a single import.
 */

import * as React from 'react';

import { useSeedStatus } from '@/lib/hooks/useSeeds';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';

export interface DemoStateCardProps {
  seedName: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function DemoStateCard({ seedName }: DemoStateCardProps) {
  const { data, isLoading, error } = useSeedStatus(seedName);

  if (isLoading) {
    return (
      <Card data-testid="demo-state-card-loading">
        <CardContent className="py-4 text-sm text-muted-foreground">
          Loading seed status…
        </CardContent>
      </Card>
    );
  }

  if (error || !data) return null;
  if (!data.applied) return null;

  const totalRows = Object.values(data.row_counts).reduce(
    (sum, n) => sum + (typeof n === 'number' ? n : 0),
    0,
  );

  return (
    <Card data-testid="demo-state-card">
      <CardHeader>
        <CardTitle>Demo Seed Status</CardTitle>
        <CardDescription>
          Live state of the <span className="font-mono">{data.seed_name}</span> demo
          seed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
          <dt className="text-muted-foreground">Seed</dt>
          <dd className="col-span-1 font-mono md:col-span-2">{data.seed_name}</dd>

          <dt className="text-muted-foreground">Version</dt>
          <dd className="col-span-1 font-mono md:col-span-2">
            {data.applied_version ?? '—'}
          </dd>

          <dt className="text-muted-foreground">Last run</dt>
          <dd className="col-span-1 md:col-span-2">{formatDate(data.last_run_at)}</dd>

          <dt className="text-muted-foreground">Status</dt>
          <dd className="col-span-1 md:col-span-2">{data.last_run_status ?? '—'}</dd>

          <dt className="text-muted-foreground">Rows</dt>
          <dd
            className="col-span-1 font-mono md:col-span-2"
            data-testid="demo-state-card-rows"
          >
            {totalRows.toLocaleString()}
          </dd>

          <dt className="text-muted-foreground">Drift</dt>
          <dd className="col-span-1 md:col-span-2">
            {data.checksum_match ? (
              <span className="text-green-600 dark:text-green-400">none</span>
            ) : (
              <span className="text-destructive">drift detected</span>
            )}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}