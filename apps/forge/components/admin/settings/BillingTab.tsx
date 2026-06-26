'use client';

/**
 * Settings — Billing tab (Step-47 Enterprise section).
 *
 * Current plan banner · 4 KPI tiles (active agents / runs / LLM
 * tokens / storage) · invoice list · payment method · 12-month
 * usage chart (Recharts) · Manage subscription + Cancel buttons.
 */

import * as React from 'react';
import {
  Receipt,
  CreditCard,
  Download,
  Sparkles,
  Users,
  PlayCircle,
  Coins,
  HardDrive,
  ChevronRight,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Kpi {
  id: string;
  label: string;
  value: string;
  meta: string;
  progress?: number; // 0–1
  Icon: LucideIcon;
  accent: string;
}

const KPIS: ReadonlyArray<Kpi> = [
  { id: 'agents',  label: 'Active agents', value: '8 / 10',  meta: '2 seats remaining', progress: 0.8,  Icon: Users,      accent: 'var(--accent-emerald)' },
  { id: 'runs',    label: 'Runs this month', value: '2,847', meta: '+18% vs last month',                                   Icon: PlayCircle, accent: 'var(--accent-cyan)' },
  { id: 'tokens',  label: 'LLM tokens',    value: '1.2M',   meta: '78% of 1.5M quota', progress: 0.78,                    Icon: Coins,      accent: 'var(--accent-violet)' },
  { id: 'storage', label: 'Storage',       value: '4.2 GB', meta: '21% of 20 GB',     progress: 0.21,                    Icon: HardDrive,  accent: 'var(--accent-amber)' },
];

const INVOICES = [
  { id: 'inv-2026-06', date: '2026-06-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2026-05', date: '2026-05-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2026-04', date: '2026-04-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2026-03', date: '2026-03-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2026-02', date: '2026-02-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2026-01', date: '2026-01-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2025-12', date: '2025-12-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2025-11', date: '2025-11-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2025-10', date: '2025-10-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2025-09', date: '2025-09-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2025-08', date: '2025-08-01', amount: 49.0, status: 'paid' },
  { id: 'inv-2025-07', date: '2025-07-01', amount: 49.0, status: 'paid' },
] as const;

const USAGE_HISTORY = [
  { month: 'Jul', runs: 1840, tokens: 0.7, storage: 2.1 },
  { month: 'Aug', runs: 1920, tokens: 0.8, storage: 2.3 },
  { month: 'Sep', runs: 2080, tokens: 0.9, storage: 2.6 },
  { month: 'Oct', runs: 2210, tokens: 0.95, storage: 2.8 },
  { month: 'Nov', runs: 2390, tokens: 1.0, storage: 3.1 },
  { month: 'Dec', runs: 2510, tokens: 1.05, storage: 3.4 },
  { month: 'Jan', runs: 2620, tokens: 1.1, storage: 3.7 },
  { month: 'Feb', runs: 2710, tokens: 1.12, storage: 3.9 },
  { month: 'Mar', runs: 2740, tokens: 1.13, storage: 4.0 },
  { month: 'Apr', runs: 2780, tokens: 1.15, storage: 4.1 },
  { month: 'May', runs: 2810, tokens: 1.18, storage: 4.15 },
  { month: 'Jun', runs: 2847, tokens: 1.2, storage: 4.2 },
];

export function BillingTab() {
  const [cancelOpen, setCancelOpen] = React.useState(false);
  return (
    <div className="flex flex-col gap-6" data-testid="billing-tab">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
            Billing
          </h2>
          <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Plan, usage, and invoices for this workspace.
          </p>
        </div>
        <Button variant="outline" data-testid="billing-manage-plan">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Manage plan
        </Button>
      </header>

      {/* Plan banner */}
      <section
        className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--accent-primary)]/30 bg-gradient-to-br from-[var(--accent-primary)]/10 to-transparent p-5"
        data-testid="billing-plan-banner"
      >
        <div>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-primary)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-primary)]">
            Current plan
          </span>
          <p className="mt-2 text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
            Forge Pro · $49/month · 8 of 10 seats
          </p>
          <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
            Next invoice: 2026-07-01
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelOpen(true)}
            className="text-[var(--accent-rose)]"
            data-testid="billing-cancel"
          >
            Cancel subscription
          </Button>
          <Button size="sm" data-testid="billing-upgrade">
            Upgrade
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </section>

      {/* KPIs */}
      <section
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="billing-kpis"
      >
        {KPIS.map((k) => (
          <KpiTile key={k.id} kpi={k} />
        ))}
      </section>

      {/* Usage chart */}
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
        data-testid="billing-usage"
      >
        <header className="flex items-center justify-between pb-3">
          <div>
            <h3 className="text-[var(--text-base)] font-semibold text-[var(--fg-primary)]">
              Usage history
            </h3>
            <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              Runs by month · last 12 months
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
            Aggregated
          </span>
        </header>
        <div className="h-56 w-full" data-testid="billing-usage-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={USAGE_HISTORY} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="billing-runs-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="month"
                stroke="var(--fg-tertiary)"
                tick={{ fill: 'var(--fg-tertiary)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
              />
              <YAxis
                stroke="var(--fg-tertiary)"
                tick={{ fill: 'var(--fg-tertiary)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  color: 'var(--fg-primary)',
                  fontSize: 12,
                }}
                cursor={{ stroke: 'var(--accent-primary)', strokeOpacity: 0.3 }}
              />
              <Area
                type="monotone"
                dataKey="runs"
                stroke="var(--accent-primary)"
                fill="url(#billing-runs-gradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Payment method */}
      <section
        className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
        data-testid="billing-payment"
      >
        <div className="flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-[var(--fg-secondary)]" aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
              Visa ending in 4242
            </span>
            <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              Expires 09/2028
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" data-testid="billing-update-payment">
          Update
        </Button>
      </section>

      {/* Invoices */}
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        data-testid="billing-invoices"
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5">
          <div>
            <h3 className="text-[var(--text-base)] font-semibold text-[var(--fg-primary)]">
              Invoices
            </h3>
            <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              Last 12 months
            </p>
          </div>
          <Receipt className="h-4 w-4 text-[var(--fg-secondary)]" aria-hidden="true" />
        </header>
        <ul className="divide-y divide-[var(--border-subtle)]">
          {INVOICES.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
              data-testid={`invoice-${inv.id}`}
            >
              <span className="font-mono text-[var(--text-xs)] text-[var(--fg-secondary)]">
                {inv.id}
              </span>
              <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                {new Date(inv.date).toLocaleDateString()}
              </span>
              <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                ${inv.amount.toFixed(2)}
              </span>
              <span
                className={cn(
                  'inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider',
                  inv.status === 'paid'
                    ? 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]'
                    : 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]',
                )}
              >
                {inv.status}
              </span>
              <Button variant="ghost" size="sm" data-testid={`invoice-download-${inv.id}`}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                PDF
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {cancelOpen ? (
        <CancelConfirmDialog onClose={() => setCancelOpen(false)} />
      ) : null}
    </div>
  );
}

