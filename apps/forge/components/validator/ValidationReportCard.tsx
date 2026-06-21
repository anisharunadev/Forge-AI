/**
 * ValidationReportCard — list-view summary for a single ValidationReport.
 *
 * Renders:
 *   - PASS/FAIL banner (also covers `running` and `error` states)
 *   - Severity summary chips (critical / high / medium / low counts)
 *   - Project id + report id + timestamps
 *   - "Open" link to the per-report detail page
 *
 * Designed to mirror `ConnectorCard` (FORA-578): same `card` shell,
 * same `data-testid` row attributes so the audit harness can assert
 * the contract end-to-end.
 */

import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

import type { ValidationReport } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface ValidationReportCardProps {
  readonly report: ValidationReport;
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  return iso;
}

function bannerForStatus(report: ValidationReport): {
  readonly label: string;
  readonly tone: 'pass' | 'fail' | 'running' | 'error';
  readonly className: string;
  readonly Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
} {
  switch (report.status) {
    case 'pass':
      return {
        label: 'PASS',
        tone: 'pass',
        Icon: CheckCircle2,
        className: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200',
      };
    case 'fail':
      return {
        label: 'FAIL',
        tone: 'fail',
        Icon: XCircle,
        className: 'border-rose-500/60 bg-rose-500/15 text-rose-200',
      };
    case 'running':
      return {
        label: 'RUNNING',
        tone: 'running',
        Icon: Loader2,
        className: 'border-brand-500/60 bg-brand-500/15 text-brand-200',
      };
    case 'error':
    default:
      return {
        label: 'ERROR',
        tone: 'error',
        Icon: AlertTriangle,
        className: 'border-amber-500/60 bg-amber-500/15 text-amber-200',
      };
  }
}

export function ValidationReportCard({ report }: ValidationReportCardProps) {
  const r = report;
  const banner = bannerForStatus(r);
  const { Icon } = banner;

  return (
    <li
      className="card space-y-3"
      data-testid="validation-report-card"
      data-report-id={r.reportId}
      data-report-status={r.status}
      data-project-id={r.projectId}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-forge-300">
            Project · <span className="font-mono">{r.projectId}</span>
          </p>
          <h3
            className="text-lg font-semibold"
            id={`report-${r.reportId}-h`}
          >
            <span className="font-mono">{r.reportId}</span>
          </h3>
        </div>
        <span
          data-testid="validation-report-banner"
          data-status={banner.tone}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 text-xs font-semibold uppercase tracking-wider',
            banner.className,
          )}
          aria-label={`Report status: ${banner.label}`}
        >
          <Icon
            className={cn(
              'h-3.5 w-3.5',
              banner.tone === 'running' && 'animate-spin',
            )}
            aria-hidden={true}
          />
          {banner.label}
        </span>
      </header>

      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        aria-label="Severity summary"
      >
        <dt className="text-forge-300">Critical</dt>
        <dd
          className="font-mono text-rose-300"
          data-testid="summary-critical"
        >
          {r.summary.critical}
        </dd>
        <dt className="text-forge-300">High</dt>
        <dd
          className="font-mono text-amber-200"
          data-testid="summary-high"
        >
          {r.summary.high}
        </dd>
        <dt className="text-forge-300">Medium</dt>
        <dd
          className="font-mono text-amber-100"
          data-testid="summary-medium"
        >
          {r.summary.medium}
        </dd>
        <dt className="text-forge-300">Low</dt>
        <dd
          className="font-mono text-sky-200"
          data-testid="summary-low"
        >
          {r.summary.low}
        </dd>
        <dt className="text-forge-300">Total findings</dt>
        <dd className="font-mono text-forge-100" data-testid="summary-total">
          {r.summary.total}
        </dd>
        <dt className="text-forge-300">Started</dt>
        <dd className="font-mono text-forge-100" data-testid="report-started">
          {fmtTime(r.startedAt)}
        </dd>
        <dt className="text-forge-300">Finished</dt>
        <dd className="font-mono text-forge-100" data-testid="report-finished">
          {fmtTime(r.finishedAt)}
        </dd>
      </dl>

      <footer className="flex items-center justify-between gap-3 border-t border-forge-800 pt-3 text-xs">
        <span className="text-forge-300" data-testid="report-tenant">
          tenant · <span className="font-mono">{r.tenantId}</span>
        </span>
        <Link
          href={`/validator/${r.reportId}`}
          className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50 hover:border-forge-500"
          data-testid="report-open"
          aria-label={`Open report ${r.reportId}`}
        >
          Open →
        </Link>
      </footer>
    </li>
  );
}