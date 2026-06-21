# Tenant Middleware — FastAPI

The tenant middleware is the bridge between Keycloak-issued JWTs and the
PostgreSQL RLS policies in `rls-policies.sql`. It runs on every API request
and is the **only** place in the backend that touches `app.tenant_id`.

## Goals

1. **Always set `app.tenant_id` before any user query runs.** The RLS
   policies return zero rows when this is unset, so a forgotten SET is
   a silent denial-of-service rather than a data leak.
2. **Never trust the caller.** A valid token, a valid `tenant_id` claim,
   and a valid `aud` are all required. The middleware must verify all
   three before opening a DB session.
3. **Make cross-tenant access auditable.** When a `forge-admin` user
   overrides the tenant via the `X-Forge-Tenant-Override` header, the
   event must be logged to the audit trail with enough context to
   reconstruct the request.
4. **Keep pgbouncer in transaction-pooling mode.** The middleware uses
   `SET LOCAL` exclusively — never `SET` (session-level) — so that GUCs
   cannot leak between requests on the same pooled connection.

## Where tenant_id is extracted from

The JWT issued by Keycloak carries a custom `tenant_id` claim (see
`realm-forge.json` and `jwt-claims.md`). The claim is added by a protocol
mapper that reads the `tenant_id` user attribute.

The middleware performs three checks before trusting the claim:

1. **Signature** — verify the JWT against the realm's JWKS (cached via
   `forge-ai/oidc-clients`). Reject on `kid` mismatch or expired cert.
