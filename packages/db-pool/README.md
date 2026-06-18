# `@fora/db-pool`

The runtime gate between the identity-broker (which mints a tenant-bound JWT)
and the database (which trusts `current_setting('app.tenant_id')`).

Per [ADR-0003 §4.2](../docs/architecture/adr-0003-auth-tenancy.md) and
[FORA-124 acceptance bar #2](https://FORA/FORA/issues/FORA-124), every
multi-tenant Postgres query must go through a connection pool that
**always** sets `app.tenant_id` from the verified claim. This package is
that pool.

## What it does

On every `query()` call, the wrapper:

1. **Validates the request envelope.** `envelope.tenant_id` must equal
   `claim.tenant_id`. On mismatch, the wrapper throws
   `TenantClaimMismatchError` and emits a `tenancy.denied` audit event.
   The connection is never checked out.
2. **Acquires a connection**, opens a transaction, and runs
   `SET LOCAL app.tenant_id = '<claim.tenant_id>'`. RLS policies
   (from 0.7.2a) use this setting to filter every read and write.
3. **Releases the connection** on commit. The per-session
   `app.tenant_id` is the sentinel UUID `00000000-0000-0000-0000-000000000000`,
   so a stray checkout (e.g. a misconfigured background job) reads
   zero rows.

## Rollout

The wrapper is gated by `FORA_TENANT_POOL`. The default is `disabled`
(pass-through). To turn the gate on:

```bash
export FORA_TENANT_POOL=enforced
```

Or pass `enforcement: 'enforced'` to the constructor for code-controlled
rollout. Canary pattern:

- Ship the wrapper. Existing DB code that bypasses the wrapper still
  works (pass-through).
- Set `FORA_TENANT_POOL=enforced` in staging. The mismatch test
  catches any caller that hand-rolls a query.
- Promote to prod once the staging logs are clean for a week.

## Usage

```ts
import { Pool } from 'pg';
import { TenantAwarePool, InMemoryAuditSink, parseEnforcement } from '@fora/db-pool';

const pg = new Pool({ connectionString: process.env.FORA_DATABASE_URL });
const pool = new TenantAwarePool({
  underlying_pool: pg,
  audit: productionAuditSink, // wire to FORA-36 in prod
  enforcement: parseEnforcement(process.env.FORA_TENANT_POOL),
});

// On every request, the broker verifies the JWT and hands you a claim.
const ctx = {
  claim: { /* decoded SessionClaims */ },
  envelope: { tenant_id: request.body.tenant_id },
};

const result = await pool.query({
  ctx,
  sql: 'SELECT * FROM customers',
});
```

## Tests

```bash
pnpm --filter @fora/db-pool test           # unit (no Postgres required)
pnpm --filter @fora/db-pool test:integration  # needs FORA_DATABASE_URL
```

The unit tests use a hand-rolled `FakePool` that simulates RLS by
filtering rows based on the connection's `app.tenant_id`. The
integration test stands up the same RLS policy as 0.7.2a and runs the
property-based case through the wrapper against a real Postgres.

## Out of scope

- The RLS policy and migration shape (lives in 0.7.2a).
- Cache, object store, and SQS isolation (lives in 0.7.2c).
- Cross-tenant admin tooling — impossible by design.
