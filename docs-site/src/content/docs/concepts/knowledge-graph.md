---
draft: false
title: Knowledge Graph
description: The project intelligence knowledge graph — what it stores, how it's queried, how conflicts are resolved.
---

The knowledge graph is Forge's "memory". It fuses code, tickets, documentation, and chat into a single queryable graph that agents reason over.

## What is this?

A **project intelligence knowledge graph** built on Apache AGE (PostgreSQL extension for graph data) with pgvector embeddings for semantic search.

```text
+--------------------------------+        +-----------------------------+
|     Sources of truth           |        |   Project Intelligence KG    |
|                                |        |                              |
|  - GitHub (code, PRs, issues)  |        |   Apache AGE graph nodes     |
|  - Jira (tickets)              | -----> |   pgvector embeddings        |
|  - Confluence (docs)           |        |   typed relationships        |
|  - Figma (designs)             |        |                              |
|  - Slack (chat)                |        |   queryable via Cypher       |
|  - SonarQube (quality)         |        |   + vector similarity        |
+--------------------------------+        +-----------------------------+
```

Each project in a tenant gets its own graph namespace. The graph is queried with Cypher via Apache AGE and with vector similarity via pgvector.

## Why does it exist?

LLMs hallucinate. Without ground truth, an agent asked "what is the contract for service X?" will invent one. The knowledge graph is the ground truth.

It also lets multiple agents reason about the same facts without rediscovering them. An architecture agent that produces an ADR and a security agent that reviews it both read from the same graph.

## What problem does it solve?

| Problem | Without KG | With KG |
|---|---|---|
| "Two sources disagree" | The agent picks one and proceeds | Conflicts enter `conflicted` state per ADR-003 — Steward decides |
| "What services do we have?" | The agent reads the repo and guesses | The graph has authoritative `Service` nodes |
| "Find similar PRs" | Cosine similarity on raw diff text | Embeddings on PR + service context |
| "What is service X's contract?" | The agent reads the latest OpenAPI file | The graph has the canonical contract node, refreshed on merge |

## How does it work?

### Storage

- **Apache AGE** stores the graph. Each node has labels (`Service`, `API`, `Database`, `ADR`, `Ticket`, `Document`, `Person`, …). Edges are typed (`depends_on`, `owned_by`, `documents`, `conflicts_with`, …).
- **pgvector** stores embeddings for semantic search. Embeddings are recomputed on ingest and on update.
- **RLS** scopes both. Project Intelligence rows carry project-scoped RLS; Organization Knowledge rows carry tenant-scoped RLS without project scope.

### Ingest

Ingestion runs through `forge-intel-scan-*` commands:

- `forge-intel-scan-repo` — entrypoints, layout, languages
- `forge-intel-scan-deps` — direct and transitive dependencies
- `forge-intel-scan-services` — services and their contracts
- `forge-intel-scan-secrets` — accidentally committed secrets (admin, requires approval)

Each ingest event is audited and produces a freshness ledger entry. Ingest is incremental; the graph re-merges rather than replaces.

### Query

Two query surfaces:

- **Cypher** via Apache AGE for structural queries ("all services owned by team X").
- **Vector similarity** via pgvector for semantic queries ("find PRs similar to this one").

### Conflict resolution

When two sources disagree (e.g., code says service X is on port 8080, Confluence says 9090), the conflict enters a `conflicted` state and surfaces in the Steward queue. The Steward resolves the conflict by accepting one side, rejecting the other, or splitting the node. See [ADR-003](/architecture/adr-003-mdm-steward/).

## How do I use it?

| If you want to… | Run |
|---|---|
| Ingest a new repo | `forge-intel-scan-repo` |
| Ingest dependencies | `forge-intel-scan-deps` |
| Find a service's contract | `forge-intel-summarize --service <name>` |
| See what changed recently | `forge-intel-trend` |
| Resolve a conflict | Open the Steward queue and pick the winning source |

Programmatic access is via the Cypher endpoint of the FastAPI backend.

## When should I use it?

The knowledge graph is always on. The question is **what you put in it**.

- Ingest everything you can — repos, tickets, docs, chat. The marginal cost is low and the marginal value of a new source is high.
- Don't ingest secrets — `forge-intel-scan-secrets` is gated for a reason.
- Don't bypass conflict resolution. The `conflicted` state is a feature.

## Related

- [Layer isolation](/architecture/overview/) — Organization Knowledge vs Project Intelligence
- [Multi-tenancy](/concepts/multi-tenancy/) — how isolation is enforced
- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
- [ADR-003: Hybrid MDM with Steward priority](/architecture/adr-003-mdm-steward/)
- [forge-intel-scan-repo](/commands/project-intelligence/)
