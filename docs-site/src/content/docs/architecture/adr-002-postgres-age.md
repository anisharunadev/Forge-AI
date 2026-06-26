---
draft: false
title: ADR-002 — PostgreSQL 17 + Apache AGE + pgvector
description: The single-database substrate for graph, vector, and relational data with row-level security.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that the primary database is PostgreSQL 17 with Apache AGE (graph) and pgvector (embeddings) extensions. The same database holds relational, graph, and vector data, isolated by RLS.

## Context

The platform needs three data shapes:

- **Relational** — tenants, projects, audit ledger, policies, user roles.
- **Graph** — project intelligence (services, APIs, dependencies, contracts).
- **Vector** — embeddings for semantic search over code, tickets, docs, and lessons.

The forces at play:

- The constitutional rules (R2, R5, R6) require RLS, layer isolation, and append-only audit on the same substrate.
- Operating three databases (relational, graph, vector) adds operational surface and breaks transactional consistency.
- Apache AGE runs inside PostgreSQL and gives us graph traversal without a separate cluster.
- pgvector gives us vector search in the same database.
- Multi-tenant isolation is enforced at the database, not at the application.

## Decision drivers

- NFR-006, NFR-007: Multi-tenancy with RLS
- DL-026: Layer isolation
- F-005, F-407: Audit ledger
- Time-to-pilot: one database is faster than three
- Single-region commitment (NFR-008)

## Considered options

- PostgreSQL 17 + Apache AGE + pgvector — **chosen**
- Separate databases: PostgreSQL + Neo4j + Pinecone
- PostgreSQL + pgvector only (no graph)
- PostgreSQL + AGE only (no vector)

## Decision outcome

Chosen option: **PostgreSQL 17 + Apache AGE + pgvector**.

| Extension | Purpose |
|---|---|
| PostgreSQL 17 | Relational substrate, RLS, transactional consistency |
| Apache AGE | Graph nodes and edges for project intelligence |
| pgvector | Embeddings for semantic search |

All three share the same RLS policies. All three live in the same transaction boundary. All three are backed up together.

The schema is portable to PostgreSQL 16 for local development (the extension differences are minor).

## Storage shape

```text
PostgreSQL 17 (single RDS instance, multi-AZ)
├── Relational tables
│   ├── tenants, projects, users, roles
│   ├── artifacts (ADR, API Contract, …)
│   ├── policies
│   └── audit_log (append-only)
├── Apache AGE graph
│   ├── Nodes: Service, API, Database, ADR, Ticket, Document, Person
│   ├── Edges: depends_on, owned_by, documents, conflicts_with
│   └── Queries: Cypher via AGE
└── pgvector
    ├── Embeddings of code chunks
    ├── Embeddings of ticket bodies
    ├── Embeddings of doc chunks
    └── Similarity search via pgvector
```

## RLS

Every table has RLS enabled. The predicate is `tenant_id` (and `project_id` where applicable):

```sql
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON artifacts
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

For Project Intelligence, the predicate includes `project_id`:

```sql
CREATE POLICY tenant_and_project ON project_services
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND project_id = current_setting('app.project_id')::uuid
  );
```

The application sets `app.tenant_id` and `app.project_id` at the start of every transaction. The connection pool resets them between tenants.

## Append-only audit

The `audit_log` table has INSERT-only grants for the application role:

```sql
REVOKE UPDATE, DELETE ON audit_log FROM forge_app;
GRANT INSERT, SELECT ON audit_log TO forge_app;
```

See [ADR-008](/architecture/adr-008-worm-audit/) for the hash chain and cross-account mirror.

## Consequences

**Positive:**

- Single database = single operational surface, single backup, single transaction boundary.
- Graph + vector + relational data composable in a single query.
- RLS at the database enforces multi-tenancy without application-level filters.
- Apache AGE is open-source; no per-node cost like Neo4j.
- pgvector is open-source; no per-query cost like Pinecone.

**Negative:**

- Vector search performance is bounded by pgvector's HNSW implementation; for very large corpora a dedicated vector store may be needed later.
- Graph traversals via Cypher in AGE are slower than native graph databases; acceptable for project intelligence scale.
- Extension version coupling — AGE and pgvector must be version-matched with PostgreSQL 17.

**Neutral:**

- The schema is portable to PostgreSQL 16 for local dev.

## Alternatives considered

### Separate databases

Pros: Each subsystem can be optimized independently.

Cons: Three operational surfaces; three backups; cross-database transactions are hard; RLS needs to be re-implemented per database; defeats time-to-pilot.

### PostgreSQL + pgvector only

Pros: Simpler.

Cons: Graph traversals in plain SQL are painful; the project intelligence model needs edges; we'd end up writing a graph layer in application code.

### PostgreSQL + AGE only

Pros: Relational + graph.

Cons: No semantic search; learning corpus (`forge-learn-search`) needs vectors; pgvector is cheap to add.

## Related

- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
- [ADR-003: Hybrid MDM with Steward priority](/architecture/adr-003-mdm-steward/)
- [ADR-008: Append-only WORM audit](/architecture/adr-008-worm-audit/)
- [Knowledge graph](/concepts/knowledge-graph/)
- [Multi-tenancy](/concepts/multi-tenancy/)
