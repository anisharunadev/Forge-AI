'use client';

/**
 * SecurityFindingList — virtualized list of SecurityReport rows (M5-G4).
 *
 * Each row shows severity, category, affected service, and a one-line
 * excerpt of the description. Click a row to open the detail drawer
 * (parent owns the open state).
 *
 * Severity filter chips sit above the list (critical / high / medium /
 * low). Multi-select is supported; an "All" chip clears the filter.
 *
 * Skill influence:
 *   - `data-dense-dashboard` — 48px row height, hover affordance,
 *     pinned-left severity dot for at-a-glance triage.
 *   - `08-empty-ux.md` — when no findings match the active filter
 *     we render the "All clear" microcopy; when the full feed is
 *     empty we render the heavier EmptyState with a CTA to record
 *     a new finding (Rule 15).
 *   - `prefers-reduced-motion` — all transitions honor the OS-level
 *     reduce-motion preference (no auto-scroll on filter change).
 */

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ShieldAlert,
  AlertTriangle,
  ShieldCheck,
  Inbox,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import type {
  SecurityReport,
  SecuritySeverity,
} from '@/lib/architecture/types';

const SEVERITY_ORDER: ReadonlyArray<SecuritySeverity> = [
  'critical',
  'high',
  'medium',
  'low',
];

const SEVERITY_TONE: Record<SecuritySeverity, { dot: string; chip: string }> = {
  critical: {
    dot: 'bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.18)]',
    chip: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  },
  high: {
    dot: 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  medium: {
    dot: 'bg-yellow-500 shadow-[0_0_0_3px_rgba(234,179,8,0.18)]',
    chip: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  },
  low: {
    dot: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]',
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
};

function severityIcon(severity: SecuritySeverity): React.ReactNode {
  switch (severity) {
    case 'critical':
      return <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'high':
      return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'medium':
      return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'low':
      return <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

function describeStatus(status: SecurityReport['status']): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'mitigating':
      return 'Mitigating';
    case 'accepted':
      return 'Accepted';
    case 'closed':
      return 'Closed';
  }
}

export interface SecurityFindingListProps {
  reports: ReadonlyArray<SecurityReport>;
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (report: SecurityReport) => void;
  onCreateNew?: () => void;
}

export function SecurityFindingList({
  reports,
  loading = false,
  selectedId = null,
  onSelect,
  onCreateNew,
}: SecurityFindingListProps) {
  // Multi-select severity filter — empty array means "show all".
  const [severityFilter, setSeverityFilter] = React.useState<ReadonlySet<SecuritySeverity>>(
    new Set(),
  );

  const filtered = React.useMemo(() => {
    if (severityFilter.size === 0) return reports;
    return reports.filter((r) => severityFilter.has(r.severity));
  }, [reports, severityFilter]);

  const counts = React.useMemo(() => {
    const c: Record<SecuritySeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const r of reports) c[r.severity] += 1;
    return c;
  }, [reports]);

  const toggleSeverity = (sev: SecuritySeverity) => {
    setSeverityFilter((prev: ReadonlySet<SecuritySeverity>) => {
      const next = new Set<SecuritySeverity>(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  };

  const clearFilter = () => setSeverityFilter(new Set());

  // Virtualized list — @tanstack/react-virtual, no new deps added.
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 84,
    overscan: 8,
  });

  return (
    <section
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="security-finding-list"
      aria-label="Security findings"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            Open findings
          </h3>
          <p className="text-[10px] text-[var(--fg-tertiary)]">
            {filtered.length} of {reports.length} match the active filter
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Severity filter">
          <FilterChip
            label="All"
            tone="neutral"
            active={severityFilter.size === 0}
            count={reports.length}
            onClick={clearFilter}
            testId="security-filter-all"
          />
          {SEVERITY_ORDER.map((sev) => (
            <FilterChip
              key={sev}
              label={sev}
              tone={SEVERITY_TONE[sev].chip}
              active={severityFilter.has(sev)}
              count={counts[sev]}
              onClick={() => toggleSeverity(sev)}
              testId={`security-filter-${sev}`}
            />
          ))}
        </div>
      </header>

      {/* Body */}
      <div
        ref={parentRef}
        className="thin-scrollbar relative max-h-[420px] overflow-y-auto"
        data-testid="security-finding-list-scroll"
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[68px] animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-inset)]"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <EmptyState
            compact
            illustration={<Inbox size={28} strokeWidth={1.5} />}
            title="No security findings recorded"
            description="Once a scan runs or a finding is reported, it will appear here."
            primaryAction={
              onCreateNew
                ? {
                    label: 'Record a finding',
                    onClick: onCreateNew,
                  }
                : undefined
            }
          />
        ) : filtered.length === 0 ? (
          <div data-testid="security-finding-list-cleared">
            <EmptyState
              compact
              illustration={<ShieldCheck size={28} strokeWidth={1.5} />}
              title="All clear — no critical findings"
              description="No findings match the active severity filter. Try clearing it to see the full feed."
              primaryAction={{
                label: 'Clear filter',
                onClick: clearFilter,
              }}
            />
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizer.getVirtualItems().map((vRow: { index: number; start: number }) => {
              const r = filtered[vRow.index];
              if (!r) return null;
              const active = selectedId === r.id;
              return (
                <button
                  type="button"
                  key={r.id}
                  data-testid={`security-finding-row-${r.id}`}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => onSelect(r)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  className={cn(
                    'flex items-start gap-3 border-b border-[var(--border-subtle)] px-3 py-3 text-left transition-colors duration-150 ease-out-soft',
                    'hover:bg-[var(--bg-inset)] focus:outline-none focus-visible:bg-[var(--bg-inset)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-inset',
                    active && 'bg-[var(--bg-inset)]',
                  )}
                >
                  <span
                    className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', (SEVERITY_TONE[r.severity] ?? SEVERITY_TONE.low).dot)}
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                          (SEVERITY_TONE[r.severity] ?? SEVERITY_TONE.low).chip,
                        )}
                      >
                        {severityIcon(r.severity)}
                        {r.severity}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
                        {r.category}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                        · {describeStatus(r.status)}
                      </span>
                    </div>
                    <p className="truncate text-xs font-medium text-[var(--fg-primary)]">
                      {r.title}
                    </p>
                    <p className="truncate text-[11px] text-[var(--fg-tertiary)]">
                      <span className="font-mono text-[var(--fg-secondary)]">{r.affected_service}</span>
                      {' · '}
                      {r.description.length > 110
                        ? `${r.description.slice(0, 110)}…`
                        : r.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {onCreateNew ? (
        <footer className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            onClick={onCreateNew}
            data-testid="security-create-cta"
          >
            + Record a new finding
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

interface FilterChipProps {
  label: string;
  tone: string;
  active: boolean;
  count: number;
  onClick: () => void;
  testId?: string;
}

const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
  { label, tone, active, count, onClick, testId },
  ref,
) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-md)] border px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors duration-150 ease-out-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        active ? tone : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)]',
      )}
    >
      <span>{label}</span>
      <span className="rounded-sm bg-[rgba(255,255,255,0.08)] px-1 text-[9px]">{count}</span>
    </button>
  );
});