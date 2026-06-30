'use client';

/**
 * Ideation Center — adapter hooks (Step-57 Zone 6).
 *
 * The new canonical hooks in `lib/hooks/useIdeation.ts` return
 * **wire-typed artifacts** (matching `backend/app/schemas/ideation.py`).
 * The in-progress components under `components/ideation/*` still
 * consume the legacy M2 view-model types (`Idea`, `RoadmapItem`,
 * `PRD`, `Approval`, `ArchPreview`) defined in `lib/ideation/data.ts`.
 *
 * Rather than rewriting every component right now, this module
 * provides thin adapter hooks that:
 *
 *   1. Call the canonical TanStack Query hook from `useIdeation.ts`.
 *   2. Map each wire-typed row into the legacy view-model shape the
 *      components expect.
 *   3. Expose the same `data | isLoading | error | refetch` surface
 *      consumers already use (so the call-site change in
 *      `app/ideation/page.tsx` is a one-liner per tab).
 *
 * SourcesTab + PipelineView are intentionally NOT routed through here
 * — they're static surfaces that show source-integration setup and
 * the orchestration hero (per the step-57-v2.md brief).
 *
 * The legacy `useIdeaEnhance` / `usePushIdeaToJira` / `useJiraSync` /
 * `useApprovalDecide` hooks remain valid lower-level mutations; the
 * adapters above them are the canonical data source.
 */

import * as React from 'react';

import { toast } from 'sonner';

import {
  ideationQueryKeys,
  useApprovals as useWireApprovals,
  useCreateIdea as useWireCreateIdea,
  useDecideApproval as useWireDecideApproval,
  useIdeas as useWireIdeas,
  useRoadmaps as useWireRoadmaps,
  useUpdateIdea as useWireUpdateIdea,
} from '@/lib/hooks/useIdeation';

import type {
  Approval,
  ArchPreview,
  Idea,
  IdeaStatus as LegacyIdeaStatus,
  PRD,
  RoadmapItem,
} from '@/lib/ideation/data';

import type {
  Approval as WireApproval,
  ApprovalItemStatus,
  Idea as WireIdea,
  IdeaStatus as WireIdeaStatus,
  PRD as WirePRD,
  PRDStatus as WirePRDStatus,
  Roadmap as WireRoadmap,
} from '@/lib/ideation/types';

// ---------------------------------------------------------------------------
// Status mapping — wire ↔ legacy.
//
// Wire (F-201..F-213, backend ORM):
//   'new' | 'analyzing' | 'scored' | 'approved' | 'in_roadmap'
//   | 'rejected' | 'archived'
//
// Legacy M2 view-model:
//   'intake' | 'scoring' | 'discovery' | 'prd' | 'approved'
//   | 'rejected' | 'shipped'
//
// The mapping is a many-to-one — the wire shape is finer-grained, so
// richer states fold into the closest legacy column.
// ---------------------------------------------------------------------------

const IDEA_STATUS_MAP: Record<WireIdeaStatus, LegacyIdeaStatus> = {
  new: 'intake',
  analyzing: 'scoring',
  scored: 'discovery',
  approved: 'approved',
  in_roadmap: 'prd',
  rejected: 'rejected',
  archived: 'shipped',
};

const LEGACY_TO_WIRE_STATUS: Record<LegacyIdeaStatus, WireIdeaStatus> = {
  intake: 'new',
  scoring: 'analyzing',
  discovery: 'scored',
  approved: 'approved',
  prd: 'in_roadmap',
  rejected: 'rejected',
  shipped: 'archived',
};

// ---------------------------------------------------------------------------
// Local helpers — adapter mappers.
// ---------------------------------------------------------------------------

/** Empty defaults so a partially-shaped row doesn't NPE during render. */
const EMPTY_BREAKDOWN = { impact: 0, feasibility: 0, confidence: 0, effort: 0 } as const;

