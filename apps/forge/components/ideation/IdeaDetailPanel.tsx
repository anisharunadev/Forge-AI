'use client';

/**
 * `<IdeaDetailPanel>` — Step 28.
 *
 * Step 5 base + Step 28 additive panels:
 *   - SOURCE card: where the idea came from (Zendesk / Jira / GitHub / Manual / Market)
 *   - AI REASONING card (uses <ReasoningChain>)
 *   - SYNC STATUS card: Jira + Confluence + IDE rows
 *   - PIPELINE BUTTONS footer: Generate PRD / Push to Jira / Confluence / ai agent
 *   - Big "🚀 Send to build pipeline" CTA when status === 'approved'
 *
 * Step 5 data model is preserved — enrichment lives in
 * `lib/ideation/pipeline-data.ts` and is looked up by idea id.
 */

import * as React from 'react';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  Lightbulb,
  Loader2, Rocket,
  Send,
  Sparkles,
  // Trello,
  XCircle
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ScoreBadge } from './ScoreBadge';
import { ReasoningChain } from './ReasoningChain';
import {
  SAMPLE_REASONING,
  findEnrichment,
  type IdeaReasoningSummary,
  type IdeaSyncStatus,
} from '@/lib/ideation/pipeline-data';
import type { Idea } from '@/lib/ideation/data';

export interface IdeaDetailPanelProps {
  idea: Idea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Triggers the one-click pipeline run. */
  onSendToPipeline?: (idea: Idea) => void;
}

function sourceAccentClasses(accent: 'cyan' | 'indigo' | 'violet' | 'amber' | 'rose'): {
  ring: string;
  bg: string;
  text: string;
} {
  switch (accent) {
    case 'cyan':
      return { ring: 'ring-[rgba(34,211,238,0.35)]', bg: 'bg-[rgba(34,211,238,0.10)]', text: 'text-[var(--accent-cyan)]' };
    case 'indigo':
      return { ring: 'ring-[rgba(99,102,241,0.35)]', bg: 'bg-[rgba(99,102,241,0.10)]', text: 'text-[var(--accent-primary)]' };
    case 'violet':
      return { ring: 'ring-[rgba(168,85,247,0.35)]', bg: 'bg-[rgba(168,85,247,0.10)]', text: 'text-[var(--accent-violet)]' };
    case 'amber':
      return { ring: 'ring-[rgba(245,158,11,0.35)]', bg: 'bg-[rgba(245,158,11,0.10)]', text: 'text-[var(--accent-amber)]' };
    case 'rose':
      return { ring: 'ring-[rgba(244,63,94,0.35)]', bg: 'bg-[rgba(244,63,94,0.10)]', text: 'text-[var(--accent-rose)]' };
  }
}

function confidenceToBadge(conf: IdeaReasoningSummary['confidence']): {
  cls: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  if (conf === 'high')
    return {
      cls: 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]',
      label: 'High confidence',
      Icon: CheckCircle2,
    };
  if (conf === 'medium')
    return {
      cls: 'bg-[rgba(245,158,11,0.12)] text-[var(--accent-amber)]',
      label: 'Medium confidence',
      Icon: CircleAlert,
    };
  return {
    cls: 'bg-[rgba(244,63,94,0.12)] text-[var(--accent-rose)]',
    label: 'Low confidence',
    Icon: XCircle,
  };
}

function syncIcon(state: 'created' | 'syncing' | 'failed' | 'none' | 'running' | 'queued' | 'completed'): {
  Icon: React.ComponentType<{ className?: string }>;
  cls: string;
  label: string;
} {
  switch (state) {
    case 'created':
    case 'completed':
      return { Icon: CheckCircle2, cls: 'text-[var(--accent-emerald)]', label: 'Created' };
    case 'running':
    case 'syncing':
    case 'queued':
      return { Icon: Loader2, cls: 'text-[var(--accent-cyan)]', label: 'In progress' };
    case 'failed':
      return { Icon: XCircle, cls: 'text-[var(--accent-rose)]', label: 'Failed' };
    case 'none':
    default:
      return { Icon: CircleAlert, cls: 'text-[var(--fg-tertiary)]', label: 'Not synced' };
  }
}

