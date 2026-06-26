'use client';

/**
 * Zone 3 — Curated tiles (Step 26 polish).
 *
 *   Row 3 — Pending Approvals · Recent Ideas
 *   Row 4 — AI Insights (320 px, 2 stacked) · Personal Stats
 *   Row 5 — Pinned (flow layout, 96×96) · Quick Actions (8 with kbd)
 *   Row 6 — Team Activity (filter counts)
 *   Row 7 — Recent Alerts
 *
 * Skill influence:
 *   - `style` (Real-Time Monitoring) — alerts tile pairs critical pulse
 *     with a "mark read" affordance.
 *   - `ux` (Empty States) — Pinned and AI Insights tiles both ship
 *     rich empty states.
 *   - `ux` (Confirmation Messages) — destructive actions are button
 *     level confirms.
 *   - `ux` (Color Only) — every status pairs icon + label.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Command as CommandIcon,
  Coins,
  Cpu,
  FlaskConical,
  GitBranch,
  Info,
  Lightbulb,
  Pin,
  PinOff,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal as TerminalIcon,
  ThumbsDown,
  ThumbsUp,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { BentoTile, ACCENT_VAR } from './GreetingBar';
import { Kbd, KbdGroup } from './MissionControl';
import { useQuickActions, type QuickActionItem, type QuickActionIcon } from './useQuickActions';
import type { DashboardSnapshot } from './mock-data';
import type { AiInsight, AlertItem, AlertSeverity, PinnedItem, TeamActivityEntry } from './types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
//  Row 3 — Tile G: Pending Approvals
// ---------------------------------------------------------------------------

export function PendingApprovalsTile({ snapshot }: { snapshot: DashboardSnapshot }) {
  const count = snapshot.approvals.length;
  return (
    <BentoTile
      title="Needs your attention"
      className="min-h-[240px] flex-1"
      href="/governance-center"
      clickable
      headerRight={
        count > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-amber)]/20 px-1.5 text-[10px] font-bold text-[var(--accent-amber)]">
            {count}
          </span>
        ) : (
          <CheckCircle2 className="h-4 w-4 text-[var(--accent-emerald)]" aria-hidden="true" />
        )
      }
      testId="tile-pending-approvals"
    >
      {count === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-[var(--accent-emerald)]" aria-hidden="true" />
          <p className="text-[var(--text-sm)] text-[var(--fg-secondary)]">All caught up ✓</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {snapshot.approvals.slice(0, 3).map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2"
              data-testid="approval-row"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">{a.title}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
                    {a.submitter} · {a.submittedAt}
                  </p>
                </div>
                <ApprovalKindBadge kind={a.kind} />
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-emerald)] hover:bg-[var(--accent-emerald)]/20"
                  aria-label={`Approve ${a.title}`}
                >
                  <ThumbsUp className="h-3 w-3" aria-hidden="true" /> Approve
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/20"
                  aria-label={`Reject ${a.title}`}
                >
                  <ThumbsDown className="h-3 w-3" aria-hidden="true" /> Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </BentoTile>
  );
}

function ApprovalKindBadge({ kind }: { kind: DashboardSnapshot['approvals'][number]['kind'] }) {
  const map: Record<typeof kind, { label: string; color: string; Icon: typeof ShieldCheck }> = {
    adr: { label: 'ADR', color: 'var(--accent-violet)', Icon: GitBranch },
    deployment: { label: 'Deploy', color: 'var(--accent-cyan)', Icon: Zap },
    security: { label: 'Sec', color: 'var(--accent-rose)', Icon: ShieldCheck },
    review: { label: 'Rev', color: 'var(--accent-amber)', Icon: CheckCircle2 },
  };
  const { label, color, Icon } = map[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
      style={{ background: `${color}1A`, color }}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" /> {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
//  Row 3 — Tile H: Recent Ideas
// ---------------------------------------------------------------------------

export function RecentIdeasTile({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <BentoTile
      title="Recent ideas"
      className="min-h-[240px] flex-1"
      href="/ideation"
      clickable
      headerRight={
        <Link href="/ideation" className="text-[11px] text-[var(--fg-tertiary)] hover:text-[var(--accent-primary)]">
          All →
        </Link>
      }
      testId="tile-recent-ideas"
    >
      <ul className="space-y-2">
        {snapshot.ideas.map((idea) => (
          <li key={idea.id} className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-amber)]/15 text-[var(--accent-amber)] font-mono text-[10px] font-bold"
              aria-label={`Score ${idea.score}`}
            >
              {idea.score}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">{idea.title}</p>
              <p className="truncate text-[11px] text-[var(--fg-tertiary)]">
                {idea.author} · {idea.age} · {idea.status}
              </p>
            </div>
            <IdeaStatusDot status={idea.status} />
          </li>
        ))}
      </ul>
    </BentoTile>
  );
}

function IdeaStatusDot({ status }: { status: 'backlog' | 'exploring' | 'scoping' | 'building' }) {
  const color =
    status === 'backlog'
      ? 'var(--fg-tertiary)'
      : status === 'exploring'
        ? 'var(--accent-cyan)'
        : status === 'scoping'
          ? 'var(--accent-amber)'
          : 'var(--accent-emerald)';
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
      title={status}
    />
  );
}

// ---------------------------------------------------------------------------
//  Row 4 — Tile I: AI Insights (320 px, 2 stacked — Fix 9)
// ---------------------------------------------------------------------------

export function AIInsightsTile({ snapshot, online }: { snapshot: DashboardSnapshot; online?: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const visible = snapshot.insights.filter((i) => !dismissed.has(i.id));
  const first = visible[0];
  const second = visible[1];
  const rest = visible.slice(2);

  return (
    <BentoTile
      title="Today's AI insights"
      className="min-h-[320px] flex-1 xl:flex-[2]"
      accentStrip="cyan"
      href="/copilot"
      clickable
      headerRight={
        <div className="flex items-center gap-2 text-[11px] text-[var(--fg-tertiary)]">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[var(--accent-cyan)]" aria-hidden="true" />
            {visible.length > 0 ? `${visible.length} new` : 'No insights yet'}
          </span>
        </div>
      }
      testId="tile-ai-insights"
    >
      <HoverAffordance href="/copilot" />
      {visible.length === 0 ? (
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center" data-testid="ai-insights-empty">
          <Sparkles className="h-7 w-7 text-[var(--accent-cyan)]" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">No insights yet</p>
            <p className="max-w-[260px] text-[11px] text-[var(--fg-tertiary)]">
              Insights will appear after 24h of activity. Try running some commands first.
            </p>
          </div>
          <Link
            href="/copilot"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-[11px] font-medium text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <Sparkles className="h-3 w-3 text-[var(--accent-cyan)]" aria-hidden="true" />
            Open Co-pilot
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {first ? <InsightCard insight={first} index={1} total={visible.length} onDismiss={() => setDismissed((d) => new Set(d).add(first.id))} /> : null}
            {second ? <InsightCard insight={second} index={2} total={visible.length} onDismiss={() => setDismissed((d) => new Set(d).add(second.id))} /> : null}
          </div>
          {rest.length > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 w-full rounded-md border border-dashed border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              data-testid="insight-toggle"
            >
              {expanded ? 'Hide' : 'Show'} {rest.length} more insight{rest.length === 1 ? '' : 's'}
            </button>
          ) : null}
          {expanded ? (
            <ul className="mt-2 space-y-2">
              {rest.map((i, idx) => (
                <li key={i.id}>
                  <InsightCard insight={i} index={3 + idx} total={visible.length} onDismiss={() => setDismissed((d) => new Set(d).add(i.id))} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {online === false ? null : null}
    </BentoTile>
  );
}

function InsightCard({
  insight,
  index,
  total,
  onDismiss,
}: {
  insight: AiInsight;
  index: number;
  total: number;
  onDismiss: () => void;
}) {
  return (
    <article
      className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"
      data-testid="insight-card"
    >
      {/* Left accent strip */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: 'linear-gradient(180deg, var(--accent-cyan), var(--accent-primary))' }}
      />
      <header className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
        <Sparkles className="h-3 w-3 text-[var(--accent-cyan)]" aria-hidden="true" />
        Insight {index} of {total}
        <span aria-hidden="true">·</span>
        <span className="font-mono normal-case">{insight.generatedAt}</span>
      </header>
      <h4 className="mt-1 truncate text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">{insight.title}</h4>
      <p className="mt-1 line-clamp-3 text-[var(--text-sm)] text-[var(--fg-secondary)]">{insight.body}</p>
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <Link
          href={`/copilot?prompt=${encodeURIComponent(insight.title)}`}
          className="text-[var(--accent-cyan)] hover:underline"
        >
          Ask Co-pilot
        </Link>
        <Link href="/copilot" className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]">
          View details
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-[var(--fg-tertiary)] hover:text-[var(--accent-rose)]"
          aria-label="Dismiss insight"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function HoverAffordance({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="pointer-events-auto absolute right-2 top-2 z-10 inline-flex translate-y-[-2px] items-center gap-1 rounded-md bg-[var(--bg-elevated)]/85 px-1.5 py-0.5 text-[var(--text-xs)] font-medium text-[var(--accent-primary)] opacity-0 shadow-sm transition-opacity duration-150 hover:underline group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      data-testid="tile-hover-affordance"
      aria-label="Open this section"
      onClick={(e) => e.stopPropagation()}
    >
      Open
      <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
//  Row 4 — Tile J: Personal Stats
// ---------------------------------------------------------------------------

export function PersonalStatsTile({ snapshot }: { snapshot: DashboardSnapshot }) {
  const runs = 47;
  const goal = 50;
  const pct = Math.round((runs / goal) * 100);
  return (
    <BentoTile
      title="Your impact this week"
      className="min-h-[240px] flex-1"
      href="/analytics?tab=me"
      clickable
      headerRight={
        <span className="rounded-full bg-[var(--accent-violet)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-violet)]">
          Me
        </span>
      }
      testId="tile-personal-stats"
    >
      <ul className="space-y-3">
        <Stat icon={Cpu} label="Runs initiated" value={String(runs)} delta="+12 vs last week" accent="cyan" />
        <Stat icon={Clock} label="Time saved" value="~14h" delta="+3h vs last week" accent="emerald" />
        <Stat icon={Coins} label="Cost approved" value="$32.40" delta="+8% MoM" accent="amber" />
      </ul>
      <div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[var(--fg-secondary)]">
            <Target className="mr-1 inline h-3 w-3 text-[var(--accent-violet)]" aria-hidden="true" />
            Weekly goal: 50 runs
          </span>
          <span className="font-mono font-bold text-[var(--fg-primary)]">{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-inset)]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--accent-violet), var(--accent-primary))',
            }}
          />
        </div>
      </div>
    </BentoTile>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  delta,
  accent,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  delta: string;
  accent: keyof typeof ACCENT_VAR;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-md"
        style={{ background: `${ACCENT_VAR[accent]}1A`, color: ACCENT_VAR[accent] }}
        aria-hidden="true"
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</p>
        <p className="font-mono text-base font-bold text-[var(--fg-primary)]">{value}</p>
      </div>
      <span className="text-[10px] text-[var(--fg-tertiary)]">{delta}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