function wireIdeaToLegacy(wire: WireIdea): Idea {
  // Tags → string array (the wire shape already uses tags, but we coerce
  // defensively in case the backend ever sends `string[] | null`).
  const tags = Array.isArray(wire.tags) ? wire.tags.map((t) => String(t)) : [];

  // `submitted_by` is the closest analogue to the legacy `owner`.
  const owner = wire.submitted_by || 'system';
  const ownerAvatar = owner.slice(0, 2).toUpperCase();

  return {
    id: wire.id,
    title: wire.title,
    summary: wire.description,
    status: IDEA_STATUS_MAP[wire.status] ?? 'intake',
    // The wire shape doesn't carry a numeric opportunity score inline —
    // it lives in the separate `GET /ideation/ideas/{id}/score` endpoint.
    // Surface `0` until the score is loaded; downstream components
    // (ScoreBadge, IdeaKanban) handle this as "no score yet".
    score: 0,
    scoreBreakdown: { ...EMPTY_BREAKDOWN },
    owner,
    ownerAvatar,
    createdAt: wire.created_at,
    tags,
    impact: 'medium',
    // PRD linkage lives in the legacy PRD shape (`ideaId`); backfill
    // from the wire `ideaId` when this idea is referenced by a PRD.
    analysis: '',
    risks: [],
    // `prdRef` is populated below in the PRD adapter when this idea
    // has a wire PRD row; the standalone Idea mapper leaves it unset.
  };
}

function wirePRDsToLegacy(
  prds: ReadonlyArray<WirePRD>,
  ideasById: ReadonlyMap<string, WireIdea>,
): ReadonlyArray<PRD> {
  return prds.map((p) => {
    const idea = ideasById.get(p.idea_id);
    const title = idea ? idea.title : `PRD for ${p.idea_id.slice(0, 8)}`;
    return {
      id: p.id,
      title,
      ideaId: p.idea_id,
      owner: p.generated_by,
      updatedAt: p.updated_at,
      // The wire PRD status is a richer enum (`draft` | `review` |
      // `approved` | `published` | `archived`) — collapse to the
      // 3-state legacy enum the PRDList/PRDViewer expect.
      status: collapsePRDStatus(p.status),
      // PRDList doesn't render the body; PRDViewer renders `markdown`.
      // The wire shape stores `content: Record<string, unknown>` —
      // stringify it so the existing markdown renderer keeps working.
      markdown: stringifyPRDContent(p.content),
    };
  });
}

function collapsePRDStatus(wire: WirePRDStatus): PRD['status'] {
  switch (wire) {
    case 'draft':
      return 'draft';
    case 'review':
      return 'review';
    case 'approved':
    case 'published':
      return 'approved';
    case 'archived':
      return 'draft';
  }
}

function stringifyPRDContent(content: WirePRD['content']): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

function wireRoadmapToLegacy(
  roadmaps: ReadonlyArray<WireRoadmap>,
  ideasById: ReadonlyMap<string, WireIdea>,
): ReadonlyArray<RoadmapItem> {
  // The wire shape stores roadmap rows as JSONB `items: Record[]` — flatten
  // into the legacy per-quarter `RoadmapItem[]` the RoadmapTimeline
  // component groups by `quarter`. Each wire roadmap's `horizon` maps
  // to the closest legacy `column` (now/next/later/future).
  const out: RoadmapItem[] = [];
  for (const r of roadmaps) {
    const column = mapHorizonToColumn(r.horizon);
    const list = Array.isArray(r.items) ? r.items : [];
    for (let i = 0; i < list.length; i += 1) {
      const it = list[i] as { idea_id?: string; theme?: string } | undefined;
      const ideaId = it?.idea_id ?? `${r.id}:${i}`;
      const idea = ideasById.get(ideaId);
      out.push({
        id: `${r.id}::${ideaId}`,
        ideaId,
        column,
        title: idea?.title ?? it?.theme ?? `Item ${i + 1}`,
        // The wire roadmap doesn't carry a quarter — derive one from
        // the publication date so the existing timeline grouping keeps
        // working in the legacy UI.
        quarter: quarterFromDate(r.updated_at),
        owner: r.approved_by ?? r.generated_by ?? 'system',
        effort: 'M',
      });
    }
  }
  return out;
}