/* ---------------- KPI Tile ---------------- */

function KpiTile({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.Icon;
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
      data-testid={`kpi-${kpi.id}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
          {kpi.label}
        </span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${kpi.accent} 18%, transparent)` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: kpi.accent }} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
        {kpi.value}
      </p>
      <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">{kpi.meta}</p>
      {typeof kpi.progress === 'number' ? (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-inset)]"
          data-testid={`kpi-progress-${kpi.id}`}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.round(kpi.progress * 100))}%`,
              backgroundColor: kpi.accent,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Cancel Dialog ---------------- */

function CancelConfirmDialog({ onClose }: { onClose: () => void }) {
  const [confirm, setConfirm] = React.useState('');
  const ok = confirm.trim().toLowerCase() === 'cancel';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="billing-cancel-dialog"
    >
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-xl">
        <h3 className="text-[var(--text-lg)] font-semibold text-[var(--fg-primary)]">
          Cancel subscription?
        </h3>
        <p className="mt-2 text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Your workspace will switch to the free tier at the end of the current billing period
          (2026-07-01). Existing data is retained for 30 days.
        </p>
        <p className="mt-3 text-[var(--text-xs)] text-[var(--fg-tertiary)]">
          Type <code className="font-mono">cancel</code> to confirm.
        </p>
        <input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-2 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          data-testid="billing-cancel-input"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep subscription
          </Button>
          <Button
            variant="destructive"
            disabled={!ok}
            onClick={onClose}
            data-testid="billing-cancel-confirm"
          >
            Cancel subscription
          </Button>
        </div>
      </div>
    </div>
  );
}
