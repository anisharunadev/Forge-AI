'use client';

/**
 * `<PipelineView>` — Step 28.
 *
 * The "Continuous Context Orchestration" hub — three columns:
 *
 *   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
 *   │  INGEST     │ →  │  PROCESS    │ →  │  SYNC       │
 *   │  sources    │    │  agent      │    │ destinations│
 *   └─────────────┘    └─────────────┘    └─────────────┘
 *
 * Below the bento: a single-row pipeline status bar with clickable
 * segments that route to the relevant detail page.
 *
 * The PROCESS column renders a streaming reasoning preview (word-by-word
 * via `setInterval` mock — a real SSE channel plugs in later).
 */

import * as React from 'react';
import {
  Activity,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  Code,
  Cog,
  Download,
  Headphones,
  Loader2,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  DESTINATIONS,
  INGEST_SOURCES,
  LIVE_REASONING_SCRIPT,
  PIPELINE_STATUS,
  type Destination,
  type IngestSource,
} from '@/lib/ideation/pipeline-data';

// ---------------------------------------------------------------------------
// Helpers — accent → classes. Keeps the components lean.
// ---------------------------------------------------------------------------

function sourceAccent(accent: IngestSource['accent']): {
  ring: string;
  bg: string;
  text: string;
  chip: string;
} {
  switch (accent) {
    case 'cyan':
      return {
        ring: 'ring-[rgba(34,211,238,0.35)]',
        bg: 'bg-[rgba(34,211,238,0.10)]',
        text: 'text-[var(--accent-cyan)]',
        chip: 'border-[rgba(34,211,238,0.35)] text-[var(--accent-cyan)]',
      };
    case 'amber':
      return {
        ring: 'ring-[rgba(245,158,11,0.35)]',
        bg: 'bg-[rgba(245,158,11,0.10)]',
        text: 'text-[var(--accent-amber)]',
        chip: 'border-[rgba(245,158,11,0.35)] text-[var(--accent-amber)]',
      };
    case 'indigo':
      return {
        ring: 'ring-[rgba(99,102,241,0.35)]',
        bg: 'bg-[rgba(99,102,241,0.10)]',
        text: 'text-[var(--accent-primary)]',
        chip: 'border-[rgba(99,102,241,0.35)] text-[var(--accent-primary)]',
      };
    case 'violet':
      return {
        ring: 'ring-[rgba(168,85,247,0.35)]',
        bg: 'bg-[rgba(168,85,247,0.10)]',
        text: 'text-[var(--accent-violet)]',
        chip: 'border-[rgba(168,85,247,0.35)] text-[var(--accent-violet)]',
      };
    case 'rose':
      return {
        ring: 'ring-[rgba(244,63,94,0.35)]',
        bg: 'bg-[rgba(244,63,94,0.10)]',
        text: 'text-[var(--accent-rose)]',
        chip: 'border-[rgba(244,63,94,0.35)] text-[var(--accent-rose)]',
      };
    case 'emerald':
      return {
        ring: 'ring-[rgba(16,185,129,0.35)]',
        bg: 'bg-[rgba(16,185,129,0.10)]',
        text: 'text-[var(--accent-emerald)]',
        chip: 'border-[rgba(16,185,129,0.35)] text-[var(--accent-emerald)]',
      };
  }
}

function sourceIcon(name: IngestSource['icon']): React.ReactNode {
  switch (name) {
    case 'Headphones':
      return <Headphones className="h-4 w-4" aria-hidden="true" />;
    case 'TrendingUp':
      return <TrendingUp className="h-4 w-4" aria-hidden="true" />;
    case 'Code':
      return <Code className="h-4 w-4" aria-hidden="true" />;
    case 'MessageSquare':
      return <Activity className="h-4 w-4" aria-hidden="true" />;
    case 'BookOpen':
      return <BookOpen className="h-4 w-4" aria-hidden="true" />;
    case 'Rss':
      return <TrendingUp className="h-4 w-4" aria-hidden="true" />;
    case 'Mail':
      return <Sparkles className="h-4 w-4" aria-hidden="true" />;
    case 'Webhook':
      return <Zap className="h-4 w-4" aria-hidden="true" />;
    case 'Slack':
      return <Sparkles className="h-4 w-4" aria-hidden="true" />;
  }
}