2. **Issuer** — `iss` must equal `${KEYCLOAK_URL}/realms/forge`.
3. **Audience** — `aud` must equal the expected client id (configurable per
   route, defaulting to the API's own client id).
4. **MFA** — `mfa_verified` must be `true` for any non-public route
   (NFR-004a). The browser and CLI flows both gate this through the
   `forge-mfa-choice` sub-flow (TOTP or WebAuthn).
5. **Not expired** — `exp` must be in the future; `nbf` must be in the
   past. A small clock-skew tolerance (60s) is permitted.

If any check fails, the middleware returns 401 and never opens a DB
session.

## Per-request DB session context

The middleware acquires a connection from pgbouncer (transaction-pooled)
and immediately issues:

```sql
SET LOCAL app.tenant_id = '<uuid>';
SET LOCAL app.bypass_rls = 'off';
-- optional, only for forge-admin override paths:
SET LOCAL app.bypass_rls = 'on';
```

These statements run inside a transaction, so the GUCs are scoped to the
single transaction and reset by pgbouncer's `server_reset_query = RESET ALL`
when the connection is returned to the pool.

The middleware opens the transaction lazily — only when the first query
that needs DB access is issued. Pure-CPU handlers (e.g. health checks)
never open a transaction at all.

## Super-admin / platform-admin bypass

Platform staff (members of the `/forge-admins` group) sometimes need to
read across tenants — for example, to investigate a customer issue that
spans tenants, or to backfill a cross-tenant report. To make this safe:

1. The JWT must carry the `forge-admin` realm role.
2. The request must include the header `X-Forge-Tenant-Override: <uuid>`.
   (No header → the JWT's own `tenant_id` is used; no bypass.)
3. The override UUID must reference a real tenant row (verified by a
   `SELECT id FROM tenants WHERE id = $1` lookup; cached for 60s).
4. The middleware sets `SET LOCAL app.bypass_rls = 'on'` and
   `SET LOCAL app.tenant_id = '<override-uuid>'`.
5. The audit log captures the override: `who`, `target tenant`,
   `reason` (an optional `X-Forge-Audit-Reason` header — required for
   non-emergency reads), `trace_id`, `request path`, `request method`.
6. The audit entry is **synchronous** — the request does not return
   200 until the audit row is durable. (WORM storage per ADR-0008.)

If `forge-admin` is set but `X-Forge-Tenant-Override` is missing, the
middleware behaves like a normal user with `tenant_id` set to the JWT's
own claim. This means admins must opt in to cross-tenant reads
explicitly per request.

## Missing / invalid tenant_id

| Condition                                                | Response                                              |
|----------------------------------------------------------|-------------------------------------------------------|
| JWT missing `tenant_id` claim                            | 403 `tenant_id_required`                              |
| `tenant_id` claim is not a valid UUID                    | 401 `invalid_tenant_claim`                            |
| `tenant_id` UUID does not match any row in `tenants`     | 403 `unknown_tenant`                                  |
| `tenant_id` UUID is the *null tenant* (all zeros)        | 403 unless `forge-admin` role + `X-Forge-Tenant-Override` |
| JWT `mfa_verified` is false (protected route)            | 403 `mfa_required`                                    |
| Override header set, but no `forge-admin` role           | 403 `admin_required_for_override`                     |
| Override header set, but UUID is unknown                 | 403 `unknown_tenant`                                  |

In every case the middleware emits a `WARN` log with the trace_id and
the failure reason. Failure paths never set `app.tenant_id` and never
return a connection that has the GUC set to a stale value.

## Audit logging for cross-tenant access

A single audit row covers the full request:

```json
{
  "event_type":   "auth.tenant_override",
  "actor_user":   "9f8e7d6c-5b4a-3210-...",
  "actor_roles":  ["forge-admin"],
  "actor_jwt_sub":"forge-admin:9f8e7d6c-...",
  "target_tenant":"9c3b1e2a-7d40-4f57-9b0e-3a55c1e6e2b1",
  "request_path": "/api/v1/projects",
  "request_method": "GET",
  "reason":       "CUSTOMER-1234 escalation",
  "trace_id":     "01HXY...",
  "ts":           "2026-06-21T11:42:13.412Z"
}
```

The row goes to the append-only WORM audit table per ADR-0008 and to
the structured log sink in parallel. Retention is 365 days for
override events (longer than the 90-day default in `realm-forge.json`).

## Request flow (ASCII)

```
                       ┌──────────────────┐
   Client ──HTTPS────▶ │  FastAPI gateway │
                       └────────┬─────────┘
                                │  Authorization: Bearer <jwt>
                                ▼
                  ┌─────────────────────────────┐
                  │ TenantMiddleware (per req)  │
                  │                             │
                  │ 1. Verify JWT (JWKS cache)  │
                  │ 2. Check iss, aud, mfa      │
                  │ 3. Extract tenant_id claim  │
                  │ 4. Validate tenant exists   │
                  │ 5. Resolve override header  │
                  └────────┬────────────────────┘
                           │
        ┌──────────────────┴───────────────────┐
        │  No override                        │  Override
        ▼                                      ▼
   SET LOCAL app.tenant_id = jwt.tenant_id   SET LOCAL app.bypass_rls = 'on'
   SET LOCAL app.bypass_rls = 'off'          SET LOCAL app.tenant_id  = override
        │                                      │
        └──────────────────┬───────────────────┘
                           ▼
                  ┌─────────────────────┐
                  │ pgbouncer (txn pool)│
                  │  RESET ALL on return│
                  └────────┬────────────┘
                           ▼
                  ┌─────────────────────┐
                  │ PostgreSQL          │
                  │  RLS policies       │
                  │  (tenant_isolation_*)│
                  └────────┬────────────┘
                           ▼
                  ┌─────────────────────┐
                  │ Route handler       │
                  │  (FastAPI)          │
                  └────────┬────────────┘
                           ▼
                       Response
                           │
                  ┌────────┴────────────┐
                  │  Audit sink         │  ◀── if override: auth.tenant_override event
                  │  (WORM + log)       │
                  └─────────────────────┘
```

## Edge cases & gotchas

- **pgbouncer transaction mode + `LISTEN`/`NOTIFY`**: not supported.
  Don't use Postgres LISTEN in tenant-scoped handlers; use the audit
  event bus instead.
- **Asyncpg + prepared statements**: prepared statement names live in the
  session, not the transaction. With `pool_mode = transaction`, the
  statement is silently re-prepared on each transaction. This is fine
  for performance but means *named* prepared statements are not shared
  across transactions. Default to unnamed statements (`stmt_cache_size=0`
  in asyncpg is OK) or accept the re-prepare cost.
- **Long-lived background workers**: a worker that runs outside of a
  request (e.g. a cron tick) must call `assert_tenant_context()` and
  fail loudly if `app.tenant_id` is unset. There is no middleware to
  set it for them.
- **Migrating tenants**: if a user's `tenant_id` changes, revoke all
  their refresh tokens (`/admin/realms/forge/users/{id}/logout`) to
  force re-issuance with the new claim.
- **Clock skew**: the JWKS verifier should use the JWT's `iat`/`exp`
  with ±60s tolerance; larger windows weaken MFA guarantees.
