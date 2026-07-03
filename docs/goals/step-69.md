# Step 69 — Phase 8 Ideation: Wire 9 Tabs to 54 Routes

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~1.5 weeks (6 zones)
> **Phase:** 8 — Ideation (currently `Planned` in `built-features.yaml`); also Centers row 16 currently `Beta`
> **Goal:** Replace the generic `useApiData` hook with per-endpoint TanStack hooks; wire the 4 missing tabs (Sources, Destinations, Market, Voice) to their backend routes; fix the status-name divergence; flip `Planned` → `Production`

## /goal

The current `built-features.yaml` state:

```yaml
- area: Centers
  order: 16
  feature: Ideation
  steps: ["28", "5"]
  status: Beta                          # ← flip to Production
  docs: centers/ideation

- area: Integration
  order: 47
  feature: "Phase 8 — Ideation (uses forge-pi)"
  steps: []
  status: Planned                       # ← flip to Production
  docs: centers/ideation
```

The **honest** state (verified this session):

| Layer | State |
|---|---|
| **Backend: 54 routes** in 12 files under `backend/app/api/v1/ideation/` | ✅ Built |
| **Backend: ~30 Pydantic schemas** in `schemas/ideation.py` (IdeaRead, RoadmapRead, PRDRead, ArchPreviewRead, Scoring, Impact, KG-Graph, etc.) | ✅ Built |
| **Backend: 1 WebSocket** at `backend/app/api/ws/ideation/workflow.py` (live pipeline updates) | ✅ Built |
| **Frontend: 25+ components** in `apps/forge/components/ideation/` (IdeationBoard, IdeaDetailPanel, RoadmapTimeline, PRDList, CaptureModal, AgentLaunchButton, ...) | ✅ Built |
| **`apps/forge/app/ideation/page.tsx` 9 tabs** | ⚠️ Page exists; 5 tabs call backend via a generic `useApiData` hook. 4 tabs (Sources, Destinations, Market, Voice) have **zero backend calls** — they use `pipeline-data.ts` fixtures |
| **Per-endpoint TanStack hooks** | 🔴 **Missing** — current pattern is generic `useApiData('/v1/ideation/ideas')` fetch, not `useIdeationIdeas()` / `useIdeationRoadmap()` / etc. |
| **TypeScript types matching backend** | 🔴 **Missing** — `lib/ideation/data.ts` has stub types (e.g. `IdeaStatus = 'intake' | 'scoring' | ...`) that don't match backend (`IdeaStatus = 'NEW' | 'ANALYZING' | 'SCORED' | 'APPROVED' | 'IN_ROADMAP' | 'REJECTED' | 'ARCHIVED'`) |
| **Status name adapter** | 🔴 **Missing** — frontend uses lowercase kanban names, backend uses uppercase enum names. We need a mapping layer |
| **WebSocket wire-up** | 🔴 Backend has WS endpoint, frontend has no subscriber |

**Goal:** Wire 9 tabs, ship 9+ TanStack hooks, fix the status-name adapter, hook the WebSocket to live updates, flip both rows to `Production`.

This is the **biggest frontend wiring step** in the pipeline — 54 routes is 6× more than Phase 6 Knowledge Graph (9 routes) and 4× more than Phase 7 Stories (11 routes).

## What you'll see after this step

- `http://localhost:3000/ideation` loads in ~500ms with real data on all 9 tabs
- The Ideas tab shows real `Idea` rows from `/api/v1/ideation/ideas` (tenant-scoped)
- Status column shows backend enum values via adapter (`NEW` ↔ "intake", `SCORED` ↔ "scoring", etc.)
- The Sources tab shows real connectors from `/api/v1/ideation/sources` (currently fixture)
- The Destinations tab shows real sync destinations from `/api/v1/ideation/destinations` (currently fixture)
- The Market Signals tab streams live updates via the WS at `/api/ws/ideation/workflow`
- The Customer Voice tab shows real clusters (currently fixture)
- Capturing a new idea via ⌘N persists via `POST /api/v1/ideation/ideas` and the kanban refreshes
- The pipeline tab's `IngestIndicator` shows real daily-ingest status (currently static)
- `pytest tests/api/ -k ideation` passes (new test file)
- `npx tsc --noEmit` — 0 new errors
- `built-features.yaml` reads `Production` on rows 16 and 47

## What you'll NOT see (out of scope, deliberately)

