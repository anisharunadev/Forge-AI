'use client';

/**
 * Architecture Center — Step 30 modernization (9 tabs).
 *
 * Bug fix first: the Step 11 page rendered count badges from
 * `adrs.length` but the empty state when `selected === undefined`.
 * The race was: `selected = adrs.find(...) ?? adrs[0]` would
 * fallback to first ADR, but if the URL pointed to a stale id that
 * wasn't in the new array, the find returned undefined and the
 * fallback was `adrs[0]` which only fires when adrs is non-empty.
 * The defensive guards now live in a single `resolveSelected`
 * helper that always returns either the matched record, the first
 * record, or undefined — and the empty state ONLY fires when the
 * source array is truly empty. The count badge and the body never
 * disagree again.
 *
 * Skill rules applied (from .claude/design-system + ui-ux-pro-max):
 *   - `style` (Swiss Modernism 2.0 + OLED Dark) — single indigo
 *     accent; mathematical 24/32/48 spacing; no `bg-black` solids.
 *   - `08-empty-ux.md` — every empty state pairs a Lucide icon
 *     illustration with a "Create one!" call to action.
 *   - `06-keyboard-ux.md` — `:focus-visible:ring-2` on every
 *     interactive element; tab order = DOM order; Cmd+K modal
 *     traps focus.
 *   - `prefers-reduced-motion` — Step 6 globals disable every
 *     transition; the `motion.div` blocks here respect that.
 *   - `09-empty-illustration.md` — never a blank screen.
 *   - `10-empty-microcopy.md` — "All clear — no risks" not "no
 *     risks"; "Try a different search" not "no results".
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Search,
  Plus,
  Pencil,
  History as HistoryIcon,
  CheckCircle2,
  XCircle,
  Network,
  FileCode2,
  ListTree,
  ShieldAlert,
  History,
  Play,
  FileText,
  AlertTriangle,
  GitMerge,
  Sparkles,
  Command as CommandIcon,
  Download,
  Filter,
  Calendar,
  User,
  Tag,
  Eye,
  MessageSquare,
  History as HistoryAlias,
  ThumbsUp,
  Workflow,
  Layers,
  TrendingUp,
  TrendingDown,
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  KanbanSquare,
  GanttChartSquare,
  Grid3x3,
  Type,
  Shield,
  Send,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';

import { Sparkline } from '@/components/charts/Sparkline';
import { RadialGaugeCard } from '@/components/charts/RadialGaugeCard';

import { ArchitectureHero } from '@/components/architecture/ArchitectureHero';
import { RiskRegisterKanban } from '@/components/architecture/RiskRegisterKanban';
import { RiskHeatMap } from '@/components/architecture/RiskHeatMap';
import { RiskDetailDrawer } from '@/components/architecture/RiskDetailDrawer';
import { TraceabilityMatrix } from '@/components/architecture/TraceabilityMatrix';
import { TraceabilityGraph } from '@/components/architecture/TraceabilityGraph';
import { VersionTimelineView } from '@/components/architecture/VersionTimelineView';
import { MigrationGuide } from '@/components/architecture/MigrationGuide';
import { CrossTabChips } from '@/components/architecture/CrossTabChips';
import { TechRadar } from '@/components/architecture/TechRadar';
import { DiagramsExplorer } from '@/components/architecture/DiagramsExplorer';
import { ConsumerFlow } from '@/components/architecture/ConsumerFlow';
import {
  ExportButton,
  SavedFiltersBar,
  AIAssistantBadge,
  BulkBar,
} from '@/components/architecture/architecture-extras';

import { ADRViewer } from '@/components/architecture/ADRViewer';
import { ApprovalStatusBadge } from '@/components/architecture/ApprovalStatusBadge';
import { APIContractViewer } from '@/components/architecture/APIContractViewer';
import { TaskBreakdownTree } from '@/components/architecture/TaskBreakdownTree';

import {
  useADRs,
  useContracts,
  useTaskBreakdowns,
  useRiskRegisters,
  useArchitectureVersions,
  useTraceability,
  useArchitectureSecurity,
  useCreateTaskBreakdown,
  useApprovals,
  useRequestApproval,
  useDecideApproval,
} from '@/lib/hooks/useArchitecture';
import { VersionDiff } from '@/components/architecture/VersionDiff';
import { SecurityReportPanel } from '@/components/architecture/SecurityReportPanel';
import { useArchitecturePipelineWS } from '@/lib/architecture/use-pipeline-ws';

import type {
  ADR,
  APIContract,
  TaskBreakdown,
  RiskRegister,
  TraceabilityGraph as TraceabilityGraphType,
  ArchitectureVersion,
} from '@/lib/architecture/data';
import {
  MOCK_ADRS_WITH_META,
  MOCK_CONTRACTS,
  MOCK_SERVICES,
  MOCK_TASK_BREAKDOWNS,
  MOCK_RISK_REGISTERS,
  MOCK_RISKS,
  MOCK_VERSIONS,
  MOCK_TRACEABILITY,
  MOCK_TECH_RADAR,
  MOCK_DIAGRAMS,
  MOCK_ACTIVITY,
  MOCK_DECISION_VELOCITY,
  ADR_COMPONENTS,
  ADR_STATUS_TONE,
  computeHealth,
  type ADRWithMeta,
  type ApiService,
  type ArchitectureActivity,
} from '@/lib/architecture/mock-fixtures';

const EMPTY_TRACEABILITY: TraceabilityGraphType = {
  id: 'tg-empty',
  title: 'Traceability',
  nodes: [],
  edges: [],
};

type TabId =
  | 'overview'
  | 'adrs'
  | 'contracts'
  | 'tasks'
  | 'risks'
  | 'trace'
  | 'versions'
  | 'radar'
  | 'diagrams'
  | 'security';

const TABS: ReadonlyArray<{
  id: TabId;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Visual ring tone for the count badge. */
  countTone?: 'emerald' | 'amber' | 'rose' | 'neutral';
}> = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: LayoutGrid, countTone: 'emerald' },
  { id: 'adrs', label: 'ADRs', shortLabel: 'ADRs', icon: FileText, countTone: 'emerald' },
  { id: 'contracts', label: 'API Contracts', shortLabel: 'APIs', icon: FileCode2, countTone: 'amber' },
  { id: 'tasks', label: 'Task Breakdowns', shortLabel: 'Tasks', icon: ListTree, countTone: 'amber' },
  { id: 'risks', label: 'Risk Registers', shortLabel: 'Risks', icon: ShieldAlert, countTone: 'rose' },
  { id: 'trace', label: 'Traceability', shortLabel: 'Trace', icon: Network, countTone: 'emerald' },
  { id: 'versions', label: 'Versions', shortLabel: 'Versions', icon: History, countTone: 'emerald' },
  { id: 'radar', label: 'Tech Radar', shortLabel: 'Radar', icon: Sparkles, countTone: 'neutral' },
  { id: 'diagrams', label: 'Diagrams', shortLabel: 'Diagrams', icon: GitMerge, countTone: 'neutral' },
  // M5-G4 — 10th tab. Security Report surfaces deployment-relevant findings
  // (secrets, dependency vulnerabilities, posture) drawn from
  // `/architecture/security-reports`. The rose tone telegraphs risk.
  { id: 'security', label: 'Security Report', shortLabel: 'Security', icon: ShieldAlert, countTone: 'rose' },
];

const COUNT_TONE: Record<NonNullable<(typeof TABS)[number]['countTone']>, string> = {
  emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  neutral: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
};

const HEALTH = computeHealth();

function resolveSelected<T extends { id: string }>(
  items: ReadonlyArray<T>,
  preferredId: string | undefined,
): T | undefined {
  if (items.length === 0) return undefined;
  if (preferredId) {
    const match = items.find((i) => i.id === preferredId);
    if (match) return match;
  }
  return items[0];
}

function Pill({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-md)] border px-2.5 py-1 text-xs transition-colors duration-150 ease-out-soft',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        active
          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
      )}
    >
      {children}
    </button>
  );
}

