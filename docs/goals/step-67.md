# Step 67 — Phase 6 Knowledge Graph Wiring

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~1 week (5 focused zones)
> **Phase:** 6 — Knowledge Graph (currently `Planned` in `built-features.yaml`)
> **Goal:** Connect the existing `Knowledge Center` UI (`apps/forge/app/knowledge-center/page.tsx`) to the existing 9 backend routes; flip `Planned` → `Production`

## /goal

The `built-features.yaml` row reads:

> Phase 6 — Knowledge Graph (Cypher + vector search) | — | **Planned**

The **honest** reason for `Planned` (verified during this session's investigation):

| Layer | State |
|---|---|
| Backend: 9 routes in `backend/app/api/v1/knowledge_graph.py` | ✅ Built (this session audited: nodes list/detail, edges, cypher, sql, hybrid, vector, stats, plus a couple of sub-routes) |
| Backend: Pydantic schemas (KGNodeRead, KGEdgeRead, KGStats, KGFreshnessInfo, CypherQueryRequest, SQLQueryRequest, HybridQueryRequest, VectorSearchRequest) | ✅ Built in `schemas/project_intelligence.py` |
| Backend: Service layer (`knowledge_graph_service.list_nodes`, etc.) | ✅ Built |
| Frontend: 12 UI components in `apps/forge/components/knowledge-graph/` (`KnowledgeGraphCanvas`, `NodeInspectorPanel`, `FiltersDrawer`, etc.) | ✅ Built but untyped against backend |
| Frontend: `apps/forge/app/knowledge-center/page.tsx` | ⚠️ Imports **`SAMPLE_GRAPH`** (a static fixture from `@/src/data/sample-graph`). It renders the canvas but **never calls any backend route**. Refresh → still static. |
| Frontend: TanStack hooks for KG (useKGSearch, useKGStats, useKGQuery, etc.) | 🔴 **Missing** (this is the actual gap) |
| Frontend: TypeScript types matching backend Pydantic | 🔴 **Missing** |

**Goal of this step:** ship a `useKnowledgeCenter()` hook module, type the existing UI components against the backend, route `Knowledge Center` through the real backend. Delete the `SAMPLE_GRAPH` fallback. Flip `Planned` → `Production`.

## What you'll SEE after this step

- `http://localhost:3000/knowledge-center` loads in ~500ms
- Real nodes + edges from the tenant's KG (Cypher query under the hood)
- The "Stats" tab shows real `node_count`, `edge_count`, `node_types`/`edge_types` distributions
- The search bar calls `/knowledge/search/vector` (or `/knowledge/nodes` for keyword) — your KG nodes come back, not a fixture
- Picking a node opens `NodeInspectorPanel` with real properties from `KGNodeRead.properties`
- Refreshing the page shows the same data (because it's real)
- All 9 backend routes are exercised at least once per session
- `pytest tests/test_workflow_executor.py -v` still passes (no regressions)

## What you'll NOT see (out of scope, deliberately)

- Building a new KG ingestion pipeline (already shipped in earlier phases; this step reads what exists)
- Adding embeddings generation (assumed upstream service is in place; backend route is already there)
- Wiring the OLD `apps/forge/components/knowledge/KnowledgeGraphView.tsx` (the older single-component file) — we wire the **newer** `knowledge-graph/` set since the page already imports from it
- Vector search UI for arbitrary embedding input — `useKGVectorSearch` reads an `embedding: number[]` you pass in; the search-input box is keyword only
- Visual graph rendering per-node type (icons + colors are already defined in `graph-palette.ts`; don't add new ones)

## Files to read FIRST (in this order)

1. `/workspace/prompts/step66-phase4-production.md` — newest prompt, matches this one's zone structure
2. `/workspace/prompts/step57p5-dashboard-real.md` — see how we did Phase 5 with the same pattern (hook module + typed schemas + mappers)
3. `backend/app/api/v1/knowledge_graph.py` — the 9 routes. Print the file, mark each route and its query params.
4. `backend/app/schemas/project_intelligence.py` — the 8 Pydantic schemas (KGNodeRead, KGEdgeRead, KGStats, KGFreshnessInfo, CypherQueryRequest, SQLQueryRequest, HybridQueryRequest, VectorSearchRequest)
5. `apps/forge/app/knowledge-center/page.tsx` — see how `SAMPLE_GRAPH` is used today; you'll delete that import
6. `apps/forge/components/knowledge-graph/KnowledgeGraphCanvas.tsx` — main visual component
7. `apps/forge/components/knowledge-graph/NodeInspectorPanel.tsx` — the panel that shows node properties
8. `apps/forge/components/knowledge-graph/graph-palette.ts` — `ALL_KINDS`, `EDGE_COLOR`, `KIND_COLOR` — the visual config; don't change these
9. `apps/forge/lib/api/client.ts` — `api.get<T>(path, opts)` shape; mirror how `lib/api/dashboard-hooks.ts` does it
10. `/workspace/docs/features/knowledge-center.md` — feature doc; update if behavior changes

## ZONE 1 — Type definitions + query keys

Create `apps/forge/lib/api/knowledge.ts` (mirror `lib/api/dashboard.ts`):

```typescript
/**
 * Knowledge Graph (Phase 6) frontend types — mirror the Pydantic
 * schemas in `backend/app/schemas/project_intelligence.py`.
 *
 * Lock-step rule: if backend type changes, this file changes.
 */

export type KGNodeType =
  | 'service' | 'team' | 'document' | 'adr' | 'story' | 'idea'
  | 'run' | 'agent' | 'approval' | 'connector' | 'org';
// The actual list of node_type strings comes from
// backend.app.schemas.project_intelligence.GKNodeRead.node_type
// (open string), but we narrow on the frontend for graph rendering.

export interface KGNode {
  id: string;
  node_type: string;          // KGNodeRead.node_type
  name: string;
  properties: Record<string, unknown>;
  tenant_id: string;
  project_id: string;
  repo_id: string | null;
  freshness_at: string | null;
  freshness_source: string | null;
  created_at: string;
  updated_at: string;
}

export interface KGEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KGStats {
  node_count: number;
  edge_count: number;
  node_types: Record<string, number>;
  edge_types: Record<string, number>;
}

export interface KGFreshnessInfo {
  node_id: string;
  status: string;
  freshness_at: string | null;
  freshness_source: string | null;
  age_seconds: number | null;
}

export interface CypherQueryRequest {
  query: string;
  params?: Record<string, unknown>;
}
export interface SQLQueryRequest {
  query: string;
  params?: Record<string, unknown>;
}
export interface HybridQueryRequest {
  cypher: string;
  sql: string;
  params?: Record<string, unknown>;
}
export interface VectorSearchRequest {
  embedding: number[];
  top_k?: number;
}

export const queryKeys = {
  kg: {
    all: ['kg'] as const,
    nodes: (filter?: { project_id?: string; type?: string }) =>
      [...queryKeys.kg.all, 'nodes', filter ?? {}] as const,
    node: (id: string) => [...queryKeys.kg.all, 'node', id] as const,
    edges: (filter?: { project_id?: string; type?: string; from?: string; to?: string }) =>
      [...queryKeys.kg.all, 'edges', filter ?? {}] as const,
    stats: (project_id?: string) =>
      [...queryKeys.kg.all, 'stats', project_id ?? null] as const,
    search: (q: string, top_k?: number) =>
      [...queryKeys.kg.all, 'search', q, top_k ?? 10] as const,
    vectorSearch: (embedding_len: number, top_k: number) =>
      [...queryKeys.kg.all, 'vector-search', embedding_len, top_k] as const,
    freshness: (node_id: string) =>
      [...queryKeys.kg.all, 'freshness', node_id] as const,
  },
};
```

## ZONE 2 — TanStack Query hooks

Create `apps/forge/lib/api/knowledge-hooks.ts` (mirror `lib/api/dashboard-hooks.ts`):

```typescript
/**
 * Knowledge Graph hooks — Phase 6, step 67.
 *
 *   - `useKGNodeList(filter)`          — list nodes (tenant-scoped)
 *   - `useKGNode(id)`                  — single node detail
 *   - `useKGEdgeList(filter)`          — list edges
 *   - `useKGStats(project_id?)`        — aggregate counts + type distributions
 *   - `useKGSearch(query, top_k)`      — keyword search via /search/vector
 *   - `useKGVectorSearch(embedding, ...)` — semantic search
 *   - `useKGKGFreshness(node_id)`      — drift flag for a node
 *   - `useKGCypher(query, params)`     — ad-hoc cypher (admin-only)
 *   - `useKGSQL(query, params)`        — ad-hoc SQL (admin-only)
 *   - `useKGHybrid({cypher, sql})`     — hybrid lookup (admin-only)
 *
 * Pattern mirrors `lib/api/dashboard-hooks.ts`:
 *   - Tenant scoping (Rule 2) via `forge-api.ts`
 *   - Stale-while-revalidate: nodes 30s, stats 60s, freshness 5m
 *   - Mutations invalidate the relevant query keys
 *
 * Permissions: read-only hooks need `kg:read`. Cypher/SQL/hybrid
 * hooks also need `kg:admin` (Rule 1 surface) — pass `enabled: false`
 * unless the principal has that permission. The auth store's role
 * claim is the gate.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  queryKeys, type CypherQueryRequest, type HybridQueryRequest,
  type KGEdge, type KGFreshnessInfo, type KGNode, type KGStats,
  type SQLQueryRequest, type VectorSearchRequest,
} from './knowledge';

export function useKGNodeList(filter?: { project_id?: string; type?: string }): UseQueryResult<KGNode[]> {
  return useQuery({
    queryKey: queryKeys.kg.nodes(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter?.project_id) params.set('project_id', filter.project_id);
      if (filter?.type) params.set('type', filter.type);
      const qs = params.toString();
      return api.get<KGNode[]>(`/knowledge/nodes${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: 30_000,
  });
}

export function useKGNode(id: string | null | undefined): UseQueryResult<KGNode> {
  return useQuery({
    queryKey: queryKeys.kg.node(id ?? ''),
    queryFn: () => api.get<KGNode>(`/knowledge/nodes/${id}`),
    enabled: Boolean(id),
  });
}

export function useKGEdgeList(filter?: { project_id?: string; type?: string }): UseQueryResult<KGEdge[]> {
  return useQuery({
    queryKey: queryKeys.kg.edges(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter?.project_id) params.set('project_id', filter.project_id);
      if (filter?.type) params.set('type', filter.type);
      const qs = params.toString();
      return api.get<KGEdge[]>(`/knowledge/edges${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: 60_000,
  });
}

export function useKGStats(project_id?: string): UseQueryResult<KGStats> {
  return useQuery({
    queryKey: queryKeys.kg.stats(project_id),
    queryFn: () => {
      const qs = project_id ? `?project_id=${project_id}` : '';
      return api.get<KGStats>(`/knowledge/stats${qs}`);
    },
    refetchInterval: 60_000,
  });
}

export function useKGFreshness(node_id: string): UseQueryResult<KGFreshnessInfo> {
  return useQuery({
    queryKey: queryKeys.kg.freshness(node_id),
    queryFn: () => api.get<KGFreshnessInfo>(`/knowledge/nodes/${node_id}/freshness`),
    enabled: Boolean(node_id),
    refetchInterval: 300_000,  // 5 minutes (cheap, backend cached)
  });
}

export function useKGCypher(
  req: CypherQueryRequest | null,
  enabled: boolean = true,
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['kg-cypher', req?.query],
    queryFn: () => api.post<unknown>('/knowledge/query/cypher', req),
    enabled: Boolean(req?.query) && enabled,
    staleTime: Infinity, // do not poll admin queries
  });
}

export function useKGSQL(
  req: SQLQueryRequest | null,
  enabled: boolean = true,
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['kg-sql', req?.query],
    queryFn: () => api.post<unknown>('/knowledge/query/sql', req),
    enabled: Boolean(req?.query) && enabled,
    staleTime: Infinity,
  });
}

export function useKGHybrid(
  req: HybridQueryRequest | null,
  enabled: boolean = true,
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['kg-hybrid', req?.cypher, req?.sql],
    queryFn: () => api.post<unknown>('/knowledge/query/hybrid', req),
    enabled: Boolean(req?.cypher) && Boolean(req?.sql) && enabled,
    staleTime: Infinity,
  });
}

export function useKGVectorSearch(
  embedding: number[] | null,
  top_k: number = 10,
): UseQueryResult<KGNode[]> {
  const body: VectorSearchRequest | null =
    embedding ? { embedding, top_k } : null;
  return useQuery({
    queryKey: queryKeys.kg.vectorSearch(embedding?.length ?? 0, top_k),
    queryFn: () => api.post<KGNode[]>('/knowledge/search/vector', body!),
    enabled: Boolean(body),
    staleTime: 60_000,
  });
}
```

(Implement pagination + refresh mutation hooks as needed. The list above is the minimum needed to flip `Production`.)

## ZONE 3 — Wire `Knowledge Center` page to real data

`apps/forge/app/knowledge-center/page.tsx` changes:

1. **Remove** the import of `SAMPLE_GRAPH` from `@/src/data/sample-graph`. **Remove** `React.useState<...>(SAMPLE_GRAPH.nodes)` and similar.

2. **Add** the hooks:
   ```typescript
   import {
     useKGNodeList, useKGEdgeList, useKGStats,
   } from '@/lib/api/knowledge-hooks';
   ```

3. **Replace** the state with hooks:
   ```typescript
   const { data: backendNodes = [], isLoading: nodesLoading } = useKGNodeList();
   const { data: backendEdges = [], isLoading: edgesLoading } = useKGEdgeList();
   const { data: stats, isLoading: statsLoading } = useKGStats();
   ```

4. **Adapt** `SampleNode[]` → `KGNode[]` in the props passed to `KnowledgeGraphCanvas`. The graph component already accepts `{ nodes, edges, ... }` so the rename is mechanical.

5. **Stats tab** now reads from `useKGStats()` — wire it to the existing stats panel.

6. **Empty state**: show `<GraphEmptyState />` when `nodesLoading === false && backendNodes.length === 0`. Today the empty state is hardcoded.

7. **Loading state**: while `nodesLoading || edgesLoading || statsLoading`, show a top-of-canvas `Loader2` spinner (already styled in the existing CSS as `.kg-loading`).

8. **Error state**: if any hook returns `isError`, show the existing `<GraphEmptyState />` with the error variant (prop: `errorMessage`). Surface via `toast.error()`.

If `KnowledgeGraphCanvas` doesn't take `KGNode[]` props today (it currently takes `SampleNode[]`), add an adapter in the page:

```typescript
const nodes: SampleNode[] = React.useMemo(() => backendNodes.map(n => ({
  id: n.id,
  label: n.name,
  kind: mapNodeType(n.node_type),
  // ...copy minimal fields the canvas needs
})), [backendNodes]);
```

**Constraint:** don't modify `KnowledgeGraphCanvas` itself unless absolutely necessary. The canvas component is ~700 lines; we don't want to risk regressions. Adapter at the page level.

## ZONE 4 — Node inspector panel real data

`apps/forge/components/knowledge-graph/NodeInspectorPanel.tsx` currently shows mock data. Replace with:

```typescript
import { useKGNode, useKGFreshness } from '@/lib/api/knowledge-hooks';

export function NodeInspectorPanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const { data: node, isLoading, error } = useKGNode(nodeId);
  const { data: freshness } = useKGFreshness(nodeId);
  // ... render name, type, properties, freshness_source, freshness_at, etc.
  // Light a cyan dot if freshness?.status === 'fresh', amber if 'stale', red if 'unknown'.
}
```

The `properties` field of `KGNode` is `Record<string, unknown>` — render a key/value table. If properties is empty, hide the section.

For the **edge panel**, similar adapter: when a user clicks an edge, capture the edge ID, pass it to a new `EdgeInspectorPanel` (or extend `NodeInspectorPanel` with an `edgeId?` variant). Use `useQuery` against `/knowledge/edges/{id}` if that route exists; otherwise inline lookup via `useKGEdgeList`'s cache.

## ZONE 5 — Tests + YAML

### `apps/forge/__tests__/knowledge-hooks.test.tsx`

A small Vitest test for the hook module — uses MSW to mock `/knowledge/nodes`. Pattern: look at `apps/forge/__tests__/dashboard-mappers.test.ts` for the shape.

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useKGNodeList, useKGStats } from '@/lib/api/knowledge-hooks';

describe('knowledge hooks', () => {
  it('useKGNodeList calls /knowledge/nodes', async () => {
    // MSW handler returns a 2-node fixture
    // Render hook; assert both nodes land in result.data
  });
  it('useKGStats returns node_count + edge_count', async () => {
    // Similar
  });
});
```

### `backend/tests/api/test_knowledge_graph.py` (HTTP layer, exists? probably yes)

Verify the integration tests cover all 9 routes:

```bash
pytest tests/api/ -k "knowledge" -v
```

If they don't exist, add `tests/api/v1/test_knowledge_graph.py` with one test per route, mirroring `tests/api/v1/test_dashboard_v2.py`.

### `built-features.yaml` flip

```yaml
  - area: Integration
    order: 45
    feature: "Phase 6 — Knowledge Graph (Cypher + vector search)"
    steps: []
    status: Planned   ← flip to: Production
    docs: centers/knowledge
```

Then:

```bash
bash scripts/generate-built-features.sh
python3 scripts/check-feature-docs.py
```

Both must pass: `41 passed, 0 missing`.

### `/workspace/docs/features/knowledge-center.md` (small update)

Add one section near the top: "Phase 6 wired (2026-06-30) — Knowledge Center reads from `/api/v1/knowledge/*`; previously it rendered a static `SAMPLE_GRAPH` fixture. See `/workspace/prompts/step67-phase6-knowledge-graph.md`."

## CONSTRAINTS

- **No schema migration.** Backend is complete. We're only wiring frontend hooks.
- **Delete `SAMPLE_GRAPH`** — the static fixture is the actual problem we're solving. Don't leave it "as fallback" — that defeats the point. If a tenant has zero KG rows, show the empty state, not the fixture.
- **Don't change `graph-palette.ts`** — colors and labels are already correct.
- **Don't change the canvas component** unless absolutely necessary. The page-level adapter absorbs the schema mismatch. If the canvas does need a tweak (e.g. `KGNode[]` ↔ `SampleNode[]` icon mapping helper), do it **in a new file** `apps/forge/lib/knowledge/node-adapter.ts` (testable, isolated).
- **Tenant scoping (Rule 2)** — every hook URL passes through `api` which adds `x-forge-tenant-id`. Don't bypass.
- **Permission gates** — cypher/SQL/hybrid hooks should fail closed: `enabled` defaults to `false` unless the principal has the `kg:admin` permission. Don't try to enforce this server-side on the backend; the backend already does. The hook gate is a UX nicety (don't show cypher tools to non-admins).
- **Dark theme only.** KG palette already ships `--accent-cyan`/`--accent-rose`/`--accent-amber`. Reuse; don't add new tokens.
- **Don't add new tests for the canvas component** unless something breaks. The existing canvas tests should still pass; we're only changing how it's wired.

## DELIVERABLE

Modified:
- [ ] `apps/forge/lib/api/knowledge.ts` (NEW)
- [ ] `apps/forge/lib/api/knowledge-hooks.ts` (NEW)
- [ ] `apps/forge/app/knowledge-center/page.tsx` — remove `SAMPLE_GRAPH`, wire hooks
- [ ] `apps/forge/components/knowledge-graph/NodeInspectorPanel.tsx` — real data
- [ ] `built-features.yaml` — Planned → Production on Phase 6

Created:
- [ ] `apps/forge/lib/knowledge/node-adapter.ts` (NEW, if adapter needed)
- [ ] `apps/forge/__tests__/knowledge-hooks.test.tsx` (NEW, ~80 lines)
- [ ] `backend/tests/api/v1/test_knowledge_graph.py` (NEW if doesn't exist)

Verify:
- [ ] `pytest tests/api/ -k knowledge -v` — all routes pass (if test file added)
- [ ] `npx tsc --noEmit` — 0 new errors in any of the touched files
- [ ] `bash scripts/generate-built-features.sh --check` — no drift
- [ ] `python3 scripts/check-feature-docs.py` — 41 passed, 0 missing
- [ ] End-to-end: `curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/knowledge/nodes` returns real nodes for `arun@acme-corp.com`
- [ ] Open `http://localhost:3000/knowledge-center` in browser; verify canvas shows real nodes (not `SAMPLE_GRAPH`)
- [ ] Open `/runs` → click a run → see "related entities" tab if it exists; should be wired automatically by the stats refetch

## "What we deliberately did NOT do"

- **Did not build a new ingestion pipeline.** Read what exists.
- **Did not change the canvas component.** Adapter at the page level.
- **Did not refactor `SAMPLE_GRAPH` to a "dev mode" toggle.** Delete it. Static fixtures lying around are exactly the debt this step eliminates.
- **Did not change `graph-palette.ts`** — colors are correct.
- **Did not add a new test framework.** Use the existing Vitest config.
- **Did not change the SSE/streaming path for vector search.** `/search/vector` is a regular POST.

---

**Total scope:** ~5 days focused work for 1 engineer. ~600 lines frontend + ~150 lines tests + ~50 lines YAML.

Tell me to ship it and I'll walk zones in order: **1 (types) → 2 (hooks) → 3 (page) → 4 (inspector) → 5 (tests + YAML)**. Or tell me **which zone to inspect first** if anything needs detail.