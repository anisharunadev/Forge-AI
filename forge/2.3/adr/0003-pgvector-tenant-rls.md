---
version: 0.1.0
last-reviewed-by: cto
last-reviewed-at: 2026-06-17
parent-prd: workspace/project/PRD.md
parent-issue: FORA-35
sub-goal: "2.3 — Design generation (design-generator)"
epic: FORA-18 (Epic 2 — Architecture Agent)
---

# ADR-0003 — PostgreSQL + pgvector in the primary database; per-tenant RLS as the isolation boundary

- **Status:** proposed
- **Date:** 2026-06-17
- **Deciders:** CTO; Security co-signs
- **Sub-goal:** FORA-35 (2.3 — Design generation)
- **Supersedes:** none
- **Superseded by:** none
- **Parent ADRs:** tech-stack §4, security memory §4, [`docs/architecture/adr-0003-auth-tenancy.md`](../../../docs/architecture/adr-0003-auth-tenancy.md)
- **Related migration:** `packages/db-migrator/migrations/0001_migration_role.sql`

## Context

The platform needs three database-shaped capabilities:

1. **OLTP** for the runtime — `agent_runs`, `agent_run_stages`, `agent_run_approvals`, `interactions`, `comments`, `audit_log`, `tenants`, `users`, `tenant_memberships`.
2. **Vector search** for the Memory agent (per ADR-0001 / FORA-50) and the future Doc agent's RAG.
3. **Multi-tenant isolation** that survives a buggy query.

Tech-stack §4 commits to PostgreSQL 16 (RDS, then Aurora) with `pgvector` in the same database. The auth/tenancy ADR (`adr-0003-auth-tenancy.md`) requires row-level security (RLS) as the isolation primitive. Migration `0001` locks the role policy: only the `migrator` role and the `audit_reader` role hold `BYPASSRLS`; every app role connects with `NOINHERIT, NOBYPASSRLS`. The `BYPASSRLS` audit (`src/bypass-audit.ts`) scans `migrations/` and `audit/` on every CI run and refuses to start if a `BYPASSRLS` grant is added anywhere else.

This is a one-way door per architecture memory §5: every app, every future MCP server, and every analyst query pins to the role / RLS model. Reverting to per-tenant logical databases (or a separate vector DB) requires a data migration and a contract change.

## Decision

We adopt **PostgreSQL 16 + pgvector in the primary database, with RLS on every user table** as the v1 storage primitive. The model is:

1. **One database, many tenants.** Per-tenant logical isolation is via RLS, not via per-tenant databases.
2. **Every user table has `tenant_id uuid NOT NULL`.** Lint-enforced by `packages/tenancy-lint` (red fixture: `red-no-rls.sql`); the green fixtures show the accepted RLS policy shape.
3. **The connection pool sets the tenant on checkout:** `SET LOCAL app.tenant_id = $1` (per `packages/db-pool`). The RLS policy reads `current_setting('app.tenant_id')::uuid` and refuses any row that does not match.
4. **Two roles, two pools.** `runtime_pool` (RLS-enforced) for every app; `migrator_pool` (BYPASSRLS) for `db-migrator` only. The `audit_reader` role is read-only and BYPASSRLS for the audit account's overnight job.
5. **pgvector lives in the same database.** Vectors are scoped to the tenant by RLS just like every other row. The vector column is `embedding vector(1536)` (Voyage `voyage-3-large` dimensions; tech-stack §8).
6. **Connection isolation is a per-tenant budget:** PgBouncer with a per-tenant `max_client_conn` and a per-tenant IOPS cap (AWS RDS Performance Insights provides the cap). A single hot tenant cannot starve the cluster.

## Consequences

**Easier:**

- One database to back up, replicate, monitor, and upgrade.
- One set of credentials to rotate.
- Vectors and OLTP share a transaction boundary (a vector write and the originating row commit together).
- RLS is enforced by the database — a forgotten `WHERE tenant_id = …` in app code still returns the right answer.

**Harder:**

- A buggy migration can affect every tenant at once. The lint + the `BYPASSRLS` audit + the migration dry-run in `db-migrator` mitigate, but reviewer discipline is the last line.
- A noisy tenant can degrade the cluster. The per-tenant PgBouncer + IOPS cap is the mitigation; the runbook (`docs/runbooks/noisy-tenant.md`, forthcoming) is the response.
- pgvector at scale (Q2 2027+) will need HNSW index tuning and a read-replica split-out. A managed vector DB is a v2 conversation.

**Accepted:**

- Cross-tenant analytics is via the audit account's read replica, not the primary.
- A 100-tenant scale-out is a v1.1 conversation (tech-stack §12 explicitly plans for sharding at 100 tenants).

## Alternatives considered

1. **Per-tenant logical databases.** Rejected: O(n) connection pools, O(n) migrations, O(n) backups, O(n) monitoring, and no advantage RLS does not already provide.
2. **Per-tenant schemas in one database.** Rejected: same operational cost as logical databases, plus the role/grant model balloons.
3. **A separate managed vector DB (Pinecone, Weaviate).** Rejected for v1: tech-stack §13 explicitly defers this. The vector volume at v1 GA does not justify a second vendor.
4. **NoSQL primary (DynamoDB, Mongo).** Rejected: the platform's contracts are relational (audit joins, RLS, foreign keys, partial indexes). NoSQL buys nothing here and forfeits pgvector.
5. **Aurora from day one.** Rejected: RDS is good enough for the first design partner; Aurora's price/performance advantage shows up at scale. The migration path is `pg_dump → aurora_restore`, no contract change.
6. **Citus / sharded Postgres.** Rejected for v1: another operational lift, another set of bugs. Revisit at 100 tenants (tech-stack §12).
