'use client';

/**
 * SpecMode — ZONE 4 of the brief.
 *
 * 3-column layout on ≥1440px:
 *   - Left: specs list with filter pills + progress bars
 *   - Center: spec editor with tabs (Overview/Requirements/Plan/
 *     Execution/Verification/History)
 *   - Right: phase progress tracker + linked entities + AI suggestions
 *
 * Skill: `04-ux-guideline.md` (heading hierarchy), `07-collapse-
 * breadcrumb.md` (collapsible side panels).
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  Filter,
  FileText,
  Share2,
  MoreHorizontal,
  Rocket,
  CheckCircle2,
  Clock,
  AlertCircle,
  Lightbulb,
  GitBranch,
  ChevronRight,
  Sparkles,
  PencilLine,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Icon } from '@/lib/command-center/icons';
import { cn } from '@/lib/utils';
import { SpecTemplateDialog } from './SpecTemplateDialog';
import {
  FORGE_PHASES,
  type ForgePhase,
} from '@/lib/forge-core/manifest';
import { PHASE_ACCENT, SPEC_STATUS_COLOR } from '@/lib/command-center/theme';
import {
  // Spec/Ticket types re-used; the SAMPLE_* data is no longer read
  // by this component — Track K (Day 2) swapped it for the
  // `useSpecs` stub from `lib/hooks/useForgeFixtures.ts`.
  type Spec,
  type SpecStatus,
} from '@/lib/command-center/sample-data';
import { useCommandCenter } from '@/lib/command-center/store';
import { useSpecs } from '@/lib/hooks/useForgeFixtures';

const SPEC_FILTERS: ReadonlyArray<{ id: SpecStatus | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'drafting', label: 'Drafting' },
  { id: 'planning', label: 'Planning' },
  { id: 'executing', label: 'Executing' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
];

const SPEC_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'plan', label: 'Plan' },
  { id: 'execution', label: 'Execution' },
  { id: 'verification', label: 'Verification' },
  { id: 'history', label: 'History' },
] as const;
type SpecTab = (typeof SPEC_TABS)[number]['id'];

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
      <motion.span
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="block h-full rounded-full bg-gradient-to-r from-[var(--accent-cyan)] via-[var(--accent-primary)] to-[var(--accent-violet)]"
      />
    </div>
  );
}

function SpecsList({
  specs,
  selected,
  onSelect,
  filter,
  onFilter,
  onOpenTemplate,
}: {
  specs: ReadonlyArray<Spec>;
  selected: string;
  onSelect: (id: string) => void;
  filter: SpecStatus | 'all';
  onFilter: (f: SpecStatus | 'all') => void;
  onOpenTemplate: () => void;
}) {
  const filtered = specs.filter((s) =>
    filter === 'all' ? true : s.status === filter,
  );
  return (
    <aside
      className="flex w-full shrink-0 flex-col gap-3 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 lg:w-[300px]"
      data-testid="fcc-specs-list"
      aria-label="Specs list"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            My Specs
          </p>
          <p className="text-xs text-[var(--fg-secondary)]">
            {filtered.length} {filtered.length === 1 ? 'spec' : 'specs'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
          data-testid="fcc-new-spec"
          onClick={() =>
            toast.info('Spec wizard coming online', {
              description: 'Step 1: pick a source.',
            })
          }
        >
          <Plus className="h-3 w-3" aria-hidden />
          New
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-1">
        <Filter className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden />
        {SPEC_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter(f.id)}
            data-testid={`fcc-spec-filter-${f.id}`}
            aria-pressed={filter === f.id}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
              filter === f.id
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                : 'border-[var(--border-subtle)] text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-1 text-[var(--fg-tertiary)]"
        onClick={onOpenTemplate}
        data-testid="fcc-spec-open-template"
      >
        <FileText className="h-3 w-3" aria-hidden />
        Start from template
      </Button>

      <ul role="list" className="flex flex-col gap-2 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4 text-center">
            <p className="text-xs font-medium text-[var(--fg-secondary)]">
              No specs loaded yet
            </p>
            <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">
              The unified <code className="font-mono">/v1/specs</code>{' '}
              endpoint ships in Day 3+. For now, start a new spec from
              a ticket or template.
            </p>
          </li>
        ) : null}
        {filtered.map((s) => {
          const isActive = s.id === selected;
          const status = SPEC_STATUS_COLOR[s.status];
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                data-testid={`fcc-spec-list-${s.id}`}
                aria-pressed={isActive}
                className={cn(
                  'group flex w-full flex-col gap-2 rounded-[var(--radius-md)] border p-3 text-left transition-[border,box-shadow] duration-150 ease-out-soft',
                  isActive
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 shadow-[var(--shadow-md)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)]',
                )}
              >
                <header className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--fg-primary)]">
                      {s.title}
                    </p>
                    <p className="truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
                      {s.id}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                      status,
                    )}
                  >
                    {s.status}
                  </span>
                </header>
                <ProgressBar value={s.progress} />
                <p className="text-[10px] text-[var(--fg-tertiary)]">
                  {s.progress}% ·{' '}
                  {new Date(s.updatedAt).toLocaleDateString()}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function SpecTabBar({
  tab,
  onTab,
}: {
  tab: SpecTab;
  onTab: (t: SpecTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Spec tabs"
      className="flex items-center gap-1 border-b border-[var(--border-subtle)]"
    >
      {SPEC_TABS.map((t) => {
        const isActive = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`fcc-spec-tab-${t.id}`}
            onClick={() => onTab(t.id)}
            className={cn(
              'relative inline-flex items-center px-3 py-2 text-sm transition-colors',
              isActive
                ? 'font-semibold text-[var(--fg-primary)]'
                : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {t.label}
            {isActive ? (
              <motion.span
                layoutId="fcc-spec-tab-underline"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--accent-primary)]"
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SpecOverview({ spec }: { spec: Spec }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="lg:col-span-2 space-y-3">
        <h3 className="text-md font-semibold text-[var(--fg-primary)]">
          Problem
        </h3>
        <p className="text-sm leading-relaxed text-[var(--fg-secondary)]">
          {spec.problem}
        </p>
        <h3 className="text-md font-semibold text-[var(--fg-primary)]">Goals</h3>
        <ul role="list" className="space-y-1.5">
          {spec.goals.map((g, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-[var(--fg-secondary)]"
            >
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-emerald)]"
                aria-hidden
              />
              <span>{g}</span>
            </li>
          ))}
        </ul>
      </section>
      <aside className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
          Snapshot
        </p>
        <dl className="mt-2 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--fg-tertiary)]">Status</dt>
            <dd
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                SPEC_STATUS_COLOR[spec.status],
              )}
            >
              {spec.status}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--fg-tertiary)]">Source</dt>
            <dd className="font-mono text-[var(--fg-primary)] capitalize">
              {spec.source}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--fg-tertiary)]">Updated</dt>
            <dd className="font-mono text-[var(--fg-secondary)]">
              {new Date(spec.updatedAt).toLocaleDateString()}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--fg-tertiary)]">Progress</dt>
            <dd className="font-mono text-[var(--fg-primary)]">
              {spec.progress}%
            </dd>
          </div>
        </dl>
        <ProgressBar value={spec.progress} />
      </aside>
    </div>
  );
}

function SpecRequirements({ spec }: { spec: Spec }) {
  const total = spec.requirements.length;
  const done = spec.requirements.filter((r) => r.done).length;
  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-md font-semibold text-[var(--fg-primary)]">
          Requirements ({done}/{total})
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-[var(--accent-primary)]"
          onClick={() => toast.info('AI will suggest requirements')}
        >
          <Sparkles className="h-3 w-3" aria-hidden />
          Suggest
        </Button>
      </header>
      <ul role="list" className="space-y-2">
        {spec.requirements.map((r) => (
          <li
            key={r.id}
            className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
          >
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                r.done
                  ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)]/20 text-[var(--accent-emerald)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--fg-tertiary)]',
              )}
              aria-hidden
            >
              {r.done ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <span className="block h-2 w-2 rounded-full bg-[var(--fg-tertiary)]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm',
                  r.done
                    ? 'text-[var(--fg-tertiary)] line-through'
                    : 'text-[var(--fg-primary)]',
                )}
              >
                {r.text}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
                {r.id} · {r.kind}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpecPlan({ spec }: { spec: Spec }) {
  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-md font-semibold text-[var(--fg-primary)]">
          Execution plan
        </h3>
        <span className="text-[10px] text-[var(--fg-tertiary)]">
          AI-generated · editable
        </span>
      </header>
      <ol role="list" className="space-y-2">
        {spec.phases.map((p, i) => {
          const accent = PHASE_ACCENT[p.phase];
          const meta = FORGE_PHASES.find((x) => x.id === p.phase);
          return (
            <li
              key={p.phase}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold',
                  accent.bg,
                  accent.fg,
                )}
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--fg-primary)]">
                  {meta?.label}
                </p>
                <p className="text-[10px] text-[var(--fg-tertiary)]">
                  {meta?.description}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                  p.status === 'completed'
                    ? 'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                    : p.status === 'in-progress'
                      ? 'border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--fg-tertiary)]',
                )}
              >
                {p.status}
              </span>
              <span className="hidden font-mono text-[10px] text-[var(--fg-tertiary)] sm:inline">
                {p.artifacts} artifacts
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SpecHistory({ spec }: { spec: Spec }) {
  return (
    <div className="space-y-3">
      <h3 className="text-md font-semibold text-[var(--fg-primary)]">
        Version history
      </h3>
      <ol role="list" className="space-y-2">
        {spec.history.map((h, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
          >
            <span className="font-mono text-[10px] font-bold text-[var(--accent-cyan)]">
              {h.version}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--fg-primary)]">{h.summary}</p>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
                {h.author} · {new Date(h.at).toLocaleString()}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SpecExecutionOrVerification({ spec }: { spec: Spec }) {
  return (
    <div className="space-y-3">
      <h3 className="text-md font-semibold text-[var(--fg-primary)]">
        Live status
      </h3>
      <ul role="list" className="grid gap-2 md:grid-cols-2">
        {spec.phases.map((p) => {
          const meta = FORGE_PHASES.find((x) => x.id === p.phase);
          const accent = PHASE_ACCENT[p.phase];
          return (
            <li
              key={p.phase}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
            >
              <span className="flex items-center gap-2">
                <Icon
                  name={meta?.icon ?? 'Circle'}
                  className={cn('h-4 w-4', accent.fg)}
                />
                <span className="text-sm font-medium text-[var(--fg-primary)]">
                  {meta?.label}
                </span>
              </span>
              <span className="text-[10px] text-[var(--fg-tertiary)]">
                {p.artifacts} artifacts · {p.status}
              </span>
            </li>
          );
        })}
      </ul>
      <a
        href="/runs"
        className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
      >
        Open in Runs center
        <ChevronRight className="h-3 w-3" aria-hidden />
      </a>
    </div>
  );
}

function SpecSidePanel({ spec }: { spec: Spec }) {
  return (
    <aside
      className="hidden w-full shrink-0 flex-col gap-4 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 xl:flex xl:w-[320px]"
      aria-label="Spec side panel"
      data-testid="fcc-spec-side-panel"
    >
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
          Phase progress
        </p>
        <ol role="list" className="mt-2 flex flex-col gap-2">
          {spec.phases.map((p) => {
            const meta = FORGE_PHASES.find((x) => x.id === p.phase);
            const accent = PHASE_ACCENT[p.phase];
            return (
              <li
                key={p.phase}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2.5"
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    accent.bg,
                    accent.fg,
                  )}
                  aria-hidden
                >
                  {p.status === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : p.status === 'in-progress' ? (
                    <Clock className="h-3.5 w-3.5 animate-spin-slow" />
                  ) : p.status === 'skipped' ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    <span className="block h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--fg-primary)]">
                    {meta?.label}
                  </p>
                  <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                    {p.status} · {p.artifacts} artifacts
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
          Linked entities
        </p>
        <div className="mt-2 space-y-2 text-xs">
          <div>
            <p className="text-[var(--fg-tertiary)]">Implements</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {spec.linkedAdrs.length === 0 ? (
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                  —
                </span>
              ) : (
                spec.linkedAdrs.map((a) => (
                  <span
                    key={a}
                    className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]"
                  >
                    {a}
                  </span>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="text-[var(--fg-tertiary)]">Related specs</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {spec.relatedSpecs.length === 0 ? (
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                  —
                </span>
              ) : (
                spec.relatedSpecs.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]"
                  >
                    {s}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
          AI suggestions
        </p>
        <ul role="list" className="mt-2 space-y-2">
          {/* ponytail: AI suggestions backed by the runtime orchestrator
              (Day 3+); Day 2 renders an empty state instead of seeding
              mock data. */}
          <li className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-center">
            <p className="text-[11px] text-[var(--fg-tertiary)]">
              AI suggestions will appear here once the orchestrator
              suggestions feed lands. Backend integration pending.
            </p>
          </li>
        </ul>
      </section>
            <li
              key={s.id}
              className="rounded-[var(--radius-md)] border border-[var(--accent-violet)]/30 bg-[var(--accent-violet)]/5 p-3"
            >
              <header className="flex items-center gap-2">
                <Lightbulb className="h-3 w-3 text-[var(--accent-violet)]" aria-hidden />
                <p className="text-xs font-semibold text-[var(--fg-primary)]">
                  {s.title}
                </p>
              </header>
              <p className="mt-1 text-[11px] text-[var(--fg-secondary)]">
                {s.body}
              </p>
              <div className="mt-2 flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => toast.info(`Triggered: ${s.primary.label}`)}
                >
                  {s.primary.label}
                </Button>
                <span className="ml-auto font-mono text-[9px] text-[var(--fg-tertiary)]">
                  {Math.round(s.confidence * 100)}% conf
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