- **No KG-graph from inside ideation** — that's its own prompt (the `/v1/ideation/kg-graph` 3 routes are a stub, see Zone 6)
- **No "AI scoring" widget** — backend has scoring endpoints but no LLM call wired in the UI yet
- **No PRD draft editor** — `PRDViewer` displays; editing the markdown is in another step
- **No arch preview rendering** — `ArchPreviewGrid` displays titles + status; the mermaid rendering is a separate prompt
- **No Jira push UI** — `POST /v1/ideation/push/{idea_id}` works but the "push to Jira" button is omitted
- **No enhancement modal** — `IdeaEnhanceDialog` is wired but the enhance endpoint call is deferred (LLM routing)
- **No pipeline run UI** — `POST /v1/ideation/workflows/run` works but the "Run pipeline" button is omitted

## Files to read FIRST (in this order)

1. This file
2. `/workspace/prompts/step67-phase6-knowledge-graph.md` — same TanStack-hooks pattern; mirror that
3. `/workspace/prompts/step57p5-dashboard-real.md` — adapter pattern
4. `backend/app/api/v1/ideation/__init__.py` — see how 12 routers are bundled
5. `backend/app/schemas/ideation.py` — 30+ Pydantic types, full list
6. `backend/app/services/ideation/` — service layer (skim; don't read every file)
7. `apps/forge/app/ideation/page.tsx` — 5 useApiData calls + 4 unwired tabs
8. `apps/forge/lib/ideation/data.ts` — current stub types (will replace)
9. `apps/forge/lib/ideation/forge-pi-client.ts` — graceful-degradation pattern (good example)
10. `apps/forge/hooks/use-api-data.ts` — the generic hook we're replacing
11. `apps/forge/lib/api/dashboard.ts` — type pattern to mirror
12. `apps/forge/lib/api/dashboard-hooks.ts` — TanStack pattern to mirror
13. `apps/forge/components/ideation/CaptureModal.tsx` — see how `idea.created` mutation needs to work
14. `apps/forge/components/ideation/IdeaKanban.tsx` — see how `status` is used (for adapter)
15. `/workspace/docs/features/ideation.md` — feature doc

## The status-name divergence (THE BUG)

The frontend `data.ts` declares:

```typescript
export type IdeaStatus =
  | 'intake' | 'scoring' | 'discovery' | 'prd'
  | 'approved' | 'rejected' | 'shipped';
```

The backend `schemas/ideation.py` declares:

```python
class IdeaStatus(str, Enum):
    NEW = "NEW"
    ANALYZING = "ANALYZING"
    SCORED = "SCORED"
    APPROVED = "APPROVED"
    IN_ROADMAP = "IN_ROADMAP"
    REJECTED = "REJECTED"
    ARCHIVED = "ARCHIVED"
```

**The names don't line up.** Frontend's "intake" doesn't exist in backend; backend's "NEW" doesn't exist in frontend. We need a bidirectional adapter.

The mapping is **semantic**, not 1:1:

| Frontend (UX-friendly) | Backend (enum) | Notes |
|---|---|---|
| `intake` | `NEW` | Newly captured, not yet analyzed |
| `scoring` | `ANALYZING` | AI is scoring |
| `discovery` | `SCORED` | Score available, awaiting PM decision |
| `prd` | `IN_ROADMAP` | In PRD drafting OR in roadmap queue (UI treats as one stage) |
| `approved` | `APPROVED` | PM approved, in queue |
| `rejected` | `REJECTED` | PM rejected |
| `shipped` | (use a flag, not status) | Backend doesn't have a SHIPPED status — use `is_shipped: bool` on Idea |

The adapter lives in `apps/forge/lib/ideation/adapter.ts` (new file):

```typescript
import type { IdeaStatus as UiStatus } from './data';
import type { IdeaStatus as ApiStatus } from '@/lib/api/ideation';

const UI_TO_API: Record<UiStatus, ApiStatus> = {
  intake: 'NEW',
  scoring: 'ANALYZING',
  discovery: 'SCORED',
  prd: 'IN_ROADMAP',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  shipped: 'APPROVED',  // see note
};

const API_TO_UI: Record<ApiStatus, UiStatus> = {
  NEW: 'intake',
  ANALYZING: 'scoring',
  SCORED: 'discovery',
  APPROVED: 'approved',
  IN_ROADMAP: 'prd',
  REJECTED: 'rejected',
  ARCHIVED: 'rejected',  // hide 'archived' as 'rejected' in the UI
};

export function uiStatusToApi(s: UiStatus): ApiStatus { return UI_TO_API[s]; }
export function apiStatusToUi(s: ApiStatus): UiStatus { return API_TO_UI[s]; }
```

The `shipped` case is a **separate concern**: backend doesn't have it; we use `is_shipped: bool` on the Idea. UI sets `shipped` locally only when the user marks the idea as shipped (out of scope for this step — defer to a follow-up). For now, just map shipped → APPROVED on the way out, and don't show a "Shipped" column in the kanban.

## ZONE 1 — TypeScript types + query keys

Create `apps/forge/lib/api/ideation.ts` (mirror `lib/api/dashboard.ts`):

```typescript
/**
 * Ideation Center (Phase 8) frontend types — mirror the Pydantic
 * schemas in `backend/app/schemas/ideation.py`.
 *
 * The Idea type uses BACKEND enum names (NEW, ANALYZING, etc.).
 * A bidirectional adapter in `lib/ideation/adapter.ts` converts
 * to/from the UI-friendly names (intake, scoring, ...).
 */

export type IdeaStatus =
  | 'NEW' | 'ANALYZING' | 'SCORED' | 'APPROVED'
  | 'IN_ROADMAP' | 'REJECTED' | 'ARCHIVED';

export type IdeaSource =
  | 'MANUAL' | 'JIRA' | 'GITHUB' | 'SLACK' | 'ZENDESK'
  | 'INTERCOM' | 'LINEAR' | 'GONG' | 'API' | 'CUSTOMER_VOICE';

export interface Idea {
  id: string;
  title: string;
  description: string;
  source: IdeaSource;
  submitted_by: string;
  status: IdeaStatus;
  tags: string[];
  attachments: Record<string, unknown>[];
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface IdeaCreate {
  title: string;
  description: string;
  source?: IdeaSource;
  tags?: string[];
  project_id?: string;
}

export interface IdeaUpdate {
  title?: string;
  description?: string;
  status?: IdeaStatus;
  tags?: string[];
}

export interface IdeaListResponse {
  items: Idea[];
  total: number;
}

export interface IdeaAnalysis {
  id: string;
  idea_id: string;
  score: number;
  factors: Record<string, number>;
  rationale: string;
  created_at: string;
}

export interface ImpactGraphNode {
  id: string;
  label: string;
  kind: string;
  weight: number;
}

export interface ImpactGraphEdge {
  from: string;
  to: string;
  weight: number;
}

export interface ImpactGraph {
  nodes: ImpactGraphNode[];
  edges: ImpactGraphEdge[];
}

export interface OpportunityScore {
  idea_id: string;
  impact: number;
  feasibility: number;
  confidence: number;
  effort: number;
  total: number;
  rationale?: string;
}

export type RoadmapHorizon = 'NOW' | 'NEXT' | 'LATER' | 'FUTURE';
export type RoadmapStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'ARCHIVED';

export interface Roadmap {
  id: string;
  name: string;
  horizon: RoadmapHorizon;
  theme: string;
  status: RoadmapStatus;
  items: Record<string, unknown>[];
  generated_by: string;
  approved_by: string | null;
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface RoadmapListResponse {
  items: Roadmap[];
  total: number;
}

export interface PRD {
  id: string;
  idea_id: string;
  title: string;
  body_markdown: string;
  status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'ARCHIVED';
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface ArchPreview {
  id: string;
  idea_id: string;
  title: string;
  mermaid_source: string;
  components: Record<string, unknown>[];
  integrations: Record<string, unknown>[];
  status: 'DRAFT' | 'REVIEW' | 'APPROVED';
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface IdeationApproval {
  id: string;
  kind: 'idea' | 'prd' | 'roadmap' | 'arch_preview';
  target_id: string;
  requested_by: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  label: string;
  created_at: string;
}

// Sources / Destinations / Market / Voice
export interface IngestSource {
  id: string;
  kind: 'jira' | 'github' | 'slack' | 'zendesk' | 'intercom' | 'linear' | 'custom';
  display_name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
}

export interface SyncDestination {
  id: string;
  kind: 'jira' | 'confluence' | 'mcp_agent' | 'webhook';
  display_name: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface MarketSignal {
  id: string;
  source: string;          // e.g. "TechCrunch", "GitHub Trending"
  category: 'competitor' | 'trend' | 'tech' | 'regulation';
  title: string;
  url: string;
  summary: string;
  observed_at: string;
}

export interface CustomerVoiceCluster {
  id: string;
  theme: string;
  count: number;
  examples: { source: string; text: string; url: string }[];
  sentiment: 'positive' | 'neutral' | 'negative';
  updated_at: string;
}

// Query keys
export const queryKeys = {
  ideation: {
    all: ['ideation'] as const,
    ideas: (filter?: { status?: IdeaStatus; source?: IdeaSource }) =>
      [...queryKeys.ideation.all, 'ideas', filter ?? {}] as const,
    idea: (id: string) => [...queryKeys.ideation.all, 'idea', id] as const,
    analysis: (idea_id: string) =>
      [...queryKeys.ideation.all, 'analysis', idea_id] as const,
    impact: (idea_id: string) =>
      [...queryKeys.ideation.all, 'impact', idea_id] as const,
    score: (idea_id: string) =>
      [...queryKeys.ideation.all, 'score', idea_id] as const,
    roadmaps: () => [...queryKeys.ideation.all, 'roadmaps'] as const,
    roadmap: (id: string) => [...queryKeys.ideation.all, 'roadmap', id] as const,
    prds: () => [...queryKeys.ideation.all, 'prds'] as const,
    prd: (id: string) => [...queryKeys.ideation.all, 'prd', id] as const,
    archPreviews: () => [...queryKeys.ideation.all, 'arch-previews'] as const,
    approvals: () => [...queryKeys.ideation.all, 'approvals'] as const,
    sources: () => [...queryKeys.ideation.all, 'sources'] as const,
    destinations: () => [...queryKeys.ideation.all, 'destinations'] as const,
    marketSignals: () => [...queryKeys.ideation.all, 'market'] as const,
    voiceClusters: () => [...queryKeys.ideation.all, 'voice'] as const,
  },
};
```

## ZONE 2 — TanStack hooks

Create `apps/forge/lib/api/ideation-hooks.ts`. This is the biggest hooks file in the project — **24 hooks** across all 12 backend sub-routers.

```typescript
/**
 * Ideation Center hooks (Phase 8).
 *
 * 24 hooks across 12 backend sub-routers:
 *   - ideas (5)        — useIdeas, useIdea, useCreateIdea, useUpdateIdea, useDeleteIdea
 *   - analysis (2)     — useIdeaAnalysis, useIdeaImpact
 *   - scoring (2)      — useOpportunityScore, useHumanOverride
 *   - roadmaps (3)     — useRoadmaps, useRoadmap, useUpsertRoadmap
 *   - prds (2)         — usePRDs, useGeneratePRD
 *   - arch (2)         — useArchPreviews, useGenerateArchPreview
 *   - approvals (2)    — useIdeationApprovals, useDecideIdeationApproval
 *   - sources (1)      — useIngestSources
 *   - destinations (1) — useSyncDestinations
 *   - market (1)       — useMarketSignals
 *   - voice (1)        — useCustomerVoiceClusters
 *   - workflow (2)     — useRunPipeline, usePipelineStatus
 *
 * Stale-while-revalidate:
 *   - lists: 30s (Ideas, Roadmaps, PRDs, ArchPreviews, Approvals)
 *   - sources/destinations: 60s (config, less volatile)
 *   - market: 5m (signals are slow)
 *   - voice: 5m
 *
 * Pattern mirrors `lib/api/dashboard-hooks.ts` and `lib/api/knowledge-hooks.ts`.
 */

import {
  useMutation, useQuery, useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  queryKeys,
  type Idea, type IdeaCreate, type IdeaListResponse, type IdeaUpdate,
  type IdeaAnalysis, type ImpactGraph,
  type OpportunityScore, type PRD, type ArchPreview,
  type Roadmap, type RoadmapListResponse,
  type IdeationApproval, type IngestSource, type SyncDestination,
  type MarketSignal, type CustomerVoiceCluster,
} from './ideation';

// --- Ideas (5) ---------------------------------------------------------------

export function useIdeas(filter?: {
  status?: Idea['status']; source?: Idea['source'];
}): UseQueryResult<IdeaListResponse> {
  return useQuery({
    queryKey: queryKeys.ideation.ideas(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter?.status) params.set('status', filter.status);
      if (filter?.source) params.set('source', filter.source);
      const qs = params.toString();
      return api.get<IdeaListResponse>(`/ideation/ideas${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: 30_000,
  });
}

