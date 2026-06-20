---
adr_id: ADR-002
title: Knowledge Graph Substrate — PostgreSQL 17 + Apache AGE
status: Accepted
date: 2026-06-20
deciders: Arunachalam V, Architecture team
consulted: Compliance, Security, Pilot Tech Leads (CMC, GAPI)
informed: Engineering, Product, Pilot Sponsors
supersedes: PRD §6.1 OQ-006
related:
  - PRD §4.2 Phase 0 (F-101..F-111)
  - PRD §4.3 Phase 1 (F-201..F-210)
  - PRD A-007 (Single graph engine, not federated)
  - PRD NFR-006, NFR-007, NFR-010, NFR-011, NFR-015, NFR-029, NFR-031, NFR-033
  - ADR-003 (Source-of-Truth Conflict Policy)
  - ADR-001 (Deployment Topology)
---

# ADR-002: Knowledge Graph Substrate — PostgreSQL 17 + Apache AGE

## Context and Problem Statement

The PRD §6.1 OQ-006 lists the knowledge graph substrate as an unresolved open question, acknowledging that F-103 (Architecture Discovery), F-104 (Dependency Graph), F-110 (Impact Analysis), F-111 (Incremental Sync), and NFR-031 (Knowledge Freshness) all read from this substrate but commit to neither the engine, the query latency SLO, nor the partial-failure behavior. A-007 commits Forge to "single graph engine, not federated."

The `review-architecture.md` identified this as one of the three CRITICAL risks: "graph substrate characteristics are absent even though F-103, F-104, F-110, F-111 imply them."

The decision must satisfy:
- **F-103, F-104, F-110, F-111** — multi-hop graph traversal, dependency discovery, impact analysis, incremental sync
- **NFR-007** — per-tenant isolation (no cross-tenant data leakage)
- **NFR-010** — 10–20 repos ingested in 24h
- **NFR-011** — impact analysis latency (currently `[TO BE MEASURED]`)
- **NFR-015** — graph remains usable when some connectors unavailable
- **NFR-031** — per-node freshness timestamps
- **NFR-033** — partial-failure tolerance
- **A-007** — single graph engine, not federated
- **Project Context Rule 1** — model-provider agnostic (no LLM SDK dependency in the substrate)
- **Project Context Rule 2** — multi-tenancy by default (`tenant_id` + `project_id` on every node)
- **Project Context Rule 5** — Organization Knowledge shared, Project Intelligence isolated

## Decision Drivers

- **Single-engine constraint (A-007)** rules out a federated graph (per-source sub-graphs)
- **Hybrid SQL+Cypher queries** are required by F-103 (architecture discovery joins service catalog relational with dependency edges graph)
- **Multi-tenancy** must be enforced at the storage layer (NFR-007), not just the application layer
- **Operational simplicity** — co-locating graph + relational + vector in one database eliminates a separate database engine's footprint
- **Tech stack alignment** — project-context.md commits to PostgreSQL 17 + pgvector; selecting a different graph engine would mean adding a second database

## Considered Options

### Option 1: PostgreSQL 17 + Apache AGE
Graph queries via Apache AGE's openCypher extension, co-located with relational data. RLS applies to both. Single engine.

### Option 2: Neo4j (separate database engine)
Native graph database. Multi-database for tenant isolation. Federated with PostgreSQL via application layer.

### Option 3: GraphRAG / Vector-only
Vector store with graph-derived embeddings. LLM-mediated traversal. No native graph operations.

### Option 4: Graph tables in PostgreSQL (no AGE)
Hand-rolled adjacency tables + recursive CTEs. No Cypher.

## Decision Outcome

**Chosen Option 1: PostgreSQL 17 + Apache AGE.**

### Architecture commitments (consequence of this decision)

- **Database**: PostgreSQL 17 (managed via AWS RDS) with the following extensions enabled:
  - **Apache AGE** (latest stable, supporting PostgreSQL 17) — graph queries via openCypher
  - **pgvector** — vector embeddings for semantic search (F-108 Q&A)
  - **PostgreSQL RLS** — multi-tenancy enforcement
