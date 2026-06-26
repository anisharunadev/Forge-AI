'use client';

/**
 * RightColumn — 380px sticky right column with 4 right tiles (Step 20):
 *   A. Project velocity (Recharts BarChart, last 6 sprints).
 *   B. Current sprint burndown (Recharts LineChart, ideal + actual).
 *   C. Team load this sprint (horizontal stacked bars).
 *   D. Recent activity (compact timeline).
 *
 * On <1024px the column is hidden (the right-side info collapses).
 */

import * as React from 'react';
import {
  Activity,
  ArrowRight,
  CheckCheck,
  Clock,
  GitCommit,
  Plus,
  UserPlus,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { ChartTooltip } from '@/src/components/charts/ChartTooltip';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export interface SprintVelocityDatum {
  sprint: string;
  completed: number;
  carryover: number;
}

export interface BurndownDatum {
  day: string;
  ideal: number;
  actual: number | null;
}

export interface TeamLoadMember {
  name: string;
  initials: string;
  allocated: number;
  capacity: number;
}

export interface ActivityEvent {
  id: string;
  actor: string;
  initials: string;
  action: string;
  target: string;
  at: string;
  href?: string;
}

export interface RightColumnProps {
  velocity: ReadonlyArray<SprintVelocityDatum>;
  burndown: ReadonlyArray<BurndownDatum>;
  teamLoad: ReadonlyArray<TeamLoadMember>;
  activity: ReadonlyArray<ActivityEvent>;
}

export function RightColumn({
  velocity,
  burndown,
  teamLoad,
  activity,
}: RightColumnProps) {
  return (
    <aside
      className="hidden w-[380px] shrink-0 space-y-4 xl:block"
      data-testid="project-right-column"
    >
      <VelocityTile data={velocity} />
      <BurndownTile data={burndown} />
      <TeamLoadTile members={teamLoad} />
      <RecentActivityTile events={activity} />
    </aside>
  );
}

/* --------------------------------------------------------------- Velocity */

function VelocityTile({ data }: { data: ReadonlyArray<SprintVelocityDatum> }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="project-tile-velocity"
    >
      <h3 className="text-[13px] font-semibold text-[var(--fg-primary)]">
        Velocity · last 6 sprints
      </h3>
      <p className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">
        Stacked points (completed + carryover)
      </p>
      <div className="mt-3 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data as any} barCategoryGap="20%">
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="sprint"
              tick={{ fontSize: 10, fill: 'var(--fg-tertiary)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--fg-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={24}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={<ChartTooltip unit=" pts" />}
            />
            <Legend
              wrapperStyle={{ fontSize: 10, color: 'var(--fg-tertiary)' }}
              iconSize={8}
            />
            <Bar
              dataKey="completed"
              name="Completed"
              stackId="a"
              fill="var(--accent-emerald)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="carryover"
              name="Carryover"
              stackId="a"
              fill="var(--accent-amber)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Burndown */

function BurndownTile({ data }: { data: ReadonlyArray<BurndownDatum> }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="project-tile-burndown"
    >
      <h3 className="text-[13px] font-semibold text-[var(--fg-primary)]">
        Current sprint burndown
      </h3>
      <p className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">
        Ideal (dashed) vs actual points remaining
      </p>
      <div className="mt-3 h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data as any}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: 'var(--fg-tertiary)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--fg-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={24}
            />
            <Tooltip
              content={<ChartTooltip unit=" pts" />}
            />
            <Line
              type="monotone"
              dataKey="ideal"
              name="Ideal"
              stroke="var(--fg-tertiary)"
              strokeDasharray="4 3"
              dot={false}
              strokeWidth={1.5}
            />
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="var(--accent-primary)"
              dot={{ r: 2.5, fill: 'var(--accent-primary)' }}
              strokeWidth={2}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Team load */

function TeamLoadTile({ members }: { members: ReadonlyArray<TeamLoadMember> }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="project-tile-team-load"
    >
      <h3 className="text-[13px] font-semibold text-[var(--fg-primary)]">
        Team load this sprint
      </h3>
      <p className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">
        Allocated vs capacity
      </p>
      <ul className="mt-3 space-y-2.5" data-testid="project-team-load-list">
        {members.map((m) => {
          const ratio = m.capacity === 0 ? 0 : m.allocated / m.capacity;
          const tone =
            ratio > 1
              ? 'rose'
              : ratio >= 0.9
              ? 'amber'
              : 'emerald';
          const barColor =
            tone === 'rose'
              ? 'bg-[var(--accent-rose)]'
              : tone === 'amber'
              ? 'bg-[var(--accent-amber)]'
              : 'bg-[var(--accent-emerald)]';
          const textTone =
            tone === 'rose'
              ? 'text-[var(--accent-rose)]'
              : tone === 'amber'
              ? 'text-[var(--accent-amber)]'
              : 'text-[var(--accent-emerald)]';
          return (
            <li
              key={m.name}
              className="flex items-center gap-2"
              data-testid="project-team-load-row"
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-[var(--bg-elevated)] text-[9px] text-[var(--fg-secondary)]">
                  {m.initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between">
                  <span className="truncate text-[11px] text-[var(--fg-primary)]">
                    {m.name}
                  </span>
                  <span className={cn('font-mono text-[10px]', textTone)}>
                    {m.allocated}/{m.capacity}pt
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
                  <div
                    className={cn('h-full rounded-full', barColor)}
                    style={{
                      width: `${Math.min(100, Math.round(ratio * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- Activity */

function RecentActivityTile({ events }: { events: ReadonlyArray<ActivityEvent> }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="project-tile-activity"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--fg-primary)]">
          Recent activity
        </h3>
        <a
          href="/audit"
          className="inline-flex items-center gap-0.5 text-[10px] text-[var(--fg-secondary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
          data-testid="project-activity-audit"
        >
          View audit log
          <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
        </a>
      </div>
      <ul className="mt-3 space-y-2.5" data-testid="project-activity-list">
        {events.slice(0, 6).map((e) => (
          <li
            key={e.id}
            className="flex items-start gap-2"
            data-testid="project-activity-row"
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback className="bg-[var(--bg-elevated)] text-[9px] text-[var(--fg-secondary)]">
                {e.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-[var(--fg-secondary)]">
                <span className="font-medium text-[var(--fg-primary)]">
                  {e.actor}
                </span>{' '}
                {e.action}{' '}
                <span className="text-[var(--fg-primary)]">{e.target}</span>
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1 font-mono text-[9px] text-[var(--fg-tertiary)]">
                <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                {e.at}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- Defaults */

export function defaultVelocity(): ReadonlyArray<SprintVelocityDatum> {
  return [
    { sprint: 'S-21', completed: 18, carryover: 4 },
    { sprint: 'S-22', completed: 22, carryover: 3 },
    { sprint: 'S-23', completed: 16, carryover: 6 },
    { sprint: 'S-24', completed: 24, carryover: 2 },
    { sprint: 'S-25', completed: 21, carryover: 5 },
    { sprint: 'S-26', completed: 25, carryover: 3 },
  ];
}

export function defaultBurndown(): ReadonlyArray<BurndownDatum> {
  return [
    { day: 'M', ideal: 50, actual: 50 },
    { day: 'T', ideal: 42, actual: 48 },
    { day: 'W', ideal: 35, actual: 42 },
    { day: 'T', ideal: 28, actual: 36 },
    { day: 'F', ideal: 21, actual: 30 },
    { day: 'F', ideal: 14, actual: 22 },
    { day: 'S', ideal: 7, actual: 16 },
    { day: 'S', ideal: 0, actual: null },
  ];
}

export function defaultTeamLoad(): ReadonlyArray<TeamLoadMember> {
  return [
    { name: 'Aarav Patel', initials: 'AP', allocated: 18, capacity: 20 },
    { name: 'Mira Chen', initials: 'MC', allocated: 12, capacity: 20 },
    { name: 'Jonas Vidal', initials: 'JV', allocated: 20, capacity: 20 },
    { name: 'Sara Kim', initials: 'SK', allocated: 8, capacity: 20 },
  ];
}

export function defaultActivity(): ReadonlyArray<ActivityEvent> {
  return [
    {
      id: 'a1',
      actor: 'Aarav Patel',
      initials: 'AP',
      action: 'approved epic',
      target: 'E-014',
      at: '2m ago',
    },
    {
      id: 'a2',
      actor: 'agent:architect',
      initials: 'AG',
      action: 'drafted PRD',
      target: 'PRD-022',
      at: '12m ago',
    },
    {
      id: 'a3',
      actor: 'Mira Chen',
      initials: 'MC',
      action: 'merged story',
      target: 'FORA-432',
      at: '1h ago',
    },
    {
      id: 'a4',
      actor: 'agent:dev',
      initials: 'AD',
      action: 'opened run on',
      target: 'FORA-440',
      at: '3h ago',
    },
    {
      id: 'a5',
      actor: 'Jonas Vidal',
      initials: 'JV',
      action: 'commented on',
      target: 'B-009',
      at: 'yesterday',
    },
  ];
}