export function useIdea(id: string | null): UseQueryResult<Idea> {
  return useQuery({
    queryKey: queryKeys.ideation.idea(id ?? ''),
    queryFn: () => api.get<Idea>(`/ideation/ideas/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IdeaCreate) => api.post<Idea>('/ideation/ideas', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ideation.ideas() }),
  });
}

export function useUpdateIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: IdeaUpdate }) =>
      api.patch<Idea>(`/ideation/ideas/${id}`, body),
    onSuccess: (idea) => {
      qc.setQueryData(queryKeys.ideation.idea(idea.id), idea);
      qc.invalidateQueries({ queryKey: queryKeys.ideation.ideas() });
    },
  });
}

export function useDeleteIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ideation/ideas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ideation.ideas() }),
  });
}

// --- Analysis + Impact + Scoring (4) -----------------------------------------

export function useIdeaAnalysis(idea_id: string | null): UseQueryResult<IdeaAnalysis> {
  return useQuery({
    queryKey: queryKeys.ideation.analysis(idea_id ?? ''),
    queryFn: () => api.get<IdeaAnalysis>(`/ideation/ideas/${idea_id}/analysis`),
    enabled: Boolean(idea_id),
  });
}

export function useIdeaImpact(idea_id: string | null): UseQueryResult<ImpactGraph> {
  return useQuery({
    queryKey: queryKeys.ideation.impact(idea_id ?? ''),
    queryFn: () => api.get<ImpactGraph>(`/ideation/ideas/${idea_id}/impact`),
    enabled: Boolean(idea_id),
  });
}

export function useOpportunityScore(idea_id: string | null): UseQueryResult<OpportunityScore> {
  return useQuery({
    queryKey: queryKeys.ideation.score(idea_id ?? ''),
    queryFn: () => api.get<OpportunityScore>(`/ideation/scoring/${idea_id}`),
    enabled: Boolean(idea_id),
  });
}

export function useHumanOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { idea_id: string; impact: number; feasibility: number; confidence: number; effort: number; rationale: string }) =>
      api.post<OpportunityScore>('/ideation/scoring/override', body),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: queryKeys.ideation.score(v.idea_id) });
    },
  });
}

// --- Roadmaps (3) ------------------------------------------------------------

export function useRoadmaps(): UseQueryResult<RoadmapListResponse> {
  return useQuery({
    queryKey: queryKeys.ideation.roadmaps(),
    queryFn: () => api.get<RoadmapListResponse>('/ideation/roadmap'),
    refetchInterval: 60_000,
  });
}

export function useRoadmap(id: string | null): UseQueryResult<Roadmap> {
  return useQuery({
    queryKey: queryKeys.ideation.roadmap(id ?? ''),
    queryFn: () => api.get<Roadmap>(`/ideation/roadmap/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpsertRoadmap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Roadmap>) => api.post<Roadmap>('/ideation/roadmap', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ideation.roadmaps() }),
  });
}

