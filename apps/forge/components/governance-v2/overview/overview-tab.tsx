'use client';

import * as React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  DollarSign,
  AlertTriangle,
  Pause,
  Play,
  TrendingUp,
  TrendingDown,
  Minus,
  FileCheck,
  GitBranch,
  Bot,
  TerminalSquare,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { KpiTile } from '../shared/kpi-tile';
import { Panel } from '../shared/panel';
import { ToneBadge, severityTone, decisionTone } from '../shared/severity-badge';
import { KPIS, LIVE_ACTIVITY } from '@/lib/governance-v2';
import { cn } from '@/lib/utils';

const decisionDot: Record<'allow' | 'warn' | 'block' | 'redact', string> = {
  allow: 'bg-[var(--accent-emerald)]',
  warn: 'bg-[var(--accent-amber)]',
  block: 'bg-[var(--accent-rose)]',
  redact: 'bg-[var(--accent-cyan)]',
};

export function OverviewTab() {
  const [paused, setPaused] = React.useState(false);
  const [activityIndex, setActivityIndex] = React.useState(0);

  // Simulate streaming new entries
  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setActivityIndex((i) => (i + 1) % LIVE_ACTIVITY.length);
    }, 2500);
    return () => clearInterval(id);
  }, [paused]);

  const visibleActivity = paused
    ? LIVE_ACTIVITY.slice(0, 12)
    : Array.from({ length: 12 }, (_, k) => LIVE_ACTIVITY[(activityIndex + k) % LIVE_ACTIVITY.length]!).filter(Boolean);

  return (
    <div className="space-y-4" data-testid="overview-tab">
      {/* ── KPI STRIP ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile
          label="Active Policies"
          value={String(KPIS.activePolicies.total)}
          sublabel={`${KPIS.activePolicies.strict} strict · ${KPIS.activePolicies.advisory} advisory`}
          tone="emerald"
          icon={<ShieldCheck className="h-4 w-4 text-[var(--accent-emerald)]" aria-hidden />}
        />
        <KpiTile
          label="Standards Met"
          value={`${KPIS.standards.percent}%`}
          sublabel={`${KPIS.standards.met} of ${KPIS.standards.total} standards`}
          tone="cyan"
          icon={<FileCheck className="h-4 w-4 text-[var(--accent-cyan)]" aria-hidden />}
        />
        <KpiTile
          label="Guardrails Firing"
          value={String(KPIS.guardrailsFiring.count24h)}
          sublabel="last 24h"
          tone="amber"
          delta={{ value: KPIS.guardrailsFiring.delta, unit: '%' }}
          icon={<ShieldAlert className="h-4 w-4 text-[var(--accent-amber)]" aria-hidden />}
        />
        <KpiTile
          label="LLM Spend Today"
          value={`$${KPIS.llmSpend.today.toFixed(2)}`}
          sublabel={`of $${KPIS.llmSpend.cap} daily cap`}
          tone="indigo"
          delta={{ value: KPIS.llmSpend.delta, unit: '%' }}
          progress={KPIS.llmSpend.today / KPIS.llmSpend.cap}
          icon={<DollarSign className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden />}
        />
        <KpiTile
          label="Violations"
          value={String(KPIS.violations.unresolved)}
          sublabel={`${KPIS.violations.critical} crit · ${KPIS.violations.high} high · ${KPIS.violations.medium} med`}
          tone="rose"
          icon={<AlertTriangle className="h-4 w-4 text-[var(--accent-rose)]" aria-hidden />}
        />
      </div>

      {/* ── ROW 1: Live Activity + Top Violations + Compliance ──────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <Panel
          title="Live Guardrail Activity"
          subtitle="Real-time stream of policy decisions"
          headerAction={
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1 text-[11px] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)]"
              aria-label={paused ? 'Resume stream' : 'Pause stream'}
              data-testid="activity-pause"
            >
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          }
          height="fixed-320"
          className="lg:col-span-2"
          dataTestId="panel-live-activity"
        >
          <div className="space-y-1.5">
            {visibleActivity.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--bg-inset)]"
                data-testid={`activity-${entry.id}`}
              >
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)] tabular-nums">
                  {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                </span>
                <span className={cn('h-2 w-2 shrink-0 rounded-full', decisionDot[entry.decision])} aria-hidden />
                <span className="flex-1 truncate text-[12px] font-medium text-[var(--fg-primary)]">{entry.rule}</span>
                <span className="hidden truncate text-[11px] text-[var(--fg-tertiary)] md:inline">{entry.actor}</span>
                <ToneBadge tone={decisionTone(entry.decision)} variant="outline">
                  {entry.decision}
                </ToneBadge>
                <span className="hidden font-mono text-[10px] text-[var(--fg-muted)] lg:inline">{entry.affectedRequest}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Top Violations" subtitle="Last 7 days" height="fixed-320" dataTestId="panel-top-violations">
          <div className="space-y-2">
            {KPIS.topViolations.map((v) => {
              const TrendIcon = v.trend === 'up' ? TrendingUp : v.trend === 'down' ? TrendingDown : Minus;
              const trendColor =
                v.trend === 'up' ? 'text-[var(--accent-rose)]' : v.trend === 'down' ? 'text-[var(--accent-emerald)]' : 'text-[var(--fg-tertiary)]';
              return (
                <button
                  key={v.policyId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2 text-left transition-colors hover:border-[var(--accent-amber)]/30"
                  data-testid={`violation-${v.policyId}`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[12px] font-medium text-[var(--fg-primary)]">{v.policyName}</span>
                    <span className="text-[10px] text-[var(--fg-tertiary)]">{v.count} violations</span>
                  </div>
                  <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', trendColor)}>
                    <TrendIcon className="h-3 w-3" aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Compliance Scorecard" subtitle="Composite score" height="fixed-320" dataTestId="panel-compliance-scorecard">
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-32 w-32">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--bg-inset)" strokeWidth="10" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--accent-emerald)"
                  strokeWidth="10"
                  strokeDasharray={`${(KPIS.totalComplianceScore / 100) * 264} 264`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-[var(--fg-primary)] tabular-nums">{KPIS.totalComplianceScore}%</span>
              </div>
            </div>
            <div className="w-full space-y-1.5">
              {KPIS.complianceByStandard.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--fg-secondary)]">{s.name}</span>
                  <span className="font-mono font-semibold text-[var(--fg-primary)] tabular-nums">{s.score}%</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── ROW 2: LLM Usage + Policy Coverage ─────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="LLM Usage Breakdown" subtitle="Spend by model (this month)" height="fixed-280" dataTestId="panel-llm-usage">
          <div className="flex h-full items-center gap-4">
            <div className="h-full w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={KPIS.llmUsageByModel.map((m) => ({ name: m.model, value: m.spend, color: `var(--accent-${m.color})` }))}
                    dataKey="value"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={2}
                  >
                    {KPIS.llmUsageByModel.map((m, i) => (
                      <Cell key={i} fill={`var(--accent-${m.color})`} stroke="var(--bg-surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={((value: number | string) => `$${Number(value).toFixed(2)}`) as never}
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {KPIS.llmUsageByModel.slice(0, 5).map((m) => (
                <div key={m.model} className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: `var(--accent-${m.color})` }}
                      aria-hidden
                    />
                    <span className="truncate text-[var(--fg-secondary)]">{m.model}</span>
                  </div>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{m.requests.toLocaleString()}</span>
                    <span className="font-semibold text-[var(--fg-primary)]">${m.spend.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Policy Coverage" subtitle="Workflows / agents / commands" height="fixed-280" dataTestId="panel-policy-coverage">
          <div className="flex h-full flex-col justify-around">
            {[
              { label: 'Workflows', covered: KPIS.policyCoverage.workflows.covered, total: KPIS.policyCoverage.workflows.total, icon: GitBranch },
              { label: 'Agents', covered: KPIS.policyCoverage.agents.covered, total: KPIS.policyCoverage.agents.total, icon: Bot },
              { label: 'Commands', covered: KPIS.policyCoverage.commands.covered, total: KPIS.policyCoverage.commands.total, icon: TerminalSquare },
            ].map(({ label, covered, total, icon: Icon }) => {
              const pct = total > 0 ? covered / total : 0;
              const tone = pct >= 0.95 ? 'emerald' : pct >= 0.8 ? 'amber' : 'rose';
              return (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="inline-flex items-center gap-2 text-[var(--fg-secondary)]">
                      <Icon className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden />
                      {label}
                    </span>
                    <span className="tabular-nums font-semibold text-[var(--fg-primary)]">
                      {covered} / {total}
                      <span className={`ml-2 text-[10px] font-medium ${tone === 'emerald' ? 'text-[var(--accent-emerald)]' : tone === 'amber' ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-rose)]'}`}>
                        ({Math.round(pct * 100)}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
                    <div
                      className={cn(
                        'h-full transition-all',
                        tone === 'emerald' ? 'bg-[var(--accent-emerald)]' : tone === 'amber' ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-rose)]',
                      )}
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">
              {KPIS.policyCoverage.workflows.total - KPIS.policyCoverage.workflows.covered} workflows unprotected.{' '}
              <a href="#" className="text-[var(--accent-cyan)] hover:underline">Review →</a>
            </p>
          </div>
        </Panel>
      </div>

      {/* ── ROW 3: Recent Policy Changes ───────────────────────────── */}
      <Panel title="Recent Policy Changes" subtitle="Last 10 events" height="fixed-200" dataTestId="panel-recent-changes">
        <div className="flex h-full items-center gap-3 overflow-x-auto">
          {KPIS.recentChanges.map((change) => {
            const typeTone =
              change.type === 'created' ? 'emerald'
              : change.type === 'updated' ? 'cyan'
              : change.type === 'deleted' ? 'rose'
              : 'amber';
            return (
              <div
                key={change.id}
                className="flex min-w-[220px] shrink-0 flex-col gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
                data-testid={`recent-${change.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <ToneBadge tone={typeTone} variant="outline">{change.type}</ToneBadge>
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                    {new Date(change.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-[var(--fg-primary)]">{change.subject}</p>
                <p className="text-[10px] text-[var(--fg-tertiary)]">by {change.actor}</p>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}