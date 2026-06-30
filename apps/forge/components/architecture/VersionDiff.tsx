'use client';

/**
 * Architecture Center — Version Diff viewer.
 *
 * Fetches `GET /architecture/versions/diff?from={from}&to={to}` and
 * renders a structural diff between two architecture snapshots.
 *
 * Sections:
 *  - Summary card (totals + breaking changes)
 *  - Added / Removed / Changed ADRs
 *  - Added / Removed / Changed API Contracts
 *  - Added / Removed / Changed Risks
 *
 * Skill rules adopted:
 *  - `ux-guideline` "Tables can overflow on mobile" — every list
 *    sits inside an `overflow-x-auto` wrapper where appropriate.
 *  - `08-empty-ux.md` / Rule 15 — the empty state explains
 *    "no changes" with a suggested next action, not a bare
 *    "No data".
 *  - `06-keyboard-ux.md` — every interactive element has a
 *    visible focus ring and a tab order matching the DOM.
 *  - `prefers-reduced-motion` — uses CSS transitions only (no
 *    framer-motion) so the global `reduce` rule disables them.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Plus,
  Minus,
  RefreshCw,
  GitCompare,
  FileText,
  FileCode2,
  ShieldAlert,
  AlertOctagon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import { api } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types — inline to keep the component self-contained.
// ---------------------------------------------------------------------------

interface VersionDiffItem {
  id: string;
  number?: number;
  title?: string;
  type: 'adr' | 'contract' | 'risk';
  status?: string;
  change_kind?: 'added' | 'removed' | 'changed';
  fields_changed?: string[];
}

interface VersionDiffResponse {
  from_version: string;
  to_version: string;
  added_adrs: VersionDiffItem[];
  removed_adrs: VersionDiffItem[];
  changed_adrs: VersionDiffItem[];
  added_contracts: VersionDiffItem[];
  removed_contracts: VersionDiffItem[];
  changed_contracts: VersionDiffItem[];
  added_risks: VersionDiffItem[];
  removed_risks: VersionDiffItem[];
  changed_risks: VersionDiffItem[];
  summary?: {
    total_changes: number;
    breaking_changes: number;
  };
}

type ChangeKind = 'added' | 'removed' | 'changed';
type EntityKind = 'adr' | 'contract' | 'risk';

// ---------------------------------------------------------------------------
// Tonal palettes — match the rest of the Architecture Center.
// ---------------------------------------------------------------------------

const SECTION_TONE: Record<
  ChangeKind,
  {
    border: string;
    bg: string;
    fg: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  added: {
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    fg: 'text-emerald-300',
    label: 'Added',
    icon: Plus,
  },
  removed: {
    border: 'border-rose-500/30',
    bg: 'bg-rose-500/5',
    fg: 'text-rose-300',
    label: 'Removed',
    icon: Minus,
  },
  changed: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    fg: 'text-amber-300',
    label: 'Changed',
    icon: RefreshCw,
  },
};

const ENTITY_LABEL: Record<EntityKind, string> = {
  adr: 'ADRs',
  contract: 'API Contracts',
  risk: 'Risks',
};

const ENTITY_ICON: Record<EntityKind, React.ComponentType<{ className?: string }>> = {
  adr: FileText,
  contract: FileCode2,
  risk: ShieldAlert,
};

const ENTITY_PREFIX: Record<EntityKind, string> = {
  adr: 'ADR',
  contract: 'API',
  risk: 'RISK',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VersionDiffProps {
  from: string;
  to: string;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionDiff({ from, to, className }: VersionDiffProps) {
  const query = useQuery<VersionDiffResponse>({
    queryKey: ['architecture', 'version-diff', from, to],
    queryFn: () =>
      api.get<VersionDiffResponse>(
        `/architecture/versions/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    // Architecture versions diff is structural — five minutes is the
    // right refresh cadence. The page itself can refetch on demand.
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(from && to),
  });

  if (query.isLoading) {
    return <DiffSkeleton />;
  }

  if (query.isError) {
    return (
      <DiffError
        message={query.error instanceof Error ? query.error.message : 'Failed to load diff'}
        onRetry={() => query.refetch()}
      />
    );
  }

  const data = query.data;
  if (!data) {
    return <DiffSkeleton />;
  }

  const totals = {
    added:
      data.added_adrs.length +
      data.added_contracts.length +
      data.added_risks.length,
    removed:
      data.removed_adrs.length +
      data.removed_contracts.length +
      data.removed_risks.length,
    changed:
      data.changed_adrs.length +
      data.changed_contracts.length +
      data.changed_risks.length,
  };
  const totalChanges = totals.added + totals.removed + totals.changed;
  const isEmpty = totalChanges === 0;

  if (isEmpty) {
    return (
      <div
        className={cn('flex flex-col gap-3', className)}
        data-testid="version-diff"
        data-empty="true"
      >
        <DiffHeader from={from} to={to} />
        <EmptyState
          illustration={<GitCompare size={40} strokeWidth={1.5} />}
          title="No changes between these versions"
          description="The architecture snapshot at the source and target versions is identical. Pick an earlier or later version to see a structural diff."
          primaryAction={{
            label: 'Open version timeline',
            onClick: () => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#versions';
              }
            },
            icon: <GitCompare className="h-4 w-4" aria-hidden="true" />,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      data-testid="version-diff"
      data-from={from}
      data-to={to}
    >
      <DiffHeader from={from} to={to} totals={totals} summary={data.summary} />

      <DiffSection
        entity="adr"
        kind="added"
        items={data.added_adrs.map((i) => ({ ...i, change_kind: 'added' as const }))}
      />
      <DiffSection
        entity="adr"
        kind="removed"
        items={data.removed_adrs.map((i) => ({ ...i, change_kind: 'removed' as const }))}
      />
      <DiffSection
        entity="adr"
        kind="changed"
        items={data.changed_adrs.map((i) => ({ ...i, change_kind: 'changed' as const }))}
      />

      <DiffSection
        entity="contract"
        kind="added"
        items={data.added_contracts.map((i) => ({ ...i, change_kind: 'added' as const }))}
      />
      <DiffSection
        entity="contract"
        kind="removed"
        items={data.removed_contracts.map((i) => ({ ...i, change_kind: 'removed' as const }))}
      />
      <DiffSection
        entity="contract"
        kind="changed"
        items={data.changed_contracts.map((i) => ({ ...i, change_kind: 'changed' as const }))}
      />

      <DiffSection
        entity="risk"
        kind="added"
        items={data.added_risks.map((i) => ({ ...i, change_kind: 'added' as const }))}
      />
      <DiffSection
        entity="risk"
        kind="removed"
        items={data.removed_risks.map((i) => ({ ...i, change_kind: 'removed' as const }))}
      />
      <DiffSection
        entity="risk"
        kind="changed"
        items={data.changed_risks.map((i) => ({ ...i, change_kind: 'changed' as const }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function DiffHeader({
  from,
  to,
  totals,
  summary,
}: {
  from: string;
  to: string;
  totals?: { added: number; removed: number; changed: number };
  summary?: { total_changes: number; breaking_changes: number };
}) {
  const totalChanges = summary?.total_changes ?? (totals ? totals.added + totals.removed + totals.changed : 0);
  const breaking = summary?.breaking_changes ?? 0;

  return (
    <section
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="version-diff-header"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompare className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            <span data-testid="version-diff-total">{totalChanges}</span>{' '}
            {totalChanges === 1 ? 'change' : 'changes'} between versions
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[var(--fg-secondary)]">
          <span
            data-testid="version-diff-from"
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5"
          >
            {from}
          </span>
          <ArrowRight className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <span
            data-testid="version-diff-to"
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5"
          >
            {to}
          </span>
        </div>
      </header>

      {totals ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryPill kind="added" count={totals.added} />
          <SummaryPill kind="removed" count={totals.removed} />
          <SummaryPill kind="changed" count={totals.changed} />
          <div
            className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2"
            data-testid="version-diff-breaking"
          >
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
              <AlertOctagon className="h-3 w-3" aria-hidden="true" />
              Breaking
            </span>
            <span
              className={cn(
                'font-mono text-sm font-semibold',
                breaking > 0 ? 'text-rose-300' : 'text-[var(--fg-primary)]',
              )}
            >
              {breaking}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SummaryPill({ kind, count }: { kind: ChangeKind; count: number }) {
  const tone = SECTION_TONE[kind];
  const Icon = tone.icon;
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-[var(--radius-md)] border p-2',
        tone.border,
        tone.bg,
      )}
      data-testid={`version-diff-pill-${kind}`}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-[10px] uppercase tracking-wide',
          tone.fg,
        )}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {tone.label}
      </span>
      <span className={cn('font-mono text-sm font-semibold', tone.fg)}>{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function DiffSection({
  entity,
  kind,
  items,
}: {
  entity: EntityKind;
  kind: ChangeKind;
  items: VersionDiffItem[];
}) {
  if (items.length === 0) return null;
  const tone = SECTION_TONE[kind];
  const Icon = tone.icon;
  const EntityIcon = ENTITY_ICON[entity];

  return (
    <section
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-lg)] border p-3',
        tone.border,
        tone.bg,
      )}
      data-testid={`version-diff-section-${entity}-${kind}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h4 className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', tone.fg)}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {tone.label} {ENTITY_LABEL[entity]}
        </h4>
        <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', tone.border, tone.fg)}>
          {items.length}
        </span>
      </header>
      <ul role="list" className="flex flex-col gap-1.5">
        {items.map((item) => (
          <DiffItemRow key={item.id} item={item} entity={entity} kind={kind} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Item row
// ---------------------------------------------------------------------------

function DiffItemRow({
  item,
  entity,
  kind,
}: {
  item: VersionDiffItem;
  entity: EntityKind;
  kind: ChangeKind;
}) {
  const tone = SECTION_TONE[kind];
  const EntityIcon = ENTITY_ICON[entity];
  const prefix = ENTITY_PREFIX[entity];
  const label =
    item.title ??
    (item.number !== undefined
      ? `${prefix}-${String(item.number).padStart(3, '0')}`
      : item.id);

  return (
    <li
      className="flex items-start justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-xs"
      data-testid={`version-diff-item-${entity}-${kind}-${item.id}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 text-[var(--fg-tertiary)]">
          <EntityIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--fg-primary)]">
            {item.number !== undefined ? (
              <span className="mr-1.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
                {prefix}-{String(item.number).padStart(3, '0')}
              </span>
            ) : null}
            {label}
          </p>
          {item.fields_changed && item.fields_changed.length > 0 ? (
            <p className="mt-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
              changed: {item.fields_changed.join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {item.status ? (
          <span
            className={cn(
              'rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--fg-secondary)]',
            )}
          >
            {item.status}
          </span>
        ) : null}
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] border',
            tone.border,
            tone.fg,
          )}
          aria-label={tone.label}
        >
          {kind === 'added' ? (
            <Plus className="h-3 w-3" aria-hidden="true" />
          ) : kind === 'removed' ? (
            <Minus className="h-3 w-3" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
          )}
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton — matches the 4-5 row layout
// ---------------------------------------------------------------------------

function DiffSkeleton() {
  return (
    <div className="flex flex-col gap-4" data-testid="version-diff-loading">
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="h-4 w-48 animate-pulse rounded bg-[var(--bg-inset)]" />
        <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-inset)]" />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        >
          <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-inset)]" />
          {[0, 1, 2, 3].map((j) => (
            <div
              key={j}
              className="h-9 w-full animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-inset)]"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

function DiffError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-rose-500/30 bg-rose-500/5 p-4"
      data-testid="version-diff-error"
      role="alert"
    >
      <header className="flex items-center gap-2">
        <AlertOctagon className="h-4 w-4 text-rose-300" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-rose-300">Could not load version diff</h4>
      </header>
      <p className="text-xs text-[var(--fg-secondary)]">{message}</p>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="text-xs"
          data-testid="version-diff-retry"
        >
          <RefreshCw className="mr-1.5 h-3 w-3" aria-hidden="true" />
          Retry
        </Button>
      </div>
    </div>
  );
}

export default VersionDiff;