// --- PRDs (2) ----------------------------------------------------------------

export function usePRDs(): UseQueryResult<PRD[]> {
  return useQuery({
    queryKey: queryKeys.ideation.prds(),
    queryFn: () => api.get<PRD[]>('/ideation/prds'),
    refetchInterval: 60_000,
  });
}

export function useGeneratePRD() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { idea_id: string }) =>
      api.post<PRD>('/ideation/prds/generate', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ideation.prds() }),
  });
}

// --- ArchPreviews (2) -------------------------------------------------------

export function useArchPreviews(): UseQueryResult<ArchPreview[]> {
  return useQuery({
    queryKey: queryKeys.ideation.archPreviews(),
    queryFn: () => api.get<ArchPreview[]>('/ideation/arch-previews'),
    refetchInterval: 60_000,
  });
}

export function useGenerateArchPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { idea_id: string }) =>
      api.post<ArchPreview>('/ideation/arch-previews/generate', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ideation.archPreviews() }),
  });
}

// --- Approvals (2) -----------------------------------------------------------

export function useIdeationApprovals(): UseQueryResult<IdeationApproval[]> {
  return useQuery({
    queryKey: queryKeys.ideation.approvals(),
    queryFn: () => api.get<IdeationApproval[]>('/ideation/approvals'),
    refetchInterval: 30_000,
  });
}

