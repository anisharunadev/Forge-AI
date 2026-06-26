'use client';

/**
 * PhaseExecutionDrawer — the killer feature.
 *
 * Slide-up drawer (h-70vh, --shadow-2xl, --radius-t-xl) that opens
 * when the user clicks "Run" on a phase. Renders:
 *   - Sticky header with phase icon/name/ticket-ref + progress bar
 *   - 60/40 split body: phase workspace | live activity feed
 *   - Sticky footer with ETA + Cancel/Pause + Mark complete/Continue
 *
 * Wired to the orchestration helpers (PHASE_ORCHESTRATION,
 * PHASE_EXECUTION_MS, scheduleOrchestration). Mock-only — no real
 * orchestrator calls. Events stream in via the Zustand store so the
 * activity rail stays consistent with the FloatingPhaseWidget.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Maximize2,
  Minimize2,
  ExternalLink,
  X,
  Pause,
  Play,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Bot,
  FileEdit,
  Link2,
  Lightbulb,
  GitPullRequest,
  Activity,
  RotateCcw,
  CircleDot,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Icon } from '@/lib/command-center/icons';
import { cn } from '@/lib/utils';
import { FORGE_PHASES, type ForgePhase } from '@/lib/forge-core/manifest';
import { PHASE_ACCENT } from '@/lib/command-center/theme';
import {
  PHASE_EXECUTION_MS,
  PHASE_ORCHESTRATION,
  PHASE_WORKSPACE_LABEL,
  scheduleOrchestration,
} from '@/lib/command-center/orchestration';
import {
  useCommandCenter,
  type OrchestrationEvent,
} from '@/lib/command-center/store';
import { selectSelectedTicket } from '@/lib/command-center/store';
import type { Ticket } from '@/lib/command-center/sample-data';

const EVENT_ICON: Record<OrchestrationEvent['kind'], React.ComponentType<{ className?: string }>> = {
  'agent-invoked': Bot,
  'file-changed': FileEdit,
  'connector-call': Link2,
  'reasoning': Lightbulb,
  'ticket-status': CircleDot,
  'pr-opened': GitPullRequest,
  'spec-linked': Link2,
  'phase-completed': CheckCircle2,
};

function EventRow({ event }: { event: OrchestrationEvent }) {
  const Icon = EVENT_ICON[event.kind] ?? Activity;
  const accent = PHASE_ACCENT[event.phase];
  return (
    <li
      className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5"
      data-testid={`fcc-event-${event.id}`}
    >
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          accent.bg,
          accent.fg,
        )}
        aria-hidden
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--fg-primary)]">{event.body}</p>
        <p className="mt-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
          {event.actor} · {event.kind}
        </p>
      </div>
      {event.href ? (
        <a
          href={event.href}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-[var(--accent-primary)] hover:underline"
          aria-label="Open in target module"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
    </li>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]"
    >
      <motion.span
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="block h-full rounded-full bg-gradient-to-r from-[var(--accent-cyan)] via-[var(--accent-primary)] to-[var(--accent-violet)]"
      />
    </div>
  );
}

function formatEta(ms: number): string {
  if (ms <= 0) return '~0s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `~${s}s`;
  return `~${Math.round(s / 60)}m ${s % 60}s`;
}

export interface PhaseExecutionDrawerProps {
  ticket: Ticket | undefined;
}

export function PhaseExecutionDrawer({ ticket }: PhaseExecutionDrawerProps) {
  const {
    executionOpen,
    setExecutionOpen,
    execution,
    setExecution,
    events,
    pushEvent,
    clearEvents,
    setActivePhase,
  } = useCommandCenter();

  const [minimized, setMinimized] = React.useState(false);
  const [notes, setNotes] = React.useState('');

  const phaseMeta = FORGE_PHASES.find((p) => p.id === execution.phase);
  const accent = PHASE_ACCENT[execution.phase];
  const trigger = PHASE_ORCHESTRATION[execution.phase];
  const totalMs = PHASE_EXECUTION_MS[execution.phase];

  const startedAtRef = React.useRef<number | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);
  const tickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---------------------------------------------------------------------
   * Lifecycle — when executionOpen flips on, kick off the mock run for
   * the currently active phase. Cleanup on close or phase change.
   * ------------------------------------------------------------------- */
  React.useEffect(() => {
    if (!executionOpen) {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    // Start a fresh execution for the active phase.
    clearEvents();
    setExecution({
      phase: execution.phase,
      status: 'running',
      progress: 0,
      stepIndex: 1,
      stepTotal: Math.max(2, Math.round(totalMs / 2000)),
      startedAt: new Date().toISOString(),
      outputLines: [],
    });
    startedAtRef.current = Date.now();
    cleanupRef.current = scheduleOrchestration(execution.phase, ticket, pushEvent);

    tickRef.current = setInterval(() => {
      const started = startedAtRef.current;
      if (!started) return;
      const elapsed = Date.now() - started;
      const progress = Math.min(100, (elapsed / totalMs) * 100);
      const stepIndex = Math.min(
        Math.max(2, Math.round(totalMs / 2000)),
        Math.floor((elapsed / totalMs) * Math.max(2, Math.round(totalMs / 2000))) + 1,
      );
      setExecution({ progress, stepIndex });
      if (progress >= 100) {
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
        setExecution({
          status: 'completed',
          finishedAt: new Date().toISOString(),
          progress: 100,
          stepIndex: Math.max(2, Math.round(totalMs / 2000)),
        });
        pushEvent({
          phase: execution.phase,
          kind: 'phase-completed',
          actor: trigger.actor,
          ticketId: ticket?.id,
          body: `${phaseMeta?.label ?? execution.phase} complete in ${Math.round(totalMs / 1000)}s`,
        });
      }
    }, 250);

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionOpen, execution.phase]);

  const togglePause = () => {
    if (execution.status === 'running') {
      setExecution({ status: 'paused' });
      if (tickRef.current) clearInterval(tickRef.current);
      toast.info('Paused', { description: phaseMeta?.label });
    } else if (execution.status === 'paused') {
      setExecution({ status: 'running' });
      startedAtRef.current = Date.now() - (execution.progress / 100) * totalMs;
      tickRef.current = setInterval(() => {
        const started = startedAtRef.current;
        if (!started) return;
        const elapsed = Date.now() - started;
        const progress = Math.min(100, (elapsed / totalMs) * 100);
        setExecution({ progress });
        if (progress >= 100) {
          if (tickRef.current) clearInterval(tickRef.current);
          setExecution({ status: 'completed', finishedAt: new Date().toISOString() });
        }
      }, 250);
    }
  };

  const cancel = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setExecution({ status: 'idle', progress: 0, stepIndex: 0 });
    setExecutionOpen(false);
    toast.info('Phase cancelled', { description: phaseMeta?.label });
  };

  const markComplete = () => {
    setExecution({ status: 'completed', progress: 100, finishedAt: new Date().toISOString() });
    pushEvent({
      phase: execution.phase,
      kind: 'phase-completed',
      actor: 'manual',
      ticketId: ticket?.id,
      body: `${phaseMeta?.label ?? execution.phase} marked complete`,
    });
    toast.success(`${phaseMeta?.label} complete`, {
      description: ticket?.id ? `for ${ticket.id}` : undefined,
    });
  };

  const advanceToNext = () => {
    const orderedPhases: ForgePhase[] = FORGE_PHASES.map((p) => p.id);
    const idx = orderedPhases.indexOf(execution.phase);
    const next = orderedPhases[idx + 1];
    if (!next) {
      toast.success('Workflow complete', { description: 'No further phases.' });
      setExecutionOpen(false);
      return;
    }
    setActivePhase(next);
    setExecution({ phase: next, status: 'running', progress: 0, stepIndex: 1, startedAt: new Date().toISOString() });
    clearEvents();
  };

  const etaMs =
    execution.status === 'running'
      ? Math.max(0, totalMs * (1 - execution.progress / 100))
      : 0;

  return (
    <AnimatePresence>
      {executionOpen ? (
        <motion.aside
          key="phase-drawer"
          role="dialog"
          aria-label={`${phaseMeta?.label} execution`}
          data-testid="fcc-phase-drawer"
          initial={{ y: '100%' }}
          animate={{ y: minimized ? 'calc(100% - 56px)' : 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[1600px] flex-col overflow-hidden border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-2xl)]',
            minimized ? 'h-14' : 'h-[70vh]',
          )}
        >
          {/* HEADER */}
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]',
                  accent.bg,
                  accent.fg,
                )}
                aria-hidden
              >
                <Icon name={phaseMeta?.icon ?? 'Circle'} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                    {phaseMeta?.label} · Phase execution
                  </p>
                  {ticket ? (
                    <span className="font-mono text-[10px] text-[var(--accent-cyan)]">
                      {ticket.id}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      execution.status === 'running'
                        ? 'border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                        : execution.status === 'completed'
                          ? 'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                          : execution.status === 'paused'
                            ? 'border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]'
                            : 'border-[var(--border-default)] bg-[var(--bg-inset)] text-[var(--fg-secondary)]',
                    )}
                    data-testid="fcc-phase-status"
                  >
                    {execution.status === 'running' ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
                    ) : null}
                    {execution.status}
                  </span>
                </div>
                <h3 className="truncate text-md font-semibold text-[var(--fg-primary)]">
                  {phaseMeta?.description}
                </h3>
              </div>
            </div>

            <div className="flex min-w-[260px] flex-1 items-center gap-3">
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                Step {execution.stepIndex} of {execution.stepTotal}
              </span>
              <div className="flex-1">
                <ProgressBar value={execution.progress} />
              </div>
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                {Math.round(execution.progress)}%
              </span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMinimized((m) => !m)}
                aria-label={minimized ? 'Maximize' : 'Minimize'}
                data-testid="fcc-drawer-minimize"
                className="h-8 w-8 text-[var(--fg-secondary)]"
              >
                {minimized ? <Maximize2 className="h-3.5 w-3.5" aria-hidden /> : <Minimize2 className="h-3.5 w-3.5" aria-hidden />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                asChild
                aria-label="Open in terminal"
                className="h-8 w-8 text-[var(--fg-secondary)]"
              >
                <a href="/forge-terminal">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExecutionOpen(false)}
                aria-label="Close"
                data-testid="fcc-drawer-close"
                className="h-8 w-8 text-[var(--fg-secondary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </header>

          {!minimized ? (
            <>
              {/* BODY — split 60/40 */}
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[3fr_2fr]">
                <section className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-[var(--border-subtle)] p-4">
                  <header>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                      {PHASE_WORKSPACE_LABEL[execution.phase]}
                    </p>
                    <h4 className="text-md font-semibold text-[var(--fg-primary)]">
                      Workspace for{' '}
                      <span className="font-mono text-[var(--accent-cyan)]">
                        {execution.phase}
                      </span>
                    </h4>
                  </header>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={8}
                    placeholder={
                      execution.phase === 'discovery'
                        ? 'e.g. Compare PKCE vs. device-code grant for mobile clients.'
                        : execution.phase === 'planning'
                          ? '- p99 token exchange < 200ms\n- Idempotent /token endpoint'
                          : execution.phase === 'execution'
                            ? 'Describe the slice of code you want to ship.'
                            : execution.phase === 'verification'
                              ? 'What should we verify before declaring done?'
                              : 'Notes for this phase'
                    }
                    className="resize-y"
                  />
                  <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                      Triggered module
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--fg-primary)]">
                      {trigger.targetModule}
                    </p>
                    <a
                      href={trigger.targetHref}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
                    >
                      Open {trigger.targetModule}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </a>
                  </div>
                </section>

                <section className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
                  <header className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                      Live activity feed
                    </p>
                    {events.length > 0 ? (
                      <button
                        type="button"
                        onClick={clearEvents}
                        className="text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
                      >
                        <RotateCcw className="mr-1 inline h-2.5 w-2.5" aria-hidden />
                        Clear
                      </button>
                    ) : null}
                  </header>
                  {events.length === 0 ? (
                    <p className="flex items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--fg-tertiary)]">
                      <Activity className="h-3 w-3" aria-hidden />
                      Awaiting first event…
                    </p>
                  ) : (
                    <ul role="list" className="flex flex-col gap-2">
                      <AnimatePresence initial={false}>
                        {events.map((e) => (
                          <motion.li
                            key={e.id}
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.18 }}
                          >
                            <EventRow event={e} />
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </section>
              </div>

              {/* FOOTER */}
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
                <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
                  <Timer className="h-3 w-3" aria-hidden />
                  {execution.status === 'running'
                    ? `Estimated time remaining: ${formatEta(etaMs)}`
                    : execution.status === 'completed'
                      ? `Completed in ~${Math.round(totalMs / 1000)}s`
                      : `Estimated total: ${formatEta(totalMs)}`}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {execution.status === 'running' || execution.status === 'paused' ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={cancel}
                        data-testid="fcc-drawer-cancel"
                        className="border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={togglePause}
                        data-testid="fcc-drawer-pause"
                        className="gap-1 border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                      >
                        {execution.status === 'paused' ? (
                          <>
                            <Play className="h-3 w-3" aria-hidden /> Resume
                          </>
                        ) : (
                          <>
                            <Pause className="h-3 w-3" aria-hidden /> Pause
                          </>
                        )}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={markComplete}
                    disabled={execution.status === 'completed'}
                    data-testid="fcc-drawer-mark-complete"
                    className="border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                    Mark complete
                  </Button>
                  <Button
                    size="sm"
                    onClick={advanceToNext}
                    disabled={execution.status !== 'completed'}
                    data-testid="fcc-drawer-continue"
                    className="gap-1 bg-[var(--accent-primary)] text-white hover:opacity-90"
                  >
                    Continue to next phase
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Button>
                </div>
              </footer>
            </>
          ) : null}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

export function PhaseExecutionDrawerConnector() {
  const ticket = useCommandCenter(selectSelectedTicket);
  return <PhaseExecutionDrawer ticket={ticket} />;
}
