---
title: Phase 6 — Knowledge Graph Wiring
description: Knowledge Center reads from the real backend (/api/v1/kg/*); static fixture removed.
---

Phase 6 wires the **Knowledge Center** UI to the nine backend routes
under `/api/v1/kg/*`. Previously the page rendered a static
`SAMPLE_NODES` fixture; now every node, edge, and stat comes from the
tenant's live graph.

## Status

- **Wired:** 2026-07-01 (Steps 57 + 67)
- **Status:** Phase 6 of 13 integration phases.
- **Scope:** Frontend hooks, adapter cleanup, inspector panel
  (properties + freshness), and a minimal inline stats strip.

## What works

- **Live data.** `apps/forge/lib/hooks/useKnowledgeGraph.ts` exposes
  TanStack Query hooks for all 9 backend routes:
  `useKGNodes`, `useKGNode`, `useKGEdges`, `useKGStats`,
  `useKGFreshness`, `useVectorSearch`, `useCypherQuery`, `useSQLQuery`,
  `useHybridQuery`. Each tenant-scoped via `Authorization` +
  `x-forge-tenant-id` injected by the shared `api` client (Rule 2).
- **Adapter preserved.** `lib/knowledge-graph/adapter.ts` continues to
  bridge the wire `KGNode`/`KGEdge` shape onto the canvas's
  `SampleNode`/`SampleEdge` contract. `KnowledgeGraphCanvas.tsx` is
  untouched.
- **Inspector — raw data.** `NodeInspectorPanel` now calls
  `useKGNode(id)` + `useKGFreshness(id)` and renders the raw
  `properties` bag as a key/value table. A coloured dot (green / amber
  / red) next to the title reports freshness.
- **Stats strip.** `GraphStatsStrip` (new) renders `useKGStats()`
  results inline — total nodes, total edges, top node type, and type
  histogram summary.
- **No offline fixture.** The `getOfflineGraph()` fallback was
  removed; an empty backend now shows `<GraphEmptyState/>` rather than
  the static sample.

## Routes covered

| Method | Path | Hook | Permission |
|---|---|---|---|
| GET    | `/kg/nodes`                     | `useKGNodes`         | `kg:read` |
| GET    | `/kg/nodes/{id}`                | `useKGNode`          | `kg:read` |
| GET    | `/kg/nodes/{id}/freshness`      | `useKGFreshness`     | `kg:read` |
| GET    | `/kg/edges`                     | `useKGEdges`         | `kg:read` |
| GET    | `/kg/stats`                     | `useKGStats`         | `kg:read` |
| POST   | `/kg/search/vector`             | `useVectorSearch`    | `kg:query` |
| POST   | `/kg/query/cypher`              | `useCypherQuery`     | `kg:query` |
| POST   | `/kg/query/sql`                 | `useSQLQuery`        | `kg:query` |
| POST   | `/kg/query/hybrid`              | `useHybridQuery`     | `kg:query` |

## Tests

- Backend: `backend/tests/api/v1/test_knowledge_graph.py` — 11 tests,
  one per route plus shape + filter coverage.
- Frontend: `apps/forge/tests/copilot/knowledge-hooks.test.tsx` —
  mocked `api` transport, 9 hook tests.

## What's deliberately not in this phase

- No new ingestion pipeline (forge-pi owns ingestion).
- No new canvas component changes (adapter absorbs the schema
  mismatch).
- No new test framework (Vitest + `vi.mock` only).