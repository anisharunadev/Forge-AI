'use client';

import * as React from 'react';
import {
  Plus,
  Search,
  Filter,
  MoreVertical,
  Sparkles,
  Copy,
  Download,
  Archive,
  Edit3,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  CircleHelp,
  FileText,
  History,
  AlertOctagon,
  TestTube,
  CheckCircle2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToneBadge, policyStatusTone, severityTone } from '../shared/severity-badge';
import { POLICIES, TEST_CASES } from '@/lib/governance-v2';
import type { PolicyDefinition, Severity, Decision, PolicyStatus } from '@/lib/governance-v2';
import { cn } from '@/lib/utils';

type PolicyFilter = 'all' | 'strict' | 'advisory' | 'off';

const statusIcon: Record<PolicyStatus, React.ComponentType<{ className?: string }>> = {
  strict: ShieldCheck,
  advisory: ShieldAlert,
  off: ShieldOff,
};

export function PoliciesTab() {
  const [selectedId, setSelectedId] = React.useState<string>(POLICIES[0]?.id ?? '');
  const [filter, setFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<PolicyFilter>('all');
  const [editorTab, setEditorTab] = React.useState<'definition' | 'rules' | 'scope' | 'exceptions' | 'test' | 'history' | 'violations'>('definition');
  const [draftDescription, setDraftDescription] = React.useState('');
  const [aiGenerating, setAiGenerating] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    return POLICIES.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.naturalLanguage.toLowerCase().includes(q);
    });
  }, [filter, statusFilter]);

  const selected = POLICIES.find((p) => p.id === selectedId) ?? POLICIES[0]!;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const p = POLICIES.find((x) => x.id === id);
    setDraftDescription(p?.naturalLanguage ?? '');
  };

  const handleTranslateToRules = async () => {
    if (aiGenerating) return;
    setAiGenerating(true);
    await new Promise((r) => setTimeout(r, 800));
    setAiGenerating(false);
    setEditorTab('rules');
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]" data-testid="policies-tab">
      {/* ── LEFT: Policy List ──────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">Policies</h3>
            <Button size="sm" className="h-7 gap-1" data-testid="policy-new">
              <Plus className="h-3 w-3" aria-hidden />
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--fg-tertiary)]" aria-hidden />
            <Input
              type="search"
              placeholder="Search policies…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 pl-7 text-[11px]"
              data-testid="policy-search"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(['all', 'strict', 'advisory', 'off'] as PolicyFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
                  statusFilter === s
                    ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                    : 'border-[var(--border-subtle)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                )}
                data-testid={`policy-filter-${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[700px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-[var(--fg-tertiary)]">No policies match.</div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {filtered.map((p) => {
                const StatusIcon = statusIcon[p.status];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelect(p.id)}
                    className={cn(
                      'flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-inset)]',
                      selectedId === p.id && 'bg-[var(--bg-inset)] border-l-2 border-l-[var(--accent-primary)]',
                    )}
                    data-testid={`policy-list-${p.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <StatusIcon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          p.status === 'strict' ? 'text-[var(--accent-rose)]'
                          : p.status === 'advisory' ? 'text-[var(--accent-amber)]'
                          : 'text-[var(--fg-muted)]',
                        )}
                        aria-hidden
                      />
                      <span className="flex-1 truncate text-[12px] font-medium text-[var(--fg-primary)]">{p.name}</span>
                      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">v{p.version}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <ToneBadge tone={policyStatusTone(p.status)}>{p.status}</ToneBadge>
                        <ToneBadge tone="muted">{p.scope}</ToneBadge>
                      </div>
                      <span className="font-mono text-[10px] text-[var(--fg-muted)]">{p.lastModified}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Policy Editor ──────────────────────────────────── */}
      <div className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                defaultValue={selected.name}
                className="bg-transparent text-[var(--text-md)] font-semibold text-[var(--fg-primary)] outline-none focus:bg-[var(--bg-inset)] focus:px-2 focus:py-0.5"
                data-testid="policy-editor-name"
              />
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">v{selected.version}</span>
              <ToneBadge tone={policyStatusTone(selected.status)}>{selected.status}</ToneBadge>
              <ToneBadge tone="muted">{selected.scope}</ToneBadge>
            </div>
            <p className="text-[11px] text-[var(--fg-tertiary)]">{selected.description}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]" data-testid="policy-editor-menu">
              <MoreVertical className="h-4 w-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem><Copy className="mr-2 h-3.5 w-3.5" />Duplicate</DropdownMenuItem>
              <DropdownMenuItem><Download className="mr-2 h-3.5 w-3.5" />Export</DropdownMenuItem>
              <DropdownMenuItem className="text-[var(--accent-rose)]"><Archive className="mr-2 h-3.5 w-3.5" />Archive</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Tabs */}
        <Tabs value={editorTab} onValueChange={(v) => setEditorTab(v as typeof editorTab)}>
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5">
            <TabsList className="h-9 bg-transparent p-0">
              {[
                { id: 'definition', label: 'Definition', icon: FileText },
                { id: 'rules', label: 'Rules', icon: ShieldCheck },
                { id: 'scope', label: 'Scope', icon: CircleHelp },
                { id: 'exceptions', label: 'Exceptions', icon: ShieldAlert },
                { id: 'test', label: 'Test', icon: TestTube },
                { id: 'history', label: 'History', icon: History },
                { id: 'violations', label: 'Violations', icon: AlertOctagon },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent-primary)] data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                    data-testid={`editor-tab-${t.id}`}
                  >
                    <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {/* Definition */}
          <TabsContent value="definition" className="m-0 p-5" data-testid="editor-pane-definition">
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Natural language policy</label>
                <Textarea
                  rows={6}
                  value={draftDescription || selected.naturalLanguage}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  className="font-mono text-[12px]"
                  placeholder="Describe the policy in plain English…"
                  data-testid="policy-natural-language"
                />
                <p className="text-[11px] text-[var(--fg-tertiary)]">Forge will translate this to structured rules automatically.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleTranslateToRules} disabled={aiGenerating} size="sm" data-testid="policy-translate">
                  {aiGenerating ? (
                    <Sparkles className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {aiGenerating ? 'Translating…' : 'Translate to rules'}
                </Button>
                <span className="text-[10px] text-[var(--fg-tertiary)]">AI-powered — mock for now</span>
              </div>
            </div>
          </TabsContent>

          {/* Rules */}
          <TabsContent value="rules" className="m-0 p-5" data-testid="editor-pane-rules">
            <div className="mx-auto max-w-3xl space-y-4">
              <div>
                <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">IF/THEN conditions</h4>
                <div className="mt-2 space-y-2">
                  {selected.rules.map((rule, idx) => (
                    <div key={rule.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2" data-testid={`rule-${rule.id}`}>
                      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">#{idx + 1}</span>
                      <span className="text-[11px] text-[var(--fg-secondary)]">IF</span>
                      <code className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-primary)]">{rule.field}</code>
                      <span className="rounded bg-[var(--accent-primary)]/10 px-1.5 py-0.5 font-mono text-[11px] text-[var(--accent-primary)]">{rule.operator}</span>
                      <code className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-primary)]">{rule.value}</code>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Action</label>
                  <select
                    defaultValue={selected.action}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--fg-primary)]"
                    data-testid="policy-action"
                  >
                    {(['block', 'redact', 'warn', 'allow'] as Decision[]).map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Severity</label>
                  <select
                    defaultValue={selected.severity}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--fg-primary)]"
                    data-testid="policy-severity"
                  >
                    {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Status</label>
                  <select
                    defaultValue={selected.status}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--fg-primary)]"
                    data-testid="policy-status"
                  >
                    {(['strict', 'advisory', 'off'] as PolicyStatus[]).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Scope */}
          <TabsContent value="scope" className="m-0 p-5" data-testid="editor-pane-scope">
            <div className="mx-auto max-w-3xl space-y-4">
              {[
                { label: 'Workflows', value: selected.appliesTo.workflows },
                { label: 'Agents', value: selected.appliesTo.agents },
                { label: 'Commands', value: selected.appliesTo.commands },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
                  <div>
                    <p className="text-[12px] font-medium text-[var(--fg-primary)]">Applies to {label.toLowerCase()}</p>
                    <p className="text-[11px] text-[var(--fg-tertiary)]">{value === 'all' ? 'All' : `${(value as string[]).length} specific`}</p>
                  </div>
                  <Switch defaultChecked={value !== 'all' || true} />
                </div>
              ))}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Project scope</label>
                <select className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--fg-primary)]">
                  <option>All projects in acme-corp</option>
                  <option>Only: research-assistant</option>
                  <option>Only: customer-support</option>
                </select>
              </div>
            </div>
          </TabsContent>

          {/* Exceptions */}
          <TabsContent value="exceptions" className="m-0 p-5" data-testid="editor-pane-exceptions">
            <div className="mx-auto max-w-3xl space-y-3">
              {selected.exceptions.length === 0 ? (
                <p className="text-[11px] text-[var(--fg-tertiary)]">No exceptions configured.</p>
              ) : (
                selected.exceptions.map((exc) => (
                  <div key={exc.id} className="flex items-start justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 p-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[12px] font-medium text-[var(--fg-primary)]">{exc.label}</span>
                      <code className="font-mono text-[11px] text-[var(--fg-secondary)]">{exc.condition}</code>
                      {exc.expiresAt ? (
                        <span className="text-[10px] text-[var(--fg-tertiary)]">Expires {exc.expiresAt}</span>
                      ) : null}
                    </div>
                    <button type="button" className="rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--accent-rose)]" aria-label="Remove exception">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
              <Button size="sm" variant="outline"><Plus className="h-3 w-3" />Add exception</Button>
            </div>
          </TabsContent>

          {/* Test (links to playground) */}
          <TabsContent value="test" className="m-0 p-5" data-testid="editor-pane-test">
            <div className="mx-auto max-w-3xl space-y-3">
              <p className="text-[11px] text-[var(--fg-tertiary)]">Use the dedicated playground to run policy test cases with full request/response inspection.</p>
              {TEST_CASES.filter((tc) => tc.category === 'pii' || tc.category === 'secret').map((tc) => (
                <div key={tc.id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-medium text-[var(--fg-primary)]">{tc.name}</span>
                    <span className="text-[11px] text-[var(--fg-tertiary)]">{tc.description}</span>
                  </div>
                  <Button size="sm" variant="outline">Run test</Button>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* History */}
          <TabsContent value="history" className="m-0 p-5" data-testid="editor-pane-history">
            <div className="mx-auto max-w-3xl space-y-2">
              {['2.1.0', '2.0.0', '1.5.0', '1.0.0'].map((v) => (
                <div key={v} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] font-semibold text-[var(--fg-primary)]">v{v}</span>
                    <span className="text-[11px] text-[var(--fg-tertiary)]">Updated by {selected.modifiedBy}</span>
                  </div>
                  <Button size="sm" variant="ghost"><Edit3 className="h-3 w-3" />View diff</Button>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Violations */}
          <TabsContent value="violations" className="m-0 p-5" data-testid="editor-pane-violations">
            <div className="mx-auto max-w-3xl">
              <div className="rounded-[var(--radius-sm)] border border-[var(--accent-rose)]/30 bg-[var(--accent-rose)]/5 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-[var(--fg-primary)]">{selected.violations} violations (last 30 days)</p>
                  <Button size="sm" variant="outline">View all</Button>
                </div>
                <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                  Severity: <ToneBadge tone={severityTone(selected.severity)}>{selected.severity}</ToneBadge>
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}