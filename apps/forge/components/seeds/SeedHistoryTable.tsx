'use client';

/**
 * SeedHistoryTable — recent apply / reset / rollback runs for a seed
 * (Plan H commit 1).
 *
 * Read-only surface backed by `useSeedRuns`. Shows started timestamp,
 * operation, status, env, total row count, and duration. The status
 * pill uses `default` for completed and `destructive` for failures;
 * `running` rows fall through to `secondary` so they read as in-flight.
 *
 * Empty state is rendered inline (no global EmptyState import) because
 * this component is embedded inside a section heading on `/admin/seeds`.
 */

import { useSeedRuns } from '@/lib/hooks/useSeeds';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { SeedRunStatus } from '@/lib/seeds/types';

export interface SeedHistoryTableProps {
  seedName: string;
}

function statusVariant(
  status: SeedRunStatus,
): 'default' | 'destructive' | 'secondary' {
  if (status === 'completed') return 'default';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

export function SeedHistoryTable({ seedName }: SeedHistoryTableProps) {
  const { data: runs, isLoading, error } = useSeedRuns(seedName);

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="seed-history-loading">
        Loading runs…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive" data-testid="seed-history-error">
        Error loading run history: {String(error)}
      </div>
    );
  }

  if (!runs?.length) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="seed-history-empty">
        No runs yet. Apply the seed to record your first run.
      </div>
    );
  }

  return (
    <Table data-testid="seed-history-table">
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Operation</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Env</TableHead>
          <TableHead>Rows</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const totalRows = Object.values(run.row_counts).reduce(
            (sum, n) => sum + n,
            0,
          );
          return (
            <TableRow key={run.id} data-testid={`seed-history-row-${run.id}`}>
              <TableCell>
                {new Date(run.started_at).toLocaleString()}
              </TableCell>
              <TableCell className="font-mono">{run.operation}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
              </TableCell>
              <TableCell className="font-mono">{run.env}</TableCell>
              <TableCell className="font-mono">{totalRows.toLocaleString()}</TableCell>
              <TableCell>
                {run.duration_ms ? `${run.duration_ms}ms` : '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}