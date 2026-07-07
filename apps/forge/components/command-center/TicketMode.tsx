'use client';

/**
 * TicketMode — ZONE 3 of the brief.
 *
 * Three stacked sections:
 *   1. Ticket input bar (URL/ID paste + examples + recent chips)
 *   2. Ticket analysis card (header + summary + linked entities)
 *   3. AI suggested workflow (horizontal phase pipeline)
 *   4. Phase execution panel (the workbench for the active phase)
 *
 * Skill: `02-typography.md` (mono for IDs), `04-ux-guideline.md`
 * (no skipped heading levels).
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ticket as TicketIcon,
  Sparkles,
  ChevronRight,
  Loader2,
  ArrowUpRight,
  PlayCircle,
  CheckCircle2,
  Link2,
  FileText,
  Bot,
  Lightbulb,
  ScrollText,
  SkipForward,
  History,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/src/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Icon } from '@/lib/command-center/icons';
import { cn } from '@/lib/utils';
import {
  FORGE_PHASES,
  skillById,
  type ForgePhase,
  skillsByPhase,
} from '@/lib/forge-core/manifest';
import {
  PHASE_ACCENT,
  PRIORITY_COLOR,
  TICKET_SOURCE_COLOR,
  TICKET_STATUS_COLOR,
  friendlyDuration,
} from '@/lib/command-center/theme';
import {
  // ticketById kept as a tolerant ID-match helper for legacy callers
  // (still indexed against the deprecated `SAMPLE_TICKETS`).
  ticketById,
  type Ticket,
  type LinkedEntity,
  type TicketSource,
} from '@/lib/command-center/sample-data';
import { useCommandCenter } from '@/lib/command-center/store';
import { useTickets } from '@/lib/hooks/useForgeFixtures';

const SOURCE_ICON: Record<TicketSource, React.ComponentType<{ className?: string }>> = {
  jira: () => (
    <span className="font-mono text-[10px] font-bold tracking-wider text-[#4C9AFF]">J</span>
  ),
  github: () => (
    <span className="font-mono text-[10px] font-bold tracking-wider text-[var(--fg-primary)]">GH</span>
  ),
  linear: () => (
    <span className="font-mono text-[10px] font-bold tracking-wider text-[#9DA8FA]">L</span>
  ),
  manual: () => null,
} as unknown as Record<TicketSource, React.ComponentType<{ className?: string }>>;

function LinkedEntityChip({ entity }: { entity: LinkedEntity }) {
  const map: Record<LinkedEntity['kind'], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    idea: { label: 'Idea', icon: Lightbulb },
    story: { label: 'Story', icon: FileText },
    adr: { label: 'ADR', icon: ScrollText },
    file: { label: 'File', icon: FileText },
    agent: { label: 'Agent', icon: Bot },
    spec: { label: 'Spec', icon: FileText },
    pr: { label: 'PR', icon: ExternalLink },
  };
  const cfg = map[entity.kind];
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1 text-[11px] text-[var(--fg-secondary)]">
      <Icon className="h-3 w-3 text-[var(--accent-cyan)]" aria-hidden />
      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
        {cfg.label}
      </span>
      <span className="font-medium text-[var(--fg-primary)]">{entity.id}</span>
      {entity.label ? (
        <span className="hidden text-[var(--fg-tertiary)] lg:inline">
          · {entity.label}
        </span>
      ) : null}
    </span>
  );
}

function TicketAnalysisCard({ ticket }: { ticket: Ticket }) {
  const source = TICKET_SOURCE_COLOR[ticket.source];
  const status = TICKET_STATUS_COLOR[ticket.status] ?? TICKET_STATUS_COLOR.todo;
  const priority = PRIORITY_COLOR[ticket.priority] ?? PRIORITY_COLOR.p3;

  return (
    <motion.section
      key={ticket.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
      data-testid={`fcc-ticket-card-${ticket.id}`}
      aria-labelledby={`ticket-${ticket.id}-title`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border',
              source.bg,
              source.fg,
              source.ring,
            )}
            aria-hidden
          >
            {React.createElement(SOURCE_ICON[ticket.source])}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[var(--fg-secondary)]">
                {ticket.id}
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  status,
                )}
              >
                {ticket.status.replace('-', ' ')}
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  priority,
                )}
              >
                {ticket.priority.toUpperCase()}
              </span>
              <span className="text-[10px] text-[var(--fg-tertiary)]">
                · {ticket.assignee}
              </span>
            </div>
            <h2
              id={`ticket-${ticket.id}-title`}
              className="mt-1 text-md font-semibold leading-snug text-[var(--fg-primary)]"
            >
              {ticket.title}
            </h2>
          </div>
        </div>
        <a
          href={ticket.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
        >
          Open source
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </a>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            AI Summary
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--fg-primary)]">
            {ticket.summary}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ticket.labels.map((l) => (
              <span
                key={l}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]"
              >
                #{l}
              </span>
            ))}
          </div>
        </div>
        <aside className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            Estimates
          </p>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--fg-tertiary)]">Complexity</dt>
              <dd className="font-medium text-[var(--fg-primary)] capitalize">
                {ticket.estimatedComplexity}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--fg-tertiary)]">Similar avg</dt>
              <dd className="font-mono text-[var(--fg-primary)]">
                {ticket.similarTicketAvgDays}d
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--fg-tertiary)]">Touched</dt>
              <dd className="font-mono text-[var(--fg-secondary)]">
                {new Date(ticket.lastTouchedAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {ticket.linked.length > 0 ? (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            Linked entities in Forge
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="list">
            {ticket.linked.map((e, i) => (
              <span role="listitem" key={`${e.kind}-${e.id}-${i}`}>
                <LinkedEntityChip entity={e} />
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </motion.section>
  );
}

function PhasePipeline({
  ticket,
  activePhase,
  onStartPhase,
}: {
  ticket: Ticket;
  activePhase: ForgePhase;
  onStartPhase: (p: ForgePhase) => void;
}) {
  return (
    <section
      aria-labelledby="pipeline-heading"
      data-testid="fcc-phase-pipeline"
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            AI Suggested Workflow
          </p>
          <h3
            id="pipeline-heading"
            className="mt-1 text-md font-semibold text-[var(--fg-primary)]"
          >
            Drive <span className="font-mono">{ticket.id}</span> through the SDLC
          </h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-cyan)]">
          <Sparkles className="h-3 w-3" aria-hidden />
          AI suggested
        </span>
      </header>
      <ol
        role="list"
        className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7"
      >
        {FORGE_PHASES.filter((p) => ticket.aiSuggestedPhases.includes(p.id)).map(
          (p) => {
            const accent = PHASE_ACCENT[p.id];
            const isActive = p.id === activePhase;
            const isFirst = p.id === ticket.aiSuggestedPhases[0];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onStartPhase(p.id)}
                  data-testid={`fcc-phase-${p.id}`}
                  aria-pressed={isActive}
                  className={cn(
                    'group relative flex w-full flex-col items-start gap-2 rounded-[var(--radius-md)] border p-3 text-left transition-[border,box-shadow] duration-200 ease-out-soft',
                    'hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                    isActive
                      ? `${accent.chip} border-current shadow-[var(--shadow-md)]`
                      : 'border-[var(--border-subtle)] bg-[var(--bg-inset)]',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon name={p.icon} className={cn('h-3.5 w-3.5', accent.fg)} />
                    <span className="text-xs font-semibold">{p.short}</span>
                    {isFirst ? (
                      <CheckCircle2
                        className="h-3 w-3 text-[var(--accent-emerald)]"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className="line-clamp-1 text-[10px] text-[var(--fg-tertiary)]">
                    {p.description}
                  </span>
                  <span className="flex items-center justify-between gap-1 text-[10px] text-[var(--fg-tertiary)]">
                    <span>~5m</span>
                    <PlayCircle className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </span>
                </button>
              </li>
            );
          },
        )}
      </ol>
      <p className="mt-3 flex items-center gap-2 text-[11px] text-[var(--fg-tertiary)]">
        <SkipForward className="h-3 w-3" aria-hidden />
        Skip Spike if pattern is established. Estimated end-to-end:{' '}
        <span className="font-mono text-[var(--fg-secondary)]">
          ~{Math.max(1, ticket.aiSuggestedPhases.length - 1)}h
        </span>
      </p>
    </section>
  );
}

function PhaseExecutionPanel({
  ticket,
  phase,
}: {
  ticket: Ticket;
  phase: ForgePhase;
}) {
  const skills = skillsByPhase(phase);
  const phaseMeta = FORGE_PHASES.find((p) => p.id === phase)!;
  const accent = PHASE_ACCENT[phase];

  const [input, setInput] = React.useState('');
  const [running, setRunning] = React.useState<string | null>(null);
  const [output, setOutput] = React.useState<string | null>(null);

  const run = (skillId: string) => {
    const skill = skillById(skillId);
    setRunning(skillId);
    setOutput(null);
    setTimeout(() => {
      setRunning(null);
      setOutput(
        `Generated ${skill?.label ?? skillId} artifact for ${ticket.id}. Streamed to Runs center.`,
      );
      toast.success(`${skill?.label ?? skillId} finished`, {
        description: `/${skillId} · ${ticket.id}`,
      });
    }, 700);
  };

  return (
    <section
      data-testid={`fcc-phase-panel-${phase}`}
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]',
              accent.bg,
              accent.fg,
            )}
            aria-hidden
          >
            <Icon name={phaseMeta.icon} className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              {phaseMeta.label} · Phase execution
            </p>
            <h3 className="text-md font-semibold text-[var(--fg-primary)]">
              {phaseMeta.label} for{' '}
              <span className="font-mono text-[var(--accent-cyan)]">{ticket.id}</span>
            </h3>
            <p className="text-xs text-[var(--fg-tertiary)]">
              {phaseMeta.description}
            </p>
          </div>
        </div>
        <span className="text-[10px] text-[var(--fg-tertiary)]">
          <History className="mr-1 inline h-3 w-3" aria-hidden />
          Resume supported
        </span>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Label
            htmlFor={`${phase}-input`}
            className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
          >
            {phase === 'discovery'
              ? 'What do you want to research?'
              : phase === 'planning'
                ? 'Acceptance criteria'
                : phase === 'execution'
                  ? 'Implementation notes'
                  : phase === 'verification'
                    ? 'Verification scope'
                    : 'Notes for this phase'}
          </Label>
          <Textarea
            id={`${phase}-input`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              phase === 'discovery'
                ? 'e.g. Compare PKCE vs. device-code grant for mobile clients.'
                : phase === 'planning'
                  ? '- p99 token exchange < 200ms\n- Idempotent /token endpoint\n- Zero-downtime migration'
                  : phase === 'execution'
                    ? 'Describe the slice of code you want to ship.'
                    : 'Describe what to verify.'
            }
            rows={5}
            className="resize-y"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={running !== null}
              onClick={() => run(skills[0]?.id ?? `forge-${phase}`)}
              className="gap-1 bg-[var(--accent-primary)] text-white hover:opacity-90"
              data-testid={`fcc-run-phase-${phase}`}
            >
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <PlayCircle className="h-3 w-3" aria-hidden />
              )}
              Run phase
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info('Phase skipped')}
              className="border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            >
              <SkipForward className="mr-1 h-3 w-3" aria-hidden />
              Skip
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/runs" className="gap-1 text-[var(--accent-primary)]">
                View artifacts
                <ChevronRight className="h-3 w-3" aria-hidden />
              </a>
            </Button>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            Live output
          </p>
          {output ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-[var(--fg-primary)]">{output}</p>
              <a
                href="/runs"
                className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
              >
                Open in Runs center
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </a>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
              Run a skill to see streaming output here.
            </p>
          )}
          <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Skills in this phase
            </p>
            <ul role="list" className="mt-2 space-y-1">
              {skills.slice(0, 5).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name={s.icon} className={cn('h-3 w-3 shrink-0', accent.fg)} />
                    <span className="truncate font-mono text-[var(--fg-secondary)]">
                      /{s.id}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => run(s.id)}
                    disabled={running !== null}
                    className="shrink-0 text-[var(--accent-primary)] hover:underline disabled:opacity-50"
                    data-testid={`fcc-skill-shortcut-${s.id}`}
                  >
                    Run
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function TicketMode() {
  const {
    selectedTicketId,
    setSelectedTicketId,
    ticketDraft,
    setTicketDraft,
    activePhase,
    setActivePhase,
    completeOnboarding,
    hasOnboarded,
  } = useCommandCenter();

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Track K (Day 2) — backed by the `useTickets` stub. Until the
  // general `/v1/tickets` endpoint ships, the hook returns `[]` and
  // the mode falls through to a "Backend integration pending" empty
  // state (see Render below).
  const { data: tickets } = useTickets();

  const ticket =
    (selectedTicketId ? ticketById(selectedTicketId) : undefined) ??
    tickets[0];

  const submit = React.useCallback(() => {
    if (!ticketDraft.trim()) {
      toast.error('Paste a ticket URL or ID first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setTimeout(() => {
      const trimmed = ticketDraft.trim();
      const found =
        tickets.find(
          (t) =>
            t.id.toLowerCase() === trimmed.toLowerCase() ||
            trimmed.toLowerCase().includes(t.id.toLowerCase()),
        ) ?? tickets[0];
      if (!found) {
        // No tickets loaded yet — the backend endpoint is pending.
        setSubmitting(false);
        setError(
          'No tickets loaded yet. Ticket ingestion backend is being wired up — paste a ticket URL above and the connector flow will pick it up.',
        );
        return;
      }
      setSelectedTicketId(found.id);
      setTicketDraft('');
      setSubmitting(false);
      if (!hasOnboarded) completeOnboarding();
      toast.success(`Loaded ${found.id}`, {
        description: found.title,
      });
    }, 350);
  }, [
    ticketDraft,
    setSelectedTicketId,
    setTicketDraft,
    hasOnboarded,
    completeOnboarding,
    tickets,
  ]);

  // Deliberately tolerant lookup so Jira/GitHub-style IDs all resolve.
  const onPickExample = (ex: string) => {
    setTicketDraft(ex);
    const found = tickets.find((t) =>
      ex.toLowerCase().includes(t.id.toLowerCase()),
    );
    if (found) {
      setSelectedTicketId(found.id);
      if (!hasOnboarded) completeOnboarding();
    }
  };

  if (!ticket && tickets.length === 0) {
    return (
      <ErrorState
        title="No tickets available"
        description="Connect a Jira, GitHub, or Linear source to load tickets. The unified /v1/tickets endpoint lands in Day 3+ — for now tickets live in your connector history."
        backHref="/connector-center"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* TICKET INPUT BAR */}
      <section
        aria-labelledby="ticket-input-heading"
        data-testid="fcc-ticket-input"
        className="rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-md)]"
      >
        <Label
          id="ticket-input-heading"
          htmlFor="ticket-input"
          className="flex items-center gap-2 text-xs font-semibold text-[var(--fg-secondary)]"
        >
          <TicketIcon className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden />
          Paste a ticket — Forge orchestrates the rest
        </Label>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <TicketIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-tertiary)]"
              aria-hidden
            />
            <Input
              id="ticket-input"
              value={ticketDraft}
              onChange={(e) => setTicketDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Paste a Jira ticket URL, GitHub issue, or ticket ID..."
              className="h-11 pl-9 pr-16"
              data-testid="fcc-ticket-input-field"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
              ⌘T
            </span>
          </div>
          <Button
            onClick={submit}
            disabled={submitting || !ticketDraft.trim()}
            className="h-11 gap-2 bg-[var(--accent-cyan)] px-4 text-white hover:opacity-90"
            data-testid="fcc-ticket-forge"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            Forge it
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            Examples
          </span>
          {tickets.slice(0, 4).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPickExample(t.id)}
              data-testid={`fcc-ticket-example-${t.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] text-[var(--fg-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]"
            >
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                {t.source}
              </span>
              <span className="font-mono text-[var(--fg-primary)]">{t.id}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            Recent tickets
          </span>
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
            last 5
          </span>
        </div>
        <ul role="list" className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {tickets.slice(0, 5).map((t) => {
            const source = TICKET_SOURCE_COLOR[t.source];
            const status = TICKET_STATUS_COLOR[t.status] ?? TICKET_STATUS_COLOR.todo;
            const isActive = t.id === selectedTicketId;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedTicketId(t.id)}
                  data-testid={`fcc-ticket-recent-${t.id}`}
                  className={cn(
                    'group flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-2.5 text-left transition-[border,box-shadow] duration-150 ease-out-soft',
                    'hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
                    isActive
                      ? 'border-[var(--accent-cyan)] shadow-[var(--shadow-md)]'
                      : 'border-[var(--border-subtle)]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border font-mono text-[10px] font-bold',
                        source.bg,
                        source.fg,
                        source.ring,
                      )}
                      aria-hidden
                    >
                      {React.createElement(SOURCE_ICON[t.source])}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11px] text-[var(--fg-primary)]">
                        {t.id}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--fg-tertiary)]">
                        {t.title}
                      </span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                      status,
                    )}
                  >
                    {t.status.replace('-', ' ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {error ? (
        <ErrorState
          title="Couldn't load that ticket"
          description={error}
          onRetry={() => setError(null)}
        />
      ) : null}

      {ticket ? (
        <AnimatePresence>
          <TicketAnalysisCard key={ticket.id} ticket={ticket} />
        </AnimatePresence>
      ) : (
        <EmptyState
          illustration={<AlertCircle size={40} strokeWidth={1.5} />}
          title="No ticket selected"
          description="Paste a Jira, GitHub, or Linear ticket above to see its analysis and suggested workflow."
        />
      )}

      {ticket ? (
        <PhasePipeline
          ticket={ticket}
          activePhase={activePhase}
          onStartPhase={setActivePhase}
        />
      ) : null}

      {ticket ? (
        <PhaseExecutionPanel ticket={ticket} phase={activePhase} />
      ) : null}
    </div>
  );
}
