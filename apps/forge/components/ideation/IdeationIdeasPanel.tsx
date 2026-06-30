'use client';

/**
 * `<IdeationIdeasPanel>` — Step-57 Zone 6.
 *
 * Bundles the Ideas-tab surface (filter chips + board + query state +
 * empty state) into a single drop-in component the page can render.
 * Keeps the page-level wiring small while the heavy lifting stays
 * here.
 *
 * Responsibilities:
 *   - Call the canonical `useIdeas` + `useCreateIdea` + `useUpdateIdea`
 *     hooks via the legacy-shape adapters in `lib/hooks/useIdeationAdapters.ts`.
 *   - Filter by status chip.
 *   - Wire `onMove` to a status-changing PATCH (the kanban "drop"
 *     gesture persists the new status to the backend).
 *   - Show loading skeleton + error+retry (per Rule 15).
 */

import * as React from 'react';

import { IdeationBoard, type IdeationView } from '@/components/ideation/IdeationBoard';
import { IdeationQueryState } from '@/components/ideation/IdeationQueryState';
import {
  IdeationFilterChips,
  type IdeaChipValue,
} from '@/components/ideation/IdeationFilterChips';
import { EmptyState } from '@/src/components/empty-state';
import { Lightbulb } from 'lucide-react';

import {
  useCreateIdeaAdapter,
  useIdeasAdapter,
  useUpdateIdeaAdapter,
  legacyStatusToWire,
  toastAdapterError,
  LEGACY_TO_WIRE,
} from '@/lib/hooks/useIdeationAdapters';

import type { Idea, IdeaStatus as LegacyIdeaStatus } from '@/lib/ideation/data';
import type { IdeaStatus as WireIdeaStatus } from '@/lib/ideation/types';

export interface IdeationIdeasPanelProps {
  readonly view: IdeationView;
  readonly onViewChange: (next: IdeationView) => void;
  readonly onSelect?: (idea: Idea) => void;
  readonly onAddNew?: (column: string) => void;
  readonly onMenu?: (idea: Idea) => void;
}

const KANBAN_COLUMN_TO_STATUS: Record<string, LegacyIdeaStatus> = {
  captured: 'intake',
  scoring: 'scoring',
  approved: 'approved',
  in_prd: 'prd',
  archived: 'shipped',
};

