'use client';

/**
 * Overview tab — Bento layout dashboard.
 *
 * KPI strip + three rows of tiles (recent activity, quick access, recommended
 * + compliance, template usage + knowledge gaps). Static rendering: this tab
 * should load in <500ms per the Step 29 brief, so we defer charts and use
 * pure CSS bars instead of mounting Recharts here.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  BookMarked,
  Sparkles,
  Users,
  Clock,
  ShieldCheck,
  ArrowRight,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts';

import { cn } from '@/lib/utils';
import {
  ACTIVITY,
  ADOPTION_BADGES,
  DRIFT_ALERTS,
  KNOWLEDGE_GAPS,
  KPIS,
  PROJECTS,
  QUICK_ACCESS,
  RECOMMENDED,
  TEMPLATE_USAGE,
  type OverviewKpi,
} from './sample-data';

const ICON_MAP = {
  book: BookMarked,
  sparkles: Sparkles,
  users: Users,
  clock: Clock,
  shield: ShieldCheck,
} as const;

const TONE_CLASS: Record<OverviewKpi['tone'], string> = {
  indigo: 'text-[var(--accent-primary)]',
  emerald: 'text-[var(--accent-emerald)]',
  cyan: 'text-[var(--accent-cyan)]',
  amber: 'text-[var(--accent-amber)]',
  violet: 'text-[var(--accent-violet)]',
};

const ACTION_VERB: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  approved: 'approved',
  archived: 'archived',
  published: 'published',
};

const ACTION_COLOR: Record<string, string> = {
  created: 'var(--accent-cyan)',
  updated: 'var(--accent-primary)',
  approved: 'var(--accent-emerald)',
  archived: 'var(--fg-muted)',
  published: 'var(--accent-violet)',
};

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function OverviewTab() {
  return (
    <div className="flex flex-col gap-6" data-testid="ok-overview">
      {/* Adoption banner (Zone 13.E — gamification) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3" data-testid="ok-adoption-banner">
        {ADOPTION_BADGES.map((b, idx) => (
          <div
            key={idx}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 px-3 py-2 text-xs text-[var(--fg-secondary)]"
          >
            <span className="text-base leading-none" aria-hidden="true">
              {b.icon === 'trophy' ? '🏆' : b.icon === 'medal' ? '🥇' : '✨'}
            </span>
            <span>{b.label}</span>
          </div>
        ))}
      </div>

      {/* KPI strip */}
      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        aria-label="Knowledge KPIs"
        data-testid="ok-kpi-strip"
      >
        {KPIS.map((kpi, idx) => {
          const Icon = ICON_MAP[kpi.iconKey];
          return (
            <motion.div
              key={kpi.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.2 }}
              className="flex h-[120px] flex-col justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              data-testid={`ok-kpi-${kpi.id}`}
            >
              <div className="flex items-start justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {kpi.label}
                </p>
                <Icon className={cn('h-4 w-4', TONE_CLASS[kpi.tone])} aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--fg-primary)]">{kpi.value}</p>
                {kpi.delta ? (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">{kpi.delta}</p>
                ) : null}
              </div>
            </motion.div>
          );
        })}
      </section>

      {/* Row 1 — Activity | Quick access | Recommended */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3" style={{ minHeight: 320 }}>
        <motion.div
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 lg:col-span-2"
          data-testid="ok-tile-recent-activity"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Recent activity</h3>
            <button
              type="button"
              data-testid="ok-recent-all"
              className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              All activity <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </header>
          <ol className="flex flex-col gap-2.5">
            {ACTIVITY.slice(0, 8).map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-3 rounded-[var(--radius-sm)] px-1 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)]"
                data-testid="ok-activity-row"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ACTION_COLOR[event.action] }}
                />
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-primary)]">
                  {event.actor.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-[var(--fg-primary)]">{event.actor}</span>{' '}
                  <span className="text-[var(--fg-tertiary)]">{ACTION_VERB[event.action]}</span>{' '}
                  <button
                    type="button"
                    data-testid="ok-activity-ref"
                    className="rounded-[var(--radius-sm)] font-mono text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    {event.ref.label}
                  </button>
                  {event.summary ? (
                    <span className="ml-2 font-mono text-[10px] text-[var(--fg-tertiary)]">{event.summary}</span>
                  ) : null}
                </span>
                <time className="shrink-0 font-mono text-[10px] text-[var(--fg-tertiary)]">
                  {relTime(event.when)}
                </time>
              </li>
            ))}
          </ol>
        </motion.div>

        <motion.div
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
          data-testid="ok-tile-quick-access"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.05 }}
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Quick access</h3>
            <button
              type="button"
              className="text-xs text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              Manage
            </button>
          </header>
          <ul className="flex flex-col gap-1">
            {QUICK_ACCESS.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  data-testid="ok-quick-row"
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                >
                  <span className="truncate font-medium">{q.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--fg-tertiary)]">
                    {q.uses} views
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 lg:col-span-3"
          data-testid="ok-tile-recommended"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.1 }}
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
              Recommended for you
            </h3>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">AI-curated · based on your role + recent activity</span>
          </header>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {RECOMMENDED.map((rec) => (
              <li key={rec.id}>
                <button
                  type="button"
                  data-testid="ok-recommended-card"
                  className={cn(
                    'flex h-full w-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-left transition-colors duration-150',
                    'hover:-translate-y-0.5 hover:border-[var(--accent-primary)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                        rec.tone === 'warning' && 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]',
                        rec.tone === 'info' && 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]',
                        rec.tone === 'positive' && 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]',
                      )}
                    >
                      {rec.tone === 'warning' ? 'Migration' : rec.tone === 'info' ? 'For you' : 'Hot topic'}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{rec.refId}</span>
                  </div>
                  <p className="text-sm font-semibold text-[var(--fg-primary)]">{rec.title}</p>
                  <p className="text-xs text-[var(--fg-secondary)]">{rec.reason}</p>
                </button>
              </li>
            ))}
          </ul>
        </motion.div>
      </section>

      {/* Row 2 — Compliance | Template usage */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" style={{ minHeight: 280 }}>
        <motion.div
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
          data-testid="ok-tile-compliance"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.15 }}
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Compliance by project</h3>
            <button
              type="button"
              className="text-xs text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              Details
            </button>
          </header>
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-elevated)] text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                  <th className="px-3 py-2 text-right font-medium">Compliance</th>
                  <th className="px-3 py-2 text-left font-medium">Last audit</th>
                </tr>
              </thead>
              <tbody>
                {PROJECTS.slice(0, 5).map((p) => {
                  const color =
                    p.compliance >= 90
                      ? 'bg-[var(--accent-emerald)]'
                      : p.compliance >= 70
                        ? 'bg-[var(--accent-amber)]'
                        : 'bg-[var(--accent-rose)]';
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--border-subtle)] text-[var(--fg-secondary)]"
                      data-testid="ok-compliance-row"
                    >
                      <td className="px-3 py-2 font-medium text-[var(--fg-primary)]">{p.name}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                            <div
                              className={cn('h-full rounded-full', color)}
                              style={{ width: `${p.compliance}%` }}
                              aria-hidden="true"
                            />
                          </div>
                          <span className="font-mono text-[10px]">{p.compliance}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[var(--fg-tertiary)]">
                        {p.lastAudit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-[var(--fg-tertiary)]">
            Showing 5 of {PROJECTS.length} projects —{' '}
            <button
              type="button"
              className="text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              view all
            </button>
          </p>
        </motion.div>

        <motion.div
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
          data-testid="ok-tile-template-usage"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.2 }}
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Most-used templates</h3>
            <button
              type="button"
              className="text-xs text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              All templates
            </button>
          </header>
          <div className="h-[200px]" data-testid="ok-template-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={TEMPLATE_USAGE}
                margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="var(--fg-tertiary)"
                  tick={{ fontSize: 10 }}
                  width={120}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: 'var(--fg-primary)' }}
                />
                <Bar dataKey="uses" radius={[0, 4, 4, 0]}>
                  {TEMPLATE_USAGE.map((t, idx) => (
                    <Cell
                      key={t.id}
                      fill={
                        t.type === 'prd'
                          ? 'var(--accent-primary)'
                          : t.type === 'adr'
                            ? 'var(--accent-violet)'
                            : t.type === 'bug'
                              ? 'var(--accent-rose)'
                              : t.type === 'runbook'
                                ? 'var(--accent-emerald)'
                                : t.type === 'rfc'
                                  ? 'var(--accent-amber)'
                                  : t.type === 'spec'
                                    ? 'var(--accent-cyan)'
                                    : 'var(--fg-tertiary)'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </section>

      {/* Row 3 — Knowledge gaps (full width) */}
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
        style={{ minHeight: 240 }}
        data-testid="ok-tile-knowledge-gaps"
      >
        <header className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
            Knowledge gaps
          </h3>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
            <AlertTriangle className="h-2.5 w-2.5 text-[var(--accent-amber)]" aria-hidden="true" />
            Detected by AI · analyzes codebase + recent runs
          </span>
        </header>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {KNOWLEDGE_GAPS.map((gap) => (
            <li
              key={gap.id}
              data-testid="ok-gap-row"
              className={cn(
                'flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3',
                gap.severity === 'high' && 'border-l-2 border-l-[var(--accent-rose)]',
                gap.severity === 'medium' && 'border-l-2 border-l-[var(--accent-amber)]',
                gap.severity === 'low' && 'border-l-2 border-l-[var(--accent-cyan)]',
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--fg-primary)]">{gap.title}</p>
                <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{gap.detail}</p>
              </div>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-2 py-1 text-[10px] font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                <Plus className="h-2.5 w-2.5" aria-hidden="true" /> Create now
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Drift detection (Zone 13.C) */}
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 p-5"
        data-testid="ok-drift-alerts"
      >
        <header className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--accent-amber)]" aria-hidden="true" />
            Drift detected — projects using outdated standards
          </h3>
        </header>
        <ul className="flex flex-col gap-2">
          {DRIFT_ALERTS.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs"
            >
              <p className="text-[var(--fg-primary)]">{d.title}</p>
              <button
                type="button"
                className="text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                View {d.affectedProjects} projects →
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}