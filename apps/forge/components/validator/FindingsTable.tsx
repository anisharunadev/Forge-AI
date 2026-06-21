/**
 * FindingsTable — severity-sorted, file-path-grouped table of findings.
 *
 * Sorting (FORA-620 §3.2):
 *   1. Sort by `severity` using the rank from `lib/api.ts`
 *      (`critical` < `high` < `medium` < `low`).
 *   2. Within a severity bucket, group by `location.filePath` and
 *      keep the file order stable by sorting by filePath asc.
 *
 * The component is fully controlled by `findings`. It does not fetch.
 * Sort state lives in the URL hash via the parent page (the smoke
 * probe clicks `[data-testid="findings-sort-toggle"]` to flip the
 * sort order, then asserts the order via `data-severity-order` on the
 * `<tbody>`).
 */

import * as React from 'react';
import { ArrowDownAZ, ArrowUpAZ } from 'lucide-react';

import {
  VALIDATION_SEVERITY_RANK,
  type ValidationFinding,
  type ValidationSeverity,
} from '@/lib/api';
import { SeverityBadge } from './SeverityBadge';
import { cn } from '@/lib/utils';

export interface FindingsTableProps {
  readonly findings: ReadonlyArray<ValidationFinding>;
  readonly defaultSeverityFirst?: boolean;
}

const SEVERITY_ORDER: ReadonlyArray<ValidationSeverity> = [
  'critical',
  'high',
  'medium',
  'low',
];

function sortFindings(
  rows: ReadonlyArray<ValidationFinding>,
  severityFirst: boolean,
): ReadonlyArray<ValidationFinding> {
  const copy = rows.slice();
  copy.sort((a, b) => {
    const ra = VALIDATION_SEVERITY_RANK[a.severity];
    const rb = VALIDATION_SEVERITY_RANK[b.severity];
    if (ra !== rb) {
      // severityFirst === true → critical at the top
      // severityFirst === false → critical at the bottom
      return severityFirst ? ra - rb : rb - ra;
    }
    // Tie-break by filePath asc, then line asc.
    if (a.location.filePath !== b.location.filePath) {
      return a.location.filePath.localeCompare(b.location.filePath);
    }
    return (a.location.line ?? 0) - (b.location.line ?? 0);
  });
  return copy;
}

export function FindingsTable({
  findings,
  defaultSeverityFirst = true,
}: FindingsTableProps) {
  const [severityFirst, setSeverityFirst] = React.useState<boolean>(
    defaultSeverityFirst,
  );
  const sorted = React.useMemo(
    () => sortFindings(findings, severityFirst),
    [findings, severityFirst],
  );

  const severityOrderAttr = severityFirst
    ? SEVERITY_ORDER.join(',')
    : SEVERITY_ORDER.slice().reverse().join(',');

  return (
    <section
      aria-label="Findings"
      className="card overflow-hidden p-0"
      data-testid="findings-table"
    >
      <header className="flex items-center justify-between gap-3 border-b border-forge-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-forge-200">
            Findings
          </h2>
          <p className="text-xs text-forge-300">
            {findings.length} {findings.length === 1 ? 'finding' : 'findings'} ·
            grouped by file path · sorted by severity
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSeverityFirst((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-forge-700 bg-forge-800 px-2.5 py-1 text-xs font-medium text-forge-50 hover:border-forge-500"
          data-testid="findings-sort-toggle"
          data-sort={severityFirst ? 'severity-asc' : 'severity-desc'}
          aria-label="Toggle severity sort order"
        >
          {severityFirst ? (
            <ArrowDownAZ className="h-3.5 w-3.5" aria-hidden={true} />
          ) : (
            <ArrowUpAZ className="h-3.5 w-3.5" aria-hidden={true} />
          )}
          {severityFirst ? 'Critical first' : 'Low first'}
        </button>
      </header>

      {findings.length === 0 ? (
        <div
          className="px-4 py-8 text-center text-sm text-emerald-200"
          data-testid="findings-empty"
        >
          No findings — scan passed.
        </div>
      ) : (
        <table
          className="w-full table-fixed text-left text-sm"
          data-testid="findings-table-grid"
        >
          <thead className="bg-forge-900/60 text-[11px] uppercase tracking-wider text-forge-400">
            <tr>
              <th scope="col" className="w-28 px-4 py-2">
                Severity
              </th>
              <th scope="col" className="w-72 px-4 py-2">
                Location
              </th>
              <th scope="col" className="px-4 py-2">
                Finding
              </th>
              <th scope="col" className="w-40 px-4 py-2">
                Rule
              </th>
            </tr>
          </thead>
          <tbody data-testid="findings-tbody" data-severity-order={severityOrderAttr}>
            {sorted.map((f) => (
              <tr
                key={f.id}
                className="border-t border-forge-800 align-top"
                data-testid="findings-row"
                data-severity={f.severity}
                data-file={f.location.filePath}
              >
                <td className="px-4 py-3">
                  <SeverityBadge severity={f.severity} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-forge-200">
                  <span
                    className="block truncate"
                    title={f.location.filePath}
                    data-testid="finding-file"
                  >
                    {f.location.filePath}
                  </span>
                  <span
                    className="mt-1 block text-forge-400"
                    data-testid="finding-line"
                  >
                    {f.location.line !== undefined
                      ? `line ${f.location.line}${
                          f.location.column !== undefined
                            ? `:${f.location.column}`
                            : ''
                        }`
                      : 'line —'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p
                    className={cn('font-medium text-forge-50')}
                    data-testid="finding-title"
                  >
                    {f.title}
                  </p>
                  <p
                    className="mt-1 text-xs text-forge-300"
                    data-testid="finding-message"
                  >
                    {f.message}
                  </p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-forge-300">
                  {f.ruleId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}