'use client';

import * as React from 'react';
import {
  ShieldCheck,
  FileCheck,
  Users,
  HeartPulse,
  CreditCard,
  Building2,
  BookLock,
  Shield,
  UserCheck,
  Cloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  XCircle,
  CircleDot,
  Download,
  X,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { STANDARDS } from '@/lib/governance-v2';
import type { ComplianceStandard, StandardControl, StandardStatus } from '@/lib/governance-v2';
import { ToneBadge, standardStatusTone } from '../shared/severity-badge';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldCheck, FileCheck, Users, HeartPulse, CreditCard, Building2, BookLock, Shield, UserCheck, Cloud, Sparkles,
};

function StandardIcon({ name, className }: { name: string; className?: string }) {
  const Icon = iconMap[name] ?? ShieldCheck;
  return <Icon className={className} aria-hidden />;
}

const colorVar: Record<string, string> = {
  indigo: 'var(--accent-primary)',
  emerald: 'var(--accent-emerald)',
  cyan: 'var(--accent-cyan)',
  rose: 'var(--accent-rose)',
  amber: 'var(--accent-amber)',
};

const statusIconMap: Record<StandardStatus, React.ComponentType<{ className?: string }>> = {
  compliant: CheckCircle2,
  partial: AlertCircle,
  'non-compliant': XCircle,
  'not-applicable': CircleDot,
};