export function useDecideIdeationApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }) =>
      api.post<IdeationApproval>(`/ideation/approvals/${id}/decide`, { decision, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ideation.approvals() }),
  });
}

// --- Sources / Destinations / Market / Voice (4) -----------------------------

export function useIngestSources(): UseQueryResult<IngestSource[]> {
  return useQuery({
    queryKey: queryKeys.ideation.sources(),
    queryFn: () => api.get<IngestSource[]>('/ideation/sources'),
    refetchInterval: 60_000,
  });
}

export function useSyncDestinations(): UseQueryResult<SyncDestination[]> {
  return useQuery({
    queryKey: queryKeys.ideation.destinations(),
    queryFn: () => api.get<SyncDestination[]>('/ideation/destinations'),
    refetchInterval: 60_000,
  });
}

export function useMarketSignals(): UseQueryResult<MarketSignal[]> {
  return useQuery({
    queryKey: queryKeys.ideation.marketSignals(),
    queryFn: () => api.get<MarketSignal[]>('/ideation/market-signals'),
    refetchInterval: 300_000,
  });
}

export function useCustomerVoiceClusters(): UseQueryResult<CustomerVoiceCluster[]> {
  return useQuery({
    queryKey: queryKeys.ideation.voiceClusters(),
    queryFn: () => api.get<CustomerVoiceCluster[]>('/ideation/voice-clusters'),
    refetchInterval: 300_000,
  });
}

