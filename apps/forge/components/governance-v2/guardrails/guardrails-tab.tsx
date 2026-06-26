'use client';

import * as React from 'react';
import {
  Fingerprint,
  KeyRound,
  AlertOctagon,
  ShieldAlert,
  Gauge,
  DollarSign,
  Cpu,
  Filter,
  Eraser,
  CheckCheck,
  Activity,
  Quote,
  FileLock,
  Sparkles,
  Ban,
  Mic,
  Languages,
  GripVertical,
  Settings,
  Play,
  TrendingUp,
  TrendingDown,
  TestTube,
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { GUARDRAILS } from '@/lib/governance-v2';
import type { GuardrailConfig, GuardrailStage } from '@/lib/governance-v2';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Fingerprint, KeyRound, AlertOctagon, ShieldAlert, Gauge, DollarSign, Cpu, Filter,
  Eraser, CheckCheck, Activity, Quote, FileLock, Sparkles, Ban, Mic, Languages,
};

const colorVar: Record<string, string> = {
  rose: 'var(--accent-rose)',
  amber: 'var(--accent-amber)',
  cyan: 'var(--accent-cyan)',
  emerald: 'var(--accent-emerald)',
  violet: 'var(--accent-violet)',
  indigo: 'var(--accent-primary)',
};

function GuardrailIcon({ name, className }: { name: string; className?: string }) {
  const Icon = iconMap[name] ?? Filter;
  return <Icon className={className} aria-hidden />;
}