function destinationIcon(name: Destination['icon']): React.ReactNode {
  switch (name) {
    case 'Trello':
      return <Code className="h-4 w-4" aria-hidden="true" />;
    case 'BookOpen':
      return <BookOpen className="h-4 w-4" aria-hidden="true" />;
    case 'Sparkles':
      return <Sparkles className="h-4 w-4" aria-hidden="true" />;
    case 'Slack':
      return <Sparkles className="h-4 w-4" aria-hidden="true" />;
    case 'Github':
      return <Code className="h-4 w-4" aria-hidden="true" />;
    case 'Mail':
      return <Sparkles className="h-4 w-4" aria-hidden="true" />;
    case 'MessageSquare':
      return <Activity className="h-4 w-4" aria-hidden="true" />;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusPulse({ tone = 'emerald' }: { tone?: 'emerald' | 'cyan' | 'amber' }) {
  const cls =
    tone === 'emerald'
      ? 'bg-[var(--accent-emerald)]'
      : tone === 'cyan'
        ? 'bg-[var(--accent-cyan)]'
        : 'bg-[var(--accent-amber)]';
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden="true">
      <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', cls)} />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', cls)} />
    </span>
  );
}

interface SourceCardProps {
  readonly source: IngestSource;
  readonly onSettings?: () => void;
  readonly onOpen?: () => void;
}