- **Graph storage**: graph nodes and edges stored as PostgreSQL tables with `agtype` data type
- **Hybrid queries**: SQL JOINs with Cypher MATCH in single queries (e.g., F-103's service catalog + dependency edges)
- **Multi-tenancy**: every graph table includes `tenant_id` and `project_id` columns; RLS policies enforce tenant filter on every read
- **NetworkX offload**: complex graph algorithms (PageRank, community detection, shortest path) compute via `age_to_networkx` then back via `networkx_to_age`
- **Connector sync**: connectors write to graph nodes directly; freshness_at and provenance columns are stamped at write time
- **Audit**: every graph mutation produces an audit event with before/after agtype snapshots

### Positive Consequences

- **Single engine (A-007 satisfied)** — no federation, no ETL, no cross-database transactions
- **Hybrid SQL+Cypher queries natively** — F-103's join of relational + graph data is a single query
- **Multi-tenancy via RLS** — same mechanism for relational and graph; defense-in-depth
- **Operational simplicity** — one database to back up, replicate, monitor, migrate
- **Vector co-location** — pgvector enables F-108 semantic Q&A without a second engine
- **Mature driver ecosystem** — psycopg3 (Python), JDBC (Java), pgx (Go), node-postgres — all support AGE

### Negative Consequences

- **AGE is younger than Neo4j** — donated to Apache in 2022; some advanced graph algorithms are not first-class
- **Native graph performance slower than Neo4j** — pure graph workloads (large traversals) will be slower
  - Mitigated by: NetworkX offload for complex algorithms; pilot scope is 100+ concurrent requirements, not millions
- **PostgreSQL extension installation adds deployment step** — AGE must be enabled per database
- **Some PostgreSQL managed services may not support AGE** — confirm AWS RDS PostgreSQL 17 supports AGE before pilot launch

### Neutral Consequences

- **No graph visualization native to AGE** — use React Flow on the frontend, fed by REST endpoints that materialize graph data from AGE queries
- **Cypher learning curve** — engineers must learn openCypher (similar to Neo4j Cypher but not identical)

## Pros and Cons of the Options

### Option 1: PostgreSQL 17 + Apache AGE

**Pros:**
- Single engine (A-007)
- Hybrid SQL+Cypher natively
- RLS applies to graph
- Co-located with relational + vector (pgvector)
- Operational simplicity
- Mature driver ecosystem

**Cons:**
- AGE is younger than Neo4j
- Slower native graph performance (mitigated by NetworkX offload)
- Extension installation overhead
- RDS PostgreSQL must support AGE (verify before pilot)

### Option 2: Neo4j

**Pros:**
- Mature native graph performance
- Best-in-class Cypher support
- Strong visualization ecosystem (Neo4j Browser, Bloom)

**Cons:**
- **Violates A-007 spirit** — federation with PostgreSQL via application layer or ETL
- RLS not first-class — multi-tenancy via per-database-per-tenant (operational overhead)
- Hybrid SQL+Cypher not native — cross-engine queries require ETL or app-layer joins
- Enterprise tier required for many features
- Doubles operational footprint (Postgres + Neo4j)
- Tenant isolation requires per-tenant Neo4j database or careful label-based filtering (none native)

### Option 3: GraphRAG / Vector-only

**Pros:**
- Strong for semantic similarity search
- LLM-mediated traversal can be expressive

**Cons:**
- **Cannot do multi-hop relational traversal** — F-104 (dependency graph across services + repos + DBs) requires edge traversals that vector similarity cannot deliver
- **No ACID transactions on graph state**
- LLM-mediated lookups are non-deterministic — bad for impact analysis (F-110)
- The PRD's stated graph needs (F-103, F-104, F-110) all require relational-style edge queries

### Option 4: Graph tables in PostgreSQL (no AGE)

**Pros:**
- No extension dependency
- Standard PostgreSQL tooling

**Cons:**
- No Cypher — recursive CTEs are verbose for multi-hop traversals
- Hand-rolled adjacency tables invite schema drift
- No graph-native tooling (visualization, algorithms)
- Loses the network effect of openCypher

## Open Items (Deferred to Implementation ADR)

- **Specific AGE version**: latest stable supporting PostgreSQL 17 (likely AGE 1.6+)
- **Hybrid query pattern library**: which F-101..F-111 queries will be SQL-only, Cypher-only, or hybrid
- **NetworkX offload boundary**: which algorithms compute in-database vs. offload to NetworkX
- **Graph data partitioning strategy**: by `tenant_id` for query performance
- **Graph versioning policy**: how supersession (F-207) interacts with graph nodes

## References

- PRD §6.1 Open Questions — OQ-006
- PRD §4.2 Phase 0 (F-101..F-111)
- PRD §4.3 Phase 1 (F-201..F-210)
- `review-architecture.md` — flag: "graph substrate characteristics are absent"
- `_bmad-output/research-forge-architecture-decisions-2026-06-20.md` — Q1 Graph Substrate
- Apache AGE: https://age.apache.org/age-manual/master/intro/overview.html
- Apache AGE GitHub: https://github.com/apache/age
- Context7: https://context7.com/apache/age