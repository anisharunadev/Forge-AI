'use client';

/**
 * Stories Center — Story Detail Drawer (Step 38).
 *
 * 6-tab drawer (Overview / Context / Implementation / Tests / Discussion
 * / History). Header now carries the **Lifecycle breadcrumb** (the
 * story's full provenance chain: ticket → idea → PRD → ADR → story) and
 * a prominent **Start implementation** button (Fix 5) that pops the
 * `StartImplementationModal`.
 *
 * Skill influence:
 *   - ux-guideline (focus management) — focus on close button on open,
 *     restore to originating card on close.
 *   - ux-guideline (active state) — selected tab uses accent border.
 *   - ux-guideline (keyboard) — Esc closes, Enter on focused control
 *     activates it.
 *   - ux-guideline (deep linking) — live sessions are real
 *     `<Link>`s into the terminal route so the URL stays shareable.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  Beaker,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  Code2,
  ExternalLink,
  FileText,
  GitBranch,
  GitPullRequest,
  History,
  MessageSquare,
  Network,
  Paperclip,
  PieChart,
  Rocket,
  Save,
  Sparkles,
  TerminalSquare,
  X,
  Zap,
} from 'lucide-react';

import type {
  ActivityEvent,
  Assignee,
  Comment,
  Story,
  StoryStatus,
} from '@/lib/stories/types';
import {
  PRIORITY_DOT_VAR,
  STATUS_DOT_VAR,
  STATUS_LABEL,
} from '@/lib/stories/types';
import { cn } from '@/lib/utils';

import { LifecycleBreadcrumb } from './LifecycleBreadcrumb';

export interface StoryDrawerProps {
  readonly story: Story | null;
  readonly assignees: ReadonlyArray<Assignee>;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onChangeStatus: (next: StoryStatus) => void;
  readonly onChangeAssignee: (next: string | null) => void;
  readonly onStartImplementation: () => void;
  readonly sampleComments: ReadonlyArray<Comment>;
  /** True if a live terminal session is currently bound to this story. */
  readonly hasLiveSession?: boolean;
  readonly liveSessionId?: string | null;
}

type DrawerTab =
  | 'overview'
  | 'context'
  | 'implementation'
  | 'tests'
  | 'discussion'
  | 'history';

const TABS: ReadonlyArray<{
  id: DrawerTab;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'context', label: 'Context', icon: Network },
  { id: 'implementation', label: 'Implementation', icon: Code2 },
  { id: 'tests', label: 'Tests', icon: Beaker },
  { id: 'discussion', label: 'Discussion', icon: MessageSquare },
  { id: 'history', label: 'History', icon: History },
];

