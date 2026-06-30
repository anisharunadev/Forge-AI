'use client';

/**
 * Agent Center — Bento grid layout (Step 4 redesign).
 *
 * Per spec, the Agents tab is rebuilt as a Bento grid:
 *   Row 1 (full, 220px)  — Hero "Build your AI workforce"
 *   Row 2 (4 × 160px)    — KPI tiles (Total / Active / Latency / Success)
 *   Row 3 (2/3 + 1/3)    — Recent agents (5 rows) + 7×24 activity heatmap
 *   Row 4 (full, auto)   — Top providers vertical bar chart
 *
 * Constraints adopted from skill searches:
 *   - 12-col grid via Tailwind grid (style: bento grid)
 *   - rounded --radius-xl cards, --bg-surface, --border-subtle
 *   - Recharts not installed → pure SVG sparklines (matches style:
 *     data-dense dashboard; small footprint, semantic palette)
 *   - Hero border: 1px conic-gradient (indigo → violet → cyan) masked
 *     to the card with @keyframes spin 8s linear infinite
 *   - prefers-reduced-motion: animations paused via media query
 *   - ux "Color Only" rule: every status is also a textual label,
 *     not just a colored dot
 */

import * as React from 'react';
import { Bot, Plus, Download, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Agent, ModelProvider } from '@/lib/agent-center/data';
import { useTopProviders } from '@/lib/query/hooks';

const SEMANTIC = {
  indigo: 'var(--accent-primary)',
  cyan: 'var(--accent-cyan)',
  amber: 'var(--accent-amber)',
  emerald: 'var(--accent-emerald)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
} as const;

const SAMPLE_KPIS = {
  total: { value: 24, delta: '+3 this week', trend: [4, 5, 6, 6, 7, 9, 11, 12, 14, 16, 20, 24] },
  active: { value: 7, delta: '+2 today', trend: [2, 3, 3, 4, 5, 5, 6, 6, 7, 7, 7, 7] },
  latency: { value: '342ms', delta: '−18ms', trend: [410, 420, 405, 380, 360, 350, 345, 340, 338, 335, 340, 342] },
  success: { value: '97.2%', delta: '+0.4%', trend: [94, 95, 95, 96, 96, 96, 97, 97, 97, 97, 97, 97.2] },
};

const STATUS_DOT: Record<Agent['status'], string> = {
  active: 'bg-[var(--accent-emerald)] shadow-[0_0_8px_var(--accent-emerald)]',
  idle: 'bg-[var(--fg-muted)]',
  degraded: 'bg-[var(--accent-amber)]',
  offline: 'bg-[var(--accent-rose)]',
};

