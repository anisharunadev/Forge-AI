/**
 * Async data loaders for the Project Intelligence center (FORA-501).
 *
 * Replaces the previous sync `lib/intelligence/mock-data.ts` seam with
 * async fetchers that hit the orchestrator stub's typed-artifact
 * endpoints. Page-level consumers (`app/project-intelligence/*`) import
 * from here; the mock-data module remains in place until the next pass
 * deletes it.
 *
 * Endpoints (project-scoped, see `bin/orchestrator-stub.py`):
 *   GET /v1/projects/project-forge-demo/epics
 *   GET /v1/projects/project-forge-demo/stories
 *   GET /v1/projects/project-forge-demo/handoffs
 *   GET /v1/projects/project-forge-demo/briefs
 *   GET /v1/projects/project-forge-demo/drafts
 *   GET /v1/projects/project-forge-demo/{prefix}/{id}
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

export const SEED_TENANT_ID = "acme-corp";

const API_BASE =
  process.env.FORA_FORGE_API_URL ?? "http://localhost:4000";
const PROJECT = "project-forge-demo";

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

export async function listEpics(): Promise<ReadonlyArray<Epic>> {
  return getList<Epic>(`/v1/projects/${PROJECT}/epics`);
}

export async function getEpic(id: string): Promise<Epic | null> {
  return getJson<Epic>(`/v1/projects/${PROJECT}/epics/${encodeURIComponent(id)}`);
}

export async function listStories(): Promise<ReadonlyArray<Story>> {
  return getList<Story>(`/v1/projects/${PROJECT}/stories`);
}

export async function getStory(id: string): Promise<Story | null> {
  return getJson<Story>(`/v1/projects/${PROJECT}/stories/${encodeURIComponent(id)}`);
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

export async function listHandoffContracts(): Promise<
  ReadonlyArray<HandoffContract>
> {
  return getList<HandoffContract>(`/v1/projects/${PROJECT}/handoffs`);
}

export async function getHandoffContract(
  id: string,
): Promise<HandoffContract | null> {
  return getJson<HandoffContract>(
    `/v1/projects/${PROJECT}/handoffs/${encodeURIComponent(id)}`,
  );
}

export async function listRequirementBriefs(): Promise<
  ReadonlyArray<RequirementBrief>
> {
  return getList<RequirementBrief>(`/v1/projects/${PROJECT}/briefs`);
}

export async function getRequirementBrief(
  id: string,
): Promise<RequirementBrief | null> {
  return getJson<RequirementBrief>(
    `/v1/projects/${PROJECT}/briefs/${encodeURIComponent(id)}`,
  );
}

export async function listDraftPrds(): Promise<ReadonlyArray<DraftPrd>> {
  return getList<DraftPrd>(`/v1/projects/${PROJECT}/drafts`);
}

export async function getDraftPrd(id: string): Promise<DraftPrd | null> {
  return getJson<DraftPrd>(
    `/v1/projects/${PROJECT}/drafts/${encodeURIComponent(id)}`,
  );
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
