# `@fora/tenancy-lint`

Build-time lint for Forge AI's tenancy invariants. Wired into the CI Tier 1
(static) step; red on every push.

Per **ADR-0003 §4.2** (RLS only via the migration runner, no `BYPASSRLS`
exception path) and **Forge AI-124 acceptance bar #5** and **Forge AI-165** (0.7.2d).

## Rules

| # | Rule id | Severity | Trigger |
|---|---------|----------|---------|
| 1 | `no-create-table-outside-migrations` | error | `CREATE TABLE` in any `.sql` whose path is not under `migrations/` |
| 2 | `no-bypassrls-outside-migrations-and-audit` | error | `BYPASSRLS` in any `.sql` or `.ts` whose path is not under `migrations/` or `audit/` |
| 3 | `multi-tenant-table-needs-rls` | warning | A `CREATE TABLE` block with a `tenant_id` column but no `ENABLE ROW LEVEL SECURITY` after the block |
| 4 | `multi-tenant-table-needs-tenant-isolation-policy` | warning | Same as above, but for the `tenant_isolation` policy |

Errors fail the build. Warnings are surfaced in the PR review and never
gate CI; the build-time half of the acceptance bar is the error rules
(1) and (2).

## Usage

```bash
# Local
pnpm --filter @fora/tenancy-lint build
node packages/tenancy-lint/bin/tenancy-lint.mjs .

# CI
tenancy-lint .
```

Exit code 0 = clean (or warnings only). Exit code 1 = one or more errors.

## Tests

```bash
pnpm test
```

Coverage:

- `CREATE TABLE` outside `migrations/` fails (rule 1)
- `BYPASSRLS` in `apps/` or `packages/` fails (rule 2)
- `BYPASSRLS` in `migrations/` and `audit/` is allowed (rule 2)
- Multi-tenant tables without `ENABLE ROW LEVEL SECURITY` warn (rule 3)
- Multi-tenant tables without `tenant_isolation` policy warn (rule 4)
- Commented-out `CREATE TABLE` / `BYPASSRLS` are ignored
- All four Forge AI-165 acceptance fixtures (red × 2, green × 2) match their
  expected lint outcome
