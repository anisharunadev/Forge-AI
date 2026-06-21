# ADR-002: PostgreSQL 17 + Apache AGE + pgvector

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group
- Related research: [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q1, Q3)

## Context and Problem Statement

Forge AI needs a single persistence substrate that supports relational, graph, and vector workloads:

- Relational: tenants, projects, workflows, audit, cost ledger, artifacts, users, RBAC.
- Graph: project intelligence knowledge graph (services, APIs, databases, dependencies), impact analysis, traceability chains (Requirement -> ADR -> Task -> Code -> Test -> Deployment).
- Vector: semantic search over organization knowledge, code embeddings, Q&A retrieval (F-108).
- Multi-tenancy: PostgreSQL RLS on every tenant-scoped table (Rule 2, NFR-006).

We must choose between a single substrate (Postgres + extensions) and a polyglot substrate (separate graph, vector, and relational engines).

The forces at play:

- ADR-001 commits Forge to RDS PostgreSQL 17 as the primary OLTP store.
- F-103 (architecture discovery) needs hybrid SQL+Cypher queries that join service catalog rows with graph traversals.
- NFR-006 mandates tenant_id + project_id on every record with RLS enforcement.
- A-007 commits Forge to "single graph engine, not federated."
- Operational footprint of running two database engines (Postgres + Neo4j, for example) is heavy at pilot scale.

## Decision Drivers

- A-007: Single graph engine (not federated)
- Rule 2: Multi-tenancy with RLS
- F-103, F-104, F-110: Hybrid SQL+Cypher queries
- F-108: Vector-based Q&A retrieval
- NFR-006: Tenant isolation
- M1 substrate commitment to a single persistence engine

## Considered Options

- PostgreSQL 17 + Apache AGE + pgvector (chosen)
- Neo4j + PostgreSQL (dual database)
- ArangoDB (multi-model, single engine)
- Memgraph + PostgreSQL + pgvector
- PostgreSQL only with JSONB for graph modeling (no Cypher)

## Decision Outcome

Chosen option: **PostgreSQL 17 with Apache AGE extension (graph) and pgvector (vectors)** as the single persistence substrate. All relational, graph, and vector data live in the same RDS instance. RLS policies apply uniformly across relational and graph tables (graph nodes are stored as rows in AGE-managed tables).

Key technical commitments:

- Hybrid SQL+Cypher queries via `SELECT * FROM cypher('graph_name', $$ MATCH ... $$) AS (...) JOIN services ON ...`.
- `tenant_id` + `project_id` columns on every AGE graph node, with RLS policies applying the same as relational tables.
- pgvector for embedding storage, indexed via HNSW for Q&A and semantic search.
- NetworkX offload (`apache-age-python` includes `age_to_networkx` / `networkx_to_age`) for complex graph algorithms (PageRank, community detection) when AGE's native traversal is too slow.

### Consequences

Positive:

- Single operational footprint: one database engine, one backup, one DR plan.
- Hybrid SQL+Cypher queries enable F-103 to join service catalog with dependency edges in a single transaction.
- RLS applies uniformly; multi-tenancy enforcement is identical across relational and graph data.
- pgvector is co-located with relational data; semantic search joins naturally with metadata filters.
- No second-engine licensing, monitoring, or migration tooling.

Negative:

- Apache AGE is younger than Neo4j (project started 2019, donated to Apache 2022). Native graph performance for pure graph workloads is slower than Neo4j.
- NetworkX offload introduces Python-side algorithm execution that must be tenant-scoped to avoid cross-tenant data leakage.
- pgvector recall and performance depends on tuning HNSW parameters per workload.

Neutral:

- Operational tooling (pg_dump, pg_basebackup, vacuum, analyze) is the same regardless of which data type lives in the database.

## Alternatives Considered

### Neo4j + PostgreSQL (dual database)

Pros:

- Mature graph engine with strong Cypher performance.
- Rich graph algorithm library.

Cons:

- Two database engines to operate, monitor, back up, and patch.
- No hybrid SQL+Cypher queries; every cross-domain query requires ETL or application-layer joining.
- RLS-style multi-tenancy requires per-database-per-tenant (operational overhead) or application-layer filtering.
- A-007 explicitly forbids a federated graph approach.

### ArangoDB (multi-model)

Pros:

- Single engine for documents, graph, and key-value.
- AQL query language supports multi-model queries.

Cons:

- Less mature PostgreSQL-equivalent RLS for multi-tenancy.
- Smaller ecosystem; less operational tooling.
- No pgvector equivalent; vector workload would need a separate store.

### Memgraph + PostgreSQL + pgvector

Pros:

- High-performance in-memory graph engine.
- OpenCypher support.

Cons:

- Adds a third persistence engine (Postgres, Memgraph, plus pgvector).
- No pgvector in Memgraph; vector store must be Postgres or external.
- Operational complexity of a third engine is unjustified for V1.

### PostgreSQL only with JSONB for graph modeling (no Cypher)

Pros:

- No new extensions; pure Postgres.

Cons:

- No Cypher; multi-hop graph traversal (F-104 dependency graph, F-110 impact analysis) must be expressed as recursive CTEs or application code.
- Loses expressivity for graph-shaped domain logic.
- No native community-detection, shortest-path, or PageRank primitives.

## Pros and Cons of the Chosen Option

Pros:

- Aligns with A-007's "single graph engine" commitment.
- Hybrid queries satisfy F-103's central use case.
- RLS coverage for graph data is automatic via the same policy machinery.
- pgvector co-location with graph data enables graph-aware retrieval.

Cons:

- AGE maturity risk; mitigated by NetworkX offload for complex algorithms.
- Vendor lock-in to PostgreSQL extension ecosystem.

## References

- [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q1 Graph Substrate, Q3 Multi-Tenancy)
- ADR-001: Cloud-only AWS deployment (RDS PostgreSQL 17)
- ADR-003: Hybrid MDM + Steward priority conflict resolution (graph provenance lives here)
- ADR-008: Append-only WORM audit trail (audit ledger lives here)
- Constitution Rule 2 (Multi-tenancy by default)
- A-007 (Single graph engine, not federated)
- PRD NFR-006, NFR-007, F-103, F-104, F-108, F-110