function TabBar({
  active,
  onChange,
  counts,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
  counts: Record<TabId, number>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Architecture Center sections"
      className="inline-flex w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-1"
      data-testid="architecture-tabs"
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        const count = counts[t.id];
        const tone = t.countTone ?? 'neutral';
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(t.id)}
            data-testid={`tab-${t.id}`}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out-soft',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              isActive
                ? 'text-[var(--fg-primary)]'
                : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {isActive ? (
              <motion.span
                layoutId="architecture-tab-pill"
                className="absolute inset-0 rounded-[var(--radius-md)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]"
                transition={{ type: 'tween', duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                aria-hidden="true"
              />
            ) : null}
            <t.icon className="relative h-3.5 w-3.5" aria-hidden="true" />
            <span className="relative whitespace-nowrap">{t.label}</span>
            <span
              className={cn(
                'relative rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px]',
                COUNT_TONE[tone],
              )}
              aria-label={`${count} entries`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Breadcrumb({ tab, item }: { tab: TabId; item?: { label: string; id: string } }) {
  const tabLabel = TABS.find((t) => t.id === tab)?.label ?? tab;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1 text-xs text-[var(--fg-tertiary)]"
      data-testid="architecture-breadcrumb"
    >
      <span>Architecture</span>
      <ChevronRight className="h-3 w-3" aria-hidden="true" />
      <span>{tabLabel}</span>
      {item ? (
        <>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="font-mono text-[var(--fg-secondary)]">{item.label}</span>
        </>
      ) : null}
    </nav>
  );
}

// =============================================================================
// OVERVIEW TAB
// =============================================================================

function OverviewTab({
  adrs,
  risks,
  services,
  tasks,
  versions,
  activity,
}: {
  adrs: ReadonlyArray<ADRWithMeta>;
  risks: ReadonlyArray<typeof MOCK_RISK_REGISTERS[number]['risks'][number]>;
  services: ReadonlyArray<ApiService>;
  tasks: ReadonlyArray<TaskBreakdown>;
  versions: ReadonlyArray<ArchitectureVersion>;
  activity: ReadonlyArray<ArchitectureActivity>;
}) {
  const recentAdrs = [...adrs]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const topRisks = [...risks]
    .sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact)
    .slice(0, 3);

  // 3x3 mini heat-map (likelihood × impact, simplified).
  const heat = Array.from({ length: 3 }, (_, li) =>
    Array.from({ length: 3 }, (_, ii) =>
      risks.filter((r) => r.likelihood === li + 3 && r.impact === ii + 3).length,
    ),
  );

  const totalEndpoints = services.reduce((s, svc) => s + svc.endpointCount, 0);
  const documentedEndpoints = services.reduce((s, svc) => s + svc.documented, 0);
  const docPct = Math.round((documentedEndpoints / totalEndpoints) * 100);

  const taskProgress = (() => {
    const buckets = { done: 0, in_progress: 0, blocked: 0, todo: 0 };
    const walk = (n: typeof tasks[number]['tree']): void => {
      buckets[n.status]++;
      n.children.forEach(walk);
    };
    tasks.forEach((t) => walk(t.tree));
    return buckets;
  })();

  const trendFor = (delta: number): 'up' | 'down' | 'flat' =>
    delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';

  return (
    <div className="flex flex-col gap-4" data-testid="overview-tab">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KPI
          label="ADRs accepted"
          value={`${HEALTH.adrs}%`}
          sub={`${adrs.filter((a) => a.status === 'approved').length} of ${adrs.length} documented`}
          accent="indigo"
          spark={[2, 3, 4, 5, 6, 5, 6, 6, 6]}
        />
        <KPI
          label="APIs documented"
          value={`${HEALTH.apis}%`}
          sub={`${documentedEndpoints} endpoints across ${services.length} services`}
          accent="cyan"
          spark={[2, 4, 6, 8, 12, 18, 22, 28, 30]}
        />
        <KPI
          label="Tasks tracked"
          value={`${HEALTH.tasks}%`}
          sub={`${taskProgress.done} done · ${taskProgress.in_progress} active · ${taskProgress.blocked} blocked`}
          accent="emerald"
          spark={[1, 2, 4, 6, 8, 10, 12, 16, 18]}
        />
        <KPI
          label="Active risks"
          value={`${HEALTH.risks}%`}
          sub={`${risks.filter((r) => r.status !== 'closed').length} open or mitigating`}
          accent="rose"
          trend={trendFor(risks.filter((r) => r.likelihood * r.impact >= 12).length - 2)}
          spark={[1, 2, 1, 3, 4, 2, 3, 5, 4]}
        />
        <KPI
          label="Coverage"
          value={`${HEALTH.coverage}%`}
          sub="Req → Test traceability"
          accent="amber"
          spark={[10, 18, 25, 35, 42, 50, 58, 65, HEALTH.coverage]}
        />
      </div>

      {/* Row 1: Scorecard + Recent + Top risks */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr_1fr]">
        {/* Health scorecard */}
        <section
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
          data-testid="health-scorecard"
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Architecture Health Scorecard</h3>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">live</span>
          </header>
          <div className="grid grid-cols-[160px_1fr] items-center gap-4">
            <RadialGaugeCard
              title="Overall"
              value={HEALTH.overall}
              unit="composite"
              color={HEALTH.overall >= 70 ? 'var(--accent-emerald)' : HEALTH.overall >= 50 ? 'var(--accent-amber)' : 'var(--accent-rose)'}
              height={130}
              className="border-0 bg-transparent"
            />
            <ul className="flex flex-col gap-2 text-xs">
              {([
                ['ADRs', HEALTH.adrs],
                ['APIs', HEALTH.apis],
                ['Tasks', HEALTH.tasks],
                ['Risks', HEALTH.risks],
                ['Coverage', HEALTH.coverage],
              ] as const).map(([k, v]) => {
                const tone =
                  v >= 80 ? 'text-emerald-300' : v >= 60 ? 'text-amber-300' : 'text-rose-300';
                const dot =
                  v >= 80 ? 'bg-emerald-400' : v >= 60 ? 'bg-amber-400' : 'bg-rose-400';
                return (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[var(--fg-secondary)]">
                      <span aria-hidden="true" className={cn('inline-block h-1.5 w-1.5 rounded-full', dot)} />
                      {k}
                    </span>
                    <span className={cn('font-mono text-sm font-semibold', tone)}>{v}/100</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              toast.info('Opening detailed scorecard — wires to /v1/architecture/scorecard');
            }}
            className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] rounded"
          >
            View detailed scorecard →
          </a>
        </section>

        {/* Recent decisions */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Recent decisions</h3>
            <HistoryAlias className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
          </header>
          <ul className="flex flex-col gap-2" role="list">
            {recentAdrs.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => toast.info(`Open ADR-${String(a.number).padStart(3, '0')}`)}
                  className="group flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-transparent p-2 text-left transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--bg-inset)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                >
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                    ADR-{String(a.number).padStart(3, '0')}
                  </span>
                  <span className="line-clamp-2 flex-1 text-xs font-medium text-[var(--fg-primary)] group-hover:text-[var(--accent-primary)]">
                    {a.title}
                  </span>
                  <span
                    className={cn(
                      'rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] uppercase',
                      ADR_STATUS_TONE[a.status],
                    )}
                  >
                    {a.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Top risks with mini heat map */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Top risks</h3>
            <ShieldAlert className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
          </header>
          <ul className="flex flex-col gap-1.5" role="list">
            {topRisks.map((r) => {
              const score = r.likelihood * r.impact;
              const tone =
                score >= 16
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : score >= 9
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
              return (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2"
                >
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-xs font-medium text-[var(--fg-primary)]">{r.title}</p>
                    <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      L{r.likelihood}·I{r.impact} · {r.owner}
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px]', tone)}>
                    {score}
                  </span>
                </li>
              );
            })}
          </ul>
          {/* 3x3 heat */}
          <div className="mt-3">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
              Distribution
            </p>
            <div className="grid grid-cols-3 gap-0.5">
              {heat.flatMap((row, li) =>
                row.map((count, ii) => {
                  const max = Math.max(1, ...heat.flat());
                  const intensity = count / max;
                  const bg = count === 0
                    ? 'bg-[var(--bg-inset)]'
                    : intensity >= 0.66
                      ? 'bg-rose-500/40'
                      : intensity >= 0.33
                        ? 'bg-amber-500/30'
                        : 'bg-emerald-500/20';
                  return (
                    <div
                      key={`${li}-${ii}`}
                      className={cn('flex h-6 items-center justify-center rounded-[var(--radius-sm)] font-mono text-[10px]', bg)}
                      title={`L${li + 3} × I${ii + 3}: ${count} risk${count === 1 ? '' : 's'}`}
                    >
                      {count}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Row 2: API coverage + task completion */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">API coverage</h3>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {documentedEndpoints}/{totalEndpoints} documented
            </span>
          </header>
          <div className="flex items-center gap-4">
            <Donut pct={docPct} total={totalEndpoints} label="endpoints" />
            <div className="flex-1 space-y-1.5">
              {services.map((s) => {
                const pct = Math.round((s.documented / s.endpointCount) * 100);
                const tone =
                  pct >= 90
                    ? 'bg-emerald-500'
                    : pct >= 70
                      ? 'bg-amber-500'
                      : 'bg-rose-500';
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="w-28 truncate text-[11px] text-[var(--fg-secondary)]">{s.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-inset)]">
                      <div
                        className={cn('h-full rounded-full transition-all duration-300', tone)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-[10px] text-[var(--fg-tertiary)]">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Task completion</h3>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {taskProgress.done + taskProgress.in_progress + taskProgress.blocked + taskProgress.todo} total
            </span>
          </header>
          <div className="flex items-center gap-4">
            <StackedBar
              done={taskProgress.done}
              active={taskProgress.in_progress}
              blocked={taskProgress.blocked}
              todo={taskProgress.todo}
            />
            <ul className="flex-1 space-y-1.5 text-xs">
              <LegendDot color="bg-emerald-500" label="Done" count={taskProgress.done} />
              <LegendDot color="bg-cyan-500" label="In progress" count={taskProgress.in_progress} />
              <LegendDot color="bg-amber-500" label="Blocked" count={taskProgress.blocked} />
              <LegendDot color="bg-slate-500" label="Not started" count={taskProgress.todo} />
            </ul>
          </div>
        </section>
      </div>

      {/* Row 3: Decision velocity */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Decision velocity</h3>
            <p className="text-xs text-[var(--fg-tertiary)]">ADRs accepted per week — last 12 weeks</p>
          </div>
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
            peak: {Math.max(...MOCK_DECISION_VELOCITY)} in week {MOCK_DECISION_VELOCITY.indexOf(Math.max(...MOCK_DECISION_VELOCITY)) + 1}
          </span>
        </header>
        <div className="h-32">
          <Sparkline data={MOCK_DECISION_VELOCITY} color="var(--accent-primary)" height={120} />
        </div>
      </section>

      {/* Row 4: Activity feed */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Activity feed</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast.info('Opens full activity feed')}
            className="h-7 px-2 text-xs text-[var(--accent-primary)]"
          >
            View full activity →
          </Button>
        </header>
        <ol className="flex flex-col gap-1.5" role="list">
          {activity.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-transparent px-2 py-1.5 text-xs hover:border-[var(--border-subtle)] hover:bg-[var(--bg-inset)]"
            >
              <ActivityTone type={a.type} />
              <span className="text-[var(--fg-secondary)]">
                <span className="font-mono text-[var(--fg-tertiary)]">{a.actor}</span>{' '}
                <span className="text-[var(--fg-primary)]">{a.verb}</span>{' '}
                <span className="font-medium text-[var(--fg-primary)]">{a.subject}</span>
              </span>
              <time className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">
                {new Date(a.at).toLocaleDateString()}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  spark,
  trend,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  spark: ReadonlyArray<number>;
  trend?: 'up' | 'down' | 'flat';
  accent: 'indigo' | 'cyan' | 'emerald' | 'rose' | 'amber';
}) {
  const accentVar = `var(--accent-${accent})`;
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Activity;
  const trendTone =
    trend === 'up' ? 'text-emerald-300' : trend === 'down' ? 'text-rose-300' : 'text-slate-400';

  return (
    <div className="flex h-[120px] flex-col justify-between rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div>
        <p className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          <span>{label}</span>
          {trend ? <TrendIcon className={cn('h-3 w-3', trendTone)} aria-hidden="true" /> : null}
        </p>
        <p className="mt-1 text-2xl font-bold" style={{ color: accentVar }}>
          {value}
        </p>
        <p className="line-clamp-1 text-[10px] text-[var(--fg-tertiary)]">{sub}</p>
      </div>
      <div className="-mx-1 -mb-1">
        <Sparkline data={spark} color={accentVar} height={28} />
      </div>
    </div>
  );
}

function Donut({ pct, total, label }: { pct: number; total: number; label: string }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative h-24 w-24">
      <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
        <circle cx={50} cy={50} r={r} fill="none" stroke="var(--bg-inset)" strokeWidth={8} />
        <circle
          cx={50}
          cy={50}
          r={r}
          fill="none"
          stroke="var(--accent-primary)"
          strokeWidth={8}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-[var(--fg-primary)]">{total}</span>
        <span className="text-[8px] uppercase text-[var(--fg-tertiary)]">{label}</span>
      </div>
    </div>
  );
}

function StackedBar({
  done,
  active,
  blocked,
  todo,
}: {
  done: number;
  active: number;
  blocked: number;
  todo: number;
}) {
  const total = done + active + blocked + todo || 1;
  const rows = [
    { label: 'Done', count: done, color: 'bg-emerald-500' },
    { label: 'Active', count: active, color: 'bg-cyan-500' },
    { label: 'Blocked', count: blocked, color: 'bg-amber-500' },
    { label: 'Todo', count: todo, color: 'bg-slate-600' },
  ];
  return (
    <div className="flex w-32 flex-col gap-1">
      <div className="flex h-32 w-full flex-col-reverse overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)]">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(r.color, 'flex items-center justify-center font-mono text-[9px] text-white')}
            style={{ flex: `${Math.max(r.count, 0.5)}` }}
            aria-label={`${r.label}: ${r.count}`}
          >
            {r.count > 0 ? r.count : ''}
          </div>
        ))}
      </div>
      <p className="text-center font-mono text-[10px] text-[var(--fg-tertiary)]">{total} total</p>
    </div>
  );
}

function LegendDot({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <li className="flex items-center justify-between gap-2 text-[var(--fg-secondary)]">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn('inline-block h-2 w-2 rounded-full', color)} />
        {label}
      </span>
      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{count}</span>
    </li>
  );
}

function ActivityTone({ type }: { type: ArchitectureActivity['type'] }) {
  const map: Record<ArchitectureActivity['type'], { icon: React.ReactNode; tone: string }> = {
    adr: { icon: <FileText className="h-3 w-3" />, tone: 'text-indigo-300' },
    api: { icon: <FileCode2 className="h-3 w-3" />, tone: 'text-cyan-300' },
    task: { icon: <ListTree className="h-3 w-3" />, tone: 'text-emerald-300' },
    risk: { icon: <ShieldAlert className="h-3 w-3" />, tone: 'text-rose-300' },
    version: { icon: <History className="h-3 w-3" />, tone: 'text-amber-300' },
    diagram: { icon: <Network className="h-3 w-3" />, tone: 'text-violet-300' },
  };
  const m = map[type];
  return <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-inset)]', m.tone)}>{m.icon}</span>;
}

// =============================================================================
// ADR MASTER-DETAIL
// =============================================================================

const ADR_STATUS_FILTERS: ReadonlyArray<{ id: 'all' | ADR['status']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'proposed', label: 'In Review' },
  { id: 'approved', label: 'Accepted' },
  { id: 'superseded', label: 'Deprecated' },
];

function ADRMasterDetail({
  adrs,
  selectedId,
  onSelect,
}: {
  adrs: ReadonlyArray<ADRWithMeta>;
  selectedId: string | undefined;
  onSelect: (adr: ADRWithMeta) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | ADR['status']>('all');
  const [componentFilter, setComponentFilter] = React.useState<'all' | ADRWithMeta['component']>('all');
  const [sort, setSort] = React.useState<'date' | 'status' | 'component' | 'impact'>('date');
  const [editorTab, setEditorTab] = React.useState<'content' | 'impact' | 'discussion' | 'versions' | 'reviews'>('content');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = adrs.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (componentFilter !== 'all' && a.component !== componentFilter) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.owner.toLowerCase().includes(q) ||
        `adr-${String(a.number).padStart(3, '0')}`.includes(q)
      );
    });
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'date':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'status':
          return a.status.localeCompare(b.status);
        case 'component':
          return a.component.localeCompare(b.component);
        case 'impact':
          return b.impact - a.impact;
      }
    });
  }, [adrs, query, statusFilter, componentFilter, sort]);

  // Bug fix: use the shared resolver. The list and the count badge can
  // never disagree now — both read from the same `adrs` array.
  const selected = resolveSelected(adrs, selectedId);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]" data-testid="adr-master-detail">
      <aside
        className="flex max-h-[760px] flex-col gap-3 lg:sticky lg:top-4 lg:self-start"
        aria-label="ADR list"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ADRs..."
            aria-label="Search ADRs"
            data-testid="adr-search"
            className="pl-8 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ADR_STATUS_FILTERS.map((f) => (
            <Pill
              key={f.id}
              active={statusFilter === f.id}
              onClick={() => setStatusFilter(f.id)}
              testId={`adr-filter-status-${f.id}`}
            >
              {f.label}
            </Pill>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ADR_COMPONENTS.map((c) => (
            <Pill
              key={c.id}
              active={componentFilter === c.id}
              onClick={() => setComponentFilter(c.id)}
              testId={`adr-filter-component-${c.id}`}
            >
              {c.label}
            </Pill>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">Sort</p>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            data-testid="adr-sort"
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1 text-[10px] text-[var(--fg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            aria-label="Sort ADRs"
          >
            <option value="date">By date</option>
            <option value="status">By status</option>
            <option value="component">By component</option>
            <option value="impact">By impact</option>
          </select>
        </div>

        <ul
          role="list"
          className="thin-scrollbar -mr-2 flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-2"
          data-testid="adr-list"
        >
          {filtered.length === 0 ? (
            <li>
              <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-3 text-center text-[10px] text-[var(--fg-muted)]">
                No ADRs match — try a different search.
              </p>
            </li>
          ) : (
            filtered.map((a) => {
              const isActive = selected?.id === a.id;
              const impactTone =
                a.impact >= 8
                  ? 'bg-rose-500/15 text-rose-300'
                  : a.impact >= 5
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-emerald-500/15 text-emerald-300';
              const componentDef = ADR_COMPONENTS.find((c) => c.id === a.component);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(a)}
                    aria-pressed={isActive}
                    data-testid="adr-list-item"
                    data-adr-id={a.id}
                    className={cn(
                      'relative flex w-full flex-col gap-1.5 rounded-[var(--radius-md)] border p-2.5 text-left text-sm transition-colors duration-150 ease-out-soft',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                      isActive
                        ? 'border-[var(--accent-primary)]/50 bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
                    )}
                  >
                    {isActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-[var(--accent-primary)]"
                      />
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                        ADR-{String(a.number).padStart(3, '0')}
                      </span>
                      <span
                        className={cn(
                          'rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px] uppercase',
                          ADR_STATUS_TONE[a.status],
                        )}
                      >
                        {a.status}
                      </span>
                    </div>
                    <span className="line-clamp-2 text-sm font-medium leading-tight">{a.title}</span>
                    <div className="flex items-center justify-between gap-1.5 text-[10px] text-[var(--fg-tertiary)]">
                      <span className="flex items-center gap-1.5">
                        <span className={cn('rounded-[var(--radius-sm)] border px-1 py-0.5 font-mono text-[9px]', componentDef?.tone)}>
                          {componentDef?.label}
                        </span>
                        <span className={cn('inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[9px]', impactTone)}>
                          <Zap className="h-2.5 w-2.5" aria-hidden="true" /> {a.impact}
                        </span>
                      </span>
                      <span>{new Date(a.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <Button
          size="sm"
          onClick={() => toast.info('Open ADR template picker')}
          data-testid="adr-create"
          className="bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          New ADR
        </Button>
      </aside>

      <div className="min-w-0">
        {selected ? (
          <ADREditor
            adr={selected}
            editorTab={editorTab}
            setEditorTab={setEditorTab}
          />
        ) : (
          // Defensive: this only fires when adrs.length === 0
          // because resolveSelected returns undefined only in that case.
          <EmptyState
            illustration={<FileText size={40} strokeWidth={1.5} />}
            title="No architecture decisions recorded"
            description="Capture your first decision so the team can review and approve it before code lands."
            primaryAction={{
              label: 'Create ADR',
              onClick: () => toast.info('Open ADR template dialog'),
              icon: <Plus className="h-4 w-4" aria-hidden="true" />,
            }}
            secondaryAction={{
              label: 'Read the ADR template',
              onClick: () => toast.info('Open ADR template docs'),
              icon: <HistoryIcon className="h-4 w-4" aria-hidden="true" />,
            }}
          />
        )}
      </div>
    </div>
  );
}

function ADREditor({
  adr,
  editorTab,
  setEditorTab,
}: {
  adr: ADRWithMeta;
  editorTab: 'content' | 'impact' | 'discussion' | 'versions' | 'reviews';
  setEditorTab: (t: 'content' | 'impact' | 'discussion' | 'versions' | 'reviews') => void;
}) {
  const componentDef = ADR_COMPONENTS.find((c) => c.id === adr.component);
  const tabs: ReadonlyArray<{ id: typeof editorTab; label: string; icon: React.ReactNode }> = [
    { id: 'content', label: 'Content', icon: <Type className="h-3 w-3" /> },
    { id: 'impact', label: 'Impact', icon: <Workflow className="h-3 w-3" /> },
    { id: 'discussion', label: 'Discussion', icon: <MessageSquare className="h-3 w-3" /> },
    { id: 'versions', label: 'Versions', icon: <HistoryAlias className="h-3 w-3" /> },
    { id: 'reviews', label: 'Reviews', icon: <ThumbsUp className="h-3 w-3" /> },
  ];
  return (
    <article
      className="relative flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
      data-testid="adr-detail"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--fg-tertiary)]">
              ADR-{String(adr.number).padStart(3, '0')}
            </span>
            <ApprovalStatusBadge status={adr.status} />
            <span
              className={cn(
                'rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px]',
                componentDef?.tone,
              )}
            >
              {componentDef?.label}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
            <Zap className="h-3 w-3" aria-hidden="true" /> impact {adr.impact}/10
          </span>
        </div>
        <h2 className="text-2xl font-bold leading-tight text-[var(--fg-primary)]">{adr.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-tertiary)]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-primary)]">
            {adr.authorInitials}
          </span>
          <span>{adr.owner}</span>
          <span>·</span>
          <span>Updated {new Date(adr.updatedAt).toLocaleDateString()}</span>
          <span>·</span>
          <span>Last review: 14 days ago</span>
        </div>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={editorTab === t.id}
            onClick={() => setEditorTab(t.id)}
            data-testid={`adr-editor-tab-${t.id}`}
            className={cn(
              'flex items-center gap-1.5 rounded-t-[var(--radius-md)] border-b-2 px-3 py-2 text-xs transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              editorTab === t.id
                ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                : 'border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[260px]">
        {editorTab === 'content' ? (
          <ADRContentTab adr={adr} />
        ) : editorTab === 'impact' ? (
          <ADRImpactTab adr={adr} />
        ) : editorTab === 'discussion' ? (
          <ADRDiscussionTab />
        ) : editorTab === 'versions' ? (
          <ADRVersionsTab adr={adr} />
        ) : (
          <ADRReviewsTab adr={adr} />
        )}
      </div>

      <div className="-mx-6 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 pt-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--fg-tertiary)]">
          <span className="font-medium uppercase tracking-wide">Linked</span>
          {adr.linkedTaskCount > 0 ? (
            <button onClick={() => toast.info('Open linked tasks tab')} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
              {adr.linkedTaskCount} tasks
            </button>
          ) : null}
          {adr.linkedRiskCount > 0 ? (
            <button onClick={() => toast.info('Open linked risks tab')} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
              {adr.linkedRiskCount} risks
            </button>
          ) : null}
          {adr.linkedApiCount > 0 ? (
            <button onClick={() => toast.info('Open linked APIs tab')} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
              {adr.linkedApiCount} APIs
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => toast.info('Edit ADR')} data-testid="adr-action-edit">
            <Pencil className="mr-1.5 h-3 w-3" aria-hidden="true" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.error(`Supersede ADR-${adr.number}`)} data-testid="adr-action-supersede">
            <XCircle className="mr-1.5 h-3 w-3" aria-hidden="true" />
            Supersede
          </Button>
          <Button
            size="sm"
            onClick={() => toast.success(`Marked ADR-${adr.number} accepted`)}
            disabled={adr.status === 'approved' || adr.status === 'published'}
            data-testid="adr-action-accept"
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            <CheckCircle2 className="mr-1.5 h-3 w-3" aria-hidden="true" />
            Mark accepted
          </Button>
        </div>
      </div>
    </article>
  );
}

function ADRContentTab({ adr }: { adr: ADRWithMeta }) {
  // M15-1 Gap 3 — wire "Request review" to useRequestApproval so the
  // POST /architecture/approvals call hits the real backend (and
  // lands in audit_events via the workflow's @audit decorator).
  const requestApproval = useRequestApproval();
  const projectId = process.env.NEXT_PUBLIC_FORGE_DEMO_PROJECT_ID ?? '22222222-2222-2222-2222-222222222222';
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <ADRViewer adr={adr} className="border-0 bg-transparent p-0" />
      </div>
      <aside className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          ADR template
        </p>
        <ul className="flex flex-col gap-1 text-xs text-[var(--fg-secondary)]">
          <li>· Context — forces</li>
          <li>· Decision — what we chose</li>
          <li>· Consequences — good and bad</li>
          <li>· Alternatives considered</li>
        </ul>
        <hr className="border-[var(--border-subtle)]" />
        <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          Word count: {adr.markdown.split(/\s+/).length}
        </p>
        <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          Last saved: just now
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={requestApproval.isPending}
          onClick={() =>
            requestApproval.mutate({
              project_id: projectId,
              artifact_type: 'adr',
              artifact_id: adr.id,
            })
          }
          className="text-xs"
          data-testid="adr-request-review"
        >
          <Send className="mr-1.5 h-3 w-3" aria-hidden="true" />
          {requestApproval.isPending ? 'Requesting…' : 'Request review'}
        </Button>
      </aside>
    </div>
  );
}

function ADRImpactTab({ adr }: { adr: ADRWithMeta }) {
  const backrefs = MOCK_ADRS_WITH_META.filter((a) => a.id !== adr.id).slice(0, 2);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ImpactRow icon={<ListTree className="h-3.5 w-3.5" />} label="Linked tasks" count={adr.linkedTaskCount} kind="task" />
      <ImpactRow icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Linked risks" count={adr.linkedRiskCount} kind="risk" />
      <ImpactRow icon={<FileCode2 className="h-3.5 w-3.5" />} label="Linked APIs" count={adr.linkedApiCount} kind="api" />
      <ImpactRow icon={<Workflow className="h-3.5 w-3.5" />} label="Linked runs" count={Math.max(1, Math.floor(adr.impact / 3))} kind="run" />
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 sm:col-span-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          Backlinks
        </p>
        <ul className="flex flex-wrap gap-1">
          {backrefs.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => toast.info(`Open ADR-${a.number}`)}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                ADR-{String(a.number).padStart(3, '0')} · {a.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 sm:col-span-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          Codebase coverage
        </p>
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">
          {Math.round((adr.impact / 10) * 42)} files reference this decision · search hits in{' '}
          <span className="font-mono text-[var(--fg-tertiary)]">backend/</span>,{' '}
          <span className="font-mono text-[var(--fg-tertiary)]">infra/</span>,{' '}
          <span className="font-mono text-[var(--fg-tertiary)]">docs/</span>
        </p>
      </div>
    </div>
  );
}

function ImpactRow({
  icon,
  label,
  count,
  kind,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  kind: string;
}) {
  return (
    <button
      type="button"
      onClick={() => toast.info(`Jump to ${label}`)}
      data-testid={`adr-impact-${kind}`}
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-left transition-colors hover:border-[var(--border-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
    >
      <span className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
        <span className="text-[var(--fg-tertiary)]">{icon}</span>
        {label}
      </span>
      <span className="rounded bg-[var(--bg-base)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-primary)]">
        {count}
      </span>
    </button>
  );
}

function ADRDiscussionTab() {
  const [draft, setDraft] = React.useState('');
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" role="list">
        <Comment name="priya.r" body="Should we add a fallback to a cheaper model on budget exhaustion?" time="2 days ago" />
        <Comment name="kenji.t" body="Looks good — what does the timeline look like for the Anthropic adapter?" time="yesterday" />
        <Comment name="dana.s" body="Resolved: adding fallback config in the next sprint." time="3 hours ago" resolved />
      </ul>
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment — use @ to mention"
          rows={3}
          className="w-full resize-none rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-[var(--fg-tertiary)]">Markdown supported · @mentions notify</span>
          <Button size="sm" onClick={() => { if (draft.trim()) { toast.success('Comment posted'); setDraft(''); } }} className="h-7 text-xs">
            <Send className="mr-1 h-3 w-3" aria-hidden="true" />
            Post
          </Button>
        </div>
      </div>
    </div>
  );
}

function Comment({ name, body, time, resolved }: { name: string; body: string; time: string; resolved?: boolean }) {
  return (
    <li className={cn('rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3', resolved && 'opacity-60')}>
      <header className="mb-1 flex items-center gap-2 text-[10px]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-base)] font-mono text-[var(--fg-primary)]">
          {name[0]?.toUpperCase()}
        </span>
        <span className="font-mono text-[var(--fg-secondary)]">@{name}</span>
        <span className="text-[var(--fg-tertiary)]">· {time}</span>
        {resolved ? <span className="ml-auto rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300">resolved</span> : null}
      </header>
      <p className="text-xs text-[var(--fg-primary)]">{body}</p>
    </li>
  );
}

function ADRVersionsTab({ adr }: { adr: ADRWithMeta }) {
  return (
    <ol className="flex flex-col gap-2" role="list">
      {[1, 2, 3].map((v) => (
        <li key={v} className="flex items-start justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs">
          <div>
            <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">v{v}.0 · {v * 7} days ago</p>
            <p className="text-[var(--fg-primary)]">{v === 1 ? 'Initial draft' : `Revision ${v}: clarified consequences`}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => toast.info('Open diff viewer')} className="h-6 px-2 text-[10px]">
              View diff
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toast.success('Restored')} className="h-6 px-2 text-[10px]">
              Restore
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ADRReviewsTab({ adr }: { adr: ADRWithMeta }) {
  // M15-1 Gap 3 — read live approvals filtered to this ADR and wire
  // approve/deny to useDecideApproval. Each decide() lands in
  // audit_events via the workflow's audit_service.record call (the
  // R6 fix in Gap 4).
  const approvalsQuery = useApprovals();
  const decideApproval = useDecideApproval();
  const liveRows = (approvalsQuery.data?.items ?? []).filter(
    (a) => a.artifact_type === 'adr' && a.artifact_id === adr.id,
  );
  // Fall back to a single empty-state row when no approvals exist yet
  // so the UI doesn't go blank — R15 (empty states explain).
  const rows = liveRows.length > 0
    ? liveRows
    : [{ id: 'empty', artifact_type: 'adr' as const, artifact_id: adr.id, status: 'pending' as const }];
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const tone =
          r.status === 'approved'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : r.status === 'denied'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : 'border-slate-500/30 bg-slate-500/10 text-slate-300';
        return (
          <div
            key={r.id}
            data-testid={`adr-review-row-${r.id}`}
            className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
          >
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-base)] font-mono text-[10px] text-[var(--fg-primary)]">
              {r.id === 'empty' ? '?' : r.id.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="font-mono text-[var(--fg-secondary)]">
                  {r.id === 'empty' ? 'No review requested yet' : `approval-${r.id.slice(0, 8)}`}
                </span>
                <span className={cn('ml-2 rounded border px-1.5 py-0.5 font-mono text-[10px]', tone)}>
                  {r.status}
                </span>
              </p>
              {r.id !== 'empty' ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decideApproval.isPending || r.status === 'approved' || r.status === 'denied'}
                    onClick={() =>
                      decideApproval.mutate({ id: r.id, decision: 'approve', reason: '' })
                    }
                    data-testid={`adr-review-approve-${r.id}`}
                    className="text-[10px]"
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decideApproval.isPending || r.status === 'approved' || r.status === 'denied'}
                    onClick={() =>
                      decideApproval.mutate({ id: r.id, decision: 'deny', reason: '' })
                    }
                    data-testid={`adr-review-deny-${r.id}`}
                    className="text-[10px]"
                  >
                    Deny
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// API CONTRACTS MASTER-DETAIL
// =============================================================================

function APIContractMasterDetail({
  services,
  selectedId,
  onSelect,
}: {
  services: ReadonlyArray<ApiService>;
  selectedId: string | undefined;
  onSelect: (s: ApiService) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'documented' | 'undocumented' | 'out_of_sync'>('all');
  const [serviceTab, setServiceTab] = React.useState<'endpoints' | 'schemas' | 'consumers' | 'producers' | 'versions' | 'mock'>('endpoints');

  const filtered = services.filter((s) => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (!query) return true;
    return s.name.toLowerCase().includes(query.toLowerCase());
  });

  const selected = resolveSelected(services, selectedId);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]" data-testid="contracts-master-detail">
      <aside className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search services..."
            aria-label="Search services"
            className="pl-8 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'documented', 'undocumented', 'out_of_sync'] as const).map((f) => (
            <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'out_of_sync' ? 'Out of sync' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Pill>
          ))}
        </div>

        <ul role="list" className="flex max-h-[520px] flex-col gap-1.5 overflow-y-auto thin-scrollbar">
          {filtered.map((s) => {
            const isActive = selected?.id === s.id;
            const tone =
              s.status === 'documented'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : s.status === 'out_of_sync'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300';
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-pressed={isActive}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-[var(--radius-md)] border p-2.5 text-left text-sm transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                    isActive
                      ? 'border-[var(--accent-primary)]/50 bg-[rgba(99,102,241,0.10)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[rgba(255,255,255,0.04)]',
                  )}
                >
                  <Layers className="mt-0.5 h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[var(--fg-primary)]">{s.name}</p>
                    <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      {s.endpointCount} endpoints · {s.version}
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase', tone)}>
                    {s.status.replace('_', ' ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0">
        {selected ? (
          <ServiceDetail service={selected} tab={serviceTab} setTab={setServiceTab} />
        ) : (
          <EmptyState
            illustration={<FileCode2 size={40} strokeWidth={1.5} />}
            title="No contracts published yet"
            description="Sync a service contract so dependent teams can build against the agreed interface."
            primaryAction={{
              label: 'Sync from repo',
              onClick: () => toast.info('Open repo picker'),
              icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
            }}
          />
        )}
      </div>
    </div>
  );
}

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  POST: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  PUT: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  PATCH: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  DELETE: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

function ServiceDetail({
  service,
  tab,
  setTab,
}: {
  service: ApiService;
  tab: 'endpoints' | 'schemas' | 'consumers' | 'producers' | 'versions' | 'mock';
  setTab: (t: typeof tab) => void;
}) {
  const tabs: ReadonlyArray<{ id: typeof tab; label: string }> = [
    { id: 'endpoints', label: 'Endpoints' },
    { id: 'schemas', label: 'Schemas' },
    { id: 'consumers', label: 'Consumers' },
    { id: 'producers', label: 'Producers' },
    { id: 'versions', label: 'Versions' },
    { id: 'mock', label: 'Mock' },
  ];
  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold leading-tight text-[var(--fg-primary)]">{service.name}</h3>
          <p className="font-mono text-xs text-[var(--fg-tertiary)]">
            {service.version} · updated {new Date(service.lastUpdated).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => toast.info('Open OpenAPI spec')} className="text-xs">
            <Eye className="mr-1 h-3 w-3" aria-hidden="true" />
            OpenAPI spec
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.info('Sync from repo')} className="text-xs">
            <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
            Sync from repo
          </Button>
          <Button size="sm" onClick={() => toast.success('Sandbox run queued')} className="bg-[var(--accent-primary)] text-xs text-white hover:opacity-90">
            <Play className="mr-1 h-3 w-3" aria-hidden="true" />
            Run in sandbox
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-5">
        <KPIInline label="Total endpoints" value={service.endpointCount} />
        <KPIInline label="Documented %" value={`${Math.round((service.documented / service.endpointCount) * 100)}%`} />
        <KPIInline label="Avg response" value={`${service.avgResponseMs}ms`} />
        <KPIInline label="Error rate" value={`${(service.errorRate * 100).toFixed(2)}%`} />
        <KPIInline label="Breaking since last" value={service.breakingSinceLast} tone={service.breakingSinceLast > 0 ? 'amber' : 'emerald'} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            data-testid={`service-tab-${t.id}`}
            className={cn(
              'rounded-t-[var(--radius-md)] border-b-2 px-3 py-2 text-xs transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              tab === t.id
                ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                : 'border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[280px]">
        {tab === 'endpoints' ? <EndpointsTable service={service} /> : null}
        {tab === 'schemas' ? <SchemasPanel service={service} /> : null}
        {tab === 'consumers' ? <ConsumersPanel service={service} /> : null}
        {tab === 'producers' ? <ProducersPanel service={service} /> : null}
        {tab === 'versions' ? <ServiceVersionsPanel service={service} /> : null}
        {tab === 'mock' ? <MockPanel service={service} /> : null}
      </div>
    </article>
  );
}

function KPIInline({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'emerald' | 'amber' | 'rose' }) {
  const t =
    tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : tone === 'rose' ? 'text-rose-300' : 'text-[var(--fg-primary)]';
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold', t)}>{value}</p>
    </div>
  );
}

function EndpointsTable({ service }: { service: ApiService }) {
  const [tryIt, setTryIt] = React.useState<string | null>(null);
  const ep = service.endpoints.find((e) => e.id === tryIt);
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        <table className="w-full min-w-[600px] text-xs">
          <thead className="bg-[var(--bg-inset)] text-[var(--fg-tertiary)]">
            <tr>
              <th className="px-2 py-2 text-left font-medium uppercase tracking-wide">Method</th>
              <th className="px-2 py-2 text-left font-medium uppercase tracking-wide">Path</th>
              <th className="px-2 py-2 text-left font-medium uppercase tracking-wide">Description</th>
              <th className="px-2 py-2 text-left font-medium uppercase tracking-wide">Auth</th>
              <th className="px-2 py-2 text-left font-medium uppercase tracking-wide">Status</th>
              <th className="px-2 py-2 text-right font-medium uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {service.endpoints.map((e) => (
              <tr
                key={e.id}
                data-testid={`endpoint-${e.id}`}
                className="border-t border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-inset)]"
              >
                <td className="px-2 py-1.5 align-top">
                  <span className={cn('inline-block rounded border px-1.5 py-0.5 font-mono text-[10px]', METHOD_TONE[e.method] ?? 'border-slate-500/30')}>
                    {e.method}
                  </span>
                </td>
                <td className="px-2 py-1.5 align-top font-mono text-[11px] text-[var(--fg-primary)]">{e.path}</td>
                <td className="px-2 py-1.5 align-top text-[var(--fg-secondary)]">{e.description}</td>
                <td className="px-2 py-1.5 align-top font-mono text-[10px] text-[var(--fg-tertiary)]">{e.auth}</td>
                <td className="px-2 py-1.5 align-top font-mono text-[10px]">
                  <span className={cn(
                    'rounded px-1 py-0.5',
                    e.status.startsWith('2') ? 'bg-emerald-500/10 text-emerald-300' : e.status.startsWith('4') ? 'bg-amber-500/10 text-amber-300' : 'bg-rose-500/10 text-rose-300',
                  )}>
                    {e.status}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => setTryIt(e.id === tryIt ? null : e.id)}
                    data-testid={`tryit-${e.id}`}
                    className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    {e.id === tryIt ? 'Close' : 'Try it'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs">
        {ep ? (
          <>
            <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {ep.method} {ep.path}
            </p>
            <p className="mt-1 text-[var(--fg-primary)]">{ep.description}</p>
            <hr className="my-2 border-[var(--border-subtle)]" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">Request</p>
            <pre className="mt-1 overflow-x-auto rounded bg-[var(--bg-base)] p-2 font-mono text-[10px] text-[var(--fg-secondary)]">{`{\n  "model": "gpt-4o",\n  "messages": []\n}`}</pre>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">Response</p>
            <pre className="mt-1 overflow-x-auto rounded bg-[var(--bg-base)] p-2 font-mono text-[10px] text-[var(--fg-secondary)]">{`HTTP ${ep.status}\n{\n  "id": "chatcmpl-...",\n  "choices": []\n}`}</pre>
            <Button size="sm" onClick={() => toast.success('Sent — see response panel')} className="mt-2 w-full text-xs">
              <Send className="mr-1 h-3 w-3" aria-hidden="true" /> Send request
            </Button>
          </>
        ) : (
          <p className="text-[var(--fg-tertiary)]">Select an endpoint to try it.</p>
        )}
      </aside>
    </div>
  );
}

function SchemasPanel({ service }: { service: ApiService }) {
  const schemas = Array.from(new Set(service.endpoints.flatMap((e) => [e.requestSchema, e.responseSchema]).filter(Boolean))) as string[];
  return (
    <div className="flex flex-col gap-2">
      {schemas.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--border-subtle)] p-4 text-center text-xs text-[var(--fg-muted)]">
          No schemas defined yet.
        </p>
      ) : (
        schemas.map((s) => (
          <div key={s} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs">
            <header className="flex items-center justify-between">
              <span className="font-mono font-semibold text-[var(--fg-primary)]">{s}</span>
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                used by {service.endpoints.filter((e) => e.requestSchema === s || e.responseSchema === s).length} endpoints
              </span>
            </header>
            <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-base)] p-2 font-mono text-[10px] text-[var(--fg-secondary)]">
{`{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "created_at": { "type": "string", "format": "date-time" }
  }
}`}
            </pre>
          </div>
        ))
      )}
    </div>
  );
}

