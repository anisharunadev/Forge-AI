'use client';

/**
 * Validator — live tail of running scans (FORA-620 §3.3).
 *
 * Uses `useLiveValidationScans` which polls every 3 s so the operator
 * can watch a scan start, accumulate findings, and resolve to pass /
 * fail without leaving the page. Only `running` reports are surfaced
 * in the main panel; finished reports appear in a separate "recently
 * completed" tray below.
 */

import * as React from 'react';
import { Radio, ShieldCheck } from 'lucide-react';

import { ValidationReportCard } from '@/components/validator/ValidationReportCard';
import { useLiveValidationScans } from '@/lib/hooks/useValidationReports';

const DEFAULT_PROJECT_ID = 'demo-project-001';

export default function ValidatorLivePage() {
  const [projectId, setProjectId] =
    React.useState<string>(DEFAULT_PROJECT_ID);

  const query = useLiveValidationScans(projectId);
  const reports = query.data ?? [];

  const running = reports.filter((r) => r.status === 'running');
  const finished = reports.filter((r) => r.status !== 'running').slice(0, 6);

  return (
    <div className="flex flex-col gap-6" data-testid="validator-live-page">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-forge-300">
          Center · Code Validator · Live
        </p>
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Radio className="h-5 w-5 animate-pulse text-brand-400" aria-hidden="true" />
            Live scan tail
          </h1>
          <div className="flex items-center gap-2">
            <label
              htmlFor="validator-live-project"
              className="text-xs uppercase tracking-wider text-forge-300"
            >
              Project
            </label>
            <input
              id="validator-live-project"
              data-testid="validator-live-project-input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-56 rounded-sm border border-forge-700 bg-forge-900 px-2 py-1 font-mono text-xs text-forge-50 focus:border-brand-500 focus:outline-none"
              placeholder="project-id"
            />
          </div>
        </div>
        <p className="text-sm text-forge-200">
          Polling every 3 s. New scans surface here as the orchestrator
          starts them and disappear once they resolve to PASS or FAIL.
        </p>
      </header>

      <nav aria-label="Validator sections" className="flex items-center gap-3 text-xs">
        <a
          href="/validator"
          className="rounded-sm border border-forge-700 bg-forge-900 px-3 py-1 text-forge-200 hover:border-forge-500"
          data-testid="validator-tab-list"
        >
          Reports
        </a>
        <a
          href="/validator/live"
          className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50"
          data-testid="validator-tab-live"
          aria-current="page"
        >
          Live tail
        </a>
      </nav>

      <section
        aria-label="Running scans"
        className="space-y-3"
        data-testid="live-running-section"
      >
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-forge-200">
            <ShieldCheck className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Running
          </h2>
          <span
            className="font-mono text-xs text-forge-300"
            data-testid="live-running-count"
          >
            {running.length}
          </span>
        </header>
        {query.isLoading ? (
          <div className="card text-sm text-forge-300" data-testid="live-loading">
            Connecting…
          </div>
        ) : null}
        {query.isError && !query.isLoading ? (
          <div
            className="card border-rose-500/40 bg-rose-500/5 text-sm text-rose-100"
            data-testid="live-error"
            role="alert"
          >
            Could not load live scans:{' '}
            {query.error?.message ?? 'unknown error'}
          </div>
        ) : null}
        {!query.isLoading && !query.isError && running.length === 0 ? (
          <div className="card text-sm text-forge-300" data-testid="live-running-empty">
            No scans are running right now for{' '}
            <span className="font-mono">{projectId}</span>.
          </div>
        ) : null}
        {running.length > 0 ? (
          <ul
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            data-testid="live-running-grid"
          >
            {running.map((r) => (
              <ValidationReportCard key={r.reportId} report={r} />
            ))}
          </ul>
        ) : null}
      </section>

      <section
        aria-label="Recently completed"
        className="space-y-3"
        data-testid="live-finished-section"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-forge-200">
            Recently completed
          </h2>
          <span
            className="font-mono text-xs text-forge-300"
            data-testid="live-finished-count"
          >
            {finished.length}
          </span>
        </header>
        {finished.length === 0 ? (
          <div
            className="card text-sm text-forge-300"
            data-testid="live-finished-empty"
          >
            Nothing completed in this poll window yet.
          </div>
        ) : (
          <ul
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            data-testid="live-finished-grid"
          >
            {finished.map((r) => (
              <ValidationReportCard key={r.reportId} report={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}