function SourceCard({ source, onSettings, onOpen }: SourceCardProps) {
  const accent = sourceAccent(source.accent);
  return (
    <article
      data-testid="pipeline-source-card"
      data-source-id={source.id}
      data-source-kind={source.kind}
      className={cn(
        'group flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 transition-[border,transform] duration-200 ease-out-soft hover:-translate-y-px hover:border-[var(--border-default)]',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              'mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md ring-1',
              accent.bg,
              accent.text,
              accent.ring,
            )}
          >
            {sourceIcon(source.icon)}
          </span>
          <div>
            <h4 className="text-sm font-medium text-[var(--fg-primary)]">{source.name}</h4>
            <p className="line-clamp-2 text-[11px] text-[var(--fg-tertiary)]">
              {source.description}
            </p>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-2 text-[10px] text-[var(--fg-secondary)]">
        {source.status === 'connected' ? (
          <>
            <StatusPulse tone="emerald" />
            <span>Synced {source.lastSync}</span>
            {source.trend ? (
              <span className="font-mono text-[var(--accent-emerald)]">{source.trend}</span>
            ) : null}
          </>
        ) : source.status === 'error' ? (
          <>
            <StatusPulse tone="amber" />
            <span className="text-[var(--accent-amber)]">Sync error</span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-[var(--fg-muted)]" aria-hidden="true" />
            <span>Not connected</span>
          </>
        )}
      </div>

      <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-[10px] font-mono text-[var(--fg-secondary)]">
        {source.kpi}
      </div>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          onClick={onOpen}
          disabled={source.status !== 'connected'}
          className="text-[11px] font-medium text-[var(--accent-primary)] transition-colors hover:underline disabled:cursor-not-allowed disabled:text-[var(--fg-muted)] disabled:no-underline"
        >
          {source.status === 'connected' ? 'View →' : 'Connect →'}
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label={`${source.name} settings`}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <Cog className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

interface DestinationCardProps {
  readonly destination: Destination;
  readonly onSettings?: () => void;
  readonly onOpen?: () => void;
}

function DestinationCard({ destination, onSettings, onOpen }: DestinationCardProps) {
  const accent = sourceAccent(destination.accent);
  return (
    <article
      data-testid="pipeline-destination-card"
      data-destination-id={destination.id}
      data-destination-kind={destination.kind}
      className={cn(
        'group flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 transition-[border,transform] duration-200 ease-out-soft hover:-translate-y-px hover:border-[var(--border-default)]',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              'mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md ring-1',
              accent.bg,
              accent.text,
              accent.ring,
            )}
          >
            {destinationIcon(destination.icon)}
          </span>
          <div>
            <h4 className="text-sm font-medium text-[var(--fg-primary)]">{destination.name}</h4>
            <p className="line-clamp-2 text-[11px] text-[var(--fg-tertiary)]">
              {destination.description}
            </p>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-2 text-[10px] text-[var(--fg-secondary)]">
        {destination.status === 'connected' ? (
          <>
            <Check className="h-3 w-3 text-[var(--accent-emerald)]" aria-hidden="true" />
            <span>Connected · Last sync {destination.lastSync}</span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-[var(--fg-muted)]" aria-hidden="true" />
            <span>Not connected</span>
          </>
        )}
      </div>

      <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-[10px] font-mono text-[var(--fg-secondary)]">
        {destination.kpi}
      </div>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          onClick={onOpen}
          disabled={destination.status !== 'connected'}
          className="text-[11px] font-medium text-[var(--accent-primary)] transition-colors hover:underline disabled:cursor-not-allowed disabled:text-[var(--fg-muted)] disabled:no-underline"
        >
          {destination.status === 'connected' ? 'View →' : 'Connect →'}
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label={`${destination.name} settings`}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Center agent panel — live reasoning preview (word-by-word mock).
// ---------------------------------------------------------------------------

interface AgentPanelProps {
  readonly onProcessNow?: () => void;
}

function AgentPanel({ onProcessNow }: AgentPanelProps) {
  const [running, setRunning] = React.useState(false);
  const [stepIdx, setStepIdx] = React.useState(0);
  const [text, setText] = React.useState('');

  React.useEffect(() => {
    if (!running) {
      setStepIdx(0);
      setText('');
      return;
    }
    if (stepIdx >= LIVE_REASONING_SCRIPT.length) {
      setRunning(false);
      return;
    }
    const full = LIVE_REASONING_SCRIPT[stepIdx] ?? '';
    let i = 0;
    setText('');
    const interval = window.setInterval(() => {
      i += 1;
      setText(full.slice(0, i));
      if (i >= full.length) {
        window.clearInterval(interval);
        window.setTimeout(() => setStepIdx((idx) => idx + 1), 600);
      }
    }, 28);
    return () => window.clearInterval(interval);
  }, [running, stepIdx]);

  const handleProcessNow = () => {
    setRunning(true);
    setStepIdx(0);
    onProcessNow?.();
  };

  const progress = LIVE_REASONING_SCRIPT.length === 0
    ? 0
    : Math.min(stepIdx / LIVE_REASONING_SCRIPT.length, 1);

  return (
    <section
      data-testid="pipeline-agent-panel"
      className="flex h-full flex-col gap-3 rounded-[var(--radius-xl)] border border-[rgba(245,158,11,0.35)] bg-[var(--bg-elevated)] p-5"
      style={{
        boxShadow: '0 0 0 1px rgba(245,158,11,0.15), 0 0 24px -8px rgba(245,158,11,0.4)',
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgba(245,158,11,0.12)] text-[var(--accent-amber)] ring-1 ring-[rgba(245,158,11,0.35)]">
            <Brain className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-[var(--fg-primary)]">
              Forge Ideation Agent
            </h3>
            <p className="text-xs text-[var(--fg-tertiary)]">
              RAG + LLM Reasoning Engine
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-mono',
            running
              ? 'bg-[rgba(34,211,238,0.12)] text-[var(--accent-cyan)]'
              : 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]',
          )}
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
          {running ? 'streaming' : 'idle'}
        </span>
      </header>

      {/* Streaming reasoning */}
      <div
        data-testid="pipeline-agent-stream"
        className="min-h-[64px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--fg-secondary)]"
      >
        {text || (running ? '…' : 'Press "Process now" to trigger an ingest + reasoning cycle.')}
        {running ? (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[var(--accent-cyan)] align-middle" aria-hidden="true" />
        ) : null}
      </div>

      {/* Step indicator: Cluster → Score → Draft */}
      <ol className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[var(--fg-tertiary)]">
        {['Cluster', 'Score', 'Draft'].map((label, i) => {
          const reached = !running ? true : stepIdx >= Math.floor((LIVE_REASONING_SCRIPT.length / 3) * i);
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded-full',
                  reached
                    ? 'bg-[var(--accent-emerald)] text-white'
                    : 'bg-[var(--bg-inset)] text-[var(--fg-muted)]',
                )}
              >
                {reached ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : null}
              </span>
              {label}
              {i < 2 ? <span aria-hidden="true">›</span> : null}
            </li>
          );
        })}
      </ol>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]" aria-hidden="true">
        <div
          className="h-full rounded-full bg-[var(--accent-amber)] transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* Live metrics */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5">
          <div className="text-[var(--fg-tertiary)]">Scoring</div>
          <div className="font-mono text-[var(--accent-amber)]">3 ideas</div>
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5">
          <div className="text-[var(--fg-tertiary)]">Drafting</div>
          <div className="font-mono text-[var(--accent-violet)]">1 PRD</div>
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5">
          <div className="text-[var(--fg-tertiary)]">Errors</div>
          <div className="font-mono text-[var(--accent-emerald)]">0</div>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <a
          href="#"
          className="text-xs text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
        >
          Configure agent →
        </a>
        <Button
          type="button"
          size="sm"
          onClick={handleProcessNow}
          disabled={running}
          data-testid="pipeline-process-now"
          className="bg-[var(--accent-amber)] text-black hover:opacity-90"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Zap className="h-4 w-4" aria-hidden="true" />
          )}
          {running ? 'Processing…' : 'Process now'}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Connection lines (decorative SVG between columns)