//  Row 5 — Tile K: Pinned (flow layout, 96×96, +Add slot — Fix 4)
// ---------------------------------------------------------------------------

export function PinnedTile({
  snapshot,
  pinIds,
  onManage,
  onUnpin,
}: {
  snapshot: DashboardSnapshot;
  pinIds: ReadonlyArray<string>;
  onManage: () => void;
  onUnpin: (id: string) => void;
}) {
  const items = pinIds
    .map((id) => snapshot.pinnedCatalog.find((c) => c.id === id))
    .filter((x): x is PinnedItem => Boolean(x));
  return (
    <BentoTile
      title="Pinned"
      className="min-h-[240px] flex-1"
      headerRight={
        <button
          type="button"
          onClick={onManage}
          className="text-[11px] text-[var(--fg-tertiary)] hover:text-[var(--accent-primary)]"
          data-testid="pinned-manage"
        >
          Manage
        </button>
      }
      testId="tile-pinned"
    >
      {items.length === 0 ? (
        // Empty state
        <button
          type="button"
          onClick={onManage}
          className="flex h-[180px] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-subtle)] text-[var(--text-sm)] text-[var(--fg-tertiary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
          data-testid="pinned-empty-state"
        >
          <Pin className="h-6 w-6" aria-hidden="true" />
          <p>Pin agents, workflows, or pages for one-click access</p>
          <span className="text-[10px] underline">Show me how →</span>
        </button>
      ) : (
        <ul className="flex flex-wrap items-start gap-3" data-testid="pinned-flow">
          {items.slice(0, 12).map((item) => (
            <li key={item.id} className="group relative h-24 w-24">
              <Link
                href={item.href}
                className="card-hover flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                data-testid={`pinned-${item.id}`}
              >
                <PinnedIcon icon={item.icon} />
                <span className="w-full truncate px-1 text-[10px] font-medium text-[var(--fg-primary)]">{item.label}</span>
              </Link>
              <button
                type="button"
                onClick={() => onUnpin(item.id)}
                aria-label={`Unpin ${item.label}`}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--fg-tertiary)] shadow-sm hover:text-[var(--accent-rose)] group-hover:flex"
              >
                <PinOff className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {/* + Add pin tile when 6+ pins exist */}
          {items.length >= 6 ? (
            <li className="h-24 w-24">
              <button
                type="button"
                onClick={onManage}
                className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border-subtle)] text-[10px] font-medium text-[var(--fg-tertiary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                data-testid="pinned-add"
                aria-label="Add another pin"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
                Add pin
              </button>
            </li>
          ) : null}
        </ul>
      )}
      <footer className="mt-3 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--fg-tertiary)]">
        <button type="button" onClick={onManage} className="hover:text-[var(--accent-primary)]">
          Customize pins →
        </button>
      </footer>
    </BentoTile>
  );
}

function PinnedIcon({ icon }: { icon: PinnedItem['icon'] }) {
  const map: Record<PinnedItem['icon'], { Icon: typeof Sparkles; color: string }> = {
    sparkles: { Icon: Sparkles, color: 'var(--accent-cyan)' },
    wrench: { Icon: Wrench, color: 'var(--accent-amber)' },
    bot: { Icon: Cpu, color: 'var(--accent-primary)' },
    play: { Icon: Play, color: 'var(--accent-emerald)' },
    lightbulb: { Icon: Lightbulb, color: 'var(--accent-amber)' },
    bar: { Icon: BarChart3, color: 'var(--accent-violet)' },
    terminal: { Icon: TerminalIcon, color: 'var(--accent-emerald)' },
    git: { Icon: GitBranch, color: 'var(--accent-violet)' },
  };
  const { Icon, color } = map[icon];
  return <Icon className="h-5 w-5" style={{ color }} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
//  Row 5 — Tile L: Quick Actions (8 with kbd, categories — Fix 5)
// ---------------------------------------------------------------------------

const QUICK_ACTION_ICON_MAP: Record<QuickActionIcon, { Icon: typeof Sparkles; color: string }> = {
  sparkles: { Icon: Sparkles, color: 'var(--accent-cyan)' },
  wrench: { Icon: Wrench, color: 'var(--accent-amber)' },
  terminal: { Icon: TerminalIcon, color: 'var(--accent-emerald)' },
  lightbulb: { Icon: Lightbulb, color: 'var(--accent-amber)' },
  command: { Icon: CommandIcon, color: 'var(--accent-cyan)' },
  bot: { Icon: Bot, color: 'var(--accent-primary)' },
  flask: { Icon: FlaskConical, color: 'var(--accent-emerald)' },
  workflow: { Icon: Workflow, color: 'var(--accent-primary)' },
  git: { Icon: GitBranch, color: 'var(--accent-violet)' },
  play: { Icon: Play, color: 'var(--accent-emerald)' },
  cpu: { Icon: Cpu, color: 'var(--accent-primary)' },
  shield: { Icon: ShieldCheck, color: 'var(--accent-rose)' },
};

function renderQuickActionIcon(icon: QuickActionIcon) {
  const m = QUICK_ACTION_ICON_MAP[icon];
  const Icon = m.Icon;
  return <Icon className="h-5 w-5" style={{ color: m.color }} aria-hidden="true" />;
}

const CATEGORY_LABELS: Record<QuickActionItem['category'], string> = {
  forge: 'Forge',
  navigate: 'Navigate',
  agents: 'Agents',
  workflows: 'Workflows',
};

export function QuickActionsTile({ onCustomize }: { onCustomize: () => void }) {
  const { actions, mounted } = useQuickActions();
  const grouped = React.useMemo(() => {
    const g: Record<QuickActionItem['category'], QuickActionItem[]> = {
      forge: [],
      navigate: [],
      agents: [],
      workflows: [],
    };
    for (const a of actions) g[a.category].push(a);
    return g;
  }, [actions]);

  if (!mounted) {
    return (
      <BentoTile
        title="Quick actions"
        className="min-h-[200px] flex-1"
        headerRight={<button type="button" aria-label="Customize quick actions" className="flex h-6 w-6 items-center justify-center rounded text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"><Wrench className="h-3 w-3" aria-hidden="true" /></button>}
        testId="tile-quick-actions"
      >
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-md bg-[var(--bg-inset)]" />
          ))}
        </div>
      </BentoTile>
    );
  }

  return (
    <BentoTile
      title="Quick actions"
      className="min-h-[280px] flex-1"
      headerRight={
        <button
          type="button"
          onClick={onCustomize}
          aria-label="Customize quick actions"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--accent-primary)]"
          data-testid="quick-actions-customize"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Customize
        </button>
      }
      testId="tile-quick-actions"
    >
      <div className="grid grid-cols-4 gap-2">
        {(Object.keys(grouped) as QuickActionItem['category'][]).map((cat) => (
          <React.Fragment key={cat}>
            {grouped[cat].length > 0 ? (
              <>
                <div className="col-span-4 mt-2 first:mt-0 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2 first:border-t-0 first:pt-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--fg-muted)]">{grouped[cat].length}</span>
                </div>
                {grouped[cat].map((a) => (
                  <QuickActionCard key={a.id} action={a} />
                ))}
              </>
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </BentoTile>
  );
}

function QuickActionCard({ action }: { action: QuickActionItem }) {
  return (
    <Link
      href={action.href}
      title={`${action.label} (${action.shortcut})`}
      className="group relative flex h-[72px] flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 text-center transition-colors hover:border-[var(--accent-primary)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      data-testid={`quick-action-${action.id}`}
    >
      {renderQuickActionIcon(action.icon)}
      <span className="line-clamp-2 w-full px-0.5 text-[10px] font-medium leading-tight text-[var(--fg-primary)]">{action.label}</span>
      <KbdGroup className="absolute bottom-0.5 right-0.5">
        <Kbd className="text-[8px]">{action.shortcut}</Kbd>
      </KbdGroup>
    </Link>
  );
}

// ---------------------------------------------------------------------------
//  Row 6 — Tile M: Team Activity (filter counts — Fix 10)
// ---------------------------------------------------------------------------

const TEAM_FILTER_MAP: Record<'All' | 'Engineering' | 'Product' | 'Design', (t: TeamActivityEntry) => boolean> = {
  All: () => true,
  Engineering: (t) => /atlas|aria|mira|orion|lyra|kira|neo|vex|zen|atlas|aria|mira/i.test(`${t.actor} ${t.target}`),
  Product: (t) => /priya|arun|idea|prd|scoping|backlog/i.test(`${t.actor} ${t.target}`),
  Design: (t) => /sana|marcus|devon|design|heatmav2|spec/i.test(`${t.actor} ${t.target}`),
};

export function TeamActivityTile({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [filter, setFilter] = React.useState<'All' | 'Engineering' | 'Product' | 'Design'>('All');
  const filters: ReadonlyArray<typeof filter> = ['All', 'Engineering', 'Product', 'Design'];
  const counts = React.useMemo(() => {
    return filters.reduce<Record<typeof filter, number>>((acc, f) => {
      acc[f] = snapshot.team.filter(TEAM_FILTER_MAP[f]).length;
      return acc;
    }, { All: 0, Engineering: 0, Product: 0, Design: 0 });
  }, [snapshot.team]);
  const visible = snapshot.team.filter(TEAM_FILTER_MAP[filter]).slice(0, 8);
  return (
    <BentoTile
      title="Team activity today"
      className="min-h-[220px]"
      href="/audit?tab=team"
      clickable
      headerRight={
        <div className="flex items-center gap-1" role="tablist" aria-label="Filter team activity">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                filter === f
                  ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                  : 'text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)]',
              )}
              data-testid={`team-filter-${f}`}
            >
              {f} <span className={cn('ml-0.5 font-mono text-[10px]', filter === f ? 'text-[var(--accent-primary)]' : 'text-[var(--fg-tertiary)]')}>{counts[f]}</span>
            </button>
          ))}
        </div>
      }
      testId="tile-team-activity"
    >
      <HoverAffordance href="/audit?tab=team" />
      <ul className="space-y-1.5">
        {visible.length === 0 ? (
          <li className="py-6 text-center text-[11px] text-[var(--fg-tertiary)]">No team activity in this view.</li>
        ) : (
          visible.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-[var(--text-sm)]">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-violet)] to-[var(--accent-primary)] text-[9px] font-bold text-white"
              >
                {entry.actor.slice(0, 1).toUpperCase()}
              </span>
              <p className="min-w-0 flex-1 truncate text-[var(--fg-primary)]">
                <strong className="font-medium">{entry.actor}</strong>{' '}
                <span className="text-[var(--fg-tertiary)]">{entry.verb}</span>{' '}
                <span className="text-[var(--fg-secondary)]">{entry.target}</span>
              </p>
              <span className="shrink-0 font-mono text-[10px] text-[var(--fg-tertiary)]">{entry.minutesAgo}m</span>
            </li>
          ))
        )}
      </ul>
    </BentoTile>
  );
}

