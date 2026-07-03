'use client';

/**
 * React Query hooks for the Knowledge Graph — Step 57 zone 2.
 *
 * Mirrors the pattern established by `useConnectors.ts`:
 *   - Typed fetchers are not separated into an `api.ts` (the KG has
 *     six endpoints, all simple, all under `/kg/*`). The hook file
 *     owns the URL contract and stays the single source of truth.
 *   - Stable query keys live alongside the types so consumers can
 *     invalidate from a mutation without re-typing the key string.
 *   - Tenant / auth headers are injected by the shared `api` client
 *     (`lib/api/client.ts`) — Rule 2 is enforced by the transport,
 *     not duplicated in each hook.
 *   - Search input is debounced at the call-site (typically 250ms);
 *     the hook itself does NOT debounce. The query key includes the
 *     current search string so stale queries stop re-rendering when
 *     the input changes mid-flight.
 *
 * Endpoints (all relative to FORGE_API_BASE_URL):
 *   GET  /kg/nodes                       useKGNodes(filters?)
 *   GET  /kg/nodes/{id}                  useKGNode(id)
 *   GET  /kg/edges                       useKGEdges(filters?)
 *   GET  /kg/stats                       useKGStats()
 *   POST /kg/search/vector               useVectorSearch()
 *   POST /kg/query/cypher                useCypherQuery()
 *
 * Mutations are intentionally omitted — every KG mutation in v1 happens
 * through ingestion pipelines (backed by `forge-pi`), not from the UI.
 * The Knowledge Center is read-mostly.
 */

import { useMutation, useQuery } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api/client';

import {
  kgQueryKeys,
  type CypherQueryInput,
  type CypherQueryResult,
  type HybridQueryInput,
  type KGEdge,
  type KGFilters,
  type KGFreshnessInfo,
  type KGNode,
  type KGStats,
  type SQLQueryInput,
  type SQLQueryResult,
  type VectorSearchInput,
} from '@/lib/knowledge-graph/types';

// ---------------------------------------------------------------------------
// Query-string helper
// ---------------------------------------------------------------------------

/**
 * Build a URLSearchParams from KGFilters. `kind` is sent as `?type=`
 * because the FastAPI handler uses `Query(alias="type")` (see
 * `backend/app/api/v1/knowledge_graph.py`). Empty / undefined fields
 * are dropped so the backend sees a clean request.
 */
function toQueryString(filters?: KGFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.kind) params.set('type', filters.kind);
  if (filters.search) params.set('search', filters.search);
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (typeof filters.limit === 'number') {
    params.set('limit', String(filters.limit));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List nodes, optionally narrowed by kind + search. */
export function useKGNodes(filters?: KGFilters) {
  return useQuery<KGNode[], ApiError>({
    queryKey: kgQueryKeys.list(filters),
    queryFn: () => api.get<KGNode[]>(`/kg/nodes${toQueryString(filters)}`),
    // The KG changes on ingestion runs, not on user action — a 60s
    // stale time keeps the graph snappy without thrashing the API.
    staleTime: 60_000,
  });
}

/** Single node by id. No-op when id is missing. */
export function useKGNode(id: string | null | undefined) {
  return useQuery<KGNode, ApiError>({
    queryKey: kgQueryKeys.detail(id ?? ''),
    queryFn: () => api.get<KGNode>(`/kg/nodes/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** List edges, optionally narrowed by kind + search. */
export function useKGEdges(filters?: KGFilters) {
  return useQuery<KGEdge[], ApiError>({
    queryKey: kgQueryKeys.edgeList(filters),
    queryFn: () => api.get<KGEdge[]>(`/kg/edges${toQueryString(filters)}`),
    staleTime: 60_000,
  });
}

/** Graph-wide stats (node_count, edge_count, type histograms). */
export function useKGStats(project_id?: string) {
  return useQuery<KGStats, ApiError>({
    queryKey: kgQueryKeys.stats(project_id),
    queryFn: () =>
      api.get<KGStats>(`/kg/stats${toQueryString({ project_id })}`),
    // Stats are the cheapest endpoint — keep them warm so the
    // Knowledge Center header KPIs never flash a spinner on revisit.
    staleTime: 30_000,
  });
}

/**
 * Vector similarity search. Mutation (POST) rather than useQuery because
 * the input includes a full embedding array — treating it as a query
 * would shove the embedding into the cache key, which is both expensive
 * and (in many apps) a privacy concern. The hook still returns the
 * cached last-result on re-mount thanks to TanStack Query's mutation
 * cache, but we do not poll.
 *
 * Callers MUST compute the embedding themselves (typically via a
 * co-pilot-side embed endpoint) and pass it in `input.embedding`.
 */
export function useVectorSearch() {
  return useMutation<KGNode[], ApiError, VectorSearchInput>({
    mutationFn: (input) =>
      api.post<KGNode[]>('/kg/search/vector', {
        embedding: input.embedding,
        top_k: input.top_k ?? 10,
        project_id: input.project_id,
        node_type: input.node_type,
      }),
  });
}

/**
 * Arbitrary Cypher query. Mutation because cypher is interactive
 * (typed by the user in the Advanced tab) and we don't want each
 * keystroke to pollute the cache.
 */
export function useCypherQuery() {
  return useMutation<CypherQueryResult, ApiError, CypherQueryInput>({
    mutationFn: (input) =>
      api.post<CypherQueryResult>('/kg/query/cypher', {
        query: input.query,
        params: input.params ?? {},
      }),
  });
}

/**
 * Drift flag for a single node. No-op when `id` is missing. Backend
 * caches freshness for ~30s; we hold the result for 5 minutes on the
 * client to keep the inspector panel cheap.
 */
export function useKGFreshness(id: string | null | undefined) {
  return useQuery<KGFreshnessInfo, ApiError>({
    queryKey: kgQueryKeys.freshness(id ?? ''),
    queryFn: () => api.get<KGFreshnessInfo>(`/kg/nodes/${id}/freshness`),
    enabled: Boolean(id),
    staleTime: 300_000,
  });
}

/**
 * Arbitrary SQL query. Mutation for the same reason as cypher.
 * `kg:query` permission gate is enforced server-side.
 */
export function useSQLQuery() {
  return useMutation<SQLQueryResult, ApiError, SQLQueryInput>({
    mutationFn: (input) =>
      api.post<SQLQueryResult>('/kg/query/sql', {
        query: input.query,
        params: input.params ?? {},
      }),
  });
}

/** Hybrid (cypher + SQL) lookup. Mutation. */
export function useHybridQuery() {
  return useMutation<SQLQueryResult, ApiError, HybridQueryInput>({
    mutationFn: (input) =>
      api.post<SQLQueryResult>('/kg/query/hybrid', {
        cypher: input.cypher,
        sql: input.sql,
        params: input.params ?? {},
      }),
  });
}