function GuardrailCard({ guardrail, onToggle }: { guardrail: GuardrailConfig; onToggle: (id: string, enabled: boolean) => void }) {
  const [showTest, setShowTest] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [testInput, setTestInput] = React.useState('');
  const [testResult, setTestResult] = React.useState<string | null>(null);

  const runTest = () => {
    setTestResult(`Sample output — guardrail ${guardrail.id} processed ${testInput.length || 0} chars.`);
  };

  const TrendIcon = guardrail.stats.trendDelta > 0 ? TrendingUp : guardrail.stats.trendDelta < 0 ? TrendingDown : null;
  const trendColor = guardrail.stats.trendDelta > 0 ? 'text-[var(--accent-emerald)]' : guardrail.stats.trendDelta < 0 ? 'text-[var(--accent-rose)]' : 'text-[var(--fg-tertiary)]';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-4 transition-all',
        guardrail.enabled ? 'border-[var(--border-subtle)]' : 'border-[var(--border-subtle)] opacity-60',
      )}
      data-testid={`guardrail-${guardrail.id}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-1 cursor-grab text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border"
          style={{
            background: `${colorVar[guardrail.color]}10`,
            borderColor: `${colorVar[guardrail.color]}30`,
            color: colorVar[guardrail.color],
          }}
          aria-hidden
        >
          <GuardrailIcon name={guardrail.icon} className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-semibold text-[var(--fg-primary)]">{guardrail.name}</h4>
            <span className="rounded-full bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--fg-tertiary)]">
              P{guardrail.priority}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--fg-secondary)]">{guardrail.description}</p>
        </div>
        <Switch
          checked={guardrail.enabled}
          onCheckedChange={(checked) => onToggle(guardrail.id, checked)}
          data-testid={`guardrail-toggle-${guardrail.id}`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-[var(--fg-tertiary)]">
            Fired <span className="font-mono font-semibold text-[var(--fg-primary)]">{guardrail.stats.firedToday}</span> today
          </span>
          {guardrail.stats.blockedToday > 0 ? (
            <span className="text-[var(--fg-tertiary)]">
              <span className="font-mono font-semibold text-[var(--accent-rose)]">{guardrail.stats.blockedToday}</span> blocked
            </span>
          ) : null}
          {guardrail.stats.redactedToday > 0 ? (
            <span className="text-[var(--fg-tertiary)]">
              <span className="font-mono font-semibold text-[var(--accent-cyan)]">{guardrail.stats.redactedToday}</span> redacted
            </span>
          ) : null}
          {TrendIcon ? (
            <span className={cn('inline-flex items-center gap-1 font-medium', trendColor)}>
              <TrendIcon className="h-3 w-3" aria-hidden />
              {guardrail.stats.trendDelta > 0 ? '+' : ''}{guardrail.stats.trendDelta}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] transition-colors',
              showSettings ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' : 'border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)]',
            )}
            data-testid={`guardrail-configure-${guardrail.id}`}
          >
            <Settings className="h-3 w-3" aria-hidden />
            Configure
          </button>
          <button
            type="button"
            onClick={() => setShowTest(!showTest)}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] transition-colors',
              showTest ? 'border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]' : 'border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)]',
            )}
            data-testid={`guardrail-test-${guardrail.id}`}
          >
            <TestTube className="h-3 w-3" aria-hidden />
            Test
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3" data-testid={`guardrail-settings-${guardrail.id}`}>
          {guardrail.settings.map((setting) => (
            <div key={setting.key} className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">{setting.label}</label>
              {setting.type === 'toggle' ? (
                <div className="flex items-center gap-2">
                  <Switch defaultChecked={Boolean(setting.value)} />
                  <span className="text-[11px] text-[var(--fg-secondary)]">{String(setting.value)}</span>
                </div>
              ) : setting.type === 'select' ? (
                <select
                  defaultValue={String(setting.value)}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] text-[var(--fg-primary)]"
                >
                  {setting.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : setting.type === 'list' ? (
                <div className="flex flex-wrap gap-1">
                  {(setting.value as ReadonlyArray<string>).map((v) => (
                    <span key={v} className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)]">
                      {v}
                    </span>
                  ))}
                </div>
              ) : setting.type === 'number' ? (
                <input
                  type="number"
                  defaultValue={Number(setting.value)}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] font-mono text-[var(--fg-primary)]"
                />
              ) : (
                <input
                  type="text"
                  defaultValue={String(setting.value)}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] text-[var(--fg-primary)]"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      {showTest ? (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/5 p-3" data-testid={`guardrail-test-panel-${guardrail.id}`}>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-cyan)]">Test input</label>
          <textarea
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            rows={2}
            placeholder="Paste a sample prompt or tool call…"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5 font-mono text-[11px] text-[var(--fg-primary)]"
          />
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={runTest}>
              <Play className="h-3 w-3" />Run test
            </Button>
            {testResult ? <span className="text-[10px] text-[var(--fg-secondary)]">{testResult}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function GuardrailsTab() {
  const [guardrails, setGuardrails] = React.useState<ReadonlyArray<GuardrailConfig>>(GUARDRAILS);
  const [stage, setStage] = React.useState<GuardrailStage>('pre-tool');

  const toggle = (id: string, enabled: boolean) => {
    setGuardrails((prev) => prev.map((g) => (g.id === id ? { ...g, enabled } : g)));
  };

  const filtered = guardrails.filter((g) => g.stage === stage);
  const enabledCount = filtered.filter((g) => g.enabled).length;

  const stageMeta: Record<GuardrailStage, { label: string; description: string; color: string }> = {
    'pre-tool': { label: 'Pre-Tool', description: 'Intercept BEFORE any tool call', color: 'rose' },
    'post-tool': { label: 'Post-Tool', description: 'After tool returns', color: 'emerald' },
    'content': { label: 'Content', description: 'System prompt + response', color: 'cyan' },
  };

  return (
    <div className="space-y-4" data-testid="guardrails-tab">
      <Tabs value={stage} onValueChange={(v) => setStage(v as GuardrailStage)}>
        <TabsList className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
          {(['pre-tool', 'post-tool', 'content'] as GuardrailStage[]).map((s) => {
            const meta = stageMeta[s];
            const count = guardrails.filter((g) => g.stage === s).length;
            const enabled = guardrails.filter((g) => g.stage === s && g.enabled).length;
            return (
              <TabsTrigger
                key={s}
                value={s}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1 text-[12px] data-[state=active]:bg-[var(--bg-elevated)] data-[state=active]:text-[var(--fg-primary)] data-[state=active]:shadow-sm"
                data-testid={`guardrail-stage-${s}`}
              >
                <span>{meta.label}</span>
                <span className="rounded-full bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono tabular-nums">
                  {enabled}/{count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(['pre-tool', 'post-tool', 'content'] as GuardrailStage[]).map((s) => (
          <TabsContent key={s} value={s} className="m-0 mt-4">
            <div className="mb-3 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
              <div className="flex flex-col gap-0.5">
                <p className="text-[12px] font-medium text-[var(--fg-primary)]">{stageMeta[s].description}</p>
                <p className="text-[10px] text-[var(--fg-tertiary)]">{enabledCount} of {filtered.length} enabled · Drag to reorder priority</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid={`guardrail-grid-${s}`}>
              {filtered.map((g) => (
                <GuardrailCard key={g.id} guardrail={g} onToggle={toggle} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}