function SyncRow({
  icon,
  name,
  state,
  ref,
  lastSync,
  onSyncNow,
}: {
  icon: React.ReactNode;
  name: string;
  state: 'created' | 'syncing' | 'failed' | 'none' | 'running' | 'queued' | 'completed';
  ref?: string;
  lastSync?: string;
  onSyncNow?: () => void;
}) {
  const meta = syncIcon(state);
  const Icon = meta.Icon;
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--bg-base)] text-[var(--fg-secondary)]">
          {icon}
        </span>
        <div>
          <div className="flex items-center gap-1.5 text-[var(--fg-primary)]">
            {name}
            <span className={cn('inline-flex items-center gap-1 font-mono text-[10px]', meta.cls)}>
              <Icon className={cn('h-3 w-3', state === 'running' || state === 'syncing' ? 'animate-spin' : '')} aria-hidden="true" />
              {meta.label}
            </span>
          </div>
          <div className="text-[10px] text-[var(--fg-tertiary)]">
            {ref ? <span className="font-mono">{ref}</span> : null}
            {ref && lastSync ? <span aria-hidden="true"> · </span> : null}
            {lastSync ? <span>{lastSync}</span> : null}
            {!ref && !lastSync ? <span>—</span> : null}
          </div>
        </div>
      </div>
      {onSyncNow ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSyncNow}
          className="text-[var(--accent-primary)] hover:bg-[rgba(99,102,241,0.08)] hover:text-[var(--accent-primary)]"
        >
          {state === 'failed' ? 'Re-sync' : 'Sync now'}
        </Button>
      ) : null}
    </div>
  );
}

