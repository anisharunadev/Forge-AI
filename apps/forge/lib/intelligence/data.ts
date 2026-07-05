/**
 * Async data loaders for the Project Intelligence center (FORA-501).
 *
 * Step 58 v2 migration: the legacy orchestrator stub on port 4000 is
 * deprecated. This module now talks to the FastAPI backend on
 * `FORGE_API_BASE_URL` (default `http://localhost:8000/api/v1`) using
 * the canonical `/epics`, `/stories`, `/sprints` endpoints. Endpoints
 * that don't exist on the FastAPI backend yet (handoffs, briefs,
 * drafts) return an empty list so the page renders its empty state
 * (Rule 15) rather than throwing 500s.
 *
 * Endpoints (project-scoped via JWT tenant — see
 * `backend/app/api/v1/stories.py`, `sprints.py`, `epics.py`):
 *   GET /epics
 *   GET /stories?project_id=…&status=…
 *   GET /sprints?project_id=…
 *   GET /sprints/current
 *
 * On any non-2xx the loader returns an empty / null value so pages can
 * render the standard `<div className="card text-sm text-forge-300">No
 * items yet.</div>` empty state instead of throwing a 500.
 */

import type {
  DraftPrd,
  Epic,
  HandoffContract,
  RequirementBrief,
  Story,
} from "./types";

import { api, FORGE_API_BASE_URL } from '@/lib/api/client';
export const SEED_TENANT_ID = "acme-corp";

const API_BASE = FORGE_API_BASE_URL;

// Warn once per load that endpoints don't yet exist on the FastAPI
// backend. The page-level consumers render the empty state when these
// return [] (Rule 15).
const MISSING_ENDPOINT_WARNED = new Set<string>();
function warnMissing(endpoint: string): void {
  if (MISSING_ENDPOINT_WARNED.has(endpoint)) return;
  MISSING_ENDPOINT_WARNED.add(endpoint);
  // eslint-disable-next-line no-console
  console.warn(
    `[intelligence] ${endpoint} is not yet exposed by the FastAPI backend; returning empty list`,
  );
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getList<T>(path: string): Promise<ReadonlyArray<T>> {
  const data = await getJson<ReadonlyArray<T>>(path);
  return data ?? [];
}

/**
 * Build a query string from a filter object. Skips undefined/null/empty.
 * Backend endpoints use snake_case query params (project_id, sprint_id,
 * status, priority, assignee_id, label, search).
 */
function buildQuery(filter?: Record<string, unknown>): string {
  if (!filter) return "";
  const entries = Object.entries(filter).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return `?${usp.toString()}`;
}

export async function listEpics(filter?: {
  project_id?: string;
  status?: string;
}): Promise<ReadonlyArray<Epic>> {
  return getList<Epic>(`/epics${buildQuery(filter)}`);
}

export async function getEpic(id: string): Promise<Epic | null> {
  return getJson<Epic>(`/epics/${encodeURIComponent(id)}`);
}

export async function listStories(filter?: {
  project_id?: string;
  sprint_id?: string;
  status?: string;
}): Promise<ReadonlyArray<Story>> {
  return getList<Story>(`/stories${buildQuery(filter)}`);
}

export async function getStory(id: string): Promise<Story | null> {
  return getJson<Story>(`/stories/${encodeURIComponent(id)}`);
}

export async function listStoriesForEpic(
  epicId: string,
  preFetchedStories?: ReadonlyArray<Story>,
): Promise<ReadonlyArray<Story>> {
  if (preFetchedStories) {
    return preFetchedStories.filter((s) => s.epicId === epicId);
  }
  const all = await listStories();
  return all.filter((s) => s.epicId === epicId);
}

export async function listStoriesByStage(
  stage: "dev" | "qa" | "devops",
): Promise<ReadonlyArray<Story>> {
  const all = await listStories();
  return all.filter((s) => s.status === stage);
}

/**
 * Handoff contracts — not yet exposed on the FastAPI backend. The
 * closest equivalent is the ideation output bundles (`/ideation/...`).
 * Until that surface lands we return an empty list so the page renders
 * its empty state.
 */
export async function listHandoffContracts(): Promise<
  ReadonlyArray<HandoffContract>
> {
  warnMissing("/handoffs");
  return [];
}

export async function getHandoffContract(
  id: string,
): Promise<HandoffContract | null> {
  warnMissing(`/handoffs/${id}`);
  return null;
}

/**
 * Requirement briefs — not yet exposed on the FastAPI backend. Return
 * empty until a `/requirement-briefs` route is added.
 */
export async function listRequirementBriefs(): Promise<
  ReadonlyArray<RequirementBrief>
> {
  warnMissing("/requirement-briefs");
  return [];
}

export async function getRequirementBrief(
  id: string,
): Promise<RequirementBrief | null> {
  warnMissing(`/requirement-briefs/${id}`);
  return null;
}

/**
 * Draft PRDs — the closest FastAPI surface is `/ideation/ideas/{id}/prd`
 * (single PRDs by idea id). The flat list endpoint `/drafts` doesn't
 * exist yet, so we return an empty list to drive the empty state.
 */
export async function listDraftPrds(): Promise<ReadonlyArray<DraftPrd>> {
  warnMissing("/drafts");
  return [];
}

export async function getDraftPrd(id: string): Promise<DraftPrd | null> {
  warnMissing(`/drafts/${id}`);
  return null;
}

/**
 * Resolve an internal id (epic/story) to its human-readable identifier
 * (`FORA-…`). Pure helper — the caller passes the pre-fetched arrays so
 * this stays synchronous and works in both server and client renderers.
 */
export function resolveIdentifier(
  id: string,
  epics: ReadonlyArray<Epic>,
  stories: ReadonlyArray<Story>,
): string {
  const epic = epics.find((e) => e.id === id);
  if (epic) return epic.identifier;
  const story = stories.find((s) => s.id === id);
  if (story) return story.identifier;
  return id;
}