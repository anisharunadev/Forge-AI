'use client';

/**
 * Validator — per-report detail page (FORA-620 §3.2).
 *
 * Server-rendered impossible because the orchestrator URL uses a
 * tenant-scoped path; the client owns the URL routing via the
 * `useParams` hook. Renders:
 *   - Breadcrumb back to /validator
 *   - Summary card (status banner + severity counts)
 *   - FindingsTable (severity-sorted, file-path-grouped)
 *   - RemediationPanel (suggested fixes per finding)
 *
 * Loading / error states render typed messages — never the
 * misleading "No findings" string when the real problem is a 5xx.
 */

import * as React from 'react';
import { ShieldCheck, ArrowLeft } from 'lucide-react';

import { FindingsTable } from '@/components/validator/FindingsTable';
import { RemediationPanel } from '@/components/validator/RemediationPanel';
import { SeverityBadge } from '@/components/validator/SeverityBadge';
import { useValidationReport } from '@/lib/hooks/useValidationReports';

export default function ValidatorDetailPage({
  params,
}: {
  readonly params: Promise<{ report_id: string }>;
}) {
  const [resolved, setResolved] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    params.then((p) => {
      if (!cancelled) setResolved(p.report_id);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const reportId = resolved ?? '';
  const query = useValidationReport(reportId);
  const report = query.data;

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="validator-detail-page"
      data-report-id={reportId}
    >
      <nav aria-label="Breadcrumb" className="text-xs text-forge-300">
        <a
          href="/validator"
          className="inline-flex items-center gap-1 hover:text-forge-100"
          data-testid="validator-breadcrumb"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Code Validator
        </a>
      </nav>

      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-forge-300">
          Center · Code Validator
        </p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          <span className="font-mono" data-testid="detail-report-id">
            {report?.reportId ?? reportId}
          </span>
        </h1>
      </header>

      {query.isLoading ? (
        <div
          className="card text-sm text-forge-300"
          data-testid="detail-loading"
        >
          Loading report…
        </div>
      ) : null}

      {query.isError && !query.isLoading ? (
        <div
          className="card border-rose-500/40 bg-rose-500/5 text-sm text-rose-100"
          data-testid="detail-error"
          role="alert"
        >
          Could not load report: {query.error?.message ?? 'unknown error'}
        </div>
      ) : null}

      {report ? (
        <>
          <section
            aria-label="Report summary"
            className="card grid gap-3 md:grid-cols-4"
            data-testid="detail-summary"
            data-status={report.status}
          >
            <div className="md:col-span-2">
              <p className="text-xs uppercase tracking-wider text-forge-300">
                Status
              </p>
              <p
                className="text-xl font-semibold uppercase tracking-wider"
                data-testid="detail-status"
              >
                {report.status}
              </p>
              <p className="mt-1 font-mono text-xs text-forge-300">
                Project · {report.projectId}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-forge-300">
                Findings
              </p>
              <p
                className="text-xl font-semibold"
                data-testid="detail-total"
              >
                {report.summary.total}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-forge-300">
                Started
              </p>
              <p
                className="font-mono text-xs text-forge-100"
                data-testid="detail-started"
              >
                {report.startedAt}
              </p>
              <p className="mt-1 text-xs text-forge-300">
                Finished:{' '}
                <span
                  className="font-mono"
                  data-testid="detail-finished"
                >
                  {report.finishedAt ?? '—'}
                </span>
              </p>
            </div>

            <div
              className="md:col-span-4 flex flex-wrap items-center gap-2"
              aria-label="Severity breakdown"
            >
              <SeverityBadge severity="critical" />
              <span
                className="font-mono text-sm text-forge-100"
                data-testid="detail-critical"
              >
                {report.summary.critical}
              </span>
              <SeverityBadge severity="high" />
              <span
                className="font-mono text-sm text-forge-100"
                data-testid="detail-high"
              >
                {report.summary.high}
              </span>
              <SeverityBadge severity="medium" />
              <span
                className="font-mono text-sm text-forge-100"
                data-testid="detail-medium"
              >
                {report.summary.medium}
              </span>
              <SeverityBadge severity="low" />
              <span
                className="font-mono text-sm text-forge-100"
                data-testid="detail-low"
              >
                {report.summary.low}
              </span>
            </div>
          </section>

          <FindingsTable findings={report.findings} />
          <RemediationPanel findings={report.findings} />
        </>
      ) : null}
    </div>
  );
}