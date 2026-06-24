/**
 * Ideation Center data layer (M2+).
 *
 * Fetches ideas, roadmaps, PRDs, architecture previews, and the
 * approval queue from the orchestrator. Backs the Ideation Center
 * page until per-endpoint mutations ship.
 */

import { DEV_TENANT_UUID } from '../../config/dev-seeds';

export type IdeaStatus =
  | 'intake'
  | 'scoring'
  | 'discovery'
  | 'prd'
  | 'approved'
  | 'rejected'
  | 'shipped';

export type RoadmapColumn = 'now' | 'next' | 'later' | 'future';

export interface ScoreBreakdown {
  impact: number;
  feasibility: number;
  confidence: number;
  effort: number;
}

export interface Idea {
  id: string;
  title: string;
  summary: string;
  status: IdeaStatus;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  owner: string;
  ownerAvatar: string;
  createdAt: string;
  tags: ReadonlyArray<string>;
  impact: 'low' | 'medium' | 'high';
  prdRef?: string;
  analysis: string;
  risks: ReadonlyArray<string>;
}

export interface RoadmapItem {
  id: string;
  ideaId: string;
  column: RoadmapColumn;
  title: string;
  quarter: string;
  owner: string;
  effort: 'S' | 'M' | 'L';
}

export interface PRD {
  id: string;
  title: string;
  ideaId: string;
  owner: string;
  updatedAt: string;
  status: 'draft' | 'review' | 'approved';
  markdown: string;
}

export interface ArchPreviewNode {
  id: string;
  label: string;
  kind: 'service' | 'database' | 'queue' | 'external';
  x: number;
  y: number;
}

export interface ArchPreviewEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface ArchPreview {
  id: string;
  title: string;
  description: string;
  nodes: ReadonlyArray<ArchPreviewNode>;
  edges: ReadonlyArray<ArchPreviewEdge>;
}