export function SpecMode() {
  const { selectedSpecId, setSelectedSpecId } = useCommandCenter();
  const [filter, setFilter] = React.useState<SpecStatus | 'all'>('all');
  const [tab, setTab] = React.useState<SpecTab>('overview');
  const [title, setTitle] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);

  // Track K (Day 2) — backed by the `useSpecs` stub. Returns `[]`
  // until the unified `/v1/specs` endpoint ships (Day 3+); the
  // component falls through to an explicit empty-state body.
  const { data: specs } = useSpecs();

  const spec = specs.find((s) => s.id === selectedSpecId) ?? specs[0];

  if (!spec) {
    // ponytail: backend-pending empty state for the whole Spec mode.
    return (
      <div
        className="flex w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center"
        data-testid="fcc-spec-empty"
      >
        <FileText className="h-8 w-8 text-[var(--fg-tertiary)]" aria-hidden />
        <p className="text-md font-semibold text-[var(--fg-primary)]">
          No specs loaded yet
        </p>
        <p className="max-w-md text-sm text-[var(--fg-tertiary)]">
          The unified <code className="font-mono">/v1/specs</code>{' '}
          endpoint is being wired up — it ships on Day 3+. Until then,
          specs created in earlier sessions remain visible in your
          project history.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
          onClick={() => setTemplateOpen(true)}
          data-testid="fcc-spec-empty-template"
        >
          <FileText className="mr-1 h-3 w-3" aria-hidden />
          Start from template
        </Button>
      </div>
    );
  }

  React.useEffect(() => {
    setTitle(spec.title);
    setTab('overview');
  }, [spec.id]);

  return (
    <div
      className="flex w-full flex-col gap-0 lg:flex-row"
      data-testid="fcc-spec-mode"
    >
      <SpecsList
        specs={specs}
        selected={spec.id}
        onSelect={setSelectedSpecId}
        filter={filter}
        onFilter={setFilter}
        onOpenTemplate={() => setTemplateOpen(true)}
      />
      <main
        className="min-w-0 flex-1 space-y-4 bg-[var(--bg-base)] p-4 lg:p-8"
        aria-label="Spec editor"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Spec editor
            </p>
            {editing ? (
              <Textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditing(false)}
                autoFocus
                className="mt-1 min-h-[40px] text-xl font-bold"
                aria-label="Edit spec title"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="group flex items-center gap-2 text-left text-xl font-bold text-[var(--fg-primary)] hover:text-[var(--accent-primary)]"
                data-testid="fcc-spec-title"
              >
                {spec.title}
                <PencilLine
                  className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden
                />
              </button>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--fg-tertiary)]">
              <span>{spec.id}</span>
              <span>·</span>
              <span>v{spec.history.at(-1)?.version ?? '0.1'}</span>
              <span>·</span>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                  SPEC_STATUS_COLOR[spec.status],
                )}
              >
                {spec.status}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1 border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              onClick={() => toast.info('Share link copied')}
            >
              <Share2 className="h-3 w-3" aria-hidden />
              Share
            </Button>
            <Button
              size="sm"
              className="gap-1 bg-[var(--accent-primary)] text-white hover:opacity-90"
              data-testid="fcc-start-execution"
              onClick={() =>
                toast.success('Execution queued', { description: spec.id })
              }
            >
              <Rocket className="h-3 w-3" aria-hidden />
              Start execution
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </header>

        <SpecTabBar tab={tab} onTab={setTab} />

        <AnimatePresence>
          <motion.div
            key={`${spec.id}-${tab}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
          >
            {tab === 'overview' && <SpecOverview spec={spec} />}
            {tab === 'requirements' && <SpecRequirements spec={spec} />}
            {tab === 'plan' && <SpecPlan spec={spec} />}
            {tab === 'execution' && <SpecExecutionOrVerification spec={spec} />}
            {tab === 'verification' && <SpecExecutionOrVerification spec={spec} />}
            {tab === 'history' && <SpecHistory spec={spec} />}
          </motion.div>
        </AnimatePresence>

        <footer className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <GitBranch className="h-3 w-3" aria-hidden />
            Outputs are typed artifacts (ADR / API Contract / Risk Register).
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              onClick={() => toast.success('Exported as ADR')}
            >
              Export as ADR
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              onClick={() => toast.success('Exported as PRD')}
            >
              Export as PRD
            </Button>
            <Button
              size="sm"
              className="bg-[var(--accent-cyan)] text-white hover:opacity-90"
              onClick={() => toast.success('Ticket generated')}
            >
              Generate ticket
            </Button>
          </div>
        </footer>
      </main>
      <SpecSidePanel spec={spec} />
      <SpecTemplateDialog open={templateOpen} onClose={() => setTemplateOpen(false)} />
    </div>
  );
}
