'use client';

/**
 * MyWorkDrawer — ZONE 6 of the brief.
 *
 * Right slide-in drawer (400px). Shows every piece of work the
 * developer owns right now: active tickets, specs, runs, approvals,
 * recent artifacts, and AI-curated "today's focus".
 *
 * Skill: `04-ux-guideline.md` (focus visible), `06-keyboard-ux.md`
 * (Esc closes, focus trap).
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X,
  Briefcase,
  Ticket as TicketIcon,
  FileText,
  PlayCircle,
  ShieldCheck,
  History,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/command-center/icons';
import { cn } from '@/lib/utils';
import {
  // Track K (Day 2) — SAMPLE_* fixtures were replaced by hooks. Type
  // aliases below stay so the row components keep their strong types.
  type ApprovalItem,
  type LiveRun,
  type RecentArtifact,
  type Ticket,
} from '@/lib/command-center/sample-data';
import { PHASE_ACCENT, TICKET_STATUS_COLOR } from '@/lib/command-center/theme';
import { skillById } from '@/lib/forge-core/manifest';
import { useCommandCenter } from '@/lib/command-center/store';
import { useLiveRuns } from '@/lib/hooks/useRuns';
import { useTickets } from '@/lib/hooks/useForgeFixtures';

function SectionHeader({
  icon: IconCmp,
  label,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <header className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
        <IconCmp className="h-3 w-3" aria-hidden />
        {label}
      </span>
      <span className="rounded-full bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]">
        {count}
      </span>
    </header>
  );
}

function TicketItem({ ticket }: { ticket: Ticket }) {
  const status = TICKET_STATUS_COLOR[ticket.status] ?? TICKET_STATUS_COLOR.todo;
  return (
    <a
      href={`#${ticket.id}`}
      className="group flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)]"
      data-testid={`fcc-mw-ticket-${ticket.id}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <TicketIcon className="h-3 w-3 shrink-0 text-[var(--accent-cyan)]" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate font-mono text-[11px] text-[var(--fg-primary)]">
            {ticket.id}
          </span>
          <span className="block truncate text-[10px] text-[var(--fg-tertiary)]">
            {ticket.title}
          </span>
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide',
          status,
        )}
      >
        {ticket.status.replace('-', ' ')}
      </span>
    </a>
  );
}

function RunItem({ run }: { run: LiveRun }) {
  const accent = PHASE_ACCENT[skillById(run.skillId)?.phase ?? 'execution'];
  return (
    <li
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
      data-testid={`fcc-mw-run-${run.id}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            run.status === 'success'
              ? 'bg-[var(--accent-emerald)]'
              : run.status === 'failed'
                ? 'bg-[var(--accent-rose)]'
                : run.status === 'running'
                  ? cn(accent.dot, 'ai-thinking-dot')
                  : 'bg-[var(--accent-amber)]',
          )}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            <Icon
              name={skillById(run.skillId)?.icon ?? 'PlayCircle'}
              className={cn('h-3 w-3', accent.fg)}
            />
            <span className="font-mono text-[11px] text-[var(--fg-primary)]">
              /{run.skillId}
            </span>
          </span>
          <span className="block font-mono text-[10px] text-[var(--fg-tertiary)]">
            {run.actor} · {run.duration}
          </span>
        </span>
      </span>
      {run.status === 'running' ? (
        <div className="flex w-20 items-center gap-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-inset)]">
            <div
              className="h-full rounded-full bg-[var(--accent-cyan)]"
              style={{ width: `${run.progress}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-[var(--accent-cyan)]">
            {run.progress}%
          </span>
        </div>
      ) : (
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {run.startedAgo}
        </span>
      )}
    </li>
  );
}

function ApprovalItemRow({ approval }: { approval: ApprovalItem }) {
  return (
    <li
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
      data-testid={`fcc-mw-approval-${approval.id}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ShieldCheck
          className={cn(
            'h-3 w-3 shrink-0',
            approval.blocking
              ? 'text-[var(--accent-amber)]'
              : 'text-[var(--fg-tertiary)]',
          )}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block truncate text-[11px] text-[var(--fg-primary)]">
            {approval.title}
          </span>
          <span className="block truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
            by {approval.requestedBy} ·{' '}
            {new Date(approval.requestedAt).toLocaleString()}
          </span>
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
          Defer
        </Button>
        <Button size="sm" className="h-6 bg-[var(--accent-primary)] px-2 text-[10px] text-white">
          Approve
        </Button>
      </div>
    </li>
  );
}

function ArtifactItem({ artifact }: { artifact: RecentArtifact }) {
  const iconMap: Record<RecentArtifact['kind'], React.ComponentType<{ className?: string }>> = {
    pr: ArrowRight,
    adr: FileText,
    doc: FileText,
    spec: FileText,
    decision: CheckCircle2,
  };
  const IconCmp = iconMap[artifact.kind];
  return (
    <li
      className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
      data-testid={`fcc-mw-artifact-${artifact.id}`}
    >
      <IconCmp className="mt-0.5 h-3 w-3 text-[var(--accent-primary)]" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-[var(--fg-primary)]">
          {artifact.title}
        </p>
        <p className="truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
          {artifact.subtitle}
        </p>
        <p className="font-mono text-[9px] text-[var(--fg-tertiary)]">
          {new Date(artifact.at).toLocaleString()}
        </p>
      </div>
    </li>
  );
}

export function MyWorkDrawer() {
  const { myWorkOpen, setMyWorkOpen } = useCommandCenter();
  const closeBtnRef = React.useRef<HTMLButtonElement>(null);

  // Track K (Day 2) — wires the drawer to real hooks.
  //   - liveRuns: backed by `GET /api/v1/workflows/runs`
  //   - tickets: stub until `/v1/tickets` ships (Day 3+)
  const { data: liveRuns } = useLiveRuns();
  const { data: allTickets } = useTickets();

  React.useEffect(() => {
    if (!myWorkOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMyWorkOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // Move focus into the drawer on open (a11y).
    closeBtnRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [myWorkOpen, setMyWorkOpen]);

  const activeTickets = allTickets.filter(
    (t) => t.status === 'in-progress' || t.status === 'in-review',
  );

  return (
    <AnimatePresence>
      {myWorkOpen ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setMyWorkOpen(false)}
            aria-hidden
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            role="dialog"
            aria-modal="true"
            aria-label="My Work"
            data-testid="fcc-my-work-drawer"
            className="fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-[100vw] flex-col gap-4 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-[var(--shadow-md)]"
          >
            <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]">
                  <Briefcase className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <h2 className="text-md font-semibold text-[var(--fg-primary)]">
                    My Work
                  </h2>
                  <p className="text-[10px] text-[var(--fg-tertiary)]">
                    All your active tickets, specs, runs, and approvals.
                  </p>
                </div>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setMyWorkOpen(false)}
                aria-label="Close My Work"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            {/* Today's focus (AI) — only renders when we have live
                tickets to talk about; otherwise falls through to a
                honest empty-state hint. */}
            {activeTickets.length > 0 || liveRuns.length > 0 ? (
              <section className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--accent-violet)]/30 bg-[var(--accent-violet)]/5 p-3">
                <header className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-[var(--accent-violet)]" aria-hidden />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-violet)]">
                    Today's focus
                  </span>
                </header>
                <p className="text-xs leading-relaxed text-[var(--fg-primary)]">
                  You have{' '}
                  <span className="font-semibold text-[var(--accent-cyan)]">
                    {activeTickets[0]?.id ?? '—'}
                  </span>{' '}
                  in execution with{' '}
                  <span className="font-semibold text-[var(--accent-amber)]">
                    {/* ponytail: approvals land in Day 3+; render 0 for now */}
                    0 pending approvals
                  </span>
                  .
                </p>
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-[var(--accent-violet)] text-white hover:opacity-90"
                  onClick={() => setMyWorkOpen(false)}
                  disabled={!activeTickets[0]}
                >
                  {activeTickets[0] ? `Resume ${activeTickets[0].id}` : 'Nothing to resume'}
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Button>
              </section>
            ) : (
              <section className="space-y-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-center">
                <Sparkles className="mx-auto h-5 w-5 text-[var(--fg-tertiary)]" aria-hidden />
                <p className="text-xs text-[var(--fg-secondary)]">
                  Your "today's focus" will appear here once tickets and
                  live runs sync from the workflows endpoint.
                </p>
              </section>
            )}

            {/* Active tickets */}
            <section className="space-y-2">
              <SectionHeader
                icon={TicketIcon}
                label="Active tickets"
                count={activeTickets.length}
              />
              {activeTickets.length === 0 ? (
                <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-[11px] text-[var(--fg-tertiary)]">
                  Backend integration pending — the unified{' '}
                  <code className="font-mono">/v1/tickets</code> endpoint
                  ships on Day 3+.
                </p>
              ) : (
                <ul role="list" className="space-y-2">
                  {activeTickets.map((t) => (
                    <li key={t.id}>
                      <TicketItem ticket={t} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Active runs */}
            <section className="space-y-2">
              <SectionHeader
                icon={PlayCircle}
                label="Active runs"
                count={liveRuns.length}
              />
              {liveRuns.length === 0 ? (
                <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-[11px] text-[var(--fg-tertiary)]">
                  No live workflow runs for this tenant yet. Trigger one
                  from the Catalog mode to populate this list.
                </p>
              ) : (
                <ul role="list" className="space-y-2">
                  {liveRuns.map((r) => (
                    <RunItem key={r.id} run={r} />
                  ))}
                </ul>
              )}
            </section>

            {/* Pending approvals */}
            <section className="space-y-2">
              <SectionHeader
                icon={ShieldCheck}
                label="Pending approvals"
                count={0}
              />
              <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-[11px] text-[var(--fg-tertiary)]">
                Approval feed is being wired to the orchestrator — for
                now, manage approvals in the Governance Center.
              </p>
            </section>

            {/* Recent artifacts */}
            <section className="space-y-2">
              <SectionHeader
                icon={History}
                label="Recent artifacts"
                count={0}
              />
              <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-[11px] text-[var(--fg-tertiary)]">
                Artifact feed comes from the audit timeline once the
                activity adapter ships (Day 3+).
              </p>
            </section>

            <footer className="mt-auto border-t border-[var(--border-subtle)] pt-3 text-[10px] text-[var(--fg-tertiary)]">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden />
                Last sync just now via Connector Center.
              </span>
            </footer>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