// --- Pipeline workflow (2) ---------------------------------------------------

export function useRunPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { idea_id: string }) =>
      api.post<{ run_id: string }>('/ideation/workflows/run', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ideation.ideas() });
    },
  });
}

export function usePipelineStatus(run_id: string | null): UseQueryResult<{ status: string; steps: { id: string; status: string }[] }> {
  return useQuery({
    queryKey: ['ideation-pipeline-status', run_id],
    queryFn: () => api.get<{ status: string; steps: { id: string; status: string }[] }>(`/ideation/workflows/${run_id}/status`),
    enabled: Boolean(run_id),
    refetchInterval: 5_000,
  });
}
```

The four missing backend endpoints (sources, destinations, market-signals, voice-clusters) **may not exist yet** — verify by checking `backend/app/api/v1/ideation/` for those routers. If they don't exist, the hooks should use a "stub" TanStack query that returns `[]`:

```typescript
export function useIngestSources(): UseQueryResult<IngestSource[]> {
  return useQuery({
    queryKey: queryKeys.ideation.sources(),
    queryFn: async () => {
      try {
        return await api.get<IngestSource[]>('/ideation/sources');
      } catch {
        return [];  // endpoint may not exist yet
      }
    },
    refetchInterval: 60_000,
  });
}
```

**Important:** this is the "honest about what works" pattern. The 4 unwired tabs are still labeled Planned in this step (sources/destinations/market/voice). The page works; the tabs that have backend coverage show real data; the tabs that don't show an empty state with a "Coming soon" tooltip. Don't fabricate.

## ZONE 3 — Wire `ideation/page.tsx` to TanStack hooks

Replace the 5 generic `useApiData` calls with the new per-endpoint hooks:

```typescript
import {
  useIdeas, useRoadmaps, usePRDs, useArchPreviews, useIdeationApprovals,
  useIngestSources, useSyncDestinations, useMarketSignals, useCustomerVoiceClusters,
} from '@/lib/api/ideation-hooks';

const ideasRes = useIdeas();           // was: useApiData('/v1/ideation/ideas')
const roadmapsRes = useRoadmaps();     // was: useApiData('/v1/ideation/roadmap')
const prdsRes = usePRDs();             // was: useApiData('/v1/ideation/prds')
const previewsRes = useArchPreviews(); // was: useApiData('/v1/ideation/arch-previews')
const approvalsRes = useIdeationApprovals(); // was: useApiData('/v1/ideation/approvals')
```

For the 4 missing tabs, **add the new hook calls** (each with their loading state):

```typescript
const sourcesRes = useIngestSources();
const destinationsRes = useSyncDestinations();
const marketRes = useMarketSignals();
const voiceRes = useCustomerVoiceClusters();
```

Pass `sourcesRes.data` to `<SourcesTab>`, `destinationsRes.data` to `<DestinationsTab>`, etc. Each tab component needs a new prop to receive the data — add it as an optional prop, default to fixture for backward compat.

The **status name adapter** applies at the Idea level. In the page (or in `IdeaKanban.tsx`), wrap ideas through the adapter:

```typescript
import { apiStatusToUi, uiStatusToApi } from '@/lib/ideation/adapter';

const uiIdeas = React.useMemo(
  () => (ideasRes.data?.items ?? []).map(i => ({
    ...i,
    status: apiStatusToUi(i.status),  // backend enum -> UX name
  })),
  [ideasRes.data],
);
```

When the user moves a card across the kanban, the inverse happens:

```typescript
const updateIdea = useUpdateIdea();
const moveIdea = (idea: UiIdea, toColumn: UiStatus) => {
  updateIdea.mutate({
    id: idea.id,
    body: { status: uiStatusToApi(toColumn) },
  });
};
```

## ZONE 4 — `IngestIndicator` real data

Currently `IngestIndicator` reads from a static `ingestStatus` prop. Replace with a hook:

```typescript
// New hook — backend has a /ideation/ingest/status endpoint
export function useIngestStatus() {
  return useQuery({
    queryKey: ['ideation-ingest-status'],
    queryFn: () => api.get<{
      status: 'idle' | 'running' | 'error';
      ideas_created_today: number;
      last_run_at: string | null;
    }>('/ideation/ingest/status'),
    refetchInterval: 30_000,
  });
}
```

The page replaces the static `ingestStatus` prop with `ingest.data.status`, `ingest.data.ideas_created_today`, `ingest.data.last_run_at`.

If `/ideation/ingest/status` doesn't exist, the indicator stays static for now (add it to the "endpoint may not exist yet" try/catch pattern).

## ZONE 5 — WebSocket wire-up

The backend has `backend/app/api/ws/ideation/workflow.py` (verified). The frontend needs a subscriber.

Create `apps/forge/lib/ideation/use-pipeline-ws.ts`:

```typescript
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/ideation';

