'use client';

import * as React from 'react';
import { Search, X, Keyboard, Command } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { HeroBand } from './shared/hero-band';
import { GovernanceTabs, DEFAULT_TABS } from './shared/tab-bar';
import { OverviewTab } from './overview/overview-tab';
import { PoliciesTab } from './policies/policies-tab';
import { GuardrailsTab } from './guardrails/guardrails-tab';
import { StandardsTab } from './standards/standards-tab';
import { LlmTab } from './llm/llm-tab';
import { BoardTab } from './board/board-tab';
import { RbacTab } from './rbac/rbac-tab';
import { TestTab } from './test/test-tab';
import { AuditTab } from './audit/audit-tab';
import {
  useSpendByDay,
  useSpendByTeam,
  useGuardrails,
  useModels,
  useStandards,
  useAuditEvents,
  useLLMTraffic,
} from '@/lib/hooks/useLiteLLM';

export interface GovernanceCenterShellProps {
  readonly persona: string;
  readonly boardTokenPresent: boolean;
}

const KEYBOARD_SHORTCUTS: ReadonlyArray<{ keys: string[]; description: string }> = [
  { keys: ['⌘', '⇧', 'P'], description: 'New policy' },
  { keys: ['⌘', '⇧', 'G'], description: 'New guardrail' },
  { keys: ['⌘', '⇧', 'S'], description: 'Load standard' },
  { keys: ['⌘', '/'], description: 'Show shortcuts' },
  { keys: ['⌘', 'K'], description: 'Global search' },
];

/**
 * Derive HeroBand KPI props from the live LiteLLM data. Falls back
 * to safe defaults while hooks are loading so the UI never renders
 * "NaN" or undefined values.
 */
function useHeroBandKpis() {
  const { data: spendByDay } = useSpendByDay(30);
  const { data: spendByTeam } = useSpendByTeam();
  const { data: guardrails } = useGuardrails();
  const { data: standards } = useStandards();

  return React.useMemo(() => {
    const todaySpend = spendByDay?.at(-1)?.spend ?? 0;
    const enabledGuardrails = (guardrails ?? []).filter((g) => g.enabled).length;
    const totalGuardrails = guardrails?.length ?? 0;
    const status: 'all-active' | 'warning' | 'critical' =
      enabledGuardrails === totalGuardrails && totalGuardrails > 0
        ? 'all-active'
        : enabledGuardrails === 0
          ? 'critical'
          : 'warning';

    const activeStandards = (standards ?? []).filter(
      (s) => s.status === 'active',
    ).length;
    const totalStandards = standards?.length ?? 0;

    const guardrailScore =
      totalGuardrails > 0 ? (enabledGuardrails / totalGuardrails) * 100 : 0;
    const standardScore =
      totalStandards > 0 ? (activeStandards / totalStandards) * 100 : 0;
    const compositeScore = Math.round(
      (guardrailScore + standardScore) / 2 || guardrailScore,
    );

    return {
      guardrailStatus: status,
      guardrailCount: totalGuardrails - enabledGuardrails,
      complianceScore: compositeScore,
      standardsMet: activeStandards,
      standardsTotal: totalStandards,
      todaySpend,
      teamCount: spendByTeam?.length ?? 0,
    };
  }, [spendByDay, spendByTeam, guardrails, standards]);
}

/**
 * The shell is the only client component in the page. Each tab pulls
 * its own data via TanStack Query hooks (mirrors the pattern in
 * `app/analytics/page.tsx`). The shell's job is layout, tab routing,
 * keyboard shortcuts, and the HeroBand aggregation.
 */
export function GovernanceCenterShell({ persona, boardTokenPresent }: GovernanceCenterShellProps) {
  const [activeTab, setActiveTab] = React.useState<string>('overview');
  const [showSearch, setShowSearch] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);

  // HeroBand aggregation only. Each tab pulls its own slice.
  const heroBand = useHeroBandKpis();

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setActiveTab('policies'); }
      if (e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); setActiveTab('guardrails'); }
      if (e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); setActiveTab('standards'); }
      if (e.key === '/') { e.preventDefault(); setShowShortcuts(true); }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setShowSearch(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewTab />;
      case 'policies':
        return <PoliciesTab />;
      case 'guardrails':
        return <GuardrailsTab />;
      case 'standards':
        return <StandardsTab />;
      case 'llm':
        return <LlmTab />;
      case 'board':
        return <BoardTab />;
      case 'rbac':
        return <RbacTab />;
      case 'audit':
        return <AuditTab />;
      default:
        return <OverviewTab />;
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 p-8" data-testid="governance-center-page">
      <HeroBand
        persona={persona}
        guardrailStatus={heroBand.guardrailStatus}
        guardrailCount={heroBand.guardrailCount}
        complianceScore={heroBand.complianceScore}
        standardsMet={heroBand.standardsMet}
        standardsTotal={heroBand.standardsTotal}
        boardTokenPresent={boardTokenPresent}
      />

      <div className="flex items-center justify-between gap-3">
        <GovernanceTabs value={activeTab} onChange={setActiveTab} tabs={DEFAULT_TABS} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-primary)]"
            data-testid="global-search-trigger"
          >
            <Search className="h-3 w-3" />
            <span>Search…</span>
            <kbd className="rounded bg-[var(--bg-inset)] px-1 py-0.5 font-mono text-[9px]">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-primary)]"
            aria-label="Show keyboard shortcuts"
            data-testid="shortcuts-trigger"
          >
            <Keyboard className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {renderTab()}

      {/* Search overlay */}
      {showSearch ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSearch(false)} data-testid="search-overlay">
          <div
            className="mt-20 w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-[var(--fg-tertiary)]" aria-hidden />
              <Input
                autoFocus
                placeholder="Search policies, guardrails, standards…"
                className="border-0 bg-transparent text-[13px] focus-visible:ring-0"
                data-testid="global-search-input"
              />
              <button type="button" onClick={() => setShowSearch(false)} className="rounded p-1 text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-[var(--fg-tertiary)]">
              <p className="px-2 py-1">Try: <code className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono">PII redaction</code>, <code className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono">ISO 27001</code>, <code className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono">Claude Sonnet</code></p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Shortcuts overlay */}
      {showShortcuts ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowShortcuts(false)} data-testid="shortcuts-overlay">
          <div
            className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">
                <Command className="h-4 w-4" /> Keyboard shortcuts
              </h3>
              <button type="button" onClick={() => setShowShortcuts(false)} className="rounded p-1 text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {KEYBOARD_SHORTCUTS.map((sc) => (
                <div key={sc.description} className="flex items-center justify-between rounded bg-[var(--bg-inset)] px-3 py-2">
                  <span className="text-[11px] text-[var(--fg-secondary)]">{sc.description}</span>
                  <div className="flex items-center gap-1">
                    {sc.keys.map((k, i) => (
                      <kbd key={i} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-primary)]">{k}</kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}