export function StoryDrawer({
  story,
  assignees,
  open,
  onClose,
  onChangeStatus,
  onChangeAssignee,
  onStartImplementation,
  sampleComments,
  hasLiveSession = false,
  liveSessionId = null,
}: StoryDrawerProps) {
  const [tab, setTab] = React.useState<DrawerTab>('overview');
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const closeBtnRef = React.useRef<HTMLButtonElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => closeBtnRef.current?.focus());
    } else if (previouslyFocused.current) {
      previouslyFocused.current.focus();
      previouslyFocused.current = null;
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open || !story) return;
    setSavedAt(new Date().toISOString());
    const id = setInterval(() => setSavedAt(new Date().toISOString()), 12000);
    return () => clearInterval(id);
  }, [open, story]);

  // Reset to overview tab whenever the story changes so the user
  // doesn't get stranded on a context tab from a prior story.
  React.useEffect(() => {
    if (story?.id) setTab('overview');
  }, [story?.id]);

  if (!open || !story) return null;

  const canStartImplementation = story.status === 'todo' || story.status === 'backlog';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-drawer-title"
      className="fixed inset-0 z-50 flex"
      data-testid="story-drawer"
    >
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="flex-1 cursor-default bg-[var(--scrim)] backdrop-blur-sm"
      />

      <div
        ref={drawerRef}
        className={cn(
          'flex w-full max-w-[760px] flex-col border-l border-[var(--border-default)]',
          'bg-[var(--bg-surface)] shadow-[var(--shadow-xl)]',
        )}
      >
        {/* Lifecycle breadcrumb */}
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 py-3">
          <LifecycleBreadcrumb story={story} />
        </div>

        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[var(--fg-tertiary)]">{story.identifier}</span>
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: PRIORITY_DOT_VAR[story.priority] }}
              />
              <span className="text-[var(--fg-secondary)]">{story.priority}</span>
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STATUS_DOT_VAR[story.status] }}
              />
              <span className="text-[var(--fg-secondary)]">{STATUS_LABEL[story.status]}</span>
              {hasLiveSession ? (
                <span
                  className="ml-1 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[rgba(34,197,94,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-emerald)]"
                  data-testid="drawer-live-indicator"
                >
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-emerald)] opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  </span>
                  Live coding session
                </span>
              ) : null}
            </div>
            <h2
              id="story-drawer-title"
              contentEditable
              suppressContentEditableWarning
              onBlur={() => {
                setSavedAt(new Date().toISOString());
                console.log('[stories] title autosaved');
              }}
              className={cn(
                'rounded-[var(--radius-sm)] text-xl font-bold text-[var(--fg-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              {story.title}
            </h2>
            <p className="text-xs text-[var(--fg-tertiary)]">
              Created by {story.assignee?.name ?? 'Unknown'} ·{' '}
              {formatAbsolute(story.createdAt)} ·{' '}
              <span aria-live="polite">
                Last updated {formatRelative(story.updatedAt)} ago
              </span>
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            {canStartImplementation ? (
              <button
                type="button"
                onClick={onStartImplementation}
                data-testid="drawer-start-implementation"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-2',
                  'bg-[var(--accent-primary)] text-sm font-semibold text-white',
                  'shadow-[var(--shadow-glow-primary)]',
                  'transition-opacity duration-fast ease-out-soft hover:opacity-90',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
                )}
              >
                <Rocket size={14} aria-hidden="true" />
                Start implementation
                <kbd className="ml-1 hidden rounded bg-white/15 px-1 text-[10px] font-mono md:inline-block">
                  ⌘⇧T
                </kbd>
              </button>
            ) : hasLiveSession ? (
              <Link
                href={liveSessionId ? `/forge-terminal?sessionId=${liveSessionId}` : '/forge-terminal'}
                data-testid="drawer-view-in-terminal"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-2',
                  'border-[var(--accent-emerald)]/40 bg-[rgba(34,197,94,0.10)]',
                  'text-sm font-semibold text-[var(--accent-emerald)]',
                  'transition-colors duration-fast ease-out-soft hover:bg-[rgba(34,197,94,0.18)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald)]',
                )}
              >
                <TerminalSquare size={14} aria-hidden="true" />
                View in terminal
                <ExternalLink size={11} aria-hidden="true" />
              </Link>
            ) : null}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className={cn(
                'rounded-[var(--radius-md)] p-1.5 text-[var(--fg-tertiary)]',
                'hover:bg-[var(--hover)] hover:text-[var(--fg-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Tabs */}
        <nav
          role="tablist"
          aria-label="Story detail"
          className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-6"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                data-testid={`drawer-tab-${t.id}`}
                className={cn(
                  'inline-flex items-center gap-1.5 border-b-2 px-2.5 py-3 text-xs font-medium whitespace-nowrap',
                  'transition-colors duration-fast ease-out-soft',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                  active
                    ? 'border-[var(--accent-primary)] text-[var(--fg-primary)]'
                    : 'border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
                )}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Body */}
        <div className="thin-scrollbar flex-1 overflow-y-auto px-6 py-5">
          {tab === 'overview' ? (
            <OverviewTab story={story} />
          ) : tab === 'context' ? (
            <ContextTab story={story} />
          ) : tab === 'implementation' ? (
            <ImplementationTab story={story} hasLiveSession={hasLiveSession} liveSessionId={liveSessionId} />
          ) : tab === 'tests' ? (
            <TestsTab story={story} />
          ) : tab === 'discussion' ? (
            <DiscussionTab story={story} sampleComments={sampleComments} />
          ) : (
            <HistoryTab story={story} />
          )}
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 py-3">
          <label className="sr-only" htmlFor="drawer-status">
            Status
          </label>
          <div className="relative">
            <select
              id="drawer-status"
              value={story.status}
              onChange={(e) => onChangeStatus(e.target.value as StoryStatus)}
              className={cn(
                'h-8 appearance-none rounded-[var(--radius-md)] border border-[var(--border-default)]',
                'bg-[var(--bg-elevated)] pl-2 pr-7 text-xs text-[var(--fg-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              {(['backlog', 'todo', 'in_progress', 'in_review', 'done'] as ReadonlyArray<StoryStatus>).map(
                (s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ),
              )}
            </select>
            <ChevronDown
              size={12}
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
            />
          </div>

          <label className="sr-only" htmlFor="drawer-assignee">
            Assignee
          </label>
          <select
            id="drawer-assignee"
            value={story.assignee?.id ?? ''}
            onChange={(e) => onChangeAssignee(e.target.value || null)}
            className={cn(
              'h-8 appearance-none rounded-[var(--radius-md)] border border-[var(--border-default)]',
              'bg-[var(--bg-elevated)] pl-2 pr-7 text-xs text-[var(--fg-primary)]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            )}
          >
            <option value="">Unassigned</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <span className="text-xs text-[var(--fg-tertiary)]" aria-live="polite">
            {savedAt ? (
              <>
                <Save size={10} aria-hidden="true" className="mr-1 inline" />
                Saved {formatRelative(savedAt)} ago
              </>
            ) : (
              '—'
            )}
          </span>

          <Link
            href={`/stories/${story.id}`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:underline"
          >
            Open in full page <ExternalLink size={10} aria-hidden="true" />
          </Link>
        </footer>
      </div>
    </div>
  );
}

/* ==================================================================== */
/*                              TAB BODIES                              */
/* ==================================================================== */

function OverviewTab({ story }: { story: Story }) {
  const acTotal = story.acceptanceCriteria.length;
  const acDone = story.acceptanceCriteria.filter((a) => a.done).length;
  const acPct = acTotal === 0 ? 0 : Math.round((acDone / acTotal) * 100);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="drawer-desc-h">
        <h3 id="drawer-desc-h" className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Description
        </h3>
        <p className="rounded-[var(--radius-md)] bg-[var(--bg-base)] p-3 text-sm text-[var(--fg-primary)]">
          {story.description}
        </p>
      </section>

      <section aria-labelledby="drawer-ac-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 id="drawer-ac-h" className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            Acceptance criteria
          </h3>
          <span className="text-[10px] text-[var(--fg-tertiary)]">
            {acDone}/{acTotal} · {acPct}%
          </span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {story.acceptanceCriteria.map((ac) => (
            <li
              key={ac.id}
              className="flex items-start gap-2 rounded-[var(--radius-sm)] p-2 hover:bg-[var(--hover)]"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-[var(--radius-sm)] border',
                  ac.done
                    ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)] text-white'
                    : 'border-[var(--border-default)] bg-[var(--bg-elevated)]',
                )}
              >
                {ac.done ? <Check size={10} /> : null}
              </span>
              <span
                className={cn(
                  'text-sm',
                  ac.done ? 'text-[var(--fg-tertiary)] line-through' : 'text-[var(--fg-primary)]',
                )}
              >
                {ac.text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="drawer-sub-h">
        <h3 id="drawer-sub-h" className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Subtasks
        </h3>
        {story.subtasks.length === 0 ? (
          <p className="text-xs text-[var(--fg-tertiary)]">No subtasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {story.subtasks.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] p-2 text-sm hover:bg-[var(--hover)]"
              >
                <CircleDot size={14} aria-hidden="true" className="text-[var(--fg-tertiary)]" />
                <span className={s.done ? 'text-[var(--fg-tertiary)] line-through' : 'text-[var(--fg-primary)]'}>
                  {s.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="drawer-dod-h">
        <h3 id="drawer-dod-h" className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Definition of Done
        </h3>
        <ul className="grid grid-cols-2 gap-2">
          {story.definitionOfDone.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-xs text-[var(--fg-secondary)]"
            >
              <Check
                size={12}
                aria-hidden="true"
                className={d.done ? 'text-[var(--accent-emerald)]' : 'text-[var(--fg-muted)]'}
              />
              {d.label}
              {d.locked ? (
                <span className="ml-auto text-[10px] text-[var(--fg-tertiary)]">locked</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="drawer-linked-h">
        <h3 id="drawer-linked-h" className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Linked items
        </h3>
        {story.linkedItems.length === 0 ? (
          <p className="text-xs text-[var(--fg-tertiary)]">No links yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {story.linkedItems.map((l, i) => (
              <Link
                key={`${l.kind}-${i}`}
                href={l.href ?? '#'}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1 text-[9px] uppercase tracking-wider text-[var(--fg-tertiary)]">
                  {l.kind}
                </span>
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ContextTab({ story }: { story: Story }) {
  const adrs = story.linkedItems.filter((l) => l.kind === 'adr');
  const prs = story.linkedItems.filter((l) => l.kind === 'pr');
  const runs = story.linkedItems.filter((l) => l.kind === 'run');

  return (
    <div className="flex flex-col gap-5" data-testid="drawer-tabpanel-context">
      <p className="text-[11px] leading-relaxed text-[var(--fg-tertiary)]">
        When this story starts implementing, Forge injects everything below into the
        agent's initial prompt and the live context panel of the terminal session.
        Toggle items off if you want the agent to start from less.
      </p>

      <CtxRow
        icon={FileText}
        label="Linked PRD section"
        detail="PRD-FORGE-001 §2.3 (Auth & PKCE flow)"
        included
      />
      <CtxRow
        icon={GitBranch}
        label="Linked ADRs"
        detail={adrs.length > 0 ? adrs.map((a) => a.label).join(' · ') : 'None linked'}
        included={adrs.length > 0}
      />
      <CtxRow
        icon={Code2}
        label="Related code files"
        detail="src/auth/pkce.ts · src/auth/redirect.ts · src/auth/index.ts"
        included
      />
      <CtxRow
        icon={Zap}
        label="Linked tasks"
        detail={`${story.subtasks.length} subtasks auto-included`}
        included
      />
      <CtxRow
        icon={Beaker}
        label="Linked tests"
        detail="src/auth/__tests__/pkce.test.ts (8 existing cases)"
        included
      />
      <CtxRow
        icon={Network}
        label="Connector data"
        detail="Zendesk ticket ACME-123 (origin) — full thread + metadata"
        included={runs.length > 0}
      />
      <CtxRow
        icon={GitPullRequest}
        label="Pull request"
        detail={
          prs.length > 0
            ? `${prs.map((p) => p.label).join(' · ')} (if exists)`
            : 'No PR yet — auto-create on first push'
        }
        included
      />

      <div className="mt-2 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--accent-primary)]/30 bg-[rgba(99,102,241,0.06)] p-3">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent-primary)]">
          <Sparkles size={12} aria-hidden="true" />
          Customize before starting — open "Start implementation" to toggle
        </p>
      </div>
    </div>
  );
}

function CtxRow({
  icon: Icon,
  label,
  detail,
  included,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  detail: string;
  included: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2',
        included
          ? 'border-[var(--accent-primary)]/30 bg-[rgba(99,102,241,0.06)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-base)] opacity-65',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
          included ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'bg-[var(--bg-elevated)] text-[var(--fg-tertiary)]',
        )}
      >
        <Icon size={11} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-[var(--fg-primary)]">{label}</p>
        <p className="mt-0.5 truncate text-[11px] text-[var(--fg-tertiary)]">{detail}</p>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
          included
            ? 'bg-[rgba(34,197,94,0.12)] text-[var(--accent-emerald)]'
            : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
        )}
      >
        {included ? 'Injected' : 'Skipped'}
      </span>
    </div>
  );
}

function ImplementationTab({
  story,
  hasLiveSession,
  liveSessionId,
}: {
  story: Story;
  hasLiveSession: boolean;
  liveSessionId: string | null;
}) {
  const pr = story.linkedItems.find((l) => l.kind === 'pr');

  return (
    <div className="flex flex-col gap-5" data-testid="drawer-tabpanel-implementation">
      {/* Live coding session card */}
      <section
        aria-labelledby="impl-live-h"
        className={cn(
          'rounded-[var(--radius-md)] border p-3',
          hasLiveSession
            ? 'border-[var(--accent-emerald)]/30 bg-[rgba(34,197,94,0.06)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-base)]',
        )}
      >
        <h3 id="impl-live-h" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Live coding session
        </h3>
        {hasLiveSession ? (
          <>
            <p className="inline-flex items-center gap-1.5 text-sm text-[var(--fg-primary)]">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-emerald)] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent-emerald)]" />
              </span>
              Claude Code is working on this story
            </p>
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
              Files changed: 4 · Tests passing: 6/8 · Branch: feature/{story.identifier.toLowerCase()}
            </p>
            <Link
              href={liveSessionId ? `/forge-terminal?sessionId=${liveSessionId}` : '/forge-terminal'}
              data-testid="drawer-open-terminal"
              className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-emerald)] px-3 py-1.5 text-xs font-semibold text-[#0A0E27] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald)]"
            >
              <TerminalSquare size={12} aria-hidden="true" />
              Open terminal session
              <ExternalLink size={10} aria-hidden="true" />
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--fg-secondary)]">No active session.</p>
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
              Click "Start implementation" in the header to spin up a terminal session with this story's full context pre-injected.
            </p>
          </>
        )}
      </section>

      {/* PR card */}
      <section aria-labelledby="impl-pr-h" className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
        <h3 id="impl-pr-h" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Pull request
        </h3>
        {pr ? (
          <p className="text-sm text-[var(--fg-primary)]">
            <span className="font-mono text-[var(--fg-tertiary)]">{pr.id}</span> · {pr.label}
          </p>
        ) : (
          <p className="text-sm text-[var(--fg-tertiary)]">
            No PR opened yet. One will be auto-created when the first commit lands on{' '}
            <span className="font-mono text-[var(--fg-secondary)]">
              feature/{story.identifier.toLowerCase()}
            </span>
            .
          </p>
        )}
        <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
          Branch: <span className="font-mono text-[var(--fg-secondary)]">feature/{story.identifier.toLowerCase()}</span> · Target: <span className="font-mono text-[var(--fg-secondary)]">main</span>
        </p>
      </section>

      {/* Files changed */}
      <section aria-labelledby="impl-files-h">
        <h3 id="impl-files-h" className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Files changed
        </h3>
        <ul className="flex flex-col gap-1">
          {(['src/auth/pkce.ts · +47 −0', 'src/auth/redirect.ts · +12 −4', 'src/auth/__tests__/pkce.test.ts · +28 −0'] as ReadonlyArray<string>).map((f) => (
            <li
              key={f}
              className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-xs"
            >
              <span className="font-mono text-[var(--fg-primary)]">{f.split(' · ')[0]}</span>
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{f.split(' · ')[1]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TestsTab({ story }: { story: Story }) {
  const total = 8;
  const passed = story.status === 'done' ? 8 : story.status === 'in_progress' ? 6 : 0;
  const pct = Math.round((passed / total) * 100);

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">Test results</p>
        <p className="mt-1 text-3xl font-bold text-[var(--fg-primary)]">
          {passed}<span className="text-base text-[var(--fg-tertiary)]">/{total}</span>
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={passed}
          aria-label={`${pct}% of tests passing`}
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]"
        >
          <span
            aria-hidden="true"
            className="block h-full rounded-full bg-[var(--accent-emerald)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>
      <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">Coverage</p>
        <p className="mt-1 text-2xl font-bold text-[var(--fg-primary)]">87%</p>
        <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">+12% vs baseline</p>
      </section>
      <p className="text-[11px] leading-relaxed text-[var(--fg-tertiary)]">
        Detailed test runs surface in the <Link href="/audit" className="text-[var(--accent-primary)] hover:underline">audit timeline</Link>{' '}
        once the implementation kicks off.
      </p>
    </div>
  );
}

function DiscussionTab({
  story,
  sampleComments,
}: {
  story: Story;
  sampleComments: ReadonlyArray<Comment>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col gap-3">
        {sampleComments.map((c) => (
          <li
            key={c.id}
            className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
          >
            <div className="mb-1 flex items-center gap-2 text-[10px]">
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                style={{ backgroundColor: c.author.color }}
              >
                {c.author.initials}
              </span>
              <span className="font-medium text-[var(--fg-primary)]">{c.author.name}</span>
              <span className="text-[var(--fg-tertiary)]">· {formatRelative(c.at)} ago</span>
            </div>
            <p className="text-sm text-[var(--fg-primary)]">{c.body}</p>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          console.log('[stories] comment posted', story.id);
        }}
        className="flex flex-col gap-2"
      >
        <label className="sr-only" htmlFor="drawer-new-comment">
          Add a comment
        </label>
        <textarea
          id="drawer-new-comment"
          rows={3}
          placeholder="Write a comment... use @ to mention"
          className={cn(
            'resize-none rounded-[var(--radius-md)] border border-[var(--border-default)]',
            'bg-[var(--bg-elevated)] p-2 text-sm text-[var(--fg-primary)]',
            'placeholder:text-[var(--fg-tertiary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        />
        <button
          type="submit"
          className={cn(
            'self-end rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 py-1.5',
            'text-xs font-semibold text-white hover:opacity-90 focus:outline-none',
            'focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2',
          )}
        >
          Post comment
        </button>
      </form>
    </div>
  );
}

function HistoryTab({ story }: { story: Story }) {
  const events: ReadonlyArray<ActivityEvent> = React.useMemo(() => {
    return [
      {
        id: 'h-1',
        kind: 'created',
        actor: story.assignee ?? { id: 'sys', name: 'System', initials: 'S', online: false, color: 'var(--fg-muted)' },
        at: story.createdAt,
        summary: `created this story`,
      },
      {
        id: 'h-2',
        kind: 'status_changed',
        actor: story.assignee ?? { id: 'sys', name: 'System', initials: 'S', online: false, color: 'var(--fg-muted)' },
        at: story.updatedAt,
        summary: `moved it to ${STATUS_LABEL[story.status]}`,
      },
      {
        id: 'h-3',
        kind: 'edited',
        actor: story.assignee ?? { id: 'sys', name: 'System', initials: 'S', online: false, color: 'var(--fg-muted)' },
        at: story.updatedAt,
        summary: `edited acceptance criteria`,
      },
    ];
  }, [story]);

  return (
    <ol className="flex flex-col gap-3">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 text-xs">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
            style={{ backgroundColor: e.actor.color }}
          >
            {e.actor.initials}
          </span>
          <div>
            <p className="text-[var(--fg-primary)]">
              <span className="font-medium">{e.actor.name}</span>{' '}
              <span className="text-[var(--fg-secondary)]">{e.summary}</span>
            </p>
            <p className="text-[10px] text-[var(--fg-tertiary)]">{formatRelative(e.at)} ago</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ==================================================================== */
/*                              Format helpers                           */
/* ==================================================================== */

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
