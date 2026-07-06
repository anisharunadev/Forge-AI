'use client';

/**
 * Lessons Learned — Steward review queue UI (F-002-LESSON / Step-64 Sub-step B).
 *
 * Two tabs: Pending (default) and All. Steward approves / rejects
 * inline. Backend promotes APPROVED into a Template (F-002); the
 * UI shows the promoted_template_id once available.
 *
 * Rule 15 (empty states) — when the queue is empty we render the
 * "auto-pause + sample" copy instead of "No data".
 */

import { useState } from 'react';

import { BookOpen, Check, X, GraduationCap } from 'lucide-react';

import type {
  LessonCandidateListResponse,
  LessonDecideRequest,
  LessonDecisionResult,
  LessonStatus,
} from '@/lib/api/lessons-types';
import {
  useApproveLesson,
  useLessons,
  useMonthlyDigest,
  useRejectLesson,
} from '@/lib/hooks/useLessons';

const STATUS_TABS: Array<{ key: LessonStatus | 'all'; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export function LessonsList(): React.JSX.Element {
  const [tab, setTab] = useState<LessonStatus | 'all'>('pending');
  const status = tab === 'all' ? undefined : tab;
  const { data, isLoading, error } = useLessons(status);
  const { data: digest } = useMonthlyDigest();
  const approve = useApproveLesson();
  const reject = useRejectLesson();

  const reviewersEditor = '00000000-0000-0000-0000-000000000000';

  const onApprove = (lessonId: string, override?: { title?: string; body?: string }) => {
    const body: LessonDecideRequest = {
      editor_id: reviewersEditor,
      ...(override?.title ? { title_override: override.title } : {}),
      ...(override?.body ? { body_override: override.body } : {}),
    };
    approve.mutate({ lessonId, body });
  };

  const onReject = (lessonId: string, notes: string) => {
    const body: LessonDecideRequest = {
      editor_id: reviewersEditor,
      review_notes: notes,
    };
    reject.mutate({ lessonId, body });
  };

  if (isLoading) {
    return <LessonsSkeleton />;
  }
  if (error) {
    return <ErrorPanel message={(error as Error).message} />;
  }
  if (!data) {
    return <ErrorPanel message="No data returned" />;
  }

  return (
    <section
      className="flex flex-col gap-6"
      data-testid="lessons-panel"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-[var(--accent-emerald)]" />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Lessons Learned
          </h1>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          Auto-mined from rollback / rollback / bad-outcome signals. Approving a
          candidate promotes it into an F-002 template; rejecting closes the
          loop without touching the global org knowledge graph.
        </p>
      </header>

      <DigestStrip digest={digest ?? null} />

      <Tabs
        value={tab}
        onChange={setTab}
        counts={{
          pending: data.pending_count,
          approved: data.approved_count,
          rejected: data.rejected_count,
        }}
      />

      {data.items.length === 0 ? (
        <EmptyState status={tab} />
      ) : (
        <ul
          className="flex flex-col gap-3"
          data-testid="lessons-list"
        >
          {data.items.map((cand) => (
            <LessonCard
              key={cand.id}
              candidate={cand}
              onApprove={(override) => onApprove(cand.id, override)}
              onReject={(notes) => onReject(cand.id, notes)}
              busy={approve.isPending || reject.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Subcomponents ---------------------------------------------------------

function DigestStrip({ digest }: { digest: LessonCandidateListResponse | MonthlyDigestStub | null }) {
  if (!digest) return null;
  const bySource =
    'by_source' in digest
      ? (digest as MonthlyDigestStub).by_source
      : {};
  const entries = Object.entries(bySource);
  if (entries.length === 0) return null;
  return (
    <div
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-muted)]"
      data-testid="lessons-digest"
    >
      <span className="font-semibold text-[var(--text-primary)]">30-day digest:</span>{' '}
      {entries.map(([src, count]) => (
        <span
          key={src}
          className="mr-3 ml-1 inline-flex items-center gap-1 rounded bg-[var(--bg-canvas)] px-2 py-0.5"
        >
          {src} · <span className="text-[var(--text-primary)]">{count}</span>
        </span>
      ))}
    </div>
  );
}

type MonthlyDigestStub = {
  pending_count?: number;
  by_source: Record<string, number>;
};

function Tabs({
  value,
  onChange,
  counts,
}: {
  value: LessonStatus | 'all';
  onChange: (v: LessonStatus | 'all') => void;
  counts: { pending: number; approved: number; rejected: number };
}) {
  return (
    <div className="flex gap-2 border-b border-[var(--border-subtle)]">
      {STATUS_TABS.map((t) => {
        const count = t.key === 'all' ? undefined : counts[t.key];
        const active = value === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? 'border-[var(--accent-emerald)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            data-testid={`lessons-tab-${t.key}`}
          >
            {t.label}
            {typeof count === 'number' && (
              <span className="ml-2 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function LessonCard({
  candidate,
  onApprove,
  onReject,
  busy,
}: {
  candidate: import('@/lib/api/lessons-types').LessonCandidateWire;
  onApprove: (override?: { title?: string; body?: string }) => void;
  onReject: (notes: string) => void;
  busy: boolean;
}) {
  const [reviewNotes, setReviewNotes] = useState('');
  return (
    <li
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
      data-testid={`lesson-row-${candidate.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-[var(--bg-canvas)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              {candidate.source_event}
            </span>
            {candidate.status !== 'pending' && (
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  candidate.status === 'approved'
                    ? 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]'
                    : 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]'
                }`}
              >
                {candidate.status}
              </span>
            )}
            {candidate.promoted_template_id && (
              <span className="rounded bg-[var(--accent-indigo)]/15 px-2 py-0.5 text-xs text-[var(--accent-indigo)]">
                template · {candidate.promoted_template_id.slice(0, 8)}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {candidate.title}
          </h3>
          <pre className="whitespace-pre-wrap break-words font-sans text-xs text-[var(--text-muted)]">
            {candidate.body.slice(0, 280)}
            {candidate.body.length > 280 && '…'}
          </pre>
        </div>

        {candidate.status === 'pending' && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove()}
              className="inline-flex items-center gap-1 rounded bg-[var(--accent-emerald)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              data-testid={`lesson-approve-${candidate.id}`}
            >
              <Check className="h-3 w-3" />
              Approve
            </button>
            <button
              type="button"
              disabled={busy || !reviewNotes}
              onClick={() => onReject(reviewNotes)}
              className="inline-flex items-center gap-1 rounded bg-[var(--accent-rose)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              data-testid={`lesson-reject-${candidate.id}`}
            >
              <X className="h-3 w-3" />
              Reject
            </button>
            <input
              type="text"
              placeholder="Rejection notes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs text-[var(--text-primary)]"
            />
          </div>
        )}
      </div>

      {candidate.review_notes && (
        <p className="mt-2 text-xs italic text-[var(--text-muted)]">
          Reviewer note: {candidate.review_notes}
        </p>
      )}
    </li>
  );
}

function EmptyState({ status }: { status: LessonStatus | 'all' }) {
  const copy =
    status === 'pending'
      ? {
          title: 'No pending lessons',
          body: 'When a run rolls back, a deployment reverts, or a metric degrades, the steward review queue fills up. Right now there is nothing to review — the pipeline is humming.',
          action: 'View monthly digest',
        }
      : status === 'approved'
      ? {
          title: 'No approved lessons yet',
          body: 'Approved lessons graduate into the Org Knowledge graph as templates. The first one lands here.',
          action: 'Open Org Knowledge → Templates',
        }
      : {
          title: 'No lessons yet',
          body: 'Lessons only surface when something goes wrong. Want a sample to review?',
          action: 'Load sample lessons',
        };
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 text-center"
      data-testid="lessons-empty"
    >
      <GraduationCap className="h-8 w-8 text-[var(--text-muted)]" />
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
        {copy.title}
      </h3>
      <p className="max-w-md text-xs text-[var(--text-muted)]">{copy.body}</p>
      <button
        type="button"
        className="rounded border border-[var(--accent-emerald)] px-3 py-1 text-xs text-[var(--accent-emerald)] hover:bg-[var(--accent-emerald)]/10"
      >
        {copy.action}
      </button>
    </div>
  );
}

function LessonsSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="lessons-skeleton">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        />
      ))}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 p-4 text-sm text-[var(--accent-rose)]"
      data-testid="lessons-error"
    >
      Couldn't load lessons: {message}
    </div>
  );
}

export default LessonsList;
