/**
 * Ideation Center data layer (M2+).
 *
 * Fetches ideas, roadmaps, PRDs, architecture previews, and the
 * approval queue from the orchestrator. Backs the Ideation Center
 * page until per-endpoint mutations ship.
 */

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
