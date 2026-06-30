'use client';

import * as React from 'react';
import {
  Search,
  Download,
  X,
  Clock,
  User,
  Layers,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToneBadge, decisionTone, severityTone } from '../shared/severity-badge';
import { AUDIT_LOG, POLICIES } from '@/lib/governance-v2';
import type { AuditEntry } from '@/lib/governance-v2';
import { cn } from '@/lib/utils';

type DecisionFilter = 'all' | 'allow' | 'warn' | 'block' | 'redact';
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low' | 'info';

export function AuditTab() {
  const [filter, setFilter] = React.useState('');
  const [decisionFilter, setDecisionFilter] = React.useState<DecisionFilter>('all');
  const [severityFilter, setSeverityFilter] = React.useState<SeverityFilter>('all');
  const [selectedEntry, setSelectedEntry] = React.useState<AuditEntry | null>(null);

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    return AUDIT_LOG.filter((e) => {
      if (decisionFilter !== 'all' && e.decision !== decisionFilter) return false;
      if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
      if (!q) return true;
      return (
        e.actor.name.toLowerCase().includes(q)
        || e.reason.toLowerCase().includes(q)
        || e.affectedEntity.toLowerCase().includes(q)
        || e.action.toLowerCase().includes(q)
      );
    });
  }, [filter, decisionFilter, severityFilter]);

  return (
    <div className="space-y-4" data-testid="audit-tab">
      {/* Filters */}
      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--fg-tertiary)]" aria-hidden />
          <Input
            type="search"
            placeholder="Search audit log…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 pl-7 text-[11px]"
            data-testid="audit-search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Decision:</span>
          {(['all', 'allow', 'warn', 'block', 'redact'] as DecisionFilter[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDecisionFilter(d)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
                decisionFilter === d
                  ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                  : 'border-[var(--border-subtle)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
              )}
              data-testid={`audit-decision-${d}`}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Severity:</span>
          {(['all', 'critical', 'high', 'medium', 'low', 'info'] as SeverityFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverityFilter(s)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
                severityFilter === s
                  ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                  : 'border-[var(--border-subtle)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
              )}
              data-testid={`audit-severity-${s}`}
            >
              {s}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-8"><Download className="h-3 w-3" />Export</Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="scrollbar-thin max-h-[600px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-inset)]">
                {['Timestamp', 'Actor', 'Action', 'Policy', 'Decision', 'Severity', 'Reason', 'Entity'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-[11px] text-[var(--fg-tertiary)]">No audit entries match.</td></tr>
              ) : filtered.slice(0, 50).map((entry) => {
                const policy = POLICIES.find((p) => p.id === entry.policyId);
                return (
                  <tr
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-inset)]"
                    data-testid={`audit-row-${entry.id}`}
                  >
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--fg-tertiary)] tabular-nums">
                      {new Date(entry.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-medium text-[var(--fg-primary)]">{entry.actor.name}</span>
                        <span className="font-mono text-[9px] text-[var(--fg-tertiary)]">{entry.actor.role}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[var(--fg-secondary)]">{entry.action}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate font-mono text-[10px] text-[var(--fg-secondary)]">{policy?.name ?? entry.policyId ?? '—'}</td>
                    <td className="px-3 py-2"><ToneBadge tone={decisionTone(entry.decision)}>{entry.decision}</ToneBadge></td>
                    <td className="px-3 py-2"><ToneBadge tone={severityTone(entry.severity)}>{entry.severity}</ToneBadge></td>
                    <td className="px-3 py-2 text-[var(--fg-secondary)]">{entry.reason}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--fg-tertiary)]">{entry.affectedEntity}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2 text-[10px] text-[var(--fg-tertiary)]">
          Showing {Math.min(filtered.length, 50)} of {filtered.length} entries · {AUDIT_LOG.length} total · Click row for full detail
        </div>
      </div>

      {/* Detail drawer */}
      {selectedEntry ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setSelectedEntry(null)} data-testid="audit-detail-overlay">
          <div
            className="scrollbar-thin flex h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-base)] p-6"
            onClick={(e) => e.stopPropagation()}
            data-testid="audit-detail"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">Audit entry detail</h3>
              <button type="button" onClick={() => setSelectedEntry(null)} className="rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'ID', value: selectedEntry.id, icon: Layers },
                { label: 'Timestamp', value: new Date(selectedEntry.timestamp).toLocaleString(), icon: Clock },
                { label: 'Actor', value: `${selectedEntry.actor.name} (${selectedEntry.actor.role})`, icon: User },
                { label: 'Action', value: selectedEntry.action },
                { label: 'Policy', value: POLICIES.find((p) => p.id === selectedEntry.policyId)?.name ?? '—' },
                { label: 'Decision', value: selectedEntry.decision, badge: decisionTone(selectedEntry.decision) },
                { label: 'Severity', value: selectedEntry.severity, badge: severityTone(selectedEntry.severity) },
                { label: 'Reason', value: selectedEntry.reason },
                { label: 'Affected entity', value: selectedEntry.affectedEntity },
                { label: 'Tenant', value: selectedEntry.tenantId },
                { label: 'Project', value: selectedEntry.projectId },
              ].map(({ label, value, badge, icon: Icon }) => (
                <div key={label} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    {Icon ? <Icon className="h-3 w-3" /> : null}
                    {label}
                  </p>
                  {badge ? (
                    <ToneBadge tone={badge}>{String(value)}</ToneBadge>
                  ) : (
                    <p className="mt-1 font-mono text-[11px] text-[var(--fg-primary)]">{value}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">Request payload</h4>
              <pre className="scrollbar-thin overflow-x-auto rounded bg-[var(--bg-base)] p-3 font-mono text-[10px] text-[var(--fg-secondary)]">
{JSON.stringify({
  prompt: 'Generate a customer profile…',
  tool_call: { tool: 'github_api_call', parameters: { token: '[REDACTED]' } },
  context: { user: selectedEntry.actor.id, tenant: selectedEntry.tenantId },
}, null, 2)}
              </pre>
            </div>

            <div className="space-y-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">Policy decision chain</h4>
              <div className="space-y-1 font-mono text-[10px]">
                <div className="rounded bg-[var(--bg-inset)] p-2 text-[var(--fg-secondary)]">
                  [14:23:18.001] pre-tool: evaluating 21 policies, 17 guardrails
                </div>
                <div className="rounded bg-[var(--bg-inset)] p-2 text-[var(--accent-cyan)]">
                  [14:23:18.005] gr-pii-detect: matched SSN pattern at position 42
                </div>
                <div className="rounded bg-[var(--bg-inset)] p-2 text-[var(--accent-amber)]">
                  [14:23:18.009] pol-pii-redact: 2 matches → REDACT
                </div>
                <div className="rounded bg-[var(--bg-inset)] p-2 text-[var(--fg-secondary)]">
                  [14:23:18.012] post-tool: scrubbed response, 14 chars redacted
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}