'use client';

/**
 * SecurityReportPanel — master-detail view for the 10th tab (M5-G4).
 *
 * Four inner tabs:
 *   - Overview      — KPI strip + a glance at the top 5 affected services.
 *   - Open Findings — virtualized list (delegated to SecurityFindingList).
 *   - By Category   — stacked bar of finding counts per category.
 *   - Posture Trend — sparkline of the score over the last N scans.
 *
 * Master-detail: clicking a row in Open Findings opens a side drawer
 * with the full record (description + recommendation + status
 * workflow). The drawer is owned here so the rest of the page stays
 * agnostic.
 *
 * Design system compliance:
 *   - No `bg-black` solids; uses `var(--bg-surface|elevated|inset)`.
 *   - Indigo accent + rose tones for severity.
 *   - All transitions honor `prefers-reduced-motion` (CSS-only).
 *   - Empty states per Rule 15: explain, never bare.
 */

import * as React from 'react';
import { X, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/src/components/empty-state';

import { SecurityPostureCard } from './SecurityPostureCard';
import { SecurityFindingList } from './SecurityFindingList';

import type {
  SecurityCategory,
  SecurityPosture,
  SecurityReport,
  SecuritySeverity,
} from '@/lib/architecture/types';

const CATEGORIES: ReadonlyArray<{ id: SecurityCategory; label: string }> = [
  { id: 'auth', label: 'Auth' },
  { id: 'data', label: 'Data' },
  { id: 'network', label: 'Network' },
  { id: 'dependency', label: 'Dependency' },
  { id: 'configuration', label: 'Config' },
  { id: 'cryptography', label: 'Crypto' },
  { id: 'logging', label: 'Logging' },
];

const CATEGORY_TONE: Record<SecurityCategory, string> = {
  auth: 'fill-indigo-400',
  data: 'fill-violet-400',
  network: 'fill-cyan-400',
  dependency: 'fill-amber-400',
  configuration: 'fill-orange-400',
  cryptography: 'fill-rose-400',
  logging: 'fill-emerald-400',
};

const STATUS_TONE: Record<SecurityReport['status'], string> = {
  open: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  mitigating: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  accepted: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  closed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
};

export interface SecurityReportPanelProps {
  posture: SecurityPosture | null;
  postureLoading?: boolean;
  reports: ReadonlyArray<SecurityReport>;
  reportsLoading?: boolean;
  onRefresh?: () => void;
}

export function SecurityReportPanel({
  posture,
  postureLoading = false,
  reports,
  reportsLoading = false,
  onRefresh,
}: SecurityReportPanelProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selectedReport = React.useMemo<SecurityReport | null>(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="security-report-panel">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList
          className="bg-[var(--bg-inset)]"
          aria-label="Security Report views"
          data-testid="security-report-tabs"
        >
          <TabsTrigger value="overview" data-testid="security-tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="findings" data-testid="security-tab-findings">
            Open Findings
          </TabsTrigger>
          <TabsTrigger value="category" data-testid="security-tab-category">
            By Category
          </TabsTrigger>
          <TabsTrigger value="trend" data-testid="security-tab-trend">
            Posture Trend
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 flex flex-col gap-4">
          <SecurityPostureCard posture={posture} loading={postureLoading} />

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <TopAffectedServices posture={posture} />
            <RecentFindings reports={reports} onSelect={setSelectedId} />
          </div>
        </TabsContent>

        {/* ── Open Findings ─────────────────────────────────────── */}
        <TabsContent value="findings" className="mt-4">
          <SecurityFindingList
            reports={reports}
            loading={reportsLoading}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId(r.id)}
          />
        </TabsContent>

        {/* ── By Category ───────────────────────────────────────── */}
        <TabsContent value="category" className="mt-4">
          <CategoryBreakdown posture={posture} reports={reports} />
        </TabsContent>

        {/* ── Posture Trend ─────────────────────────────────────── */}
        <TabsContent value="trend" className="mt-4">
          <PostureTrend posture={posture} />
        </TabsContent>
      </Tabs>

      {onRefresh ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            onClick={onRefresh}
            data-testid="security-refresh"
          >
            Refresh posture & findings
          </Button>
        </div>
      ) : null}

      <FindingDetailDrawer
        report={selectedReport}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — scoped to this file so the parent page stays compact.
// ---------------------------------------------------------------------------

function TopAffectedServices({ posture }: { posture: SecurityPosture | null }) {
  const services = posture?.top_affected_services ?? [];
  const maxCount = Math.max(1, ...services.map((s) => s.count));

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="security-top-services"
      aria-label="Top affected services"
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          Top affected services
        </h3>
        <p className="text-[10px] text-[var(--fg-tertiary)]">
          Service-level concentration of open findings
        </p>
      </header>
      {services.length === 0 ? (
        <EmptyState
          compact
          illustration={<Sparkles size={28} strokeWidth={1.5} />}
          title="No affected services reported"
          description="Concentration will populate once findings roll in."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li
              key={s.service}
              className="flex items-center gap-2 text-xs"
              data-testid={`security-service-row-${s.service}`}
            >
              <span className="w-40 truncate font-mono text-[var(--fg-secondary)]">
                {s.service}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-inset)]">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-cyan-400"
                  style={{ width: `${(s.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[10px] text-[var(--fg-tertiary)]">
                {s.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentFindings({
  reports,
  onSelect,
}: {
  reports: ReadonlyArray<SecurityReport>;
  onSelect: (id: string) => void;
}) {
  const top = React.useMemo<ReadonlyArray<SecurityReport>>(
    () =>
      [...reports]
        .filter((r) => r.severity === 'critical' || r.severity === 'high')
        .sort((a, b) => a.severity.localeCompare(b.severity))
        .slice(0, 5),
    [reports],
  );

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="security-recent-findings"
      aria-label="Recent critical & high findings"
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          Recent critical &amp; high
        </h3>
        <p className="text-[10px] text-[var(--fg-tertiary)]">
          Last 5 findings that demand attention
        </p>
      </header>
      {top.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-4 text-center text-xs text-[var(--fg-tertiary)]">
          Nothing critical or high right now. Nice.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {top.map((r: SecurityReport) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                data-testid={`security-recent-row-${r.id}`}
                className="flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-left transition-colors duration-150 ease-out-soft hover:border-[var(--accent-primary)] hover:bg-[var(--bg-inset)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                    r.severity === 'critical'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                  )}
                >
                  {r.severity}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-medium text-[var(--fg-primary)]">
                    {r.title}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                    {r.affected_service} · {r.category}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryBreakdown({
  posture,
  reports,
}: {
  posture: SecurityPosture | null;
  reports: ReadonlyArray<SecurityReport>;
}) {
  // Prefer the posture aggregate (server-computed) but fall back to a
  // client-side aggregate when posture is unavailable — Rule 15 (no
  // bare empty states).
  const byCategory = React.useMemo<Record<SecurityCategory, number>>(() => {
    const seed: Record<SecurityCategory, number> = {
      auth: 0,
      data: 0,
      network: 0,
      dependency: 0,
      configuration: 0,
      cryptography: 0,
      logging: 0,
    };
    if (posture?.by_category) {
      for (const k of Object.keys(seed) as SecurityCategory[]) {
        seed[k] = posture.by_category[k] ?? 0;
      }
      return seed;
    }
    for (const r of reports) seed[r.category] += 1;
    return seed;
  }, [posture, reports]);

  const maxCount = Math.max(1, ...(Object.values(byCategory) as number[]));
  const total = (Object.values(byCategory) as number[]).reduce(
    (sum: number, n: number) => sum + n,
    0,
  );

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="security-category-breakdown"
      aria-label="Findings by category"
    >
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            Findings by category
          </h3>
          <p className="text-[10px] text-[var(--fg-tertiary)]">
            Where the open findings cluster
          </p>
        </div>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {total} total
        </span>
      </header>

      {total === 0 ? (
        <EmptyState
          compact
          illustration={<Sparkles size={28} strokeWidth={1.5} />}
          title="No findings recorded"
          description="When the posture aggregate or findings list populates, the stacked bar will render here."
        />
      ) : (
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
          {CATEGORIES.map((c) => {
            const n = byCategory[c.id];
            if (n === 0) return null;
            const pct = (n / total) * 100;
            return (
              <span
                key={c.id}
                data-testid={`security-category-bar-${c.id}`}
                data-count={n}
                title={`${c.label}: ${n}`}
                className={cn('h-full', CATEGORY_TONE[c.id])}
                style={{ width: `${pct}%` }}
              />
            );
          })}
        </div>
      )}

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-2"
            data-testid={`security-category-legend-${c.id}`}
          >
            <span className="flex items-center gap-1.5 text-[var(--fg-secondary)]">
              <span
                aria-hidden="true"
                className={cn('inline-block h-2 w-2 rounded-full', CATEGORY_TONE[c.id])}
              />
              {c.label}
            </span>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {byCategory[c.id]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PostureTrend({ posture }: { posture: SecurityPosture | null }) {
  const trend = posture?.trend ?? [];

  if (trend.length === 0) {
    return (
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
        data-testid="security-posture-trend"
        data-state="empty"
      >
        <EmptyState
          compact
          illustration={<Sparkles size={28} strokeWidth={1.5} />}
          title="No trend data yet"
          description="Once two or more scans complete, the score over time will plot here."
        />
      </section>
    );
  }

  const width = 600;
  const height = 160;
  const padding = 24;
  const minScore = 0;
  const maxScore = 100;

  const xStep = (width - padding * 2) / Math.max(1, trend.length - 1);
  const points = trend.map((p, i) => {
    const x = padding + i * xStep;
    const y =
      height - padding - ((p.score - minScore) / (maxScore - minScore)) * (height - padding * 2);
    return { x, y, ...p };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="security-posture-trend"
      data-state="ready"
    >
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            Posture score trend
          </h3>
          <p className="text-[10px] text-[var(--fg-tertiary)]">
            {trend.length} scan{trend.length === 1 ? '' : 's'} recorded
          </p>
        </div>
        <span className="font-mono text-2xl font-semibold text-[var(--fg-primary)]">
          {posture?.score ?? '—'}
        </span>
      </header>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label="Posture score trend"
      >
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="var(--border-subtle)"
          strokeWidth={1}
        />
        <path
          d={path}
          fill="none"
          stroke="var(--accent-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p) => (
          <circle
            key={p.date}
            cx={p.x}
            cy={p.y}
            r={3}
            className="fill-[var(--accent-primary)]"
          >
            <title>{`${p.date}: ${p.score}`}</title>
          </circle>
        ))}
      </svg>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer — opens when a row is selected.
// ---------------------------------------------------------------------------

function FindingDetailDrawer({
  report,
  onClose,
}: {
  report: SecurityReport | null;
  onClose: () => void;
}) {
  // Esc closes the drawer (matches the parent page's shortcut overlay).
  React.useEffect(() => {
    if (!report) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report, onClose]);

  if (!report) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Security finding detail"
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(0,0,0,0.45)]"
      onClick={onClose}
      data-testid="security-finding-drawer"
    >
      <div
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-2xl thin-scrollbar"
        onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span
              className={cn(
                'inline-flex w-fit items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                STATUS_TONE[report.status],
              )}
              data-testid="security-finding-drawer-status"
            >
              {report.status}
            </span>
            <h2
              className="text-base font-semibold text-[var(--fg-primary)]"
              data-testid="security-finding-drawer-title"
            >
              {report.title}
            </h2>
            <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {report.severity} · {report.category} · {report.affected_service}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="rounded-[var(--radius-md)] p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            data-testid="security-finding-drawer-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
            Description
          </h3>
          <p
            className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs leading-relaxed text-[var(--fg-secondary)]"
            data-testid="security-finding-drawer-description"
          >
            {report.description}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
            Recommendation
          </h3>
          <p
            className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs leading-relaxed text-[var(--fg-secondary)]"
            data-testid="security-finding-drawer-recommendation"
          >
            {report.recommendation}
          </p>
        </section>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs">
          <DetailRow label="Discovered" value={new Date(report.discovered_at).toLocaleString()} />
          <DetailRow
            label="Mitigated"
            value={
              report.mitigated_at
                ? new Date(report.mitigated_at).toLocaleString()
                : '—'
            }
          />
          <DetailRow label="Source ADR" value={report.source_adr_id ?? '—'} />
          <DetailRow label="Generated by" value={report.generated_by ?? '—'} />
        </dl>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd className="truncate font-mono text-[11px] text-[var(--fg-secondary)]">{value}</dd>
    </>
  );
}

export default SecurityReportPanel;