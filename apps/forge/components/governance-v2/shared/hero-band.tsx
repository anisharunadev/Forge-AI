'use client';

import * as React from 'react';
import { ShieldCheck, MoreVertical, Download, FileText, Activity } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type StatusTone = 'emerald' | 'amber' | 'rose';

const statusToneClasses: Record<StatusTone, string> = {
  emerald: 'bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] border-[var(--accent-emerald)]/30',
  amber: 'bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border-[var(--accent-amber)]/30',
  rose: 'bg-[var(--accent-rose)]/10 text-[var(--accent-rose)] border-[var(--accent-rose)]/30',
};

export interface GuardrailStatusPillProps {
  readonly status: 'all-active' | 'warning' | 'critical';
  readonly count: number;
}

export function GuardrailStatusPill({ status, count }: GuardrailStatusPillProps) {
  const tone: StatusTone = status === 'all-active' ? 'emerald' : status === 'warning' ? 'amber' : 'rose';
  const dot = status === 'all-active' ? '🟢' : status === 'warning' ? '🟡' : '🔴';
  const label = status === 'all-active'
    ? 'All guardrails active'
    : status === 'warning'
    ? `${count} violation${count !== 1 ? 's' : ''} in last hour`
    : `${count} critical violations`;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider',
        statusToneClasses[tone],
      )}
      data-testid="guardrail-status-pill"
      aria-live="polite"
    >
      <span aria-hidden>{dot}</span>
      <span>{label}</span>
    </div>
  );
}

export interface ComplianceScoreProps {
  readonly score: number;
  readonly standardsMet: number;
  readonly standardsTotal: number;
}

export function ComplianceScore({ score, standardsMet, standardsTotal }: ComplianceScoreProps) {
  return (
    <div
      className="inline-flex items-center gap-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px]"
      data-testid="compliance-score"
    >
      <span className="font-semibold text-[var(--fg-secondary)]">COMPLIANCE</span>
      <span className="tabular-nums font-bold text-[var(--accent-emerald)]">{score}%</span>
      <span className="text-[var(--fg-tertiary)]">·</span>
      <span className="tabular-nums text-[var(--fg-secondary)]">{standardsMet} of {standardsTotal} standards</span>
    </div>
  );
}

export interface BoardTokenPillProps {
  readonly present: boolean;
}

export function BoardTokenPill({ present }: BoardTokenPillProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider',
        present
          ? 'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
          : 'border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]',
      )}
      data-testid="board-token-pill"
    >
      <ShieldCheck className="h-3 w-3" aria-hidden />
      {present ? 'Board token present' : 'No board token'}
    </div>
  );
}

export interface HeroBandProps {
  readonly persona: string;
  readonly guardrailStatus: 'all-active' | 'warning' | 'critical';
  readonly guardrailCount: number;
  readonly complianceScore: number;
  readonly standardsMet: number;
  readonly standardsTotal: number;
  readonly boardTokenPresent: boolean;
}

export function HeroBand({
  persona,
  guardrailStatus,
  guardrailCount,
  complianceScore,
  standardsMet,
  standardsTotal,
  boardTokenPresent,
}: HeroBandProps) {
  return (
    <section
      className="hero-border relative flex min-h-[180px] items-center overflow-hidden rounded-[var(--radius-xl)]"
      data-testid="governance-hero"
      aria-labelledby="governance-hero-title"
    >
      <div className="relative z-10 flex h-full w-full flex-col items-start justify-between gap-4 rounded-[var(--radius-xl)] bg-[var(--bg-surface)]/85 px-8 py-6 backdrop-blur-sm md:flex-row md:items-center">
        <div className="flex max-w-2xl flex-col gap-2">
          <p className="text-[var(--text-xs)] uppercase tracking-widest text-[var(--fg-tertiary)]">
            GOVERNANCE CENTER · {persona}
          </p>
          <h1
            id="governance-hero-title"
            className="flex items-center gap-3 text-[var(--text-2xl)] leading-tight text-[var(--fg-primary)]"
            style={{ fontWeight: 'var(--font-weight-bold)' }}
          >
            <ShieldCheck className="h-6 w-6 text-[var(--accent-emerald)]" aria-hidden />
            Governance Center
          </h1>
          <p className="max-w-2xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Policy management, AI guardrails, compliance standards, and LLM control.
            Every prompt and tool call passes through this layer before reaching the model.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <GuardrailStatusPill status={guardrailStatus} count={guardrailCount} />
            <ComplianceScore score={complianceScore} standardsMet={standardsMet} standardsTotal={standardsTotal} />
            <BoardTokenPill present={boardTokenPresent} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-inset)]"
              aria-label="Open governance menu"
              data-testid="governance-menu-trigger"
            >
              <MoreVertical className="h-3 w-3" aria-hidden />
              Actions
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                Export config
              </DropdownMenuItem>
              <DropdownMenuItem>
                <FileText className="mr-2 h-3.5 w-3.5" aria-hidden />
                Audit log export
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Activity className="mr-2 h-3.5 w-3.5" aria-hidden />
                System status
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </section>
  );
}