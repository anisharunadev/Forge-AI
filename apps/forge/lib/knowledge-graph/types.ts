/**
 * Knowledge Graph — wire types (Step 57 zone 2).
 *
 * These types mirror `backend/app/schemas/project_intelligence.py`:
 *   - KGNodeRead  (the response model for /kg/nodes + /kg/nodes/{id})
 *   - KGEdgeRead  (the response model for /kg/edges)
 *   - KGStats     (the response model for /kg/stats)
 *
 * The backend accepts any string for `node_type` / `edge_type` (the
 * Pydantic model uses `str`, not an enum), so the closed unions below
 * are an **expressive superset** of what the seed inserts. UI surfaces
 * (the node-kind badge legend, the edge legend) can therefore use
 * strict autocompletion while the backend remains open-ended — any
 * unknown value coming back from the API simply types as `string`
 * rather than crashing the renderer.
 *
 * `NodeKind` and `EdgeKind` are kept as plain string-literal unions
 * (not TS enums) so they survive `isolatedModules` and `verbatimModuleSyntax`
 * without re-export gymnastics. They can be re-exported by consumers
 * with `import type { NodeKind } from '@/lib/knowledge-graph/types'`.
 *
 * Rule 2 (multi-tenancy) is enforced by the API client — every field
 * below that carries `tenant_id` / `project_id` is non-optional on the
 * server, so it is non-optional here.
 */

// ---------------------------------------------------------------------------
// Closed-set unions — the kinds the Knowledge Center UI renders today.
//
// NOTE: The seed in `backend/seeds/packages/acme-corp/data/021_graph_nodes.json`
//       currently inserts { project, user, service, api, database, repo,
//       standard, policy, adr, idea, risk } and edges of { owns, depends_on,
//       deploys, documents, governed_by, implements, references }. The unions
//       below are intentionally broader (covering what the UI narrative
//       documents in step-57-v2.md) so new node/edge kinds surface in the
//       picker immediately when the seed expands. The backend schema is open
//       (`str`), so any additional kind returned over the wire just types
//       as the wider `string` and does NOT break callers.
// ---------------------------------------------------------------------------

/** Node kinds supported by the Knowledge Center UI. */
export type NodeKind =
  | 'person'
  | 'team'
  | 'service'
  | 'module'
  | 'doc'
  | 'adr'
  | 'policy'
  | 'runbook'
  | 'tool';

/** Edge kinds supported by the Knowledge Center UI. */
export type EdgeKind =
  | 'owns'
  | 'member_of'
  | 'contains'
  | 'depends_on'
  | 'integrates_with'
  | 'documents'
  | 'decides'
  | 'governs'
  | 'operates'
  | 'contributes_to';

// ---------------------------------------------------------------------------
// Wire types — exact mirror of the backend Pydantic models. Field order
// and naming follow the FastAPI response_model so they round-trip without
// `select` mappers.
// ---------------------------------------------------------------------------

