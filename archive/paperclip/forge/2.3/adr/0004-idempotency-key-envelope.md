---
version: 0.1.0
last-reviewed-by: cto
last-reviewed-at: 2026-06-17
parent-prd: workspace/project/PRD.md
parent-issue: Forge AI-35
sub-goal: "2.3 — Design generation (design-generator)"
epic: Forge AI-18 (Epic 2 — Architecture Agent)
---

# ADR-0004 — Idempotency-Key on every mutating call; replay-or-conflict envelope

- **Status:** proposed
- **Date:** 2026-06-17
- **Deciders:** CTO
- **Sub-goal:** Forge AI-35 (2.3 — Design generation)
- **Supersedes:** none
- **Superseded by:** none
- **Parent ADRs:** architecture memory §7, [`packages/db-migrator/migrations/0003_agent_run_idempotency_keys.sql`](../../../packages/db-migrator/migrations/0003_agent_run_idempotency_keys.sql)

## Context

Architecture memory §7 mandates idempotency keys on every mutating call: a retry must be a no-op. The platform's primary mutating surface is the Orchestrator's REST + gRPC API (`POST /v1/runs`, `POST /v1/runs/{id}/transitions`, `POST /v1/approvals/{id}/decisions`, `POST /v1/tenants/{id}/cloud/assume`, `Orchestrator.AdvanceStage`, `Orchestrator.CreateRun`).

The 2.3 design pass has to lock three things the migration alone does not decide:

1. **The header shape** — `Idempotency-Key: <UUIDv4>` on every mutating call.
2. **The replay-or-conflict decision** — a retry with the same key + same request fingerprint returns the cached response; a retry with the same key + a different fingerprint returns `409 IDEMPOTENCY_CONFLICT`.
3. **The TTL** — the migration comment says "7 days in v1"; this ADR codifies it and names the retention job.

This is a one-way door per architecture memory §5: the response-cache contract is encoded in every client, every test, and every runbook. Reverting to "best-effort dedupe" requires ripping the column out of the contract and accepting duplicate writes on retry.

## Decision

We adopt the following contract on every mutating endpoint:

1. **Header:** `Idempotency-Key: <UUIDv4>` is required. A request without the header returns `400 IDEMPOTENCY_KEY_REQUIRED` (gRPC: `INVALID_ARGUMENT` with `idempotency_key_required = true`).
2. **Request fingerprint:** the server computes `SHA-256(canonical_request_body)` after sorting keys, stripping whitespace, and lowercasing the header set. The fingerprint is stored with the response.
3. **Replay:** a request with the same `(tenant_id, key)` and the same fingerprint returns the **cached response status + body** (with a `Replay: true` header so the caller can tell). No side effects.
4. **Conflict:** a request with the same `(tenant_id, key)` and a **different** fingerprint returns `409 IDEMPOTENCY_CONFLICT` with `{error: {code, request_id, retry_after_ms: null}}`. The caller must mint a new key.
5. **Storage:** `agent_run_idempotency_keys` table (migration 0003). Primary key `(tenant_id, key)`. `run_id` is nullable (an idempotent request may precede a run). On `agent_runs` soft-delete, the key is kept (ON DELETE SET NULL) so a replay still works.
6. **TTL:** 7 days. A nightly job (`packages/db-migrator/jobs/idem_retention.sql`, forthcoming) deletes rows older than 7 days. The job is idempotent and tenant-scoped.
7. **Visibility:** the `audit_log` records the idempotency key on every mutating action; a query "which calls mutated this run?" is one join.
8. **In-process lock:** the server takes a `pg_advisory_xact_lock(hashtext(tenant_id || ':' || key))` at the start of the transaction to serialize concurrent retries. The lock is released at COMMIT.

## Consequences

**Easier:**

- A client retry (network blip, 503 from the orchestrator, the agent loop) is provably a no-op.
- The audit trail can reconstruct every mutation, in order, with the response body that was returned.
- A flaky agent cannot double-post a PR or double-charge a budget.

**Harder:**

- Every client (Forge console, MCP server, agent runtime) must generate a UUIDv4 per call. The 2.3 design pass writes a typed `withIdempotencyKey` helper for the TS clients and a `idempotency_key` context for the Python clients.
- The 7-day retention is a real background job; the runbook (`docs/runbooks/idem-retention.md`, forthcoming) is the only acceptable response to a job failure.
- A buggy client that reuses a key with a new payload (the conflict path) gets a 409 — which is correct, but loud. A typed error code with a clear `request_id` is the only way this does not become "did my write go through?" support tickets.

**Accepted:**

- The advisory lock is per `(tenant_id, key)`, not global. Two different tenants can mutate concurrently.
- The fingerprint canonicalization is documented in `packages/contracts/src/idempotency.ts` and is the spec; the JS/Python implementations must produce the same hash byte-for-byte (test fixture committed in the package).

## Alternatives considered

1. **Server-generated dedupe (auto-key from request hash).** Rejected: the client cannot tell the difference between a retry and a new call. The whole point of an idempotency key is that the **client** decides "this is the same call."
2. **No idempotency, just optimistic concurrency (`If-Match`).** Rejected: `If-Match` protects against lost updates, not against duplicate writes. The platform needs both — `If-Match` on `agent_runs` and `Idempotency-Key` on the mutating call.
3. **Stripe-style `idempotency_key` in the request body.** Rejected: headers are the standard place (RFC 8594 draft, used by Stripe, Square, Adyen); the body field collides with the payload.
4. **In-memory dedupe (Redis with a short TTL).** Rejected: a Redis flush on incident loses dedupe; a tenant restart is invisible. The Postgres-backed store survives both.
5. **30-day TTL.** Rejected: a retry after 7 days is almost certainly a bug, not a network blip. 7 days matches Stripe's default and is long enough for the agent loop's worst case.
6. **A separate `idempotency_keys` schema with hash partitioning.** Deferred: the table size at v1 GA (~10k keys/day × 7 days = 70k rows) does not justify partitioning. Revisit at v1.1 if the table crosses 10M rows.
