'use client';

/**
 * DriftTable — display LiteLLM drift report.
 *
 * F-829 Phase D. Renders one row per divergence surfaced by the
 * nightly reconcile job (or the manual ReconcileButton). Shape:
 *
 *     { tenant_id, field, expected, actual, detected_at }
 *
 * The table is intentionally minimal — host pages can compose it
 * inside a card or a section header. Matches the existing
 * `components/data/DataTable.tsx` styling (Tailwind 3.4.x).
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { settingsQueryKeys } from '@/lib/hooks/useSettings';

export interface DriftRow {
  readonly tenant_id: string;
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  readonly detected_at: string;
}

export interface DriftTableProps {
  readonly tenantId: string;
  /** Optional className for the wrapper `<table>`. */
  readonly className?: string;
}

async function fetchDrift(tenantId: string): Promise<ReadonlyArray<DriftRow>> {
  return api.get<ReadonlyArray<DriftRow>>(`/api/v1/admin/llm-gateway/drift?tenant_id=${encodeURIComponent(tenantId)}`, { });
}

export function DriftTable(props: DriftTableProps): React.ReactElement {
  const { tenantId, className } = props;

  const query: UseQueryResult<ReadonlyArray<DriftRow>, Error> = useQuery<
    ReadonlyArray<DriftRow>,
    Error
  >({
    queryKey: settingsQueryKeys.drift(tenantId),
    queryFn: () => fetchDrift(tenantId),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Loading drift report…
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
      >
        Failed to load drift report: {query.error.message}
      </div>
    );
  }

  const rows = query.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
        No drift detected for tenant {tenantId}.
      </div>
    );
  }

  return (
    <div className={className ?? 'overflow-x-auto rounded-md border border-slate-200'}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th
              scope="col"
              className="px-3 py-2 text-left font-semibold text-slate-700"
            >
              Tenant
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left font-semibold text-slate-700"
            >
              Field
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left font-semibold text-slate-700"
            >
              Expected
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left font-semibold text-slate-700"
            >
              Actual
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left font-semibold text-slate-700"
            >
              Detected
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, idx) => (
            <tr key={`${row.tenant_id}-${row.field}-${idx}`}>
              <td className="px-3 py-2 font-mono text-xs text-slate-700">
                {row.tenant_id}
              </td>
              <td className="px-3 py-2 text-slate-700">{row.field}</td>
              <td className="px-3 py-2 text-slate-700">
                {row.expected}
              </td>
              <td className="px-3 py-2 text-amber-700">{row.actual}</td>
              <td className="px-3 py-2 text-xs text-slate-500">
                {row.detected_at}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DriftTable;