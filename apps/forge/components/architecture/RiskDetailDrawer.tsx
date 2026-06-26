'use client';

/**
 * Risk Detail Drawer — Step 30 Zone 7 sub-feature.
 * 5 tabs: Description / Mitigation / Linked decisions / History / Review.
 */

import * as React from 'react';
import { X, AlertTriangle, ShieldCheck, GitMerge, History as HistoryIcon, RefreshCw, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';
import type { Risk } from '@/lib/architecture/data';

type Tab = 'description' | 'mitigation' | 'linked' | 'history' | 'review';

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'description', label: 'Description', icon: <AlertTriangle className="h-3 w-3" /> },
  { id: 'mitigation', label: 'Mitigation', icon: <ShieldCheck className="h-3 w-3" /> },
  { id: 'linked', label: 'Linked decisions', icon: <GitMerge className="h-3 w-3" /> },
  { id: 'history', label: 'History', icon: <HistoryIcon className="h-3 w-3" /> },
  { id: 'review', label: 'Review', icon: <RefreshCw className="h-3 w-3" /> },
];

export interface RiskDetailDrawerProps {
  risk: Risk | null;
  onClose: () => void;
  adrIndex: Record<string, string>;
}

export function RiskDetailDrawer({ risk, onClose, adrIndex }: RiskDetailDrawerProps) {
  const [tab, setTab] = React.useState<Tab>('description');

  React.useEffect(() => {
    setTab('description');
  }, [risk?.id]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (risk) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [risk, onClose]);

  if (!risk) return null;
  const score = risk.likelihood * risk.impact;
  const linkedAdr = adrIndex[risk.id];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Risk ${risk.id} detail`}
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(0,0,0,0.5)]"
      onClick={onClose}
      data-testid="risk-detail-drawer"
    >
      <aside
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">{risk.id}</p>
            <h2 className="mt-0.5 text-base font-bold leading-tight text-[var(--fg-primary)]">{risk.title}</h2>
            <p className="mt-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
              L{risk.likelihood} × I{risk.impact} = {score} · {risk.owner} · {risk.status}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close drawer" className="h-7 px-2">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </header>

        <div className="mt-3 flex gap-1 border-b border-[var(--border-subtle)]" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              data-testid={`risk-drawer-tab-${t.id}`}
              className={cn(
                'flex items-center gap-1.5 rounded-t-[var(--radius-md)] border-b-2 px-3 py-2 text-xs transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                tab === t.id
                  ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                  : 'border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex-1 text-sm">
          {tab === 'description' ? (
            <DescriptionPanel risk={risk} />
          ) : tab === 'mitigation' ? (
            <MitigationPanel risk={risk} />
          ) : tab === 'linked' ? (
            <LinkedPanel risk={risk} linkedAdr={linkedAdr} />
          ) : tab === 'history' ? (
            <HistoryPanel risk={risk} />
          ) : (
            <ReviewPanel risk={risk} />
          )}
        </div>

        <footer className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">Last reviewed 14 days ago</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs">
              <Send className="mr-1 h-3 w-3" aria-hidden="true" /> Notify owner
            </Button>
            <Button size="sm" className="bg-[var(--accent-primary)] text-xs text-white hover:opacity-90">
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" /> Re-evaluate
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function DescriptionPanel({ risk }: { risk: Risk }) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <Section title="Risk">
        <p className="text-[var(--fg-primary)]">{risk.title}</p>
      </Section>
      <Section title="Scenarios">
        <ul className="list-inside list-disc space-y-1 text-[var(--fg-secondary)]">
          <li>Provider outage cascades to all agents currently in flight.</li>
          <li>Retry storm saturates the orchestrator queue.</li>
          <li>Cost attribution double-counts under concurrent runs.</li>
        </ul>
      </Section>
      <Section title="Triggers">
        <p className="text-[var(--fg-secondary)]">
          Latency p95 above 2× baseline for more than 5 minutes, or error rate above 5% over 10 minutes.
        </p>
      </Section>
    </div>
  );
}

function MitigationPanel({ risk }: { risk: Risk }) {
  const tasks = [
    { id: 'task-1-3', title: 'Implement Anthropic adapter', status: 'in_progress' as const },
    { id: 'task-2-4', title: 'Cross-tenant query guard', status: 'todo' as const },
  ];
  return (
    <div className="flex flex-col gap-3 text-xs">
      <Section title="Current plan">
        <p className="text-[var(--fg-primary)]">{risk.mitigation}</p>
      </Section>
      <Section title="Linked mitigation tasks">
        <ul className="flex flex-col gap-1">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2">
              <span className="font-mono text-[10px] text-[var(--fg-secondary)]">{t.id} · {t.title}</span>
              <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px]',
                t.status === 'in_progress' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-slate-500/15 text-slate-300',
              )}>
                {t.status.replace('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function LinkedPanel({ risk, linkedAdr }: { risk: Risk; linkedAdr?: string }) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      {linkedAdr ? (
        <button
          type="button"
          className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-left transition-colors hover:border-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">{linkedAdr}</p>
          <p className="mt-1 font-medium text-[var(--fg-primary)]">ADR addresses this risk</p>
          <p className="mt-1 text-[var(--fg-secondary)]">Decision: enforce circuit breaker + multi-provider fallback in PAL.</p>
        </button>
      ) : (
        <EmptyState
          illustration={<GitMerge size={28} strokeWidth={1.5} />}
          title="No linked decisions yet"
          description="Link an ADR that addresses this risk."
        />
      )}
    </div>
  );
}

function HistoryPanel({ risk }: { risk: Risk }) {
  const events = [
    { date: '2026-06-12', actor: 'platform-team', verb: 'identified', subject: risk.title },
    { date: '2026-06-15', actor: 'platform-team', verb: 'assessed', subject: `L${risk.likelihood} × I${risk.impact}` },
    { date: '2026-06-18', actor: risk.owner, verb: 'mitigation planned', subject: risk.mitigation },
    { date: '2026-06-22', actor: 'governance-team', verb: 'reviewed', subject: 'no change' },
  ];
  return (
    <ol className="flex flex-col gap-2 text-xs" role="list">
      {events.map((e) => (
        <li key={e.date} className="flex items-start gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2">
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{e.date}</span>
          <span className="text-[var(--fg-primary)]">
            <span className="font-mono text-[var(--fg-secondary)]">{e.actor}</span> {e.verb} <em className="text-[var(--fg-secondary)]">{e.subject}</em>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ReviewPanel({ risk: _risk }: { risk: Risk }) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <Section title="Review schedule">
        <p className="text-[var(--fg-secondary)]">Quarterly auto-review · next: 2026-09-15</p>
      </Section>
      <Section title="Trend">
        <p className="text-[var(--fg-secondary)]">Likelihood trending down (was 4 in Q1, now {3}). Impact unchanged.</p>
      </Section>
      <Button variant="outline" size="sm" className="self-start text-xs">
        <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" /> Re-evaluate now
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{title}</p>
      {children}
    </div>
  );
}
