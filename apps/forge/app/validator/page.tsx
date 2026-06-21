'use client';

/**
 * Validator — list view of recent ValidationReports per project
 * (FORA-620 §3.1).
 *
 * Layout mirrors `app/connector-center/page.tsx` (FORA-578): a header
 * with the Center eyebrow + title, a project selector (single source
 * of truth for the tenant), and a stacked grid of
 * `ValidationReportCard`s. Loading + empty + error states all render
 * typed messages — no `console.error` swallowed into a misleading
 * "No reports yet" copy.
 */

import * as React from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';

import { ValidationReportCard } from '@/components/validator/ValidationReportCard';
import { Button } from '@/components/ui/button';
import { useValidationReports } from '@/lib/hooks/useValidationReports';

const DEFAULT_PROJECT_ID = 'demo-project-001';

export default function ValidatorListPage() {
  const [projectId, setProjectId] =
    React.useState<string>(DEFAULT_PROJECT_ID);

  const query = useValidationReports(projectId);
  const reports = query.data ?? [];

  return (
    <div className="flex flex-col gap-6" data-testid="validator-list-page">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-forge-300">
          Center
        </p>
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            Code Validator
          </h1>
          <div className="flex items-center gap-2">
            <label
              htmlFor="validator-project"
              className="text-xs uppercase tracking-wider text-forge-300"
            >
              Project
            </label>
            <input
              id="validator-project"
              data-testid="validator-project-input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-56 rounded-sm border border-forge-700 bg-forge-900 px-2 py-1 font-mono text-xs text-forge-50 focus:border-brand-500 focus:outline-none"
              placeholder="project-id"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              data-testid="validator-refresh"
              disabled={query.isFetching}
            >
              <RefreshCw
                className={
                  query.isFetching
                    ? 'mr-1.5 h-3.5 w-3.5 animate-spin'
                    : 'mr-1.5 h-3.5 w-3.5'
                }
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>
        <p className="text-sm text-forge-200">
          Recent validation reports for the selected project. Each card
          summarizes a single scan — open it for the full findings table
          and remediation guidance.
        </p>
      </header>

      <nav aria-label="Validator sections" className="flex items-center gap-3 text-xs">
        <a
          href="/validator"
          className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50"
          data-testid="validator-tab-list"
          aria-current="page"
        >
          Reports
        </a>
        <a
          href="/validator/live"
          className="rounded-sm border border-forge-700 bg-forge-900 px-3 py-1 text-forge-200 hover:border-forge-500"
          data-testid="validator-tab-live"
        >
          Live tail
        </a>
      </nav>

      {query.isLoading ? (
        <div
          className="card text-sm text-forge-300"
          data-testid="validator-loading"
        >
          Loading reports…
        </div>
      ) : null}

      {query.isError && !query.isLoading ? (
        <div
          className="card border-rose-500/40 bg-rose-500/5 text-sm text-rose-100"
          data-testid="validator-error"
          role="alert"
        >
          Could not load reports: {query.error?.message ?? 'unknown error'}
        </div>
      ) : null}

      {!query.isLoading && !query.isError && reports.length === 0 ? (
        <div
          className="card text-sm text-forge-300"
          data-testid="validator-empty"
        >
          No reports yet for project <span className="font-mono">{projectId}</span>.
        </div>
      ) : null}

      {reports.length > 0 ? (
        <ul
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          data-testid="validator-grid"
          aria-label={`${reports.length} validation reports`}
        >
          {reports.map((r) => (
            <ValidationReportCard key={r.reportId} report={r} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}