/**
 * WebSocket subscriber for live pipeline updates.
 *
 * The backend `backend/app/api/ws/ideation/workflow.py` pushes
 * messages of the form:
 *   { type: 'pipeline.step', run_id, step_id, status }
 *   { type: 'pipeline.done', run_id, status }
 *
 * We invalidate the relevant TanStack queries on each message.
 */
export function usePipelineWS(run_id: string | null) {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (!run_id) return;
    const url = `/api/ws/ideation/workflow?run_id=${encodeURIComponent(run_id)}`;
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'pipeline.step' || msg.type === 'pipeline.done') {
        qc.invalidateQueries({ queryKey: ['ideation-pipeline-status', run_id] });
        if (msg.type === 'pipeline.done') {
          qc.invalidateQueries({ queryKey: queryKeys.ideation.ideas() });
        }
      }
    };
    return () => ws.close();
  }, [run_id, qc]);
}
```

The page wires this in when the user has a pipeline run open:

```typescript
usePipelineWS(activeRunId);
```

## ZONE 6 — KG-graph stub (defer)

The 3 `/ideation/kg-graph` routes are stubs. The frontend `ArchPreviewGraph` component shows a hardcoded graph. **Don't touch either** in this step. Add a TODO comment:

```typescript
// TODO(step70+): wire ArchPreviewGraph to /ideation/kg-graph
// For now, use the local graph fixture.
```

This is a separate prompt.

## ZONE 7 — Tests + YAML

### `apps/forge/__tests__/ideation-hooks.test.tsx`

Vitest test for the new hooks module. Pattern: see `apps/forge/__tests__/knowledge-hooks.test.tsx`. Test that:

- `useIdeas()` calls `/ideation/ideas` and parses `IdeaListResponse`
- `useIdea(id)` calls `/ideation/ideas/{id}`
- `useCreateIdea()` POSTs and invalidates the `ideas` query key
- `useUpdateIdea()` PATCHes and updates the per-idea query key
- `useDecideIdeationApproval()` POSTs and invalidates the `approvals` query key

### `apps/forge/__tests__/ideation-adapter.test.ts`

Adapter test (small, no MSW needed):

```typescript
import { apiStatusToUi, uiStatusToApi } from '@/lib/ideation/adapter';

describe('ideation adapter', () => {
  it('maps backend enums to UI names', () => {
    expect(apiStatusToUi('NEW')).toBe('intake');
    expect(apiStatusToUi('ANALYZING')).toBe('scoring');
    expect(apiStatusToUi('SCORED')).toBe('discovery');
    expect(apiStatusToUi('IN_ROADMAP')).toBe('prd');
    expect(apiStatusToUi('APPROVED')).toBe('approved');
    expect(apiStatusToUi('REJECTED')).toBe('rejected');
    expect(apiStatusToUi('ARCHIVED')).toBe('rejected');  // intentional
  });
  it('maps UI names to backend enums', () => {
    expect(uiStatusToApi('intake')).toBe('NEW');
    expect(uiStatusToApi('scoring')).toBe('ANALYZING');
    expect(uiStatusToApi('discovery')).toBe('SCORED');
    expect(uiStatusToApi('prd')).toBe('IN_ROADMAP');
  });
  it('roundtrips through the adapter', () => {
    for (const ui of ['intake', 'scoring', 'discovery', 'prd', 'approved', 'rejected'] as const) {
      expect(apiStatusToUi(uiStatusToApi(ui))).toBe(ui);
    }
  });
});
```

### `backend/tests/api/v1/test_ideation.py` (NEW)

```python
"""HTTP-layer integration tests for Ideation (Phase 8).

The Ideation API has 54 routes across 12 sub-routers. This test
exercises the public surface: ideas, roadmaps, PRDs, arch previews,
approvals. Sources/destinations/market/voice are stub endpoints
(planned for step 70+).
"""

# tests for: list/create/update/delete ideas
# tests for: list roadmaps
# tests for: list PRDs
# tests for: list arch previews
# tests for: list + decide approvals
# tenant isolation test
```

### `built-features.yaml` — flip both rows

```yaml
- area: Centers
  order: 16
  feature: Ideation
  steps: ["28", "5", "69"]
  status: Production
  docs: centers/ideation

