'use client';

/**
 * CatalogMode — ZONE 5 of the brief (polished).
 *
 * Surfaces the `forge-core` skill catalog with four rails:
 *   1. Featured commands (most-used this week)
 *   2. Recently used by your team
 *   3. Suggested for your tickets (AI match)
 *   4. Full catalog, filterable by phase / tag / category
 *
 * Each card = `<ForgeSkillCard>` with `Add to spec` and
 * `Trigger from ticket` actions wired to the global store.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Sparkles,
  Users,
  Layers,
  Filter,
  X,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  FORGE_SKILLS,
  FORGE_PHASES,
  featuredSkills,
  recentlyUsedByTeam,
  searchSkills,
  type ForgePhase,
  type ForgeSkill,
} from '@/lib/forge-core/manifest';
import { PHASE_ACCENT } from '@/lib/command-center/theme';
import { SAMPLE_TICKETS } from '@/lib/command-center/sample-data';
import { useCommandCenter } from '@/lib/command-center/store';
import { ForgeSkillCard } from './ForgeSkillCard';

type CatalogFilter = ForgePhase | 'all';

const ALL_PHASE_FILTERS: ReadonlyArray<CatalogFilter> = [
  'all',
  ...FORGE_PHASES.map((p) => p.id),
];

function RailHeader({
  icon: IconCmp,
  title,
  subtitle,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <header className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)] text-[var(--accent-cyan)]">
          <IconCmp className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div>
          <h2 className="text-md font-semibold text-[var(--fg-primary)]">
            {title}
          </h2>
          <p className="text-[11px] text-[var(--fg-tertiary)]">{subtitle}</p>
        </div>
      </div>
      {badge ? (
        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]">
          {badge}
        </span>
      ) : null}
    </header>
  );
}

function Rail({
  skills,
  onRun,
  onAddToSpec,
  onTriggerFromTicket,
}: {
  skills: ReadonlyArray<ForgeSkill>;
  onRun: (s: ForgeSkill) => void;
  onAddToSpec: (s: ForgeSkill) => void;
  onTriggerFromTicket: (s: ForgeSkill) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {skills.map((s) => (
        <ForgeSkillCard
          key={s.id}
          skill={s}
          onRun={onRun}
          onAddToSpec={onAddToSpec}
          onTriggerFromTicket={onTriggerFromTicket}
        />
      ))}
    </div>
  );
}

export function CatalogMode() {
  const { catalogQuery, setCatalogQuery, setSelectedTicketId, setActivePhase } =
    useCommandCenter();
  const [filter, setFilter] = React.useState<CatalogFilter>('all');

  const visible = React.useMemo(() => {
    const base =
      catalogQuery.trim() === ''
        ? filter === 'all'
          ? FORGE_SKILLS
          : FORGE_SKILLS.filter((s) => s.phase === filter)
        : searchSkills(catalogQuery);
    return filter === 'all' ? base : base.filter((s) => s.phase === filter);
  }, [catalogQuery, filter]);

  const onRun = React.useCallback((s: ForgeSkill) => {
    toast.success(`Running /${s.id}`, {
      description: 'Open the Runs center to follow live output.',
    });
  }, []);

  const onAddToSpec = React.useCallback((s: ForgeSkill) => {
    toast.success(`Added ${s.label} to current spec`, {
      description: 'Open Spec mode to wire it into the plan.',
    });
  }, []);

  const onTriggerFromTicket = React.useCallback(
    (s: ForgeSkill) => {
      // Pick the first active ticket to seed the workflow with.
      const t = SAMPLE_TICKETS.find((tk) => tk.status === 'in-progress') ??
        SAMPLE_TICKETS[0];
      if (!t) {
        toast.error('No ticket available to trigger this skill.');
        return;
      }
      setSelectedTicketId(t.id);
      setActivePhase(s.phase);
      toast.success(`Triggered ${s.label} on ${t.id}`, {
        description: 'Switched to Ticket mode automatically.',
      });
    },
    [setSelectedTicketId, setActivePhase],
  );

  const featured = featuredSkills(6);
  const team = recentlyUsedByTeam(4);
  const suggested: ReadonlyArray<ForgeSkill> = FORGE_SKILLS.slice(0, 3)
    .map((_s, i) => FORGE_SKILLS[(i * 7) % FORGE_SKILLS.length])
    .filter((s): s is ForgeSkill => Boolean(s));

  return (
    <div className="space-y-8" data-testid="fcc-catalog-mode">
      {/* Search + filters bar */}
      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-tertiary)]"
            aria-hidden
          />
          <Input
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder="Search the full forge-* catalog..."
            className="pl-9 pr-9"
            data-testid="fcc-catalog-search"
          />
          {catalogQuery ? (
            <button
              type="button"
              onClick={() => setCatalogQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden />
          {ALL_PHASE_FILTERS.map((f) => {
            const meta =
              f === 'all'
                ? { label: 'All phases', short: 'All' }
                : {
                    label: FORGE_PHASES.find((p) => p.id === f)?.label ?? f,
                    short: FORGE_PHASES.find((p) => p.id === f)?.short ?? f,
                  };
            const isActive = f === filter;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                data-testid={`fcc-catalog-filter-${f}`}
                aria-pressed={isActive}
                className={cn(
                  'rounded-full border px-3 py-1 text-[11px] transition-colors',
                  isActive
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
                )}
              >
                {meta.short}
              </button>
            );
          })}
          <span className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">
            {visible.length} skills
          </span>
        </div>
      </section>

      {/* Featured rail */}
      <section className="space-y-3">
        <RailHeader
          icon={Star}
          title="Featured this week"
          subtitle="Top usage across Forge tenants"
          badge={`${featured.length}`}
        />
        <Rail
          skills={featured}
          onRun={onRun}
          onAddToSpec={onAddToSpec}
          onTriggerFromTicket={onTriggerFromTicket}
        />
      </section>

      {/* Recently used by team rail */}
      <section className="space-y-3">
        <RailHeader
          icon={Users}
          title="Recently used by your team"
          subtitle="What your teammates ran in the last 7 days"
          badge={`${team.length}`}
        />
        <Rail
          skills={team}
          onRun={onRun}
          onAddToSpec={onAddToSpec}
          onTriggerFromTicket={onTriggerFromTicket}
        />
      </section>

      {/* Suggested for your tickets rail */}
      <section className="space-y-3">
        <RailHeader
          icon={Sparkles}
          title="Suggested for your tickets"
          subtitle="AI-matched to the work in your queue"
          badge={`${suggested.length}`}
        />
        <Rail
          skills={suggested}
          onRun={onRun}
          onAddToSpec={onAddToSpec}
          onTriggerFromTicket={onTriggerFromTicket}
        />
      </section>

      {/* Full catalog grouped by phase */}
      <section className="space-y-3">
        <RailHeader
          icon={Layers}
          title="Full catalog"
          subtitle="Every forge-* skill, grouped by GSD phase"
          badge={`${FORGE_SKILLS.length}`}
        />
        {visible.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-center text-xs text-[var(--fg-tertiary)]">
            No skills match your filter. Try clearing search or selecting
            "All phases".
          </p>
        ) : (
          <div className="space-y-6">
            {FORGE_PHASES.filter(
              (p) => filter === 'all' || p.id === filter,
            ).map((phase) => {
              const inPhase = visible.filter((s) => s.phase === phase.id);
              if (inPhase.length === 0) return null;
              const accent = PHASE_ACCENT[phase.id];
              return (
                <div key={phase.id} className="space-y-3">
                  <header className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        accent.chip,
                      )}
                    >
                      {phase.short}
                    </span>
                    <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
                      {phase.label}
                    </h3>
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      {inPhase.length} skill{inPhase.length === 1 ? '' : 's'}
                    </span>
                  </header>
                  <motion.div
                    layout
                    className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
                  >
                    {inPhase.map((s) => (
                      <ForgeSkillCard
                        key={s.id}
                        skill={s}
                        onRun={onRun}
                        onAddToSpec={onAddToSpec}
                        onTriggerFromTicket={onTriggerFromTicket}
                      />
                    ))}
                  </motion.div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