/** A knowledge-graph node. Mirrors `backend.app.schemas.project_intelligence.KGNodeRead`. */
export interface KGNode {
  id: string;
  node_type: string;
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

/** A knowledge-graph edge. Mirrors `backend.app.schemas.project_intelligence.KGEdgeRead`. */
export interface KGEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Aggregate counts for the graph. Mirrors `backend.app.schemas.project_intelligence.KGStats`. */
export interface KGStats {
  node_count: number;
  edge_count: number;
  /** Map of node_type → count, e.g. `{ service: 12, doc: 4 }`. */
  node_types: Record<string, number>;
  /** Map of edge_type → count, e.g. `{ owns: 8, depends_on: 14 }`. */
  edge_types: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Query inputs
// ---------------------------------------------------------------------------

/**
 * Filters for `useKGNodes` / `useKGEdges`. Both `kind` and `search` are
 * optional; when both are omitted, the backend returns the first
 * `limit` rows for the active tenant/project.
 */
export interface KGFilters {
  /** Narrow by node or edge kind (sent as `?type=` on the wire). */
  kind?: NodeKind | EdgeKind | string;
  /** Free-text search (debounced by the caller — typically 250ms). */
  search?: string;
  /** Force a specific project (defaults to the active project from auth). */
  project_id?: string;
  /** Max rows to fetch; backend default is 100, hard ceiling 1000. */
  limit?: number;
}

/** Vector search request body — mirrors `VectorSearchRequest`. */
export interface VectorSearchInput {
  /** Pre-computed embedding (callers compute this client-side). */
  embedding: number[];
  /** 1–100, default 10. */
  top_k?: number;
  project_id?: string;
  /** Narrow results to a single node kind. */
  node_type?: NodeKind | string;
}

/** Cypher query request body — mirrors `CypherQueryRequest`. */
export interface CypherQueryInput {
  query: string;
  params?: Record<string, unknown>;
}

/** Cypher query response shape: `{ rows: unknown[] }`. */
export interface CypherQueryResult {
  rows: Array<Record<string, unknown>>;
}

/**
 * Drift status for a single KG node. Mirrors
 * `backend.app.schemas.project_intelligence.KGFreshnessInfo`.
 * `status` is open on the wire (the backend uses `str`) — the closed-set
 * here covers the values the freshness service emits today; anything else
 * types as the wider `string` and renders as the "unknown" dot.
 */
export interface KGFreshnessInfo {
  node_id: string;
  status: 'fresh' | 'stale' | 'unknown' | string;
  freshness_at: string | null;
  freshness_source: string | null;
  age_seconds: number | null;
}

/** Mirrors `SQLQueryRequest`. */
export interface SQLQueryInput {
  query: string;
  params?: Record<string, unknown>;
}
/** `{ rows: unknown[] }` — same envelope as Cypher. */
export interface SQLQueryResult {
  rows: Array<Record<string, unknown>>;
}

/** Mirrors `HybridQueryRequest` (cypher + sql composed). */
export interface HybridQueryInput {
  cypher: string;
  sql: string;
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stable query keys
// ---------------------------------------------------------------------------

/**
 * Centralised query-key factory. Mirrors the `connectorQueryKeys` pattern
 * from `useConnectors.ts` — using a single `all` prefix lets mutations
 * invalidate every KG cache slice with one call:
 *
 *   void qc.invalidateQueries({ queryKey: kgQueryKeys.all });
 *
 * Individual consumers compose with `.list()`, `.detail()`, `.edges()`,
 * `.stats()`, `.vector()`, `.cypher()`.
 */
export const kgQueryKeys = {
  all: ['kg'] as const,
  nodes: () => [...kgQueryKeys.all, 'nodes'] as const,
  list: (filters?: KGFilters) =>
    [...kgQueryKeys.nodes(), filters ?? {}] as const,
  detail: (id: string) => [...kgQueryKeys.nodes(), 'detail', id] as const,
  edges: () => [...kgQueryKeys.all, 'edges'] as const,
  edgeList: (filters?: KGFilters) =>
    [...kgQueryKeys.edges(), filters ?? {}] as const,
  stats: (project_id?: string) =>
    [...kgQueryKeys.all, 'stats', project_id ?? null] as const,
  vector: () => [...kgQueryKeys.all, 'vector'] as const,
  vectorSearch: (input: VectorSearchInput) =>
    [...kgQueryKeys.vector(), input] as const,
  cypher: () => [...kgQueryKeys.all, 'cypher'] as const,
  freshness: (id: string) => [...kgQueryKeys.all, 'freshness', id] as const,
  /** M8 T-B3: incoming-only backlinks (Obsidian "Referenced by"). */
  backlinks: (id: string) => [...kgQueryKeys.all, 'backlinks', id] as const,
  sql: () => [...kgQueryKeys.all, 'sql'] as const,
  hybrid: () => [...kgQueryKeys.all, 'hybrid'] as const,
};