function SourceCard({ enrichment }: { enrichment: ReturnType<typeof findEnrichment> }) {
  if (!enrichment) return null;
  const accent = sourceAccentClasses(enrichment.source.accent);
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Source
        </h3>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono ring-1',
            accent.bg,
            accent.text,
            accent.ring,
          )}
          data-testid="idea-source-badge"
        >
          {enrichment.source.label}
        </span>
      </header>
      <div className="flex flex-col gap-1.5 text-[11px]">
        {enrichment.source.title ? (
          <a
            href={enrichment.source.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1 text-[var(--fg-primary)] underline-offset-2 hover:underline"
          >
            <span className="line-clamp-2">{enrichment.source.title}</span>
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-[var(--fg-tertiary)]">Captured manually.</span>
        )}
        <div className="flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
          {enrichment.source.reporter ? (
            <span>Reporter: {enrichment.source.reporter}</span>
          ) : null}
          {enrichment.source.priority ? (
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono uppercase tracking-wider text-[var(--fg-secondary)]">
              {enrichment.source.priority}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ReasoningSummaryCard({ reasoning }: { reasoning: IdeaReasoningSummary }) {
  const conf = confidenceToBadge(reasoning.confidence);
  const ConfIcon = conf.Icon;
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          <Brain className="h-3 w-3" aria-hidden="true" />
          Why this score?
        </h3>
        <span className={cn('inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono', conf.cls)}>
          <ConfIcon className="h-3 w-3" aria-hidden="true" />
          {conf.label}
        </span>
      </header>
      <dl className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="text-[10px] font-mono uppercase tracking-wider text-[var(--fg-tertiary)]">
            Cluster
          </dt>
          <dd className="text-[var(--fg-secondary)]">{reasoning.cluster}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-mono uppercase tracking-wider text-[var(--fg-tertiary)]">
            Feasibility
          </dt>
          <dd className="text-[var(--fg-secondary)]">{reasoning.feasibility}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-mono uppercase tracking-wider text-[var(--fg-tertiary)]">
            Impact
          </dt>
          <dd className="text-[var(--fg-secondary)]">{reasoning.impact}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-mono uppercase tracking-wider text-[var(--fg-tertiary)]">
            Risk
          </dt>
          <dd className="text-[var(--fg-secondary)]">{reasoning.risk}</dd>
        </div>
      </dl>
      <footer className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">Final</span>
        <span className="rounded-[var(--radius-sm)] bg-[rgba(168,85,247,0.12)] px-2 py-0.5 font-mono text-xs text-[var(--accent-violet)]">
          {reasoning.finalScore.toFixed(1)} / 10
        </span>
      </footer>
    </section>
  );
}

function SyncStatusCard({ sync }: { sync: IdeaSyncStatus }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        Sync status
      </h3>
      <div className="flex flex-col gap-2">
        <SyncRow
          icon={<Trello className="h-3.5 w-3.5" aria-hidden="true" />}
          name="Jira"
          state={sync.jira?.state ?? 'none'}
          {...(sync.jira?.ref !== undefined ? { ref: sync.jira.ref } : {})}
          {...(sync.jira?.lastSync !== undefined ? { lastSync: sync.jira.lastSync } : {})}
          onSyncNow={() => toast.success('Mock: re-syncing to Jira')}
        />
        <SyncRow
          icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
          name="Confluence"
          state={sync.confluence?.state ?? 'none'}
          {...(sync.confluence?.ref !== undefined ? { ref: sync.confluence.ref } : {})}
          {...(sync.confluence?.lastSync !== undefined ? { lastSync: sync.confluence.lastSync } : {})}
          onSyncNow={() => toast.success('Mock: re-syncing to Confluence')}
        />
        <SyncRow
          icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
          name="ai agent"
          state={sync.ide?.state ?? 'none'}
          {...(sync.ide?.active !== undefined ? { ref: `${sync.ide.active} active` } : {})}
          {...(sync.ide?.lastSync !== undefined ? { lastSync: sync.ide.lastSync } : {})}
          onSyncNow={() => toast.success('Mock: queueing ai agent run')}
        />
      </div>
    </section>
  );
}

export function IdeaDetailPanel({
  idea,
  open,
  onOpenChange,
  onSendToPipeline,
}: IdeaDetailPanelProps) {
  const enrichment = idea ? findEnrichment(idea.id) : undefined;
  const isApproved = idea?.status === 'approved';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl"
        data-testid="idea-detail-panel"
      >
        {idea ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto pr-2">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" aria-hidden="true" />
                {idea.title}
              </SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{idea.id}</span> · created{' '}
                {new Date(idea.createdAt).toLocaleDateString()}
              </SheetDescription>
            </SheetHeader>

            <div className="flex items-center gap-2">
              <ScoreBadge score={idea.score} />
              <Badge variant="outline">{idea.status}</Badge>
              <Badge variant="outline">{idea.impact} impact</Badge>
            </div>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Summary
              </h3>
              <p className="text-sm text-forge-100">{idea.summary}</p>
            </section>

            {/* Step 28: SOURCE */}
            <SourceCard enrichment={enrichment} />

            {/* Step 28: AI REASONING (summary + expandable full chain) */}
            {enrichment ? (
              <details className="group rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <summary className="cursor-pointer list-none p-3">
                  <ReasoningSummaryCard reasoning={enrichment.reasoning} />
                </summary>
                <div className="border-t border-[var(--border-subtle)] p-3">
                  <ReasoningChain chain={SAMPLE_REASONING} defaultOpen={false} />
                </div>
              </details>
            ) : null}

            {/* Step 28: SYNC STATUS */}
            {enrichment ? <SyncStatusCard sync={enrichment.sync} /> : null}

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Score breakdown
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-forge-300">Impact</dt>
                <dd className="font-mono">{idea.scoreBreakdown.impact}/10</dd>
                <dt className="text-forge-300">Feasibility</dt>
                <dd className="font-mono">
                  {idea.scoreBreakdown.feasibility}/10
                </dd>
                <dt className="text-forge-300">Confidence</dt>
                <dd className="font-mono">
                  {idea.scoreBreakdown.confidence}/10
                </dd>
                <dt className="text-forge-300">Effort</dt>
                <dd className="font-mono">{idea.scoreBreakdown.effort}/10</dd>
              </dl>
            </section>

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Analysis
              </h3>
              <p className="text-sm text-forge-100">{idea.analysis}</p>
            </section>

            {idea.risks.length > 0 ? (
              <section>
                <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Risks
                </h3>
                <ul className="list-inside list-disc text-sm text-forge-100">
                  {idea.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {idea.prdRef ? (
              <section>
                <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  PRD
                </h3>
                <p className="font-mono text-xs text-forge-100">{idea.prdRef}</p>
              </section>
            ) : null}

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Owner
              </h3>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-forge-700 bg-forge-800 font-mono text-[10px]">
                  {idea.ownerAvatar}
                </span>
                <span className="text-sm">{idea.owner}</span>
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Tags
              </h3>
              <div className="flex flex-wrap gap-1">
                {idea.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            </section>

            <Separator />

            {/* Step 28: Pipeline buttons */}
            <section className="space-y-2">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Pipeline
              </h3>

              {isApproved ? (
                <Button
                  type="button"
                  size="lg"
                  data-testid="idea-one-click-pipeline"
                  onClick={() => {
                    onSendToPipeline?.(idea);
                    toast.success('Pipeline started', {
                      description: `${idea.title} → PRD → Jira → Confluence → ai agent`,
                      duration: 4000,
                      progressBar: true,
                    });
                  }}
                  className="w-full bg-[var(--accent-amber)] text-black hover:opacity-90"
                >
                  <Rocket className="h-4 w-4" aria-hidden="true" />
                  🚀 Send to build pipeline
                </Button>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toast.info('Mock: opens PRD generation flow.')}
                  className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Generate PRD
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toast.info('Mock: pushes to Jira.')}
                  className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Push to Jira
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toast.info('Mock: generates Confluence page.')}
                  className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Confluence page
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toast.info('Mock: queues ai agent run.')}
                  className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Send to ai agent
                </Button>
              </div>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}