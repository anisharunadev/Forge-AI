'use client';

/**
 * Zone 3 — Row 1 + Row 2 bento tiles (Step 26 polish).
 *
 *   Row 1 — Live Activity · Your Agents · Today's Runs Timeline
 *   Row 2 — Cost Breakdown · Runs Over Time · Top Agents
 *
 * Skill influence:
 *   - `chart` (part-to-whole, performance vs target) — Tile D radial.
 *   - `chart` (compare categories) — Tile F horizontal bars.
 *   - `ux` (Color Only) — every status pairs dot + verb chip + label.
 *   - `ux` (Streaming, Empty States, Reduced Motion) — live activity
 *     pause toggle, "waiting for orchestrator" empty state, ghost
 *     bars in the timeline.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock,
  Pause,
  PauseCircle,
  Play,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { BentoTile, ACCENT_VAR, agentStatusColor } from './GreetingBar';
import { StaleBadge, snapshotAgeSec } from './StaleBadge';
import { useRefreshGlow } from './RefreshButton';
import type { DashboardSnapshot } from './mock-data';
import type { ActivityColor, AgentState, LiveActivityEntry } from './types';
import { ErrorState } from '@/components/error-state';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
//  Tile HoverAffordance — "→ Open" pill that fades in on hover (Fix 15)
// ---------------------------------------------------------------------------

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
//  Row 1 — Tile A: Live Activity
// ---------------------------------------------------------------------------

export function LiveActivityTile({ snapshot, online }: { snapshot: DashboardSnapshot; online: boolean }) {
  const [paused, setPaused] = React.useState(false);
  const glow = useRefreshGlow();
  const ageSec = snapshotAgeSec(snapshot.generatedAt, online);
  return (
    <BentoTile
      title="Live activity"
      className={cn('min-h-[300px] flex-1 xl:flex-[2]', glow ? 'refresh-glow' : '')}
      href="/runs"
      clickable
      stale={!online}
      staleBadgeAgeSec={online ? 0 : ageSec}
      headerRight={
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-emerald)]">
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]"
              style={!paused && online ? { animation: 'ai-thinking-pulse 1.6s ease-in-out infinite' } : undefined}
              aria-hidden="true"
            />
            {paused ? 'Paused' : online ? 'Streaming' : 'Stalled'}
          </span>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            aria-label={paused ? 'Resume activity stream' : 'Pause activity stream'}
            data-testid="live-activity-toggle"
          >
            {paused ? <Play className="h-3 w-3" aria-hidden="true" /> : <Pause className="h-3 w-3" aria-hidden="true" />}
          </button>
        </div>
      }
      testId="tile-live-activity"
    >
      <HoverAffordance href="/runs" />
      {!online ? (
        // Stale empty state — "Waiting for orchestrator..."
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-center" data-testid="live-activity-empty-stale">
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]">
            <Clock aria-hidden="true" className="h-4 w-4 stale-pulse" />
          </span>
          <p className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">Waiting for orchestrator…</p>
          <p className="text-[11px] text-[var(--fg-tertiary)]">Last sync {Math.max(1, Math.round(ageSec / 60))}m ago. Will resume automatically.</p>
        </div>
      ) : snapshot.activity.length === 0 ? (
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-center" data-testid="live-activity-empty">
          <Activity aria-hidden="true" className="h-6 w-6 text-[var(--fg-tertiary)]" />
          <p className="text-[var(--text-sm)] text-[var(--fg-tertiary)]">No live activity yet.</p>
          <p className="text-[11px] text-[var(--fg-tertiary)]">Run a command to see events stream in.</p>
        </div>
      ) : (
        <ul className="thin-scrollbar -mx-1 max-h-[260px] space-y-1 overflow-y-auto px-1" data-testid="live-activity-list">
          {snapshot.activity.slice(0, 12).map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      <footer className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--fg-tertiary)]">
        <Link href="/runs" className="hover:text-[var(--accent-primary)]">
          View all runs →
        </Link>
      </footer>
    </BentoTile>
  );
}

function ActivityRow({ entry }: { entry: LiveActivityEntry }) {
  const accent = ACCENT_VAR[entry.color as ActivityColor] ?? ACCENT_VAR.cyan;
  return (
    <li
      className="grid grid-cols-[56px_24px_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-[var(--text-sm)] hover:bg-[var(--bg-inset)]"
      data-testid="live-activity-row"
    >
      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{entry.timestamp}</span>
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-violet)] to-[var(--accent-primary)] text-[9px] font-bold text-white"
      >
        {entry.agent.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="font-medium text-[var(--fg-primary)]">{entry.agent}</span>
        <span
          className="rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{ color: accent, background: `${accent}1A` }}
        >
          {entry.verb}
        </span>
        <span className="truncate text-[var(--fg-secondary)]">{entry.target}</span>
      </span>
      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{entry.duration}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
//  Row 1 — Tile B: Your Agents
// ---------------------------------------------------------------------------

export function YourAgentsTile({ snapshot, online }: { snapshot: DashboardSnapshot; online: boolean }) {
  return (
    <BentoTile
      title="Your agents"
      className="min-h-[300px] flex-1"
      href="/agent-center"
      clickable
      stale={!online}
      headerRight={
        <div className="flex items-center gap-2 text-[11px] text-[var(--fg-tertiary)]">
          <span>{snapshot.agents.length} registered</span>
        </div>
      }
      testId="tile-your-agents"
    >
      <HoverAffordance href="/agent-center" />
      <div className="grid grid-cols-3 gap-2">
        {snapshot.agents.slice(0, 9).map((agent) => (
          <AgentMiniCard key={agent.id} agent={agent} stale={!online} />
        ))}
      </div>
      <footer className="mt-3 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--fg-tertiary)]">
        <Link href="/agent-center" className="hover:text-[var(--accent-primary)]">
          Manage agents →
        </Link>
      </footer>
    </BentoTile>
  );
}

function AgentMiniCard({
  agent,
  stale,
}: {
  agent: DashboardSnapshot['agents'][number];
  stale: boolean;
}) {
  const tone = agentStatusColor(agent.status);
  const Icon = agentIcon(agent.status);
  return (
    <Link
      href={`/agent-center/${agent.id}`}
      className={cn(
        'card-hover group flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        agent.status === 'running' ? tone.border : '',
      )}
      data-testid={`agent-mini-${agent.id}`}
      title={`${agent.name} — ${agent.role}\nStatus: ${agent.status}\nLast: ${agent.lastActivity}`}
    >
      <div className="relative">
        <Icon className={cn('h-5 w-5', tone.fg)} aria-hidden="true" />
        <span
          className={cn('absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ring-2 ring-[var(--bg-elevated)]', tone.dot)}
          aria-hidden="true"
        />
      </div>
      <span className="w-full truncate text-[10px] font-medium text-[var(--fg-primary)]">{agent.name}</span>
      <span className="w-full truncate text-[9px] text-[var(--fg-tertiary)]">{agent.task.split(':')[0]}</span>
      {agent.status === 'running' && !stale ? (
        <span className="absolute right-1 top-1 rounded bg-[var(--accent-cyan)]/20 px-1 text-[8px] font-bold uppercase text-[var(--accent-cyan)]">
          live
        </span>
      ) : null}
    </Link>
  );
}

function agentIcon(status: AgentState) {
  switch (status) {
    case 'running':
      return Bot;
    case 'idle':
      return CircleDashed;
    case 'paused':
      return PauseCircle;
    case 'error':
      return Clock;
  }
}

// ---------------------------------------------------------------------------
//  Row 1 — Tile C: Today's Runs Timeline (24h, dense — Fix 11)
// ---------------------------------------------------------------------------

export function TodaysRunsTimelineTile({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <BentoTile
      title="Today's runs"
      className="min-h-[300px] flex-1"
      href="/runs"
      clickable
      headerRight={
        <div className="flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
          <LegendDot color="var(--accent-emerald)" label="ok" />
          <LegendDot color="var(--accent-rose)" label="failed" />
          <LegendDot color="var(--accent-cyan)" label="running" />
        </div>
      }
      testId="tile-todays-runs"
    >
      <HoverAffordance href="/runs" />
      <TimelineRibbon runs={snapshot.runsToday} />
    </BentoTile>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function TimelineRibbon({
  runs,
}: {
  runs: DashboardSnapshot['runsToday'];
}) {
  // Render all 24 hours — empty hours get a ghost bar (1px dashed).
  // Hours with runs get a solid bar, height proportional to duration.
  const totalMinutes = 24 * 60;
  const nowMin = (new Date().getHours() * 60) + new Date().getMinutes();

  // Bucket runs by hour for richer tooltips.
  const byHour: Record<number, { runs: number; totalMin: number }> = {};
  for (const r of runs) {
    const startMin = totalMinutes - r.startMinutesAgo - r.durationMinutes;
    const hour = Math.floor(startMin / 60);
    if (!byHour[hour]) byHour[hour] = { runs: 0, totalMin: 0 };
    byHour[hour].runs += 1;
    byHour[hour].totalMin += r.durationMinutes;
  }

  return (
    <div className="space-y-2">
      <div className="relative h-[80px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)]" aria-label="Today's runs timeline">
        {/* Major grid lines every 6 hours */}
        {[0, 6, 12, 18].map((h) => (
          <span
            key={`grid-${h}`}
            className="absolute top-0 bottom-0 w-px bg-[var(--border-default)]/60"
            style={{ left: `${(h / 24) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {/* Hour ticks every hour */}
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={`tick-${i}`}
            className="absolute top-0 bottom-0 w-px bg-[var(--border-subtle)]/40"
            style={{ left: `${(i / 24) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {/* Ghost bars for empty hours (1px dashed) */}
        {Array.from({ length: 24 }).map((_, i) => {
          if (byHour[i]) return null;
          const hh = String(i).padStart(2, '0');
          return (
            <span
              key={`ghost-${i}`}
              className="absolute h-px border-b border-dashed border-[var(--border-subtle)]"
              style={{ left: `${(i / 24) * 100}%`, width: `${(1 / 24) * 100}%`, top: 38 }}
              title={`${hh}:00 · 0 runs`}
              aria-hidden="true"
            />
          );
        })}
        {/* "Now" indicator (only when within current day) */}
        {nowMin > 0 && nowMin <= totalMinutes ? (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 z-[1] flex flex-col items-center"
            style={{ left: `${(nowMin / totalMinutes) * 100}%` }}
          >
            <span className="h-full w-0.5 bg-[var(--accent-cyan)]" style={{ boxShadow: '0 0 0 2px rgba(34, 211, 238, 0.2)' }} />
            <span className="absolute -top-1 -translate-x-1/2 rounded bg-[var(--accent-cyan)]/20 px-1 font-mono text-[8px] uppercase tracking-wide text-[var(--accent-cyan)]">now</span>
          </span>
        ) : null}
        {/* Run bars */}
        {runs.map((run) => {
          const startMin = totalMinutes - run.startMinutesAgo - run.durationMinutes;
          const widthPct = (run.durationMinutes / totalMinutes) * 100;
          const leftPct = (startMin / totalMinutes) * 100;
          const color =
            run.status === 'succeeded'
              ? 'var(--accent-emerald)'
              : run.status === 'failed'
                ? 'var(--accent-rose)'
                : run.status === 'running'
                  ? 'var(--accent-cyan)'
                  : 'var(--accent-amber)';
          const hh = String(Math.floor(startMin / 60)).padStart(2, '0');
          const tooltip = `${hh}:00 · ${run.durationMinutes}m · ${run.status}`;
          return (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="absolute h-2 rounded-sm transition-transform hover:scale-y-150 hover:z-[2]"
              style={{
                left: `${Math.max(0, leftPct)}%`,
                width: `${Math.max(0.5, widthPct)}%`,
                top: `${(parseInt(run.agent.replace(/\D/g, '') || '0', 10) % 7) * 10 + 8}px`,
                background: color,
              }}
              title={tooltip}
              aria-label={tooltip}
              data-testid={`timeline-bar-${run.id}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-[var(--fg-tertiary)]">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Row 2 — Tile D: Cost Breakdown (Radial) — NOT clickable (Fix 15)
// ---------------------------------------------------------------------------

export function CostBreakdownTile({ snapshot, online }: { snapshot: DashboardSnapshot; online: boolean }) {
  const total = snapshot.cost.reduce((acc, s) => acc + s.value, 0);
  const data = snapshot.cost.map((s) => ({
    name: s.name,
    value: s.value,
    fill: s.color,
  }));

  return (
    <BentoTile
      title="Cost by category"
      className="min-h-[280px] flex-1"
      headerRight={
        <span className="text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">Last 24h</span>
      }
      testId="tile-cost-breakdown"
    >
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
          <p className="font-mono text-[24px] font-bold leading-none text-[var(--fg-primary)]">
            {online ? `$${total.toFixed(2)}` : '—'}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">Total</p>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <RadialBarChart innerRadius="40%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
            <PolarGrid stroke="var(--border-subtle)" />
            <PolarAngleAxis type="category" dataKey="name" tick={{ fill: 'var(--fg-tertiary)', fontSize: 11 }} />
            <RadialBar background={{ fill: 'var(--bg-inset)' }} dataKey="value" cornerRadius={4} />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
                color: 'var(--fg-primary)',
              }}
              formatter={((value: unknown, _name: unknown, p: unknown) => {
                const v = typeof value === 'number' ? value : 0;
                const payload = p as { payload?: { name?: string } } | undefined;
                return [`$${v.toFixed(2)} (${total > 0 ? ((v / total) * 100).toFixed(0) : 0}%)`, payload?.payload?.name ?? ''];
              }) as never}
            />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 space-y-1">
        {snapshot.cost.map((slice) => (
          <li key={slice.name} className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: slice.color }} />
              {slice.name}
            </span>
            <span className="font-mono text-[var(--fg-secondary)]">${slice.value.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </BentoTile>
  );
}

// ---------------------------------------------------------------------------
//  Row 2 — Tile E: Runs Over Time (Stacked Area) — NOT clickable
// ---------------------------------------------------------------------------

export function RunsOverTimeTile({ snapshot, online }: { snapshot: DashboardSnapshot; online: boolean }) {
  return (
    <BentoTile
      title="Runs · last 24h"
      className="min-h-[280px] flex-1 xl:flex-[2]"
      headerRight={
        <div className="flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
          <LegendDot color="var(--accent-emerald)" label="Succeeded" />
          <LegendDot color="var(--accent-rose)" label="Failed" />
          <LegendDot color="var(--accent-cyan)" label="Running" />
        </div>
      }
      testId="tile-runs-over-time"
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={snapshot.runsOverTime.map((p) => ({ ...p, label: `${String(p.hour).padStart(2, '0')}:00` }))}>
          <defs>
            <linearGradient id="g-succ" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-emerald)" stopOpacity={0.6} />
              <stop offset="100%" stopColor="var(--accent-emerald)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="g-fail" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-rose)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--accent-rose)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="g-run" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="label" interval={3} tick={{ fill: 'var(--fg-tertiary)', fontSize: 10 }} stroke="var(--border-subtle)" />
          <YAxis tick={{ fill: 'var(--fg-tertiary)', fontSize: 10 }} stroke="var(--border-subtle)" />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              color: 'var(--fg-primary)',
            }}
          />
          {!online ? null : (
            <>
              <Area type="monotone" dataKey="succeeded" stackId="1" stroke="var(--accent-emerald)" fill="url(#g-succ)" />
              <Area type="monotone" dataKey="failed" stackId="1" stroke="var(--accent-rose)" fill="url(#g-fail)" />
              <Area type="monotone" dataKey="running" stackId="1" stroke="var(--accent-cyan)" fill="url(#g-run)" />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </BentoTile>
  );
}

// ---------------------------------------------------------------------------
//  Row 2 — Tile F: Top Agents (Horizontal Bar) — NOT clickable
// ---------------------------------------------------------------------------

export function TopAgentsTile({ snapshot }: { snapshot: DashboardSnapshot }) {
  const top = snapshot.topAgents[0];
  const maxRuns = top ? top.runs : 0;
  return (
    <BentoTile
      title="Top agents · 7d"
      className="min-h-[280px] flex-1"
      headerRight={
        <Link href="/agent-center" className="text-[11px] text-[var(--fg-tertiary)] hover:text-[var(--accent-primary)]">
          All →
        </Link>
      }
      testId="tile-top-agents"
    >
      <ul className="space-y-2">
        {snapshot.topAgents.map((agent) => (
          <li key={agent.id} className="space-y-0.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-[var(--fg-primary)]">{agent.name}</span>
              <span className="font-mono text-[var(--fg-secondary)]">
                {agent.runs} <span className="text-[var(--fg-tertiary)]">runs</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-inset)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${maxRuns > 0 ? Math.min(100, (agent.runs / maxRuns) * 100) : 0}%`,
                  background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-violet))',
                }}
              />
            </div>
            <p className="text-[10px] text-[var(--fg-tertiary)]">{agent.successRate}% success</p>
          </li>
        ))}
      </ul>
    </BentoTile>
  );
}