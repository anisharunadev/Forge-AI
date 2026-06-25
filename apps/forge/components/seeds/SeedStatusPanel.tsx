'use client';

/**
 * SeedStatusPanel — top-of-page status overview for `/admin/seeds`
 * (Plan H commit 1).
 *
 * Renders a single Card summarising a seed's current applied-state:
 *   - applied badge (green / grey)
 *   - applied version
 *   - total row count (sum of `row_counts` map)
 *   - last run timestamp
 *   - checksum match (or drift warning)
 *
 * Wired to `useSeedStatus` from the Plan F hook suite. Read-only —
 * mutation controls live in the page header (Apply / Reset / Rollback).
 *
 * Skeleton pattern follows the rest of the admin tabs: outer Card,
 * `CardHeader` with title + status pill, `CardContent` with a `dl`
 * for the four key facts.
 */

import { useSeedStatus } from '@/lib/hooks/useSeeds';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface SeedStatusPanelProps {
  seedName: string;
}

export function SeedStatusPanel({ seedName }: SeedStatusPanelProps) {
  const { data, isLoading, error } = useSeedStatus(seedName);

  if (isLoading) {
    return (
      <Card data-testid="seed-status-panel-loading">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Loading seed status…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="seed-status-panel-error">
        <CardContent className="py-6 text-sm text-destructive">
          Error loading seed status: {String(error)}
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const totalRows = Object.values(data.row_counts).reduce(
    (sum, n) => sum + n,
    0,
  );

  return (
    <Card data-testid="seed-status-panel">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="font-mono">{data.seed_name}</CardTitle>
            <CardDescription>
              Demo seed for Acme Corp — idempotent re-apply supported.
            </CardDescription>
          </div>
          <Badge variant={data.applied ? 'default' : 'secondary'}>
            {data.applied ? 'applied' : 'not applied'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono">{data.applied_version ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Total rows</dt>
            <dd className="font-mono" data-testid="seed-status-total-rows">
              {totalRows.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last run</dt>
            <dd>
              {data.last_run_at
                ? new Date(data.last_run_at).toLocaleString()
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Checksum</dt>
            <dd>
              {data.checksum_match ? (
                <span className="text-green-600">match</span>
              ) : (
                <span className="text-destructive">drift</span>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}