function StandardCard({
  standard,
  onSelect,
  onLoad,
}: {
  standard: ComplianceStandard;
  onSelect: (s: ComplianceStandard) => void;
  onLoad: (id: string) => void;
}) {
  const compliantCount = standard.controls.filter((c) => c.status === 'compliant').length;
  const totalControls = standard.controls.length;
  const percent = totalControls > 0 ? Math.round((compliantCount / totalControls) * 100) : 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--accent-primary)]/40',
        standard.loaded ? 'border-[var(--accent-emerald)]/30' : 'border-[var(--border-subtle)]',
      )}
      data-testid={`standard-card-${standard.id}`}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border"
          style={{ background: `${colorVar[standard.color] ?? 'var(--accent-primary)'}10`, borderColor: `${colorVar[standard.color] ?? 'var(--accent-primary)'}30`, color: colorVar[standard.color] ?? 'var(--accent-primary)' }}
          aria-hidden
        >
          <StandardIcon name={standard.icon} className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-semibold text-[var(--fg-primary)]">{standard.code}</h4>
            {standard.loaded ? <ToneBadge tone="emerald">Loaded</ToneBadge> : <ToneBadge tone="muted">Available</ToneBadge>}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-secondary)]">{standard.description}</p>
        </div>
      </div>

      {standard.loaded ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--fg-tertiary)]">
              <span className="font-mono font-semibold text-[var(--fg-primary)]">{compliantCount}/{totalControls}</span> controls
            </span>
            <span className="font-mono font-semibold text-[var(--accent-emerald)]">{percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
            <div className="h-full bg-[var(--accent-emerald)]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--fg-tertiary)]">
            {standard.id === 'iso-27001' ? '93 controls' : standard.id === 'soc2-type2' ? '~64 controls' : standard.id === 'gdpr' ? '~99 articles' : '~50-100 controls'}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => onLoad(standard.id)} className="h-7 text-[11px]" data-testid={`standard-load-${standard.id}`}>
              Load
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onSelect(standard)} className="h-7 text-[11px]">
              Preview
            </Button>
          </div>
        </div>
      )}

      {standard.loaded ? (
        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2">
          <Button size="sm" variant="outline" onClick={() => onSelect(standard)} className="h-7 flex-1 text-[11px]" data-testid={`standard-manage-${standard.id}`}>
            Manage
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]">
            <Download className="h-3 w-3" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StandardDetail({ standard, onClose }: { standard: ComplianceStandard; onClose: () => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-testid="standard-detail">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <StandardIcon name={standard.icon} className="h-5 w-5 text-[var(--accent-primary)]" aria-hidden />
            <h3 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">{standard.code}</h3>
            <span className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-secondary)]">v{standard.version}</span>
            <ToneBadge tone="emerald">{standard.overallScore}% compliant</ToneBadge>
          </div>
          <p className="text-[11px] text-[var(--fg-tertiary)]">{standard.description}</p>
          <p className="text-[10px] text-[var(--fg-tertiary)]">Last assessed: {standard.lastAssessed} · Scope: {standard.scope}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]" aria-label="Close detail">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Tabs defaultValue="controls">
        <TabsList className="border-b border-[var(--border-subtle)] bg-transparent px-4">
          {[
            { id: 'controls', label: `Controls (${standard.controls.length})` },
            { id: 'evidence', label: `Evidence (${standard.evidence.length})` },
            { id: 'exceptions', label: `Exceptions (${standard.exceptions.length})` },
            { id: 'reports', label: 'Reports' },
          ].map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent-primary)] data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              data-testid={`standard-detail-tab-${t.id}`}
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="controls" className="m-0 max-h-[500px] overflow-y-auto p-4">
          <div className="space-y-2">
            {standard.controls.map((control) => (
              <ControlRow key={control.id} control={control} />
            ))}
            {standard.controls.length === 0 ? (
              <p className="text-[11px] text-[var(--fg-tertiary)]">No controls yet — load the standard to populate.</p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="evidence" className="m-0 max-h-[500px] overflow-y-auto p-4">
          <div className="space-y-2">
            {standard.evidence.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3" data-testid={`evidence-${ev.id}`}>
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-[var(--fg-primary)]">{ev.description}</span>
                  <div className="flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
                    <span className="font-mono">{new Date(ev.timestamp).toLocaleString()}</span>
                    <span>·</span>
                    <span>{ev.source}</span>
                    <span>·</span>
                    <span className="font-mono">control {ev.controlId}</span>
                  </div>
                </div>
                <Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="exceptions" className="m-0 p-4">
          <div className="space-y-2">
            {standard.exceptions.map((exc) => (
              <div key={exc.id} className="rounded-[var(--radius-sm)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 p-3" data-testid={`exception-${exc.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[var(--fg-primary)]">Exception: {exc.controlId}</span>
                  {exc.expiresAt ? <span className="text-[10px] text-[var(--fg-tertiary)]">Expires {exc.expiresAt}</span> : null}
                </div>
                <p className="mt-1 text-[11px] text-[var(--fg-secondary)]">{exc.justification}</p>
                <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">Approved by {exc.approver} on {exc.approvedAt}</p>
              </div>
            ))}
            {standard.exceptions.length === 0 ? <p className="text-[11px] text-[var(--fg-tertiary)]">No exceptions.</p> : null}
          </div>
        </TabsContent>

        <TabsContent value="reports" className="m-0 p-4">
          <div className="space-y-2">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
              <h4 className="text-[12px] font-semibold text-[var(--fg-primary)]">Compliance Report — {standard.code}</h4>
              <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                Generate a comprehensive PDF for auditors. Includes control status, evidence list, and exceptions.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm"><Download className="h-3 w-3" />Download PDF</Button>
                <Button size="sm" variant="outline"><Download className="h-3 w-3" />Download JSON</Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ControlRow({ control }: { control: StandardControl }) {
  const StatusIcon = statusIconMap[control.status];
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3" data-testid={`control-${control.id}`}>
      <StatusIcon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          control.status === 'compliant' ? 'text-[var(--accent-emerald)]'
          : control.status === 'partial' ? 'text-[var(--accent-amber)]'
          : control.status === 'non-compliant' ? 'text-[var(--accent-rose)]'
          : 'text-[var(--fg-muted)]',
        )}
        aria-hidden
      />
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold text-[var(--fg-primary)]">{control.code}</span>
          <span className="text-[12px] font-medium text-[var(--fg-primary)]">{control.title}</span>
          <ToneBadge tone={standardStatusTone(control.status)}>{control.status}</ToneBadge>
        </div>
        <p className="text-[11px] text-[var(--fg-secondary)]">{control.requirement}</p>
        {control.notes ? <p className="text-[10px] italic text-[var(--fg-tertiary)]">Note: {control.notes}</p> : null}
        {control.evidence.length > 0 ? (
          <p className="text-[10px] text-[var(--fg-tertiary)]">
            {control.evidence.length} evidence items linked
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="ghost" className="h-6 text-[10px]">Mark compliant</Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]">Exception</Button>
      </div>
    </div>
  );
}

export function StandardsTab() {
  const [standards, setStandards] = React.useState<ReadonlyArray<ComplianceStandard>>(STANDARDS);
  const [selected, setSelected] = React.useState<ComplianceStandard | null>(standards.find((s) => s.loaded) ?? null);

  const load = (id: string) => {
    setStandards((prev) => prev.map((s) => (s.id === id ? { ...s, loaded: true, overallScore: 85 } : s)));
  };

  return (
    <div className="space-y-4" data-testid="standards-tab">
      {!selected ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {standards.map((s) => (
            <StandardCard key={s.id} standard={s} onSelect={setSelected} onLoad={load} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Button size="sm" variant="outline" onClick={() => setSelected(null)} data-testid="standards-back">
            ← Back to library
          </Button>
          <StandardDetail standard={selected} onClose={() => setSelected(null)} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {standards.filter((s) => s.id !== selected.id).slice(0, 4).map((s) => (
              <StandardCard key={s.id} standard={s} onSelect={setSelected} onLoad={load} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}