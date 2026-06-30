'use client';

import * as React from 'react';
import {
  LayoutDashboard,
  ShieldCheck,
  ShieldAlert,
  FileCheck,
  Cpu,
  Gavel,
  Users,
  History,
  Activity,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export interface TabDef {
  readonly id: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly count?: number;
  readonly healthTone?: 'emerald' | 'amber' | 'rose';
}

export interface GovernanceTabsProps {
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly tabs: ReadonlyArray<TabDef>;
}

export function GovernanceTabs({ value, onChange, tabs }: GovernanceTabsProps) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList
        className="scrollbar-thin inline-flex h-10 w-full items-center justify-start gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1"
        data-testid="governance-tab-list"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-all',
                'text-[var(--fg-secondary)] data-[state=active]:bg-[var(--bg-elevated)] data-[state=active]:text-[var(--fg-primary)] data-[state=active]:shadow-sm',
                'hover:text-[var(--fg-primary)]',
              )}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span>{tab.label}</span>
              {tab.count != null ? (
                <span
                  className={cn(
                    'inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    tab.healthTone === 'emerald'
                      ? 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]'
                      : tab.healthTone === 'amber'
                      ? 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                      : tab.healthTone === 'rose'
                      ? 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]'
                      : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
                  )}
                  data-testid={`tab-${tab.id}-count`}
                >
                  {tab.count}
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

export const DEFAULT_TABS: ReadonlyArray<TabDef> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'policies', label: 'Policies', icon: ShieldCheck, count: 21 },
  { id: 'guardrails', label: 'Guardrails', icon: ShieldAlert, count: 17, healthTone: 'amber' },
  { id: 'standards', label: 'Standards', icon: FileCheck, count: 4, healthTone: 'emerald' },
  { id: 'llm', label: 'LLM Control', icon: Cpu, count: 9 },
  { id: 'board', label: 'Board', icon: Gavel, count: 5 },
  { id: 'rbac', label: 'RBAC', icon: Users, count: 6 },
  { id: 'audit', label: 'Audit', icon: History, count: 87 },
];