// ---------------------------------------------------------------------------

function ConnectionLines() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 80"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="ingest-to-process" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(34,211,238,0.0)" />
          <stop offset="50%" stopColor="rgba(34,211,238,0.55)" />
          <stop offset="100%" stopColor="rgba(245,158,11,0.55)" />
        </linearGradient>
        <linearGradient id="process-to-sync" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(245,158,11,0.55)" />
          <stop offset="50%" stopColor="rgba(245,158,11,0.0)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0.55)" />
        </linearGradient>
      </defs>

      {/* Ingest → process */}
      <line
        x1="280"
        y1="40"
        x2="600"
        y2="40"
        stroke="url(#ingest-to-process)"
        strokeWidth="2"
        strokeDasharray="6 6"
        className="animate-[dash-flow_3s_linear_infinite]"
      />
      {/* Process → sync */}
      <line
        x1="600"
        y1="40"
        x2="920"
        y2="40"
        stroke="url(#process-to-sync)"
        strokeWidth="2"
        strokeDasharray="6 6"
        className="animate-[dash-flow_3s_linear_infinite]"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Pipeline status bar (single row)
// ---------------------------------------------------------------------------

function PipelineStatusBar() {
  return (
    <div
      data-testid="pipeline-status-bar"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[11px]"
      role="status"
      aria-label="Pipeline status"
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-[var(--accent-emerald)]">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Healthy
      </span>
      {PIPELINE_STATUS.map((s, i) => (
        <React.Fragment key={s.id}>
          <span aria-hidden="true" className="text-[var(--fg-muted)]">·</span>
          <button
            type="button"
            data-testid={`pipeline-status-${s.id}`}
            className="group inline-flex items-center gap-1 rounded text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            onClick={() =>
              toast.info(`${s.count} ${s.label}`, {
                description: 'Deep-link routes to the detail page in a follow-up.',
              })
            }
          >
            <span className="font-mono">{s.count}</span>
            <span>{s.label}</span>
            {i < PIPELINE_STATUS.length - 1 ? (
              <span aria-hidden="true" className="text-[var(--fg-muted)]">›</span>
            ) : null}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PipelineView
// ---------------------------------------------------------------------------

export interface PipelineViewProps {
  readonly onAddSource?: () => void;
  readonly onAddDestination?: () => void;
  readonly onOpenSource?: (source: IngestSource) => void;
  readonly onOpenDestination?: (destination: Destination) => void;
  readonly onProcessNow?: () => void;
}

export function PipelineView({
  onAddSource,
  onAddDestination,
  onOpenSource,
  onOpenDestination,
  onProcessNow,
}: PipelineViewProps) {
  const connectedSources = INGEST_SOURCES.filter((s) => s.status === 'connected');
  const connectedDestinations = DESTINATIONS.filter((d) => d.status === 'connected');

  return (
    <section
      aria-label="Continuous Context Orchestration"
      data-testid="pipeline-view"
      className="flex flex-col"
    >
      {/* Header */}
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            Continuous Context Orchestration
          </p>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            How Forge turns signals into shipped work
          </h2>
        </div>
      </header>

      {/* Bento */}
      <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Layer SVG lines on lg only (positions align with column edges) */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          <ConnectionLines />
        </div>

        {/* INGEST */}
        <section
          aria-label="What Forge ingests"
          data-testid="pipeline-column-ingest"
          className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
        >
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(34,211,238,0.12)] text-[var(--accent-cyan)]">
                <Download className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
                  What Forge ingests
                </p>
                <p className="text-xs font-medium text-[var(--fg-primary)]">
                  {connectedSources.length} active sources
                </p>
              </div>
            </div>
          </header>

          <div className="flex flex-col gap-3">
            {connectedSources.map((s) => (
              <SourceCard
                key={s.id}
                source={s}
                onSettings={() => toast.info(`Settings: ${s.name}`, {
                  description: 'Source settings open in a follow-up.',
                })}
                onOpen={() => onOpenSource?.(s)}
              />
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddSource}
            data-testid="pipeline-add-source"
            className="mt-1 border-dashed border-[var(--border-default)] bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add source
          </Button>
        </section>

        {/* PROCESS */}
        <div data-testid="pipeline-column-process" className="relative">
          <AgentPanel onProcessNow={onProcessNow} />
        </div>

        {/* SYNC */}
        <section
          aria-label="Syncs to your tools"
          data-testid="pipeline-column-sync"
          className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
        >
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]">
                <Upload className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
                  Syncs to your tools
                </p>
                <p className="text-xs font-medium text-[var(--fg-primary)]">
                  {connectedDestinations.length} active destinations
                </p>
              </div>
            </div>
          </header>

          <div className="flex flex-col gap-3">
            {connectedDestinations.map((d) => (
              <DestinationCard
                key={d.id}
                destination={d}
                onSettings={() => toast.info(`Settings: ${d.name}`, {
                  description: 'Destination settings open in a follow-up.',
                })}
                onOpen={() => onOpenDestination?.(d)}
              />
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddDestination}
            data-testid="pipeline-add-destination"
            className="mt-1 border-dashed border-[var(--border-default)] bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add destination
          </Button>
        </section>
      </div>

      <PipelineStatusBar />

      {/* Exported reasoning preview — empty state until the ideation
          reasoning endpoint ships. The lite card stays defined below
          (Day-4 wiring) and is only used when real chain data lands. */}
      <div className="mt-4">
        <ReasoningChainLiteEmpty />
      </div>
    </section>
  );
}

// ponytail: empty-state variant of the reasoning preview card — Track O
// (Day 3) removed the SAMPLE_REASONING seed. Rendered until the
// ideation reasoning endpoint lands.
function ReasoningChainLiteEmpty() {
  return (
    <article
      data-testid="pipeline-reasoning-lite"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-center"
    >
      <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
        Latest reasoning chain
      </p>
      <p className="text-sm font-medium text-[var(--fg-primary)]">
        No reasoning chain yet
      </p>
      <p className="text-xs text-[var(--fg-tertiary)]">
        The Ideation reasoning endpoint ships on Day 4+. Latest agent
        run output will appear here.
      </p>
    </article>
  );
}