- area: Integration
  order: 47
  feature: "Phase 8 — Ideation (uses forge-pi)"
  steps: ["69"]
  status: Production
  docs: centers/ideation
```

## CONSTRAINTS

- **No schema migration.** All Pydantic schemas are stable.
- **Don't fabricate endpoints.** If a backend route doesn't exist (sources, destinations, market, voice), the hook should gracefully return `[]` and the tab should show an empty state with a "Coming soon" hint.
- **Status name adapter is mandatory** at the page boundary. Don't sprinkle `apiStatusToUi` calls inside individual components; do it once at the page level.
- **Tenant scoping (Rule 2)** — every hook URL passes through `api` which adds `x-forge-tenant-id`.
- **Permission gates** — `useDecideIdeationApproval`, `useUpdateIdea`, `useDeleteIdea`, `useUpsertRoadmap` mutations should be permission-checked on the backend. The frontend doesn't gate them; the backend 403s if the principal lacks the role.
- **Dark theme only** — reuse existing `--accent-cyan`, `--accent-rose`, etc. tokens.
- **Don't touch the Ideation Board component internals** (`IdeationBoard.tsx`, `IdeaKanban.tsx`, etc.). The page-level adapter absorbs the API schema. The components continue to receive the `Idea` type they expect.
- **Don't add a new test framework.** Use existing Vitest.
- **Don't change the WS protocol.** Backend pushes `{type, run_id, ...}`; frontend parses that shape.

## DELIVERABLE

Modified:
- [ ] `apps/forge/lib/ideation/adapter.ts` (NEW) — status name adapter
- [ ] `apps/forge/lib/api/ideation.ts` (NEW) — TypeScript types + query keys
- [ ] `apps/forge/lib/api/ideation-hooks.ts` (NEW) — 24 hooks
- [ ] `apps/forge/lib/ideation/use-pipeline-ws.ts` (NEW) — WS subscriber
- [ ] `apps/forge/app/ideation/page.tsx` — replace useApiData with hooks, add 4 missing tabs
- [ ] `apps/forge/components/ideation/IngestIndicator.tsx` — real data
- [ ] `built-features.yaml` — flip rows 16 + 47 to `Production`

Created:
- [ ] `apps/forge/__tests__/ideation-hooks.test.tsx` (NEW)
- [ ] `apps/forge/__tests__/ideation-adapter.test.ts` (NEW)
- [ ] `backend/tests/api/v1/test_ideation.py` (NEW)

Verify:
- [ ] `pytest tests/api/v1/test_ideation.py -v` — all pass
- [ ] `npx vitest run __tests__/ideation-` — both test files pass
- [ ] `npx tsc --noEmit` — 0 new errors
- [ ] `bash scripts/generate-built-features.sh --check` — no drift
- [ ] `python3 scripts/check-feature-docs.py` — 41 passed, 0 missing
- [ ] End-to-end: open `http://localhost:3000/ideation`; verify each of 9 tabs loads (5 with real data, 4 with empty state + "coming soon" hint)

## "What we deliberately did NOT do"

- **Did not build the 4 missing backend endpoints** (sources, destinations, market, voice) — that's a backend step, separate prompt
- **Did not wire the LLM scoring call** — scoring route exists, but the actual LLM call is forge-pi territory
- **Did not add a PRD markdown editor** — separate prompt
- **Did not add Jira push UI** — `POST /v1/ideation/push/{idea_id}` works but the button is omitted
- **Did not migrate the 12 components** (`IdeationBoard`, `IdeaDetailPanel`, etc.) — they keep their current types; the page-level adapter handles the divergence
- **Did not implement the Arch Preview mermaid renderer** — `ArchPreviewGrid` shows titles; the graph itself is a follow-up
- **Did not change the WebSocket protocol** — backend already settled it

---

**Total scope:** ~1.5 weeks focused work for 1 engineer. ~1500 lines frontend + ~400 lines tests + ~50 lines YAML.

The 4 unwired tabs (Sources, Destinations, Market, Voice) are the **honest gap**. We expose them in the UI but mark them "Coming soon" until the backend ships those routes. Better to ship a partial-but-honest Production than to claim 9/9 when only 5/9 have backend data.

Tell me to ship it and I'll walk zones in order: **1 (types) → 2 (hooks) → 3 (page rewire) → 4 (IngestIndicator) → 5 (WS) → 6 (KG stub defer) → 7 (tests + YAML)**. Or name a zone to inspect first.