function Sparkline({ data, color, height = 60 }: { data: ReadonlyArray<number>; color: string; height?: number }) {
  const width = 200;
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1 || 1);
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${(height - 4 - ((v - min) / range) * (height - 8)).toFixed(1)}`);
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const gradId = React.useId();
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-[60px] w-full"
      role="img"
      aria-label="Trend"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function ActivityHeatmap() {
  // 7 days × 24 hours = 168 cells, intensity 0..4
  // Use a deterministic pseudo-random pattern so SSR matches CSR.
  const cells = React.useMemo(() => {
    const out: number[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const peak = h >= 9 && h <= 18 ? 1 : 0;
        const v = ((d * 7 + h * 13) % 11) / 11;
        out.push(Math.min(4, Math.floor(v * 3 * (0.4 + peak * 0.6))));
      }
    }
    return out;
  }, []);
  const intensityToBg = (i: number) => {
    if (i === 0) return 'var(--bg-inset)';
    if (i === 1) return 'color-mix(in srgb, var(--accent-primary) 20%, var(--bg-inset))';
    if (i === 2) return 'color-mix(in srgb, var(--accent-primary) 45%, var(--bg-inset))';
    if (i === 3) return 'color-mix(in srgb, var(--accent-primary) 70%, var(--bg-inset))';
    return 'var(--accent-primary)';
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">00</span>
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          role="img"
          aria-label="Activity heatmap of runs in the last 7 days, hourly buckets"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="font-mono text-[9px] text-[var(--fg-tertiary)] text-center">
              {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
            </span>
          )).map((el, i) => <React.Fragment key={i}>{el}</React.Fragment>)}
        </div>
      </div>
      {Array.from({ length: 7 }, (_, day) => (
        <div key={day} className="grid grid-cols-[auto_1fr] items-center gap-2">
          <span className="w-6 font-mono text-[10px] text-[var(--fg-tertiary)]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day]}
          </span>
          <div
            className="grid gap-[2px]"
            style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
            data-testid={`heatmap-row-${day}`}
          >
            {cells.slice(day * 24, day * 24 + 24).map((i, h) => (
              <div
                key={h}
                className="aspect-square rounded-[var(--radius-sm)]"
                style={{ background: intensityToBg(i) }}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      ))}
      <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">Runs in the last 7 days</p>
    </div>
  );
}

function TopProvidersChart({ days = 7 }: { days?: number } = {}) {
  // Zone 2 (step-54) — wire to real backend data. Source of truth
  // is `GET /dashboard/top-providers` which aggregates
  // `litellm_call_records` joined to `model_providers` on
  // `litellm_model_alias`. Each row carries `run_count`, `total_cost`,
  // `avg_duration_seconds`, `success_rate`, and the resolved
  // `provider_name` so the chart can render a human label.
  const { data, isLoading, isError, error } = useTopProviders(days);

  if (isLoading) {
    return (
      <p
        className="text-sm text-[var(--fg-tertiary)]"
        data-testid="top-providers-loading"
      >
        Loading top providers…
      </p>
    );
  }

  if (isError) {
    return (
      <p
        className="text-sm text-[var(--accent-rose)]"
        data-testid="top-providers-error"
        role="alert"
      >
        {(error as { message?: string })?.message ??
          'Could not load provider stats. Retry in a moment.'}
      </p>
    );
  }

  const rows = (data ?? []).slice(0, 5);
  if (rows.length === 0) {
    return (
      <p
        className="text-sm text-[var(--fg-tertiary)]"
        data-testid="top-providers-empty"
      >
        No LLM traffic recorded yet for this tenant. Once agents start
        calling providers, the top performers will appear here.
      </p>
    );
  }

  const max = Math.max(...rows.map((r) => r.run_count)) || 1;
  return (
    <div
      className="flex flex-col gap-3"
      role="img"
      aria-label={`Top ${rows.length} providers by call volume over last ${days} days`}
    >
      {rows.map((row) => {
        const pct = (row.run_count / max) * 100;
        const label = row.provider_name || row.model;
        const testKey = row.provider_id ?? row.model;
        return (
          <div
            key={testKey}
            className="grid grid-cols-[140px_1fr_80px] items-center gap-3"
            data-testid={`provider-bar-${testKey}`}
          >
            <span className="truncate text-sm text-[var(--fg-primary)]" title={label}>
              {label}
            </span>
            <div className="h-2 overflow-hidden rounded-[var(--radius-md)] bg-[var(--bg-inset)]">
              <div
                className="h-full rounded-[var(--radius-md)] bg-[var(--accent-primary)] transition-[width] duration-200 ease-out-soft"
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
            </div>
            <span
              className="text-right font-mono text-xs text-[var(--fg-secondary)]"
              title={`${row.run_count.toLocaleString()} calls · $${row.total_cost.toFixed(2)} · ${row.success_rate.toFixed(1)}% success`}
            >
              {row.run_count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HeroCard({ onRegister, onImportTemplate }: { onRegister?: () => void; onImportTemplate?: () => void }) {
  return (
    <div
      className="hero-border relative overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg-surface)] p-8"
      data-testid="agent-center-hero"
    >
      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent-primary)]">
            Get started
          </p>
          <h2 className="mt-2 text-[var(--text-2xl)] font-bold leading-tight text-[var(--fg-primary)]">
            Build your AI workforce
          </h2>
          <p className="mt-3 max-w-xl text-sm text-[var(--fg-secondary)]">
            Register agents, attach tools, and assign them to projects.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={onRegister}
            className="bg-[var(--accent-primary)] text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]"
            data-testid="hero-register-agent"
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Register Agent
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onImportTemplate}
            className="text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
            data-testid="hero-import-template"
          >
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Import template
          </Button>
        </div>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  delta,
  trend,
  color,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  delta: string;
  trend: ReadonlyArray<number>;
  color: string;
  testId: string;
}) {
  return (
    <div
      className="card flex flex-col gap-2 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] transition-[transform,box-shadow] duration-200 ease-out-soft"
      data-testid={testId}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </span>
      <span className="text-[var(--text-3xl)] font-bold leading-none text-[var(--fg-primary)]">
        {value}
      </span>
      <Sparkline data={trend} color={color} />
      <span className="text-xs text-[var(--fg-tertiary)]">{delta}</span>
    </div>
  );
}

export interface AgentCenterBentoProps {
  agents: ReadonlyArray<Agent>;
  providers: ReadonlyArray<ModelProvider>;
  onSelectAgent?: (agent: Agent) => void;
  onRegisterAgent?: () => void;
  onImportTemplate?: () => void;
}

export function AgentCenterBento({
  agents,
  providers,
  onSelectAgent,
  onRegisterAgent,
  onImportTemplate,
}: AgentCenterBentoProps) {
  const recent = agents.slice(0, 5);

  return (
    <div
      className="mx-auto flex max-w-[1440px] flex-col gap-4 px-8"
      data-testid="agent-center-bento"
    >
      <HeroCard onRegister={onRegisterAgent} onImportTemplate={onImportTemplate} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Total Agents"
          value={SAMPLE_KPIS.total.value}
          delta={SAMPLE_KPIS.total.delta}
          trend={SAMPLE_KPIS.total.trend}
          color={SEMANTIC.indigo}
          testId="kpi-total-agents"
        />
        <KpiTile
          label="Active Runs"
          value={SAMPLE_KPIS.active.value}
          delta={SAMPLE_KPIS.active.delta}
          trend={SAMPLE_KPIS.active.trend}
          color={SEMANTIC.cyan}
          testId="kpi-active-runs"
        />
        <KpiTile
          label="Avg Latency"
          value={SAMPLE_KPIS.latency.value}
          delta={SAMPLE_KPIS.latency.delta}
          trend={SAMPLE_KPIS.latency.trend}
          color={SEMANTIC.amber}
          testId="kpi-avg-latency"
        />
        <KpiTile
          label="Success Rate"
          value={SAMPLE_KPIS.success.value}
          delta={SAMPLE_KPIS.success.delta}
          trend={SAMPLE_KPIS.success.trend}
          color={SEMANTIC.emerald}
          testId="kpi-success-rate"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card xl:col-span-2" data-testid="recent-agents">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Recent agents</h3>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--fg-tertiary)]">No agents yet.</p>
          ) : (
            <ul role="list" className="mt-3 flex flex-col">
              {recent.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onSelectAgent?.(a)}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors duration-150 ease-out-soft hover:bg-[rgba(255,255,255,0.04)]"
                    data-testid={`recent-agent-${a.id}`}
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--fg-primary)]">
                      <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-[var(--fg-primary)]">{a.name}</p>
                      <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                        {a.type} · v{a.version}
                      </p>
                    </div>
                    <span
                      className={cn('h-2 w-2 rounded-full', STATUS_DOT[a.status])}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{a.status}</span>
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      {new Date(a.lastInvokedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card" data-testid="activity-heatmap">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Activity</h3>
          <div className="mt-3">
            <ActivityHeatmap />
          </div>
        </div>
      </div>

      <div className="card" data-testid="top-providers">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-semibold text-[var(--fg-primary)]">
            Top performing model providers
          </h3>
          <a
            href="#providers"
            className="inline-flex items-center gap-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            data-testid="view-all-providers"
          >
            View all
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
        <div className="mt-4">
          <TopProvidersChart days={7} />
        </div>
      </div>
    </div>
  );
}
