'use client';

import * as React from 'react';
import {
  Gavel,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToneBadge } from '../shared/severity-badge';
import { Panel } from '../shared/panel';
import { cn } from '@/lib/utils';
import { useBoardConfirmations } from '@/lib/api/governance-hooks';

const BOARD_MEMBERS = [
  { id: 'm-1', name: 'Jane CTO', role: 'Chair', votes: 247, present: true },
  { id: 'm-2', name: 'VP Eng', role: 'Voting', votes: 232, present: true },
  { id: 'm-3', name: 'CISO', role: 'Voting', votes: 198, present: false },
  { id: 'm-4', name: 'CFO', role: 'Voting', votes: 156, present: true },
  { id: 'm-5', name: 'Legal', role: 'Advisory', votes: 89, present: false },
];

const PENDING_DECISIONS = [
  { id: 'pd-1', title: 'Approve new data residency policy', priority: 'high', age: '2h', votes: { for: 2, against: 0, abstain: 0 } },
  { id: 'pd-2', title: 'Spend cap increase to $750/day for tenant', priority: 'medium', age: '4h', votes: { for: 1, against: 1, abstain: 1 } },
  { id: 'pd-3', title: 'New LLM provider approval — Custom Endpoint', priority: 'high', age: '6h', votes: { for: 0, against: 0, abstain: 0 } },
];

const RECENT_DECISIONS = [
  { id: 'rd-1', subject: 'SOC2 Type II renewal', outcome: 'accepted', decider: 'Jane CTO', at: '2 hours ago', rev: 'rev-2841' },
  { id: 'rd-2', subject: 'GDPR evidence package', outcome: 'accepted', decider: 'VP Eng', at: '5 hours ago', rev: 'rev-2840' },
  { id: 'rd-3', subject: 'Production deploy — Forge v2.4', outcome: 'accepted', decider: 'Board', at: '1 day ago', rev: 'rev-2839' },
  { id: 'rd-4', subject: 'New agent onboarding', outcome: 'declined', decider: 'Jane CTO', at: '2 days ago', rev: 'rev-2838' },
  { id: 'rd-5', subject: 'Policy archive — legacy PII', outcome: 'accepted', decider: 'Eng Lead', at: '3 days ago', rev: 'rev-2837' },
];

// ponytail: inline fixtures above remain as the no-network fallback.
// When the canonical board-confirmations endpoint is reachable the
// live rows supersede RECENT_DECISIONS (Step-72 hook module).
function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const deltaMin = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const hr = Math.round(deltaMin / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function BoardTab() {
  const confirmationsQ = useBoardConfirmations();
  const liveConfirmations = confirmationsQ.data ?? [];

  return (
    <div className="space-y-4" data-testid="board-tab">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Board members"
          subtitle="Active voting + advisory"
          height="fixed-320"
          dataTestId="board-members"
        >
          <div className="space-y-2">
            {BOARD_MEMBERS.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-primary)]/15 text-[11px] font-semibold text-[var(--accent-primary)]">
                      {m.name.split(' ').map((s) => s[0]).join('')}
                    </div>
                    <span className={cn('absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-[var(--bg-surface)]', m.present ? 'bg-[var(--accent-emerald)]' : 'bg-[var(--fg-muted)]')} aria-hidden />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[12px] font-medium text-[var(--fg-primary)]">{m.name}</span>
                    <span className="text-[10px] text-[var(--fg-tertiary)]">{m.role} · {m.votes} votes</span>
                  </div>
                </div>
                <ToneBadge tone={m.present ? 'emerald' : 'muted'}>{m.present ? 'Present' : 'Away'}</ToneBadge>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
            <Button size="sm" variant="outline" className="w-full"><Plus className="h-3 w-3" />Add member</Button>
          </div>
        </Panel>

        <Panel
          title="Pending decisions"
          subtitle="Awaiting board vote"
          headerAction={
            <Button size="sm" variant="outline"><Gavel className="h-3 w-3" />Convene board</Button>
          }
          height="fixed-320"
          className="lg:col-span-2"
          dataTestId="pending-decisions"
        >
          <div className="space-y-2">
            {PENDING_DECISIONS.map((d) => (
              <div key={d.id} className="rounded-[var(--radius-sm)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 p-3" data-testid={`pending-${d.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[var(--fg-primary)]">{d.title}</span>
                  <ToneBadge tone={d.priority === 'high' ? 'rose' : 'amber'}>{d.priority}</ToneBadge>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-[var(--fg-tertiary)]">Age: {d.age} · votes: {d.votes.for} for, {d.votes.against} against, {d.votes.abstain} abstain</span>
                  <div className="flex items-center gap-1">
                    <button type="button" className="rounded p-1 text-[var(--accent-emerald)] hover:bg-[var(--accent-emerald)]/10" aria-label="Approve"><CheckCircle2 className="h-3.5 w-3.5" /></button>
                    <button type="button" className="rounded p-1 text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10" aria-label="Decline"><XCircle className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="Decision history"
        subtitle="Recent board confirmations"
        height="auto"
        dataTestId="board-history"
      >
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-inset)]">
              {['Subject', 'Plan rev', 'Outcome', 'Decider', 'When'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {(liveConfirmations.length > 0
              ? liveConfirmations.map((c) => ({
                  id: c.id,
                  subject: c.subject.identifier,
                  outcome: c.outcome,
                  decider: c.decider?.displayName ?? '—',
                  at: formatRelative(c.decidedAt),
                  rev: c.planRev,
                }))
              : RECENT_DECISIONS
            ).map((d) => (
              <tr key={d.id} className="hover:bg-[var(--bg-inset)]" data-testid={`history-${d.id}`}>
                <td className="px-3 py-2 font-medium text-[var(--fg-primary)]">{d.subject}</td>
                <td className="px-3 py-2 font-mono text-[var(--fg-tertiary)]">{d.rev}</td>
                <td className="px-3 py-2">
                  <ToneBadge tone={d.outcome === 'accepted' ? 'emerald' : d.outcome === 'declined' ? 'rose' : 'amber'}>
                    {d.outcome}
                  </ToneBadge>
                </td>
                <td className="px-3 py-2 text-[var(--fg-secondary)]">{d.decider}</td>
                <td className="px-3 py-2 text-[var(--fg-tertiary)]">{d.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}