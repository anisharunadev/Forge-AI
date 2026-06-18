# Memory MCP (FORA-32)

The Knowledge-Layer-backed memory service every FORA sub-agent retrieves
from. The full design is in
[`docs/architecture/adr-0002-memory-store.md`](../../docs/architecture/adr-0002-memory-store.md);
this server is the v1 dev implementation against SQLite + sqlite-vec.

## Tools

| Tool                | Maps to the issue's API        | Purpose                                                         |
| ------------------- | ------------------------------ | --------------------------------------------------------------- |
| `write`             | `memory.write(...)`            | Direct write; mirrors to the audit log in one transaction       |
| `propose`           | `memory.propose(...)`          | Propose a fact for curation (ADR-0002 §4.2)                     |
| `recall`            | `memory.retrieve(...)`         | Hybrid lexical+vector recall; enforces the tenant boundary      |
| `retrieve`          | `memory.retrieve(...)`         | Alias for `recall` — kept for the issue's literal test shape    |
| `inject_for_stage`  | (per-stage injection table)    | Resolves `workspace/README.md §2` and recalls the facts         |
| `seed_workspace`    | (cold-start)                   | Materializes the seed corpus from `workspace/{memory,customer,project}/*.md` |
| `promote`           | (ADR §4.3)                     | Promote a fact across namespaces                                |
| `forget`            | (ADR §6.3)                     | GDPR / manual correction; deletes the vector row, audits reason |
| `stats`             | —                              | Store health                                                    |
| `read_audit`        | (Audit system 0.5)             | Most recent audit rows; the Audit agent's subscription point    |
| `injection_table`   | —                              | Raw per-stage injection table                                   |

## Five memory scopes

The FORA-32 issue names five scopes; the ADR names three namespaces.
The mapping is:

| Issue scope | ADR namespace    | Tenant column      | Example fact                                |
| ----------- | ---------------- | ------------------ | ------------------------------------------- |
| `project`   | `project`        | `tenant_id=project_id` | "Project X uses UUID v7 for new entity ids" |
| `org`       | `memory`         | `null` (global)    | "All new entities use UUID v7" (epoch rule) |
| `customer`  | `customer`       | `tenant_id=customer_id` | "Acme prefers Lucid for diagrams"       |
| `codebase`  | `codebase`       | `tenant_id=repo_id`    | "src/api uses builder pattern"          |
| `execution` | `execution`      | `tenant_id=run_id`     | "Run #481 hit 3 retries on the cart API" |

`memory` rows are global. Everything else is tenant-scoped and the
SQL filter denies any cross-tenant read. The Memory service is the
**only writer** (ADR-0002 §4.1); the Master Orchestrator is the
**only reader** (ADR-0002 §4.2 row 5); sub-agents never call
`memory.recall` directly.

## Wire protocol

JSON-RPC 2.0 over stdio, identical to the GitHub and Jira MCPs. The
shared client (`agents._shared.mcp_client.StdioMcpClient`) drives
this server too.

## Env

| Var                  | Default                          | Purpose                                 |
| -------------------- | -------------------------------- | --------------------------------------- |
| `FORA_MEMORY_DB`     | `./var/memory.db`                | Path to the SQLite database file        |
| `FORA_MEMORY_AUDIT`  | `./var/memory-audit.jsonl`       | Path to the JSONL audit mirror          |
| `FORA_WORKSPACE_ROOT`| `./workspace`                    | Root of the seed corpus                 |

## Smoke test

```
python -m agents.memory_mcp.smoke_test
```

The smoke test runs the four acceptance criteria from FORA-32 and
prints evidence for each:

1. `memory.retrieve({scope:'codebase', stage:'arch'})` returns the right files.
2. `memory.write({scope:'execution', ...})` and the Audit system records who/when.
3. Tenant boundary respected — no cross-tenant leakage.
4. Cold-start in a fresh tenant succeeds when the seed corpus is in place.

## Differences from the GitHub and Jira MCPs

| Area          | GitHub / Jira MCP                  | Memory MCP                                                |
| ------------- | ---------------------------------- | --------------------------------------------------------- |
| Substrate     | Live REST + sample fixtures        | SQLite + sqlite-vec (dev) — Postgres+pgvector (prod ADR) |
| Auth model    | Per-tool token (GitHub PAT, Jira)  | Internal; tenant_id is the boundary                       |
| Idempotency   | Caller-supplied key                | Deterministic fact_id derived from (namespace, scope, file, anchor) so re-seeding is idempotent |
| Audit         | Not required                       | Mandatory: every write mirrors to `memory_audit` in the same transaction (ADR-0002 §7 invariant 1) |
| Mode split    | live / sample                      | Single mode; the seed corpus is the dev fixture           |

## Why SQLite+sqlite-vec (and not the prod target)

The production target in ADR-0002 §3.1 is Postgres+pgvector+tsvector.
The dev substrate is sqlite-vec because:

- It runs in a single process with no external service to manage.
- The same vec0 distance query shape (`MATCH ... ORDER BY distance`)
  ports to pgvector's `<=>` operator with a one-line SQL change.
- The row shape (memory_fact + memory_audit) is identical, so a future
  Postgres backend swap is purely a connection driver change.

The hybrid query (ADR-0002 §3.3) keeps the same 0.7/0.3 weights; the
L2 distance is normalized into a 0..1 similarity so the ranking
matches cosine on L2-normalized vectors.

## What's deliberately **not** in v1

- Re-ranking by an LLM judge (deferred to the Evaluation ADR).
- Cross-tenant promotion gate (a future CTO-signed `customer→memory`
  approval flow lives in the Architect gate; today the `promote` tool
  executes without a gate so the smoke test can drive it).
- Embedding cache (ADR-0002 §8) — the dev embedder is deterministic
  and free, so caching is a no-op until we wire a real embedding model.
- Multi-region replication (ADR-0002 §15).