// ---------------------------------------------------------------------------
//  Row 7 — Tile N: Recent Alerts
// ---------------------------------------------------------------------------

export function RecentAlertsTile({ snapshot, onMarkAll }: { snapshot: DashboardSnapshot; onMarkAll: () => void }) {
  const [filter, setFilter] = React.useState<'All' | 'Unread' | 'Critical'>('All');
  return (
    <BentoTile
      title="Recent alerts"
      className="min-h-[200px]"
      href="/audit"
      clickable
      headerRight={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" role="tablist" aria-label="Filter alerts">
            {(['All', 'Unread', 'Critical'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  filter === f
                    ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                    : 'text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)]',
                )}
                data-testid={`alert-filter-${f}`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onMarkAll}
            className="text-[11px] text-[var(--fg-tertiary)] hover:text-[var(--accent-primary)]"
            data-testid="alert-mark-all"
          >
            Mark all read
          </button>
        </div>
      }
      testId="tile-recent-alerts"
    >
      {snapshot.alerts.length === 0 ? (
        <p className="py-6 text-center text-[var(--text-sm)] text-[var(--fg-tertiary)]">No alerts. Quiet day ✓</p>
      ) : (
        <ul className="space-y-1">
          {snapshot.alerts.slice(0, 5).map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </BentoTile>
  );
}

function AlertRow({ alert }: { alert: AlertItem }) {
  const tone = alertTone(alert.severity);
  const Icon =
    alert.icon === 'triangle'
      ? AlertTriangle
      : alert.icon === 'check'
        ? CheckCircle2
        : Info;
  return (
    <li
      className={cn(
        'flex items-start gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2',
        alert.severity === 'critical' ? 'border-l-2 border-l-[var(--accent-rose)]' : '',
      )}
      data-testid={`alert-row-${alert.id}`}
    >
      <span
        className={cn('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded', tone.bg, tone.fg)}
        aria-hidden="true"
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[11px] font-medium text-[var(--fg-primary)]">{alert.title}</p>
          {alert.severity === 'critical' ? (
            <span className="rounded bg-[var(--accent-rose)]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--accent-rose)]">
              Action required
            </span>
          ) : null}
        </div>
        <p className="truncate text-[10px] text-[var(--fg-tertiary)]">{alert.body}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-[var(--fg-tertiary)]">{alert.timestamp}</span>
    </li>
  );
}

function alertTone(s: AlertSeverity): { fg: string; bg: string } {
  switch (s) {
    case 'critical':
      return { fg: 'text-[var(--accent-rose)]', bg: 'bg-[var(--accent-rose)]/15' };
    case 'warning':
      return { fg: 'text-[var(--accent-amber)]', bg: 'bg-[var(--accent-amber)]/15' };
    case 'success':
      return { fg: 'text-[var(--accent-emerald)]', bg: 'bg-[var(--accent-emerald)]/15' };
    case 'info':
      return { fg: 'text-[var(--accent-cyan)]', bg: 'bg-[var(--accent-cyan)]/15' };
    default:
      return { fg: 'text-[var(--fg-tertiary)]', bg: 'bg-[var(--bg-inset)]' };
  }
}

void ChevronRight;