// ponytail: demo-mode fallback. Activates when the ideation API is
// unreachable so the kanban still has something to render. Real
// tenants with empty boards (API 200, items=[]) still show the
// "No ideas yet" EmptyState — fallback is reserved for `isError`.
// Replace with the canonical seed-ideation bootstrap when wired
// (see backend/scripts/seed_ideation.py).
const FALLBACK_IDEAS: ReadonlyArray<Idea> = [
  {
    id: 'demo-idea-captured-1',
    title: 'Slack summarizer for incident channels',
    summary:
      'Auto-generate a daily digest of #incident-response into Notion for the on-call handoff.',
    status: 'intake',
    score: 3.4,
    scoreBreakdown: { impact: 7, feasibility: 9, confidence: 6, effort: 3 },
    owner: 'Priya R.',
    ownerAvatar: 'PR',
    createdAt: '2026-06-28T09:12:00Z',
    tags: ['slack', 'incident', 'notion'],
    impact: 'medium',
    analysis: 'Captured from support retro 2026-06-26.',
    risks: ['Requires Slack admin approval for the bot scope.'],
  },
  {
    id: 'demo-idea-captured-2',
    title: 'AI code reviewer for hotfix PRs',
    summary:
      'Pre-review small PRs targeting main with security + style comments before a human reviewer is assigned.',
    status: 'intake',
    score: 5.2,
    scoreBreakdown: { impact: 8, feasibility: 7, confidence: 7, effort: 5 },
    owner: 'Marcus L.',
    ownerAvatar: 'ML',
    createdAt: '2026-06-27T15:40:00Z',
    tags: ['code-review', 'security', 'github'],
    impact: 'high',
    analysis: 'Surfaced from a customer interview last week.',
    risks: ['False positives on stylistic comments may erode trust.'],
  },
  {
    id: 'demo-idea-scoring-1',
    title: 'Invoice parser for AP team',
    summary:
      'Extract line items + totals from PDF invoices, post to NetSuite with a Slack approval gate.',
    status: 'scoring',
    score: 7.1,
    scoreBreakdown: { impact: 8, feasibility: 8, confidence: 7, effort: 5 },
    owner: 'Sara K.',
    ownerAvatar: 'SK',
    createdAt: '2026-06-24T11:05:00Z',
    tags: ['finance', 'ocr', 'netsuite'],
    impact: 'high',
    analysis: 'Reasoning chain in progress — vendor lock-in assessment pending.',
    risks: ['Vendor template drift', 'Reconciliation edge cases'],
  },
  {
    id: 'demo-idea-approved-1',
    title: 'Status page aggregator',
    summary:
      'Single pane of glass across AWS, GitHub, and Vercel health feeds with Slack escalation.',
    status: 'approved',
    score: 8.4,
    scoreBreakdown: { impact: 9, feasibility: 8, confidence: 9, effort: 4 },
    owner: 'Jordan W.',
    ownerAvatar: 'JW',
    createdAt: '2026-06-22T08:20:00Z',
    tags: ['observability', 'incident'],
    impact: 'high',
    prdRef: 'prd-status-aggregator',
    analysis: 'Approved by Eng Leadership 2026-06-23.',
    risks: ['Rate limits on vendor status APIs'],
  },
  {
    id: 'demo-idea-prd-1',
    title: 'Customer feedback clustering',
    summary:
      'Cluster Zendesk + Jira tickets into themes nightly; surface top 5 weekly in Ideation Center.',
    status: 'prd',
    score: 9.1,
    scoreBreakdown: { impact: 9, feasibility: 7, confidence: 8, effort: 6 },
    owner: 'Devon A.',
    ownerAvatar: 'DA',
    createdAt: '2026-06-19T14:50:00Z',
    tags: ['feedback', 'clustering', 'ideation'],
    impact: 'high',
    prdRef: 'prd-feedback-clustering',
    analysis: 'PRD in review with PM Agent.',
    risks: ['Cluster quality drift over time'],
  },
  {
    id: 'demo-idea-archived-1',
    title: 'Voice-driven JQL builder',
    summary:
      'Speak a query, get a JQL string. Shelved — accuracy below 60% in evaluation.',
    status: 'shipped',
    score: 4.0,
    scoreBreakdown: { impact: 5, feasibility: 4, confidence: 3, effort: 6 },
    owner: 'Priya R.',
    ownerAvatar: 'PR',
    createdAt: '2026-05-30T10:00:00Z',
    tags: ['jira', 'voice'],
    impact: 'low',
    analysis: 'Archived 2026-06-15 after PoC evaluation.',
    risks: [],
  },
];