function ConsumersPanel({ service }: { service: ApiService }) {
  // Synthesize consumer rows from the service id.
  const consumers = ['dashboard', 'cli', 'github-bot', 'orchestrator', 'knowledge-graph'].slice(0, 3);
  return (
    <ul className="flex flex-col gap-1" role="list">
      {consumers.map((c, i) => (
        <li key={c} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs">
          <div>
            <p className="font-mono text-[var(--fg-primary)]">{c}</p>
            <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {1000 - i * 137} calls/day · last {i + 1}m ago
            </p>
          </div>
          <span className={cn('rounded px-2 py-0.5 font-mono text-[10px]', i === 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-cyan-500/10 text-cyan-300')}>
            {i === 0 ? 'healthy' : 'ok'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProducersPanel({ service }: { service: ApiService }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs text-[var(--fg-secondary)]">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
        Implementation status
      </p>
      <ul className="space-y-1">
        {service.endpoints.map((e) => (
          <li key={e.id} className="flex items-center justify-between">
            <span className="font-mono text-[11px]">{e.method} {e.path}</span>
            <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px]',
              e.status.startsWith('2') ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300',
            )}>
              {e.status.startsWith('2') ? 'implemented' : 'partial'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ServiceVersionsPanel({ service }: { service: ApiService }) {
  return (
    <ul className="flex flex-col gap-1" role="list">
      {[service.version, 'v1.3.0', 'v1.2.1', 'v1.0.0'].map((v, i) => (
        <li key={v} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs">
          <div>
            <p className="font-mono font-semibold text-[var(--fg-primary)]">{v}</p>
            <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {i * 30 + 15} days ago · {service.endpoints.length - i * 2} endpoints
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => toast.info('Diff between versions')}>
              Diff
            </Button>
            {i === 0 ? <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">current</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MockPanel({ service }: { service: ApiService }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs">
      <p className="text-[var(--fg-secondary)]">
        Spin up a mock server from the OpenAPI spec. Useful for parallel frontend development and contract tests.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => toast.success(`Mock server started on :4010`)} className="bg-[var(--accent-primary)] text-xs text-white hover:opacity-90">
          <Play className="mr-1 h-3 w-3" aria-hidden="true" /> Start mock server
        </Button>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">http://localhost:4010{service.openapiUrl.replace('/specs/', '/')}</span>
      </div>
      <pre className="overflow-x-auto rounded bg-[var(--bg-base)] p-2 font-mono text-[10px] text-[var(--fg-secondary)]">
{`# Example call
curl http://localhost:4010/v1/models \\
  -H "Authorization: Bearer demo"`}
      </pre>
    </div>
  );
}

// =============================================================================
// TASK BREAKDOWNS TAB
// =============================================================================

function TaskBreakdownMasterDetail({
  breakdowns,
  selectedId,
  onSelect,
  onCreateFromADR,
  firstAdr,
}: {
  breakdowns: ReadonlyArray<TaskBreakdown>;
  selectedId: string | undefined;
  onSelect: (b: TaskBreakdown) => void;
  // M15-1 Gap 2 — handler that fires useCreateTaskBreakdown.mutate
  // with source_type='adr' for the given ADR id. The page owns the
  // mutation; the button below passes the ADR id (UUID) up.
  onCreateFromADR?: (adrId: string) => void;
  // First ADR (id + display label) so the Generate-from-ADR button
  // can both name its target AND pass a valid UUID to the mutation.
  firstAdr?: { id: string; label: string };
}) {
  const [view, setView] = React.useState<'tree' | 'kanban' | 'timeline' | 'matrix'>('tree');
  const selected = resolveSelected(breakdowns, selectedId);

  return (
    <div className="flex flex-col gap-4" data-testid="tasks-master-detail">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--fg-tertiary)]">
          Hierarchical decomposition: Epic → Story → Subtask. Toggle views to see different cuts.
        </p>
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-0.5">
          {([
            { id: 'tree' as const, label: 'Tree', icon: ListTree },
            { id: 'kanban' as const, label: 'Kanban', icon: KanbanSquare },
            { id: 'timeline' as const, label: 'Timeline', icon: GanttChartSquare },
            { id: 'matrix' as const, label: 'Matrix', icon: Grid3x3 },
          ]).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              data-testid={`tasks-view-${v.id}`}
              className={cn(
                'flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1 text-xs transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                view === v.id
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
              )}
            >
              <v.icon className="h-3 w-3" aria-hidden="true" />
              {v.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">Epics</p>
          <ul className="flex flex-col gap-1" role="list">
            {breakdowns.map((b) => {
              const isActive = selected?.id === b.id;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(b)}
                    aria-pressed={isActive}
                    className={cn(
                      'flex w-full items-start justify-between gap-2 rounded-[var(--radius-md)] border p-3 text-left text-sm transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                      isActive
                        ? 'border-[var(--accent-primary)]/50 bg-[rgba(99,102,241,0.10)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[rgba(255,255,255,0.04)]',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[var(--fg-primary)]">{b.title}</p>
                      <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">{b.source}</p>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{b.totalEstimateHours}h</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            variant="outline"
            size="sm"
            disabled={!onCreateFromADR || !firstAdr}
            onClick={() => firstAdr && onCreateFromADR?.(firstAdr.id)}
            className="text-xs"
            data-testid="tasks-generate-from-adr"
          >
            <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
            Generate from {firstAdr?.label ?? 'ADR'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toast.info('AI: decompose this story')} className="text-xs">
            <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
            AI: decompose story
          </Button>
        </aside>
        <section>
          {selected ? (
            view === 'tree' ? (
              <TaskBreakdownTree breakdown={selected} />
            ) : view === 'kanban' ? (
              <TaskKanban breakdown={selected} />
            ) : view === 'timeline' ? (
              <TaskTimeline breakdown={selected} />
            ) : (
              <TaskMatrix breakdown={selected} />
            )
          ) : (
            <EmptyState
              illustration={<ListTree size={40} strokeWidth={1.5} />}
              title="No work broken down yet"
              description="Turn an approved decision into the stories engineers will pick up next sprint."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function flattenTasks(n: typeof MOCK_TASK_BREAKDOWNS[number]['tree']): ReadonlyArray<typeof MOCK_TASK_BREAKDOWNS[number]['tree']> {
  return [n, ...n.children.flatMap(flattenTasks)];
}

function TaskKanban({ breakdown }: { breakdown: TaskBreakdown }) {
  const tasks = flattenTasks(breakdown.tree);
  const columns = [
    { id: 'todo' as const, label: 'Backlog', tone: 'border-slate-500/40' },
    { id: 'in_progress' as const, label: 'In progress', tone: 'border-cyan-500/40' },
    { id: 'blocked' as const, label: 'Blocked', tone: 'border-amber-500/40' },
    { id: 'done' as const, label: 'Done', tone: 'border-emerald-500/40' },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
      {columns.map((col) => (
        <div key={col.id} className={cn('flex flex-col gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-2', col.tone)}>
          <header className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
            <span>{col.label}</span>
            <span className="font-mono">{tasks.filter((t) => t.status === col.id).length}</span>
          </header>
          {tasks.filter((t) => t.status === col.id).slice(0, 5).map((t) => (
            <div key={t.id} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2 text-xs">
              <p className="font-medium text-[var(--fg-primary)]">{t.title}</p>
              <p className="mt-1 font-mono text-[10px] text-[var(--fg-tertiary)]">{t.estimateHours}h</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TaskTimeline({ breakdown }: { breakdown: TaskBreakdown }) {
  const tasks = flattenTasks(breakdown.tree).slice(0, 8);
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <svg viewBox="0 0 800 280" className="h-72 w-full" role="img" aria-label="Timeline">
        {/* Day grid */}
        {[0, 1, 2, 3, 4].map((d) => (
          <line key={d} x1={d * 160 + 80} y1={20} x2={d * 160 + 80} y2={260} stroke="var(--border-default)" strokeWidth={0.5} />
        ))}
        {tasks.map((t, i) => {
          const y = 30 + i * 28;
          const start = (i * 1.4 + 10) % 100;
          const len = 30 + (t.estimateHours / 16) * 80;
          const tone = t.status === 'done' ? 'fill-emerald-500/30 stroke-emerald-400' : t.status === 'blocked' ? 'fill-amber-500/30 stroke-amber-400' : 'fill-cyan-500/30 stroke-cyan-400';
          return (
            <g key={t.id}>
              <rect x={80 + start * 6} y={y} width={len} height={16} rx={3} className={tone} strokeWidth={1} />
              <text x={78 + start * 6} y={y + 11} fontSize={9} fill="var(--fg-primary)" textAnchor="end">{t.title.slice(0, 18)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TaskMatrix({ breakdown }: { breakdown: TaskBreakdown }) {
  const tasks = flattenTasks(breakdown.tree);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="relative h-72">
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
          <div className="border-b border-r border-[var(--border-subtle)]" />
          <div className="border-b border-[var(--border-subtle)]" />
          <div className="border-r border-[var(--border-subtle)]" />
          <div />
        </div>
        <p className="absolute left-1/2 top-1 -translate-x-1/2 font-mono text-[10px] text-[var(--fg-tertiary)]">low impact → high impact</p>
        <p className="absolute bottom-1 left-2 -rotate-90 origin-bottom-left font-mono text-[10px] text-[var(--fg-tertiary)]">low effort</p>
        {tasks.slice(0, 10).map((t, i) => {
          const x = ((i * 31 + t.id.length * 7) % 90) + 5;
          const y = ((i * 23 + t.estimateHours * 5) % 85) + 5;
          const tone = t.status === 'done' ? 'fill-emerald-400' : t.status === 'blocked' ? 'fill-amber-400' : 'fill-cyan-400';
          return (
            <div
              key={t.id}
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-[var(--bg-surface)]"
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${t.title} · ${t.estimateHours}h`}
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3"><circle cx={6} cy={6} r={5} className={tone} /></svg>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center font-mono text-[10px] text-[var(--fg-tertiary)]">effort → vs ↑ impact</p>
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function ArchitectureCenterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Fetch live data via the new TanStack Query hooks (Step 58 v2).
  // The page still falls back to the rich mock fixtures when the API
  // returns empty / errors, matching the connector-center pattern
  // (online/offline merge — Rule 15: empty states explain, never bare).
  // Step 58 v2: the data shapes returned by the live API differ from
  // the page's `ADRWithMeta` / `ApiService` projections (component,
  // impact, author initials, endpoint count…). When live data exists
  // we synthesize those fields; when it doesn't we use the mock
  // fixtures verbatim.
  const adrsQuery = useADRs();
  const contractsQuery = useContracts();
  const breakdownsQuery = useTaskBreakdowns();
  const registersQuery = useRiskRegisters();
  // M15-1 Gap 2 — wire the Generate-breakdown-from-ADR button.
  // createTaskBreakdown.mutate({ project_id, source_type: 'adr', source_id })
  // invalidates breakdownsQuery automatically via the hook's onSuccess.
  const createTaskBreakdown = useCreateTaskBreakdown();
  // M15-1 Gap 3 — approvals hooks are called inside ADRContentTab +
  // ADRReviewsTab themselves (TanStack dedupes by query key). Only
  // the breakdown mutation needs to live at the page level because
  // the button is inside TaskBreakdownMasterDetail which receives the
  // callback via prop.
  const projectId = process.env.NEXT_PUBLIC_FORGE_DEMO_PROJECT_ID ?? '22222222-2222-2222-2222-222222222222';
  const versionsQuery = useArchitectureVersions();
  const traceabilityQuery = useTraceability();
  // M5-G4 — Security Report hook. The posture query reads the cached
  // deployment posture aggregate (total_open / critical_open / score).
  // The reports list backs the Open Findings inner-tab.
  const security = useArchitectureSecurity();
  const securityPostureQuery = security.usePosture();
  const securityReportsQuery = security.useReports({ status: 'open' });
  const securityOpenCount = (securityReportsQuery.data?.items ?? []).filter(
    (r) => r.status === 'open' || r.status === 'mitigating',
  ).length;

  // M5-G4 — wire the architecture WS bus so Security Report lifecycle
  // events (`architecture.security_report.created`, posture recompute)
  // automatically invalidate the security query slice. The hook is a
  // no-op without a projectId; the seed-derived `acme-corp` project
  // id from the ADR fixtures is the canonical subscriber when no
  // persona-scoped project is active.
  useArchitecturePipelineWS(
    process.env.NEXT_PUBLIC_FORGE_DEMO_PROJECT_ID ?? '22222222-2222-2222-2222-222222222222',
  );

  const liveAdrs: ReadonlyArray<ADR> = adrsQuery.data?.items ?? [];
  const adrs: ReadonlyArray<ADRWithMeta> = liveAdrs.length > 0
    ? liveAdrs.map((a) => {
        const meta = MOCK_ADRS_WITH_META.find((m) => m.id === a.id);
        return meta ?? {
          ...a,
          component: 'backend' as const,
          impact: 5,
          authorInitials: a.approved_by?.slice(0, 2).toUpperCase() ?? 'XX',
          linkedTaskCount: 0,
          linkedRiskCount: 0,
          linkedApiCount: 0,
          owner: 'arun@acme-corp.com',
          markdown: '',
          updatedAt: a.updated_at ?? new Date().toISOString(),
        };
      })
    : MOCK_ADRS_WITH_META;
  const contracts: ReadonlyArray<APIContract> = contractsQuery.data?.items && contractsQuery.data.items.length > 0
    ? contractsQuery.data.items
    : MOCK_CONTRACTS;
  const breakdowns: ReadonlyArray<TaskBreakdown> = breakdownsQuery.data?.items && breakdownsQuery.data.items.length > 0
    ? breakdownsQuery.data.items
    : MOCK_TASK_BREAKDOWNS;
  const registers: ReadonlyArray<RiskRegister> = registersQuery.data?.items && registersQuery.data.items.length > 0
    ? registersQuery.data.items
    : MOCK_RISK_REGISTERS;
  const versions: ReadonlyArray<ArchitectureVersion> = versionsQuery.data && versionsQuery.data.length > 0
    ? versionsQuery.data
    : MOCK_VERSIONS;
  const traceability: TraceabilityGraphType = traceabilityQuery.data?.matrix?.length
    ? {
        id: 'tg-live',
        title: 'Traceability',
        nodes: traceabilityQuery.data.matrix.flatMap((row) =>
          row.targets.map((t) => ({ id: t.id, label: t.label, kind: 'adr' as const })),
        ),
        edges: traceabilityQuery.data.matrix.flatMap((row) =>
          row.targets.map((t) => ({ id: `${row.source_id}->${t.id}`, source: row.source_id, target: t.id })),
        ),
      }
    : MOCK_TRACEABILITY;

  // Live data is loading — surface that to the UI so we can render skeletons.
  const isLiveLoading =
    adrsQuery.isLoading ||
    contractsQuery.isLoading ||
    breakdownsQuery.isLoading ||
    registersQuery.isLoading ||
    versionsQuery.isLoading ||
    traceabilityQuery.isLoading;

  const tabParam = (searchParams?.get('tab') as TabId | null) ?? 'overview';
  const idParam = searchParams?.get('id') ?? undefined;
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? tabParam : 'overview';

  const [selectedADRId, setSelectedADRId] = React.useState<string | undefined>(idParam);
  const [selectedServiceId, setSelectedServiceId] = React.useState<string | undefined>(undefined);
  const [selectedBreakdownId, setSelectedBreakdownId] = React.useState<string | undefined>(undefined);
  const [selectedRegisterId, setSelectedRegisterId] = React.useState<string | undefined>(undefined);
  const [riskView, setRiskView] = React.useState<'heatmap' | 'kanban'>('heatmap');
  const [riskCell, setRiskCell] = React.useState<{ l: number; i: number } | null>(null);
  const [traceView, setTraceView] = React.useState<'matrix' | 'graph'>('matrix');
  const [selectedRiskId, setSelectedRiskId] = React.useState<string | null>(null);
  const [adrSelectedIds, setAdrSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  // Cmd+K opens global search.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        const t = TABS[idx];
        if (t) updateUrl(t.id);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const map: Record<TabId, string> = {
          overview: 'adr', adrs: 'adr', contracts: 'api', tasks: 'task',
          risks: 'risk', trace: 'adr', versions: 'adr', radar: 'adr', diagrams: 'adr',
        };
        const kind = map[tab] ?? 'adr';
        toast.info(`New ${kind}`, { description: `Stub: open modal for ${kind} on ${tab}` });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep ADR selection in sync with URL on first load.
  React.useEffect(() => {
    if (idParam && tab === 'adrs' && adrs.some((a) => a.id === idParam)) {
      setSelectedADRId(idParam);
    }
  }, [idParam, tab, adrs]);

  const updateUrl = React.useCallback(
    (nextTab: TabId, nextId?: string) => {
      const params = new URLSearchParams();
      params.set('tab', nextTab);
      if (nextId) params.set('id', nextId);
      router.replace(`/architecture?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  // All counts read from the same data the body renders — guaranteed consistent.
  const counts: Record<TabId, number> = {
    overview: adrs.length + MOCK_SERVICES.length + MOCK_RISKS.length,
    adrs: adrs.length,
    contracts: MOCK_SERVICES.length,
    tasks: breakdowns.length,
    risks: MOCK_RISKS.length,
    trace: traceability.nodes.length,
    versions: versions.length,
    radar: MOCK_TECH_RADAR.length,
    diagrams: MOCK_DIAGRAMS.length,
    security: securityOpenCount,
  };

  const handleTabChange = (next: TabId) => updateUrl(next);
  const handleADRSelect = (a: ADRWithMeta) => { setSelectedADRId(a.id); updateUrl('adrs', a.id); };
  const handleServiceSelect = (s: ApiService) => { setSelectedServiceId(s.id); updateUrl('contracts', s.id); };
  const handleBreakdownSelect = (b: TaskBreakdown) => { setSelectedBreakdownId(b.id); updateUrl('tasks', b.id); };
  const handleRegisterSelect = (r: RiskRegister) => { setSelectedRegisterId(r.id); updateUrl('risks', r.id); };

  const breadcrumbItem = (() => {
    if (tab === 'adrs') {
      const a = resolveSelected(adrs, selectedADRId);
      return a ? { label: `ADR-${String(a.number).padStart(3, '0')}`, id: a.id } : undefined;
    }
    if (tab === 'contracts') {
      const c = resolveSelected(MOCK_SERVICES, selectedServiceId);
      return c ? { label: c.name, id: c.id } : undefined;
    }
    if (tab === 'tasks') {
      const b = resolveSelected(breakdowns, selectedBreakdownId);
      return b ? { label: b.title, id: b.id } : undefined;
    }
    if (tab === 'risks') {
      const r = resolveSelected(registers, selectedRegisterId);
      return r ? { label: r.title, id: r.id } : undefined;
    }
    return undefined;
  })();

  const adrIndex = React.useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const r of MOCK_RISKS) {
      map[r.id] = `ADR-${String((r.id.length * 7) % 99).padStart(3, '0')}`;
    }
    return map;
  }, []);

  const register: RiskRegister | null = resolveSelected(registers, selectedRegisterId) ?? null;

  return (
    <AdminShell>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6" data-testid="architecture-center">
        <ArchitectureHero
          demoConflicts={MOCK_RISKS.filter((r) => r.status === 'open').length}
          onCreateADR={() => toast.info('Open ADR template dialog')}
          onResolveConflicts={() => toast.error('Conflict resolver — wires to /v1/architecture/conflicts')}
        />

        <Breadcrumb tab={tab} item={breadcrumbItem} />

        <TabBar active={tab} onChange={handleTabChange} counts={counts} />

        <CrossTabChips
          counts={{
            adrs: adrs.length,
            apis: MOCK_SERVICES.reduce((s, sv) => s + sv.endpointCount, 0),
            tasks: breakdowns.length,
            risks: MOCK_RISKS.length,
          }}
          scope={tab}
          onJump={(t) => updateUrl(t)}
        />

        <AnimatePresence>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === 'overview' ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AIAssistantBadge tab="overview" onClick={() => toast.info('AI: explain changes in architecture health')} />
                  <ExportButton
                    testId="export-overview"
                    title="Architecture Health Snapshot"
                    filename="architecture-health"
                    columns={['metric', 'value']}
                    getData={() => [
                      { metric: 'overall', value: HEALTH.overall },
                      { metric: 'adrs', value: HEALTH.adrs },
                      { metric: 'apis', value: HEALTH.apis },
                      { metric: 'tasks', value: HEALTH.tasks },
                      { metric: 'risks', value: HEALTH.risks },
                      { metric: 'coverage', value: HEALTH.coverage },
                    ]}
                  />
                </div>
                <OverviewTab
                  adrs={adrs}
                  risks={MOCK_RISKS}
                  services={MOCK_SERVICES}
                  tasks={breakdowns}
                  versions={versions}
                  activity={MOCK_ACTIVITY}
                />
              </div>
            ) : null}

            {tab === 'adrs' ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AIAssistantBadge tab="adrs" onClick={() => toast.info('AI: draft a new ADR from recent commits')} />
                    <BulkBar
                      testId="adrs"
                      items={adrs}
                      selected={adrSelectedIds}
                      onToggle={(id) => setAdrSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        return next;
                      })}
                      onClear={() => setAdrSelectedIds(new Set())}
                      actions={[
                        { label: 'Mark accepted', onClick: () => toast.success(`${adrSelectedIds.size} ADRs marked accepted`) },
                        { label: 'Archive', onClick: () => toast.info(`${adrSelectedIds.size} ADRs archived`) },
                        { label: 'Export', onClick: () => exportData(adrs.filter((a) => adrSelectedIds.has(a.id)).map((a) => ({ id: a.id, number: a.number, title: a.title, status: a.status, owner: a.owner })), ['id', 'number', 'title', 'status', 'owner'] as never, 'adrs-bulk', 'json', 'ADRs') },
                      ]}
                    />
                  </div>
                  <ExportButton
                    testId="export-adrs"
                    title="Architecture Decision Records"
                    filename="adrs"
                    columns={['id', 'number', 'title', 'status', 'owner', 'component']}
                    getData={() => adrs.map((a) => ({ id: a.id, number: a.number, title: a.title, status: a.status, owner: a.owner, component: a.component }))}
                  />
                </div>
                <SavedFiltersBar
                  tab="adrs"
                  currentState={{ statusFilter: 'all', componentFilter: 'all', query: '' }}
                  onApply={(state) => toast.info(`Applied filter: ${JSON.stringify(state)}`)}
                />
                <ADRMasterDetail
                  adrs={adrs}
                  selectedId={selectedADRId ?? adrs[0]?.id}
                  onSelect={handleADRSelect}
                />
              </div>
            ) : null}

            {tab === 'contracts' ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AIAssistantBadge tab="contracts" onClick={() => toast.info('AI: detect contract drift across versions')} />
                  <ExportButton
                    testId="export-contracts"
                    title="API Contracts"
                    filename="api-contracts"
                    columns={['id', 'name', 'version', 'endpointCount', 'status']}
                    getData={() => MOCK_SERVICES.map((s) => ({ id: s.id, name: s.name, version: s.version, endpointCount: s.endpointCount, status: s.status }))}
                  />
                </div>
                <APIContractMasterDetail
                  services={MOCK_SERVICES}
                  selectedId={selectedServiceId ?? MOCK_SERVICES[0]?.id}
                  onSelect={handleServiceSelect}
                />
                <details className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                  <summary className="cursor-pointer text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">
                    Consumer call flow (Sankey)
                  </summary>
                  <div className="mt-3">
                    <ConsumerFlow />
                  </div>
                </details>
              </div>
            ) : null}

            {tab === 'tasks' ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AIAssistantBadge tab="tasks" onClick={() => toast.info('AI: decompose this story into subtasks')} />
                  <ExportButton
                    testId="export-tasks"
                    title="Task Breakdowns"
                    filename="tasks"
                    columns={['id', 'title', 'estimateHours', 'status']}
                    getData={() => {
                      const walk = (n: { id: string; title: string; estimateHours: number; status: string; children: ReadonlyArray<{ id: string; title: string; estimateHours: number; status: string; children: never[] }> }): Array<{ id: string; title: string; estimateHours: number; status: string }> => [
                        { id: n.id, title: n.title, estimateHours: n.estimateHours, status: n.status },
                        ...n.children.flatMap(walk),
                      ];
                      return breakdowns.flatMap((b) => walk(b.tree as never));
                    }}
                  />
                </div>
                <TaskBreakdownMasterDetail
                  breakdowns={breakdowns}
                  selectedId={selectedBreakdownId ?? breakdowns[0]?.id}
                  onSelect={handleBreakdownSelect}
                  onCreateFromADR={(adrId) =>
                    createTaskBreakdown.mutate({
                      project_id: projectId,
                      source_type: 'adr',
                      source_id: adrId,
                    })
                  }
                  firstAdr={
                    liveAdrs[0]
                      ? {
                          id: liveAdrs[0].id,
                          label: `ADR-${String(liveAdrs[0].number ?? '001').padStart(3, '0')}`,
                        }
                      : undefined
                  }
                />
              </div>
            ) : null}

            {tab === 'risks' ? (
              MOCK_RISKS.length === 0 ? (
                <EmptyState
                  illustration={<ShieldAlert size={40} strokeWidth={1.5} />}
                  title="No risk registers yet"
                  description="Risk registers surface threats and mitigations across every ADR."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <ul
                      role="list"
                      className="flex flex-wrap gap-2"
                      data-testid="risk-register-tabs"
                    >
                      {registers.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => handleRegisterSelect(r)}
                            aria-pressed={(selectedRegisterId ?? registers[0]?.id) === r.id}
                            data-testid="risk-register-item"
                            data-register-id={r.id}
                            className={cn(
                              'rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-medium transition-colors',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                              (selectedRegisterId ?? registers[0]?.id) === r.id
                                ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--accent-primary)]'
                                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
                            )}
                          >
                            {r.title}
                            <span className="ml-1.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
                              {r.risks.length}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-0.5">
                      {(['heatmap', 'kanban'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setRiskView(v)}
                          aria-pressed={riskView === v}
                          data-testid={`risk-view-${v}`}
                          className={cn(
                            'rounded-[var(--radius-sm)] px-2.5 py-1 text-xs transition-colors',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                            riskView === v
                              ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                              : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
                          )}
                        >
                          {v === 'heatmap' ? 'Heat map' : 'Kanban'}
                        </button>
                      ))}
                    </div>
                  </header>
                  {riskView === 'heatmap' ? (
                    <div className="flex flex-col gap-3">
                      <RiskHeatMap
                        risks={MOCK_RISKS}
                        selectedCell={riskCell}
                        onSelectCell={setRiskCell}
                      />
                      {riskCell ? (
                        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3" data-testid="risk-cell-detail">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                            L{riskCell.l} × I{riskCell.i} — {MOCK_RISKS.filter((r) => r.likelihood === riskCell.l && r.impact === riskCell.i).length} risk(s)
                          </p>
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {MOCK_RISKS.filter((r) => r.likelihood === riskCell.l && r.impact === riskCell.i).map((r) => (
                              <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1.5">
                                <span className="truncate text-xs text-[var(--fg-primary)]">{r.title}</span>
                                <button
                                  type="button"
                                  onClick={() => setSelectedRiskId(r.id)}
                                  className="inline-flex h-6 items-center rounded border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-2 text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                                  data-testid={`open-risk-drawer-${r.id}`}
                                >
                                  Open
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <RiskRegisterKanban register={register} adrIndex={adrIndex} />
                  )}
                </div>
              )
            ) : null}

            {tab === 'trace' ? (
              <div className="flex flex-col gap-3">
                <div className="inline-flex items-center gap-2 self-end rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-0.5">
                  {(['matrix', 'graph'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTraceView(v)}
                      aria-pressed={traceView === v}
                      data-testid={`trace-view-${v}`}
                      className={cn(
                        'rounded-[var(--radius-sm)] px-3 py-1 text-xs transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                        traceView === v
                          ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                          : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
                      )}
                    >
                      {v === 'matrix' ? 'Matrix' : 'Graph'}
                    </button>
                  ))}
                  <AIAssistantBadge tab="trace" onClick={() => toast.info('AI: detect gaps in traceability')} />
                </div>
                {traceView === 'matrix' ? (
                  <TraceabilityMatrix graph={traceability} />
                ) : (
                  <TraceabilityGraph graph={traceability} />
                )}
              </div>
            ) : null}

            {tab === 'versions' ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <AIAssistantBadge tab="versions" onClick={() => toast.info('AI: generate migration guide between versions')} />
                  <ExportButton
                    testId="export-versions"
                    title="Architecture Versions"
                    filename="architecture-versions"
                    columns={['version', 'date', 'highlights']}
                    getData={() => versions.map((v) => ({ version: v.version, date: v.date, highlights: v.highlights.join(' · ') }))}
                  />
                </div>
                <VersionTimelineView versions={versions} />
                <MigrationGuide versions={versions} />
              </div>
            ) : null}

            {tab === 'radar' ? (
              <div className="flex flex-col gap-3">
                <div className="self-end"><AIAssistantBadge tab="radar" onClick={() => toast.info('AI: suggest tech radar updates based on recent commits')} /></div>
                <TechRadar projectId={process.env.NEXT_PUBLIC_FORGE_DEMO_PROJECT_ID ?? '22222222-2222-2222-2222-222222222222'} />
              </div>
            ) : null}

            {tab === 'diagrams' ? (
              <div className="flex flex-col gap-3">
                <div className="self-end"><AIAssistantBadge tab="diagrams" onClick={() => toast.info('AI: regenerate diagrams from live system')} /></div>
                <DiagramsExplorer diagrams={MOCK_DIAGRAMS} />
              </div>
            ) : null}

            {tab === 'security' ? (
              <div className="flex flex-col gap-3" data-testid="security-tab-panel">
                <div className="self-end">
                  <AIAssistantBadge
                    tab="security"
                    onClick={() =>
                      toast.info('AI: triage open findings and draft mitigations')
                    }
                  />
                </div>
                <SecurityReportPanel
                  posture={securityPostureQuery.data ?? null}
                  postureLoading={securityPostureQuery.isLoading}
                  reports={securityReportsQuery.data?.items ?? []}
                  reportsLoading={securityReportsQuery.isLoading}
                  onRefresh={() => {
                    void securityPostureQuery.refetch();
                    void securityReportsQuery.refetch();
                  }}
                />
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onJump={(t) => { updateUrl(t); setCommandOpen(false); }}
      />

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} tabs={TABS} />
      <RiskDetailDrawer
        risk={selectedRiskId ? MOCK_RISKS.find((r) => r.id === selectedRiskId) ?? null : null}
        onClose={() => setSelectedRiskId(null)}
        adrIndex={adrIndex}
      />
    </AdminShell>
  );
}

function CommandPalette({
  open,
  onClose,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  onJump: (t: TabId) => void;
}) {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const results: ReadonlyArray<{ kind: string; id: string; label: string; sub: string; tab: TabId }> = [
    ...MOCK_ADRS_WITH_META.map((a) => ({ kind: 'ADR', id: a.id, label: `ADR-${String(a.number).padStart(3, '0')} · ${a.title}`, sub: a.status, tab: 'adrs' as const })),
    ...MOCK_SERVICES.map((s) => ({ kind: 'API', id: s.id, label: `${s.name} (${s.version})`, sub: `${s.endpointCount} endpoints`, tab: 'contracts' as const })),
    ...MOCK_RISKS.map((r) => ({ kind: 'Risk', id: r.id, label: r.title, sub: `L${r.likelihood}×I${r.impact}`, tab: 'risks' as const })),
    ...MOCK_TASK_BREAKDOWNS.map((b) => ({ kind: 'Task', id: b.id, label: b.title, sub: `${b.totalEstimateHours}h`, tab: 'tasks' as const })),
    ...MOCK_VERSIONS.map((v) => ({ kind: 'Version', id: v.version, label: v.version, sub: v.highlights[0] ?? '', tab: 'versions' as const })),
    ...MOCK_TECH_RADAR.map((b) => ({ kind: 'Tech', id: b.id, label: b.name, sub: `${b.ring} · ${b.quadrant}`, tab: 'radar' as const })),
  ];
  const q = query.trim().toLowerCase();
  const filtered = q ? results.filter((r) => r.label.toLowerCase().includes(q)) : results.slice(0, 20);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(0,0,0,0.5)] p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="command-palette"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
          <CommandIcon className="h-4 w-4 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ADRs, APIs, risks, tasks, versions, tech…"
            className="flex-1 bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
            data-testid="command-palette-input"
          />
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto thin-scrollbar" role="listbox">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-xs text-[var(--fg-tertiary)]">No matches — try a different term.</li>
          ) : (
            filtered.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <button
                  type="button"
                  onClick={() => onJump(r.tab)}
                  className="flex w-full items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-left text-xs hover:bg-[var(--bg-inset)] focus:outline-none focus-visible:bg-[var(--bg-inset)]"
                >
                  <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]">{r.kind}</span>
                  <span className="flex-1 truncate text-[var(--fg-primary)]">{r.label}</span>
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{r.sub}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--fg-tertiary)]">
          <span>↑↓ navigate · ↵ select</span>
          <span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

function ShortcutsOverlay({ open, onClose, tabs }: { open: boolean; onClose: () => void; tabs: ReadonlyArray<{ id: TabId; label: string; count: number }> }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rows: Array<{ keys: string; action: string }> = [
    { keys: '⌘ K', action: 'Toggle global search' },
    { keys: '⌘ /', action: 'Toggle this shortcuts overlay' },
    { keys: '⌘ N', action: 'Create new entity (context-aware)' },
    { keys: '⌘ 1..9', action: 'Jump to tab by index' },
    { keys: 'Esc', action: 'Close overlay / drawer' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.6)]"
      onClick={onClose}
      data-testid="shortcuts-overlay"
    >
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5" onClick={(e) => e.stopPropagation()}>
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--fg-primary)]">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            ✕
          </button>
        </header>
        <ul className="flex flex-col gap-1.5 text-xs">
          {rows.map((r) => (
            <li key={r.keys} className="flex items-center justify-between rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1.5">
              <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-primary)]">{r.keys}</kbd>
              <span className="ml-2 flex-1 text-[var(--fg-secondary)]">{r.action}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">Tabs</p>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            {tabs.map((t, i) => (
              <div key={t.id} className="flex items-center gap-1 text-[var(--fg-secondary)]">
                <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-1 py-0.5 font-mono">{i + 1}</kbd>
                <span>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}