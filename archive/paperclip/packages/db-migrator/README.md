# @fora/db-migrator

Postgres migration runner that bootstraps every Forge AI multi-tenant table with the canonical `tenant_isolation` RLS policy, enforces a `BYPASSRLS` audit, and ships the property-based test that proves cross-tenant reads are impossible.

Implements **Forge AI-162** (0.7.2a) — the database half of [Forge AI-124 0.7.2 Per-tenant namespace primitive](../workspace/memory/architecture.md#6-data-model-discipline).

## What it does

1. **Single entry point.** `runMigrations(pool, { projectRoot })` is the only path that creates tables. Ad-hoc DDL is blocked by lint in 0.7.2d; the runner is the runtime gate.
2. **Canonical RLS policy.** Every multi-tenant table is created with `id`, `created_at`, `tenant_id uuid not null references tenants(id) on delete cascade`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and:
   ```sql
   CREATE POLICY tenant_isolation ON "<table>"
     USING (tenant_id = coalesce(
       nullif(current_setting('app.tenant_id', true), '')::uuid,
       '00000000-0000-0000-0000-000000000000'::uuid
     ));
   ```
3. **Sentinel default.** The `coalesce(..., nil_uuid)` matches zero rows when `app.tenant_id` is unset or empty. A misconfigured connection pool cannot read the entire table.
4. **`BYPASSRLS` audit.** The runner greps `migrations/` and `audit/` for any `BYPASSRLS` grant and refuses to apply if one is added outside those two paths. The two allowed roles are `migrator` (in `migrations/`) and `audit_reader` (in `audit/`).
5. **Property-based test.** Uses `fast-check` to fuzz every model in the registry and assert the emitted DDL contains the canonical policy shape, and (with a real Postgres) that reads without a `tenant_id` predicate return only rows owned by the current `app.tenant_id`.

## Out of scope

- The connection pool that actually sets `app.tenant_id` on every connect lives in **0.7.2b**.
- Cross-tenant analytics (impossible by construction per Forge AI-124 out-of-scope).
- Migration rollback beyond a single `down` per migration (v1 simplification).

## Usage

### Apply migrations

```ts
import { Pool } from 'pg';
import { runMigrations } from '@fora/db-migrator';

const pool = new Pool({ connectionString: process.env.Forge AI_DATABASE_URL });
const result = await runMigrations(pool, { projectRoot: process.cwd() });
//   { applied: ['0001_tenants', '0001_users', ...], verified: ['tenant_isolation@users', ...] }
```

### Run the property-based test against a real Postgres

```bash
export Forge AI_DATABASE_URL=postgres://migrator:...@localhost:5432/fora
pnpm test
```

Without `Forge AI_DATABASE_URL` the e2e portion is skipped and only the pure-string property runs (the build-time gate).

### Add a new model

1. Add an entry to [`src/registry.ts`](./src/registry.ts).
2. Run `pnpm test` — the property-based test will fail if the new model does not produce the canonical `tenant_isolation` policy.
3. Run `pnpm migrate` to apply the new table.

## Directory layout

```
packages/db-migrator/
├── src/
│   ├── index.ts            public surface
│   ├── runner.ts           the only path that creates tables
│   ├── registry.ts         declarative list of multi-tenant models
│   ├── rls.ts              pure SQL emitter (table + RLS policy)
│   ├── bypass-audit.ts     the BYPASSRLS grep audit
│   ├── connection.ts       withTenant(pool, tenantId, fn) helper
│   └── types.ts            type definitions
├── migrations/             bootstrap + role grants (the only paths allowed to hold BYPASSRLS)
│   └── 0001_migration_role.sql
├── audit/                  audit-reader role grant (BYPASSRLS allowed here too)
│   └── 0001_audit_reader_role.sql
├── test/
│   ├── rls-emitter.test.ts       unit tests for the SQL emitter
│   ├── bypass-audit.test.ts      unit tests for the BYPASSRLS grep
│   └── property-based.test.ts    the fast-check property-based test
└── bin/
    └── fora-db-migrate.mjs       CLI entry point
```

## Risk and rollback

- The runner is **idempotent**: it tracks applied migrations in `schema_migrations` and skips them on re-run.
- The runner is **additive**: a new model is a new entry in the registry; existing tables are not touched.
- To roll back: drop the table. v1 has no `down` migrations; the spec explicitly defers that.