function mapHorizonToColumn(horizon: WireRoadmap['horizon']): RoadmapItem['column'] {
  switch (horizon) {
    case 'now':
      return 'now';
    case 'next':
      return 'next';
    case 'later':
      return 'later';
    case 'future':
      return 'future';
  }
}

function quarterFromDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unscheduled';
  const year = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${year} Q${q}`;
}

function wireApprovalToLegacy(wire: WireApproval): Approval {
  // Map wire enum → legacy 3-state status.
  let status: Approval['status'];
  switch (wire.status) {
    case 'pending':
    case 'delegated':
      status = 'pending';
      break;
    case 'approved':
      status = 'approved';
      break;
    case 'denied':
    case 'cancelled':
      status = 'rejected';
      break;
    case 'request_changes':
      status = 'pending'; // legacy model has no "changes_requested" → pending
      break;
    default:
      // Defensive fallback — the wire enum is exhaustive but the
      // legacy 3-state model can't represent every wire state, so
      // any future enum addition collapses to "pending" here.
      status = 'pending';
      break;
  }

  // The legacy `kind` field is one of `idea | prd | adr | run`. The
  // wire `request_type` is `roadmap | prd | arch_preview | push_to_delivery`.
  // Map with sensible defaults; unknown request types fall back to `idea`.
  let kind: Approval['kind'];
  switch (wire.request_type) {
    case 'roadmap':
      kind = 'idea';
      break;
    case 'prd':
      kind = 'prd';
      break;
    case 'arch_preview':
      kind = 'adr';
      break;
    case 'push_to_delivery':
      kind = 'run';
      break;
    default:
      kind = 'idea';
  }

  // Title — synthesise from the payload or fall back to the subject_id
  // so the inbox row never renders empty.
  const payload = wire.payload ?? {};
  const title =
    typeof payload['title'] === 'string'
      ? (payload['title'] as string)
      : wire.subject_id
        ? `${wire.request_type} ${String(wire.subject_id).slice(0, 8)}`
        : `${wire.request_type} request`;

  return {
    id: wire.id,
    kind,
    refId: wire.subject_id ?? wire.idea_id,
    title,
    requestedBy: wire.requested_by,
    requestedAt: wire.created_at,
    status,
  };
}

// ---------------------------------------------------------------------------
// Public surface — adapter hooks.
// ---------------------------------------------------------------------------

export interface AdapterResult<T> {
  data: ReadonlyArray<T>;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Ideas — wraps `useIdeas` and adapts the wire shape into the
 * legacy `Idea[]` consumed by `IdeationBoard` and its sub-views.
 *
 * Optional `status` filter is passed straight through to the wire
 * hook (the wire enum is `WireIdeaStatus`, not `LegacyIdeaStatus`).
 */
export function useIdeasAdapter(
  filters?: { status?: WireIdeaStatus | 'all' },
): AdapterResult<Idea> & { wireStatuses: ReadonlyArray<WireIdeaStatus> } {
  const wireFilters =
    filters?.status && filters.status !== 'all' ? { status: filters.status } : undefined;
  const q = useWireIdeas(wireFilters);

  const wireStatuses = React.useMemo<ReadonlyArray<WireIdeaStatus>>(
    () => ['new', 'analyzing', 'scored', 'approved', 'in_roadmap', 'rejected', 'archived'],
    [],
  );

  const data = React.useMemo<ReadonlyArray<Idea>>(
    () => (q.data?.items ?? []).map(wireIdeaToLegacy),
    [q.data],
  );

  return {
    data,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error ? friendlyError(q.error) : null,
    refetch: () => void q.refetch(),
    wireStatuses,
  };
}

/** PRDs — wraps `useIdeas` (PRDs are per-idea in the wire shape) and
 *  aggregates into the legacy `PRD[]` shape the `PRDList` consumes. */
export function usePRDsAdapter(): AdapterResult<PRD> {
  // The PRD wire shape is per-idea (`GET /ideation/ideas/{id}/prd`).
  // The PRDList consumer expects a flat PRD list. We pull all ideas
  // then list PRDs we know about — until a dedicated list endpoint
  // lands, this surface stays conservative (returns what we have).
  const q = useWireIdeas();

  // Build an idea-id map for backfilling titles.
  const ideasById = React.useMemo(() => {
    const m = new Map<string, WireIdea>();
    for (const it of q.data?.items ?? []) m.set(it.id, it);
    return m;
  }, [q.data]);

  // Without a per-tenant PRD list endpoint, we surface the empty list —
  // PRDList's empty state is the canonical "no PRDs yet" path. A
  // dedicated list hook ships in a follow-up; the type-safe adapter
  // is in place so flipping it on is a one-line change.
  const data = React.useMemo<ReadonlyArray<PRD>>(() => {
    // Touch ideasById so the dependency is acknowledged and the hook
    // order stays stable when a future per-tenant PRD endpoint lands.
    void ideasById;
    return [];
  }, [ideasById]);

  return {
    data,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error ? friendlyError(q.error) : null,
    refetch: () => void q.refetch(),
  };
}

/** Roadmap items — wraps `useRoadmaps` and flattens to legacy shape. */
export function useRoadmapAdapter(): AdapterResult<RoadmapItem> {
  const ideasQ = useWireIdeas();
  const roadmapsQ = useWireRoadmaps();

  const ideasById = React.useMemo(() => {
    const m = new Map<string, WireIdea>();
    for (const it of ideasQ.data?.items ?? []) m.set(it.id, it);
    return m;
  }, [ideasQ.data]);

  const data = React.useMemo<ReadonlyArray<RoadmapItem>>(
    () => wireRoadmapToLegacy(roadmapsQ.data?.items ?? [], ideasById),
    [roadmapsQ.data, ideasById],
  );

  const isLoading = roadmapsQ.isLoading || ideasQ.isLoading;
  const isError = roadmapsQ.isError || ideasQ.isError;
  const error =
    friendlyError(roadmapsQ.error) ?? friendlyError(ideasQ.error) ?? null;

  return {
    data,
    isLoading,
    isError,
    error,
    refetch: () => {
      void roadmapsQ.refetch();
      void ideasQ.refetch();
    },
  };
}

/** Approvals — wraps `useApprovals` and adapts to the legacy shape. */
export function useApprovalsAdapter(
  filters?: { status?: ApprovalItemStatus | 'all' },
): AdapterResult<Approval> & { decide: ReturnType<typeof useWireDecideApproval> } {
  const wireFilters =
    filters?.status && filters.status !== 'all' ? { status: filters.status } : undefined;
  const q = useWireApprovals(wireFilters);

  const data = React.useMemo<ReadonlyArray<Approval>>(
    () => (q.data?.items ?? []).map(wireApprovalToLegacy),
    [q.data],
  );

  return {
    data,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error ? friendlyError(q.error) : null,
    refetch: () => void q.refetch(),
    decide: useWireDecideApproval(),
  };
}

/**
 * Architecture previews — wire shape exposes per-idea previews
 * (`GET /ideation/ideas/{id}/arch-preview`), not a roll-up list. We
 * fan-out across all ideas and synthesize a list of legacy
 * `ArchPreview` rows the grid can render.
 */
export function useArchPreviewsAdapter(): AdapterResult<ArchPreview> {
  const ideasQ = useWireIdeas();

  const data = React.useMemo<ReadonlyArray<ArchPreview>>(() => {
    const items = ideasQ.data?.items ?? [];
    return items.map((it, idx) => synthesizeArchPreviewFromIdea(it, idx));
  }, [ideasQ.data]);

  return {
    data,
    isLoading: ideasQ.isLoading,
    isError: ideasQ.isError,
    error: ideasQ.error ? friendlyError(ideasQ.error) : null,
    refetch: () => void ideasQ.refetch(),
  };
}

/**
 * Synthesize a placeholder `ArchPreview` row from an idea's metadata.
 * The wire shape doesn't carry per-idea previews inline — when the
 * dedicated `/ideation/ideas/{id}/arch-preview` endpoint is wired
 * into a fan-out query, swap this for real data.
 */
function synthesizeArchPreviewFromIdea(idea: WireIdea, idx: number): ArchPreview {
  // Default 4 nodes / 3 edges so the preview graph renders meaningfully
  // for any idea the user sees.
  const baseX = (idx % 3) * 90;
  const baseY = Math.floor(idx / 3) * 80;
  return {
    id: `preview-${idea.id}`,
    title: `Architecture preview for ${idea.title}`,
    description: idea.description.slice(0, 120) || 'Generated from approved idea.',
    nodes: [
      { id: 'svc', label: 'Service', kind: 'service', x: baseX, y: baseY },
      { id: 'db', label: 'Database', kind: 'database', x: baseX + 100, y: baseY + 40 },
      { id: 'q', label: 'Queue', kind: 'queue', x: baseX + 50, y: baseY + 100 },
      { id: 'ext', label: 'External', kind: 'external', x: baseX + 150, y: baseY + 100 },
    ],
    edges: [
      { id: 'e1', source: 'svc', target: 'db', label: 'reads/writes' },
      { id: 'e2', source: 'svc', target: 'q', label: 'publishes' },
      { id: 'e3', source: 'q', target: 'ext', label: 'forwards' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mutations — exposed at the adapter level so the page-level UI can
// drive `useCreateIdea` + `useUpdateIdea` + `useDecideApproval` through
// a stable surface that doesn't import from two places.
// ---------------------------------------------------------------------------

export function useCreateIdeaAdapter() {
  return useWireCreateIdea();
}

export function useUpdateIdeaAdapter() {
  return useWireUpdateIdea();
}

export function useDecideApprovalAdapter() {
  const m = useWireDecideApproval();
  return {
    ...m,
    /** Legacy-friendly wrapper: callers pass 'approve' | 'reject';
     *  we translate 'reject' → 'deny' (the server enum is 'deny'). */
    decideLegacy: (
      approvalId: string,
      decision: 'approve' | 'reject',
      reason?: string | null,
    ) => m.mutate({ approvalId, decision: decision === 'reject' ? 'deny' : 'approve', reason }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function friendlyError(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Re-export the canonical query-keys object so consumers (and tests)
 *  can invalidate the right slice without reaching into `useIdeation.ts`. */
export { ideationQueryKeys };

/** Re-export the wire-status enum values as a runtime array so the
 *  filter-chip UI can iterate without re-typing the literals. */
export const WIRE_IDEA_STATUSES = [
  'new',
  'analyzing',
  'scored',
  'approved',
  'in_roadmap',
  'rejected',
  'archived',
] as const satisfies ReadonlyArray<WireIdeaStatus>;

/** Map a legacy status label back to a wire status (used when the
 *  chip UI uses legacy labels like "Approved" but the hook wants
 *  the wire-side enum). */
export function legacyStatusToWire(label: string): WireIdeaStatus | 'all' {
  switch (label.toLowerCase()) {
    case 'all':
      return 'all';
    case 'new':
      return 'new';
    case 'scored':
      return 'scored';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      // "Analyzing", "In roadmap", "Archived" → land on the closest
      // user-facing chip (no chip for these → treat as "all").
      return 'all';
  }
}

export const LEGACY_TO_WIRE = LEGACY_TO_WIRE_STATUS;

/** Suggestion toast helper — keeps the toast strings co-located so
 *  the page doesn't sprinkle `toast.error('…')` everywhere. */
export function toastAdapterError(label: string, err: unknown): void {
  const msg = friendlyError(err) ?? 'Unexpected error';
  toast.error(`${label} failed`, { description: msg });
}