export function IdeationIdeasPanel({
  view,
  onViewChange,
  onSelect,
  onAddNew,
  onMenu,
}: IdeationIdeasPanelProps) {
  const [chip, setChip] = React.useState<IdeaChipValue>('all');

  // Adapter pulls the canonical TanStack Query result. The wire
  // hook itself takes the wire-status filter; we forward the chip
  // value mapped into the wire enum.
  const wireStatusFilter =
    chip === 'all' ? undefined : legacyStatusToWire(chip);
  const adapter = useIdeasAdapter(
    wireStatusFilter && wireStatusFilter !== 'all'
      ? { status: wireStatusFilter }
      : undefined,
  );

  const updateIdea = useUpdateIdeaAdapter();

  const handleMove = React.useCallback(
    (ideaId: string, toColumn: string) => {
      const targetStatus = KANBAN_COLUMN_TO_STATUS[toColumn];
      if (!targetStatus) return;
      const wireStatus = LEGACY_TO_WIRE[targetStatus];
      updateIdea.mutate(
        { id: ideaId, patch: { status: wireStatus } },
        {
          onError: (err) => toastAdapterError('Status update', err),
        },
      );
    },
    [updateIdea],
  );

  // Local counts per chip — derived from the full (unfiltered) list
  // so the chips show the global distribution. We pull a second
  // adapter call without a filter to compute these without
  // round-tripping after the user changes the chip.
  const unfiltered = useIdeasAdapter();
  const counts = React.useMemo<Partial<Record<IdeaChipValue, number>>>(() => {
    const items = unfiltered.data;
    let all = items.length;
    let isNew = 0;
    let isScored = 0;
    let isApproved = 0;
    let isRejected = 0;
    for (const it of items) {
      // Convert legacy → wire to decide which chip it falls under.
      const wire = LEGACY_TO_WIRE[it.status];
      switch (wire) {
        case 'new':
          isNew += 1;
          break;
        case 'scored':
          isScored += 1;
          break;
        case 'approved':
        case 'in_roadmap':
          // In-roadmap counts under "Approved" — both are post-decision
          // states, and the chip row only has room for 4 status buckets.
          isApproved += 1;
          break;
        case 'rejected':
        case 'archived':
          isRejected += 1;
          break;
        default:
          break;
      }
    }
    return {
      all,
      new: isNew,
      scored: isScored,
      approved: isApproved,
      rejected: isRejected,
    };
  }, [unfiltered.data]);

  // ponytail: when the ideation API errors out, fall back to the demo
  // idea set so the kanban still has rows. We don't suppress the
  // error UI entirely — the IdeationQueryState still renders a
  // banner via the `errorTitle`/`error` props, but `isError` is
  // flipped off so the children render the populated board.
  const useFallback = adapter.isError && FALLBACK_IDEAS.length > 0;
  const renderData = useFallback ? FALLBACK_IDEAS : adapter.data;
  const fallbackCounts: Partial<Record<IdeaChipValue, number>> = useFallback
    ? {
        all: FALLBACK_IDEAS.length,
        new: FALLBACK_IDEAS.filter((i) => i.status === 'intake').length,
        scored: FALLBACK_IDEAS.filter((i) => i.status === 'scoring').length,
        approved: FALLBACK_IDEAS.filter(
          (i) => i.status === 'approved' || i.status === 'prd',
        ).length,
        rejected: FALLBACK_IDEAS.filter(
          (i) => i.status === 'rejected' || i.status === 'shipped',
        ).length,
      }
    : counts;

  // Render — loading + error wrapped, success path shows chips + board.
  return (
    <div className="flex flex-col gap-4" data-testid="ideation-ideas-panel">
      <IdeationFilterChips
        value={chip}
        onChange={setChip}
        counts={fallbackCounts}
      />

      {useFallback ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="ideation-fallback-banner"
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent-amber)]/30 bg-[rgba(245,158,11,0.06)] px-3 py-2 text-xs text-[var(--fg-secondary)]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-amber)]" aria-hidden="true" />
          <span>
            Backend unreachable — showing demo ideas. Retry to load real data.
          </span>
          <button
            type="button"
            onClick={adapter.refetch}
            data-testid="ideation-fallback-retry"
            className="ml-auto rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)] hover:bg-[rgba(99,102,241,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            Retry
          </button>
        </div>
      ) : null}

      <IdeationQueryState
        isLoading={adapter.isLoading}
        isError={adapter.isError && !useFallback}
        error={adapter.error}
        onRetry={adapter.refetch}
        loadingRows={6}
        errorTitle="Couldn't load ideas"
      >
        {renderData.length === 0 ? (
          <div className="card">
            <EmptyState
              illustration={<Lightbulb size={40} strokeWidth={1.5} />}
              title={
                chip === 'all'
                  ? 'No ideas yet'
                  : `No ${chip} ideas`
              }
              description={
                chip === 'all'
                  ? 'Capture your first idea to kick off ideation.'
                  : 'Try a different status filter, or capture a new idea.'
              }
            />
          </div>
        ) : (
          <IdeationBoard
            ideas={renderData}
            view={view}
            onViewChange={onViewChange}
            onSelect={onSelect}
            onAddNew={onAddNew}
            onMenu={onMenu}
            onMove={handleMove}
          />
        )}
      </IdeationQueryState>
    </div>
  );
}

// Re-export so consumers can re-use the create-idea mutation if they
// want to drive capture from a parent component.
export { useCreateIdeaAdapter as useCreateIdea };
export type { WireIdeaStatus };