'use client';

/**
 * SeedDiffView — render the live-vs-manifest delta for a seed
 * (Plan H commit 4).
 *
 * Pulls `GET /seeds/{name}/diff` via `useSeedDiff` and surfaces three
 * pieces of information in order of severity:
 *   1. The drift badge in the header (green "No drift" or destructive
 *      "Drift detected").
 *   2. The backend summary string — usually a one-line explanation
 *      like "1247 rows match manifest; checksum stable".
 *   3. A row-count-changes table per table (table name, before,
 *      after, signed delta coloured green/red).
 *   4. A missing-files list, if any data files referenced by the
 *      manifest have disappeared from the live database.
 *
 * The component does NOT render `extra_rows` — Plan C's diff DTO
 * includes that field but the current runner never populates it
 * (idempotent upserts cannot produce extras), so we silently ignore
 * it to keep the view focused on operator-actionable drift.
 */

import { useSeedDiff } from '@/lib/hooks/useSeeds';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export interface SeedDiffViewProps {
  seedName: string;
}

export function SeedDiffView({ seedName }: SeedDiffViewProps) {
  const { data: diff, isLoading, error } = useSeedDiff(seedName);

  if (isLoading) {
    return (
      <Card data-testid="seed-diff-loading">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Computing diff…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="seed-diff-error">
        <CardContent className="py-6 text-sm text-destructive">
          Error computing diff:{' '}
          {error instanceof Error ? error.message : String(error)}
        </CardContent>
      </Card>
    );
  }

  if (!diff) {
    return null;
  }

  const hasRowChanges = Object.keys(diff.row_count_changes).length > 0;
  const hasMissing = diff.missing_files.length > 0;

  return (
    <Card data-testid="seed-diff-view">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Diff: {diff.seed_name}</CardTitle>
          <Badge variant={diff.checksum_match ? 'default' : 'destructive'}>
            {diff.checksum_match ? 'No drift' : 'Drift detected'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{diff.summary}</p>

        {hasRowChanges && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Row count changes</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead>After</TableHead>
                  <TableHead>Δ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(diff.row_count_changes).map(
                  ([table, [before, after]]) => {
                    const delta = after - before;
                    const deltaClass =
                      delta > 0
                        ? 'text-green-600'
                        : delta < 0
                          ? 'text-red-600'
                          : 'text-muted-foreground';
                    return (
                      <TableRow key={table}>
                        <TableCell className="font-mono">{table}</TableCell>
                        <TableCell className="font-mono">{before}</TableCell>
                        <TableCell className="font-mono">{after}</TableCell>
                        <TableCell className={`font-mono ${deltaClass}`}>
                          {delta > 0 ? `+${delta}` : delta}
                        </TableCell>
                      </TableRow>
                    );
                  },
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {hasMissing && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Missing files</h4>
            <ul className="list-inside list-disc text-sm">
              {diff.missing_files.map((file) => (
                <li key={file} className="font-mono">
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasRowChanges && !hasMissing && diff.checksum_match && (
          <p className="text-sm text-muted-foreground">
            Manifest matches live database. No re-apply needed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}