export interface Approval {
  id: string;
  kind: 'idea' | 'prd' | 'adr' | 'run';
  refId: string;
  title: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function safeArray<T>(res: Response): Promise<ReadonlyArray<T>> {
  if (!res.ok) return [];
  try {
    const json = (await res.json()) as T[] | { items?: T[] };
    if (Array.isArray(json)) return json;
    if (json && Array.isArray((json as { items?: T[] }).items)) {
      return (json as { items: T[] }).items;
    }
    return [];
  } catch {
    return [];
  }
}

/** GET /v1/ideation/ideas */
export async function listIdeas(): Promise<ReadonlyArray<Idea>> {
  const res = await fetch(`${SERVER_BASE}/v1/ideation/ideas`, {
    cache: 'no-store',
  });
  return safeArray<Idea>(res);
}

/** GET /v1/ideation/roadmap */
export async function listRoadmapItems(): Promise<ReadonlyArray<RoadmapItem>> {
  const res = await fetch(`${SERVER_BASE}/v1/ideation/roadmap`, {
    cache: 'no-store',
  });
  return safeArray<RoadmapItem>(res);
}

/** GET /v1/ideation/prds */
export async function listPRDs(): Promise<ReadonlyArray<PRD>> {
  const res = await fetch(`${SERVER_BASE}/v1/ideation/prds`, {
    cache: 'no-store',
  });
  return safeArray<PRD>(res);
}

/** GET /v1/ideation/arch-previews */
export async function listArchPreviews(): Promise<ReadonlyArray<ArchPreview>> {
  const res = await fetch(`${SERVER_BASE}/v1/ideation/arch-previews`, {
    cache: 'no-store',
  });
  return safeArray<ArchPreview>(res);
}

/** GET /v1/ideation/approvals */
export async function listApprovals(): Promise<ReadonlyArray<Approval>> {
  const res = await fetch(`${SERVER_BASE}/v1/ideation/approvals`, {
    cache: 'no-store',
  });
  return safeArray<Approval>(res);
}

// ---------------------------------------------------------------------------
// Forge AI-440 / Pillar 1 — Ideation Center mutations (Phase 1 + 2)
//
// These mirror the shape used by `usePushIdeaToJira` /
// `useApprovalDecide` / `useIdeaEnhance` so the hooks stay thin TanStack
// Query wrappers. The orchestrator dispatches `pushIdeaToJira` against
// the real MCP Jira server's `create_issue` tool (registry entry
// `jira` in `lib/mcp-registry.ts`). The dev stub synthesizes the
// same `JIRA/{epic}/{story...}` `external_ref` shape so the UI sees
// the same `epicKey` receipt as `<PushToJiraButton>` (F-213).
// ---------------------------------------------------------------------------

/**
 * Result of `pushIdeaToJira`. The orchestrator returns the canonical
 * `JIRA/{key}` `external_ref`; the client unwraps it to
 * `{ epicKey, storyKeys }` so the UI shows the same receipt as the
 * migration-plan push button.
 */
export interface JiraPushResult {
  readonly epicKey: string;
  readonly storyKeys: ReadonlyArray<string>;
  readonly pushedAt: string;
}

/**
 * POST /v1/ideation/ideas/{id}/push/jira
 *
 * Body: `{ project_key: string }`.
 *
 * The orchestrator wraps the MCP Jira server's `create_issue` tool
 * (registry entry `jira` in `lib/mcp-registry.ts`) and writes an
 * audit record. On success the response is the canonical wire shape:
 *
 *   { target, success, external_ref, error, record_id }
 *
 * Errors are surfaced as plain `Error` so the consumer can render a
 * retry affordance — the test contract (FORA-440 §3.1) asserts the
 * `mcp_unavailable` message text round-trips unchanged.
 */
export async function pushIdeaToJira(
  ideaId: string,
  projectKey: string,
): Promise<JiraPushResult> {
  const res = await fetch(
    `${SERVER_BASE}/v1/ideation/ideas/${encodeURIComponent(ideaId)}/push/jira`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_key: projectKey }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    let msg = `push to jira failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { message?: unknown };
      if (errBody && typeof errBody.message === 'string') msg = errBody.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as {
    target?: string;
    success?: boolean;
    external_ref?: string | null;
    error?: string | null;
    record_id?: string | null;
  };
  // Unwrap `JIRA/{epic}/{story1}/{story2}...` into the typed shape
  // the UI consumes. Falls back to the whole `external_ref` if the
  // wire shape ever drifts.
  const external = body.external_ref ?? '';
  const tail = external.startsWith('JIRA/') ? external.slice('JIRA/'.length) : external;
  const parts = tail.split('/').filter((p) => p.length > 0);
  const epicKey = parts[0] ?? external;
  const storyKeys = parts.length > 1 ? parts.slice(1) : [];
  return {
    epicKey,
    storyKeys,
    pushedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — Idea enhancement + approval decision
// ---------------------------------------------------------------------------

/** Server's refreshed analysis after an editor note is applied. */
export interface IdeaAnalysis {
  readonly summary: string;
  readonly risks: ReadonlyArray<string>;
  readonly score: number;
  readonly scoreBreakdown: ScoreBreakdown;
}

/**
 * POST /v1/ideation/ideas/{id}/enhance — re-run the analysis with
 * the editor note appended. Returns the refreshed `IdeaAnalysis` so
 * the dialog can render a receipt.
 */
export async function enhanceIdea(
  ideaId: string,
  editorNote: string,
): Promise<IdeaAnalysis> {
  const res = await fetch(
    `${SERVER_BASE}/v1/ideation/ideas/${encodeURIComponent(ideaId)}/enhance`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editor_note: editorNote }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    let msg = `enhance failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { message?: unknown };
      if (errBody && typeof errBody.message === 'string') msg = errBody.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as Partial<IdeaAnalysis> & {
    scoreBreakdown?: ScoreBreakdown;
  };
  return {
    summary: body.summary ?? '',
    risks: body.risks ?? [],
    score: body.score ?? 0,
    scoreBreakdown: body.scoreBreakdown ?? {
      impact: 0,
      feasibility: 0,
      confidence: 0,
      effort: 0,
    },
  };
}

/**
 * Approval decision verbs — the server enum is locked, the UI mirrors
 * it so type errors surface at compile time. Note: the server uses
 * `deny` (not `reject`); the local `Approval.status` field on the
 * client uses `rejected` (a different concept: the resulting row
 * status, not the verb the PM clicked).
 */
export type ApprovalDecisionVerb = 'approve' | 'deny' | 'request_changes';

/** Server's echo of the decided approval row. */
export interface DecideApprovalResult {
  readonly id: string;
  readonly status: 'approved' | 'rejected' | 'changes_requested';
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly reason?: string;
}

/**
 * POST /v1/ideation/approvals/{id}/decide — record a PM decision
 * (approve / deny / request_changes) on a pending approval.
 */
export async function decideApproval(
  approvalId: string,
  decision: ApprovalDecisionVerb,
  reason?: string,
): Promise<DecideApprovalResult> {
  const res = await fetch(
    `${SERVER_BASE}/v1/ideation/approvals/${encodeURIComponent(approvalId)}/decide`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
        'x-fora-tenant-id': DEV_TENANT_UUID,
      },
      body: JSON.stringify({ decision, reason: reason ?? null }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    let msg = `approval decide failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { message?: unknown };
      if (errBody && typeof errBody.message === 'string') msg = errBody.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as Partial<DecideApprovalResult>;
  return {
    id: body.id ?? approvalId,
    status:
      body.status ??
      (decision === 'approve'
        ? 'approved'
        : decision === 'deny'
          ? 'rejected'
          : 'changes_requested'),
    decidedBy: body.decidedBy ?? 'system',
    decidedAt: body.decidedAt ?? new Date().toISOString(),
    reason: body.reason ?? reason,
  };
}

/** Local helpers — pure transforms, no I/O. */
export function getIdea(items: ReadonlyArray<Idea>, id: string): Idea | undefined {
  return items.find((i) => i.id === id);
}

export function getPRD(items: ReadonlyArray<PRD>, id: string): PRD | undefined {
  return items.find((p) => p.id === id);
}

export function getArchPreview(
  items: ReadonlyArray<ArchPreview>,
  id: string,
): ArchPreview | undefined {
  return items.find((p) => p.id === id);
}
