'use client';

import * as React from 'react';
import {
  Cpu,
  Server,
  Gauge,
  DollarSign,
  GitFork,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
  BarChart3,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { MODELS, PROVIDERS, RATE_LIMITS, ROUTING_RULES, SPEND_CAPS } from '@/lib/governance-v2';
import type { LlmModel, LlmProvider, RateLimit, SpendCap } from '@/lib/governance-v2';
import { cn } from '@/lib/utils';

const providerColorVar: Record<string, string> = {
  cyan: 'var(--accent-cyan)',
  emerald: 'var(--accent-emerald)',
  indigo: 'var(--accent-primary)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
};

const providerTypeLabel: Record<LlmProvider['type'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
  'aws-bedrock': 'AWS Bedrock',
  azure: 'Azure OpenAI',
  custom: 'Custom Endpoint',
};

// Mock observability data
const REQUEST_VOLUME = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, '0')}:00`,
  requests: Math.floor(800 + Math.sin(i / 3) * 400 + Math.random() * 200),
  errors: Math.floor(20 + Math.random() * 30),
}));

const LATENCY_DATA = MODELS.slice(0, 6).map((m) => ({
  name: m.name,
  p50: Math.floor(m.avgLatency * 0.7),
  p95: Math.floor(m.avgLatency * 1.4),
  p99: Math.floor(m.avgLatency * 2.1),
}));

const SPEND_BY_MODEL = MODELS.map((m) => ({ name: m.name, spend: m.requestCount * ((m.inputCost + m.outputCost) / 2) / 1000 }));

const TOKEN_USAGE = MODELS.slice(0, 6).map((m) => ({ name: m.name, tokens: m.requestCount * 4500 }));

const TOP_USERS = [
  { user: 'jane.cto', requests: 4280, spend: 87.40 },
  { user: 'eng-lead', requests: 3120, spend: 64.20 },
  { user: 'support-bot', requests: 6230, spend: 28.10 },
  { user: 'crm-bot', requests: 4520, spend: 21.30 },
  { user: 'researcher-ai', requests: 2840, spend: 98.20 },
];

function ProvidersTab() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="providers-grid">
      {PROVIDERS.map((p) => (
        <div key={p.id} className={cn('flex flex-col gap-3 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-4', p.enabled ? 'border-[var(--border-subtle)]' : 'border-[var(--border-subtle)] opacity-60')} data-testid={`provider-${p.id}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)]"
                style={{ background: `${providerColorVar[p.color]}15`, color: providerColorVar[p.color] }}
                aria-hidden
              >
                <Server className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-[var(--fg-primary)]">{p.name}</h4>
                <p className="text-[10px] text-[var(--fg-tertiary)]">{providerTypeLabel[p.type]}</p>
              </div>
            </div>
            <Switch checked={p.enabled} data-testid={`provider-toggle-${p.id}`} />
          </div>

          <div className="space-y-1 font-mono text-[11px]">
            <div className="flex justify-between"><span className="text-[var(--fg-tertiary)]">API Key</span><span className="text-[var(--fg-primary)]">{p.apiKeyMasked}</span></div>
            {p.endpoint ? (
              <div className="flex justify-between"><span className="text-[var(--fg-tertiary)]">Endpoint</span><span className="text-[var(--fg-primary)] truncate ml-2 max-w-[180px]">{p.endpoint}</span></div>
            ) : null}
            <div className="flex justify-between"><span className="text-[var(--fg-tertiary)]">Last Test</span><span className="text-[var(--fg-primary)]">{new Date(p.lastTest).toLocaleTimeString()}</span></div>
            <div className="flex justify-between"><span className="text-[var(--fg-tertiary)]">Requests</span><span className="text-[var(--fg-primary)] tabular-nums">{p.requestCount.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-[var(--fg-tertiary)]">Spend</span><span className="text-[var(--fg-primary)] tabular-nums">${p.spend.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--fg-tertiary)]">Error Rate</span>
              <span className={cn('tabular-nums', p.errorRate > 0.5 ? 'text-[var(--accent-rose)]' : p.errorRate > 0.3 ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-emerald)]')}>{p.errorRate.toFixed(1)}%</span>
            </div>
          </div>

          <Button size="sm" variant="outline" className="h-7 text-[11px]">
            <CheckCircle2 className="h-3 w-3" />Test connection
          </Button>
        </div>
      ))}
    </div>
  );
}

function ModelsTab() {
  return (
    <div className="space-y-3" data-testid="models-table">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-[var(--fg-secondary)]">
          <span className="font-mono font-semibold text-[var(--fg-primary)]">{MODELS.filter((m) => m.enabled).length}</span> of {MODELS.length} models enabled
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--fg-tertiary)]">Restrict to allowlist</span>
          <Switch defaultChecked />
          <Button size="sm"><Plus className="h-3 w-3" />Add custom model</Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-inset)]">
              {['Model', 'Provider', 'Context', 'Cost (1M)', 'Requests', 'Errors', 'Latency', 'Enabled'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {MODELS.map((m) => {
              const provider = PROVIDERS.find((p) => p.id === m.provider);
              return (
                <tr key={m.id} className="hover:bg-[var(--bg-inset)]" data-testid={`model-row-${m.id}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden />
                      <span className="font-medium text-[var(--fg-primary)]">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[var(--fg-secondary)]">{provider?.name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-[var(--fg-secondary)]">{(m.contextWindow / 1000).toFixed(0)}K</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-[var(--fg-secondary)]">${m.inputCost} / ${m.outputCost}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-[var(--fg-primary)]">{m.requestCount.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={cn('font-mono tabular-nums', m.errorRate > 0.4 ? 'text-[var(--accent-rose)]' : m.errorRate > 0.2 ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-emerald)]')}>
                      {m.errorRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-[var(--fg-secondary)]">{m.avgLatency}ms</td>
                  <td className="px-3 py-2"><Switch defaultChecked={m.enabled} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateLimitsTab() {
  return (
    <div className="space-y-3" data-testid="rate-limits">
      {RATE_LIMITS.map((rl) => {
        const warning = rl.currentUsage >= 0.8;
        const critical = rl.currentUsage >= 0.95;
        return (
          <div key={rl.id} className={cn('flex flex-col gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-4', critical ? 'border-[var(--accent-rose)]/30' : warning ? 'border-[var(--accent-amber)]/30' : 'border-[var(--border-subtle)]')} data-testid={`rate-limit-${rl.id}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">{rl.scope}</span>
                <span className="text-[12px] font-medium text-[var(--fg-primary)]">{rl.target}</span>
                {critical ? <AlertTriangle className="h-3.5 w-3.5 text-[var(--accent-rose)]" /> : warning ? <AlertTriangle className="h-3.5 w-3.5 text-[var(--accent-amber)]" /> : null}
              </div>
              <span className={cn('font-mono text-[12px] font-semibold tabular-nums', critical ? 'text-[var(--accent-rose)]' : warning ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-emerald)]')}>
                {Math.round(rl.currentUsage * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
              <div
                className={cn('h-full transition-all', critical ? 'bg-[var(--accent-rose)]' : warning ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-emerald)]')}
                style={{ width: `${rl.currentUsage * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
              <div className="rounded bg-[var(--bg-inset)] px-2 py-1">
                <p className="text-[9px] text-[var(--fg-tertiary)]">REQ/MIN</p>
                <p className="font-mono font-semibold text-[var(--fg-primary)] tabular-nums">{rl.requestsPerMinute}</p>
              </div>
              <div className="rounded bg-[var(--bg-inset)] px-2 py-1">
                <p className="text-[9px] text-[var(--fg-tertiary)]">REQ/DAY</p>
                <p className="font-mono font-semibold text-[var(--fg-primary)] tabular-nums">{rl.requestsPerDay.toLocaleString()}</p>
              </div>
              <div className="rounded bg-[var(--bg-inset)] px-2 py-1">
                <p className="text-[9px] text-[var(--fg-tertiary)]">TOKENS/DAY</p>
                <p className="font-mono font-semibold text-[var(--fg-primary)] tabular-nums">{(rl.tokensPerDay / 1000).toFixed(0)}K</p>
              </div>
              <div className="rounded bg-[var(--bg-inset)] px-2 py-1">
                <p className="text-[9px] text-[var(--fg-tertiary)]">SPEND/DAY</p>
                <p className="font-mono font-semibold text-[var(--fg-primary)] tabular-nums">${rl.spendPerDay}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SpendCapsTab() {
  return (
    <div className="space-y-3" data-testid="spend-caps">
      {SPEND_CAPS.map((sc) => {
        const pct = sc.current / sc.cap;
        const warning = pct >= sc.alertThreshold;
        return (
          <div key={sc.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-testid={`spend-cap-${sc.id}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[var(--accent-amber)]" aria-hidden />
                <span className="text-[12px] font-medium text-[var(--fg-primary)]">{sc.target} ({sc.period})</span>
                {sc.hardStop ? <span className="rounded-full bg-[var(--accent-rose)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--accent-rose)]">Hard stop</span> : null}
              </div>
              <span className={cn('font-mono text-[12px] font-semibold tabular-nums', warning ? 'text-[var(--accent-amber)]' : 'text-[var(--fg-primary)]')}>
                ${sc.current.toFixed(2)} / ${sc.cap.toFixed(2)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
              <div
                className={cn('h-full', warning ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-emerald)]')}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
              <span>Alert at {Math.round(sc.alertThreshold * 100)}% ({Math.round(sc.alertThreshold * sc.cap)}$)</span>
              <span>{Math.round(pct * 100)}% used</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ObservabilityTab() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="observability">
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">Request volume (24h)</h4>
          <BarChart3 className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden />
        </div>
        <div className="mt-3 h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={REQUEST_VOLUME}>
              <defs>
                <linearGradient id="reqGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--fg-tertiary)' }} interval={3} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--fg-tertiary)' }} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11 }} />
              <Area type="monotone" dataKey="requests" stroke="var(--accent-primary)" fill="url(#reqGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">Latency p50/p95/p99 by model</h4>
        <div className="mt-3 h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={LATENCY_DATA} layout="vertical">
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--fg-tertiary)' }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: 'var(--fg-tertiary)' }} width={140} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="p50" fill="var(--accent-emerald)" />
              <Bar dataKey="p95" fill="var(--accent-amber)" />
              <Bar dataKey="p99" fill="var(--accent-rose)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">Spend by model (this month)</h4>
        <div className="mt-3 h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={SPEND_BY_MODEL}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--fg-tertiary)' }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--fg-tertiary)' }} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11 }} />
              <Bar dataKey="spend" fill="var(--accent-amber)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">Top users by consumption</h4>
        <div className="mt-3 space-y-2">
          {TOP_USERS.map((u) => (
            <div key={u.user} className="flex items-center justify-between rounded bg-[var(--bg-inset)] px-3 py-2">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden />
                <span className="font-mono text-[11px] text-[var(--fg-primary)]">{u.user}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] tabular-nums">
                <span className="text-[var(--fg-tertiary)]">{u.requests.toLocaleString()} req</span>
                <span className="font-semibold text-[var(--fg-primary)]">${u.spend.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RoutingTab() {
  return (
    <div className="space-y-3" data-testid="routing-rules">
      {ROUTING_RULES.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-testid={`routing-rule-${r.id}`}>
          <GitFork className="h-4 w-4 shrink-0 text-[var(--accent-violet)]" aria-hidden />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">{r.name}</h4>
              <span className="rounded-full bg-[var(--accent-violet)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--accent-violet)]">{r.strategy}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <span className="text-[var(--fg-tertiary)]">When</span>
              <code className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-primary)]">{r.condition}</code>
              <span className="text-[var(--fg-tertiary)]">→</span>
              <span className="font-mono font-semibold text-[var(--accent-primary)]">{r.model}</span>
              {r.fallback ? (
                <>
                  <span className="text-[var(--fg-tertiary)]">→</span>
                  <span className="font-mono text-[var(--fg-secondary)]">{r.fallback}</span>
                </>
              ) : null}
            </div>
          </div>
          <Switch defaultChecked />
        </div>
      ))}
    </div>
  );
}

export function LlmTab() {
  return (
    <Tabs defaultValue="providers" className="space-y-4" data-testid="llm-tab">
      <TabsList className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
        {[
          { id: 'providers', label: 'Providers', icon: Server, count: PROVIDERS.length },
          { id: 'models', label: 'Models', icon: Cpu, count: MODELS.length },
          { id: 'rate-limits', label: 'Rate Limits', icon: Gauge, count: RATE_LIMITS.length },
          { id: 'spend-caps', label: 'Spend Caps', icon: DollarSign, count: SPEND_CAPS.length },
          { id: 'routing', label: 'Routing', icon: GitFork, count: ROUTING_RULES.length },
          { id: 'observability', label: 'Observability', icon: Activity },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1 text-[12px] data-[state=active]:bg-[var(--bg-elevated)] data-[state=active]:text-[var(--fg-primary)] data-[state=active]:shadow-sm"
              data-testid={`llm-tab-${t.id}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span>{t.label}</span>
              {t.count != null ? (
                <span className="rounded-full bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono tabular-nums">{t.count}</span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="providers" className="m-0"><ProvidersTab /></TabsContent>
      <TabsContent value="models" className="m-0"><ModelsTab /></TabsContent>
      <TabsContent value="rate-limits" className="m-0"><RateLimitsTab /></TabsContent>
      <TabsContent value="spend-caps" className="m-0"><SpendCapsTab /></TabsContent>
      <TabsContent value="routing" className="m-0"><RoutingTab /></TabsContent>
      <TabsContent value="observability" className="m-0"><ObservabilityTab /></TabsContent>
    </Tabs>
  );
}