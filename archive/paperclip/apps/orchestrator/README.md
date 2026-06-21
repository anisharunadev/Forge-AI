# @fora/orchestrator — Master Orchestrator (Forge AI-50 / Forge AI-134)

**Status:** 0.1.0 (first-pass CTO delivery — Forge AI-134 acceptance)
**Sub-task:** [Forge AI-134](/Forge AI/issues/Forge AI-134) — 0.1.1 Session lifecycle
**Spec:** [Forge AI-50 spec §3, §4, §9](/Forge AI/issues/Forge AI-50#document-spec), [ADR-0009](/Forge AI/docs/architecture/adr-0009-soft-delete-runs-events.md)

The Master Orchestrator owns the session lifecycle of a Forge AI run:
`create / pause / resume / cancel`, durable across crashes, with
`Idempotency-Key` on every mutating call. The four sibling sub-tasks
(`Forge AI-135` stage engine, `Forge AI-136` event bus, `Forge AI-137` human-approval
router) build on this service.

## Endpoints (Forge AI-50 §4.1 subset shipped in 0.1.1)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/runs` | Create a run (trigger) — writes `agent_runs` + 7 `agent_run_stages` rows in one transaction. |
| `GET`  | `/v1/runs/{id}` | Read run header. 404 for cross-tenant or soft-deleted. |
| `GET`  | `/v1/runs/{id}/stages` | List the seven stage rows in canonical order. |
| `POST` | `/v1/runs/{id}/pause`  | Operator pause. Idempotent. |
| `POST` | `/v1/runs/{id}/resume` | Operator resume. Idempotent. |
| `POST` | `/v1/runs/{id}/cancel` | Operator cancel (terminal). Idempotent. |
| `GET`  | `/healthz` | Liveness. |

The remaining Forge AI-50 §4.1 endpoints (`/events`, `/soft-delete`,
`/restore`, `/approvals/{id}/decide`, `/stages/{stage}/return`) are
owned by Forge AI-136, Forge AI-137, and the v1.1 ADR.

## Idempotency contract

Every mutating call requires an `Idempotency-Key` header (UUID v4, per
spec rev 2 editorial). Three outcomes:

1. **First call** — handler runs, response is stored.
2. **Replay (same key + same body)** — cached response is returned with
   `idempotent-replay: true` header; the handler does NOT re-run.
3. **Conflict (same key + different body)** — `409 IDEMPOTENCY_CONFLICT`.

The dedupe store is the `agent_run_idempotency_keys` table (see
`migrations/0003_*`). The store is the single source of truth for
replay: a future v1.1 ADR may add a TTL job, but no TTL is enforced in
0.1.

## Crash recovery (Forge AI-134 acceptance #4)

`buildRecoveryTickets(pool, tenantId)` reads every non-terminal run for
the tenant and returns one ticket per run. The ticket carries the run
header, the seven stage rows, and the `resumeFrom` stage (the row
matching `run.current_stage`). The actual resume is the stage engine's
job in Forge AI-135; this service hands the engine the read-side data.

## Soft-delete invariant (ADR-0009)

Every read and write in `repo.ts` filters `deleted_at IS NULL`. A
soft-deleted run is invisible to the API (returns 404, not 410).
The audit account owns the row for retention. Hard-delete is a DBA
path with a 1Password-held credential; no product endpoint deletes.

## Running locally

```bash
# from this directory
pnpm install
pnpm typecheck
pnpm test

# against a real Postgres (Forge AI_DATABASE_URL must be set)
Forge AI_DATABASE_URL=postgres://user:pass@localhost:5432/fora \
Forge AI_ORCHESTRATOR_PORT=8082 \
pnpm dev
```

The bin entry applies migrations on boot via `@fora/db-migrator`. A
re-run is a no-op.

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `Forge AI_ORCHESTRATOR_PORT` | `8082` | HTTP port |
| `Forge AI_ORCHESTRATOR_HOST` | `0.0.0.0` | Bind host |
| `Forge AI_DATABASE_URL` | (required) | Postgres connection string |
| `Forge AI_DEFAULT_COST_CEILING_USD` | `100.00` | Per-run ceiling (Forge AI-50 §3.1) |
| `Forge AI_ORCHESTRATOR_LOG_LEVEL` | `info` | pino log level |
| `Forge AI_ENV` | `dev` | `dev` / `test` / `prod` |
| `Forge AI_BOOT_RECOVERY_TENANT_ID` | unset | Optional: rebuild recovery tickets on boot for a single tenant (debug only) |

## Auth model

The Orchestrator trusts the upstream gateway to have verified the JWT
and stamped `x-fora-tenant-id` on the request (ADR-0003 §4.2). A v1.1
ADR moves JWT validation in-process; today, missing tenant header is a
401 with `VALIDATION` code.

## Tests

Unit tests cover the pure modules (state machine, fingerprinting, UUID
parser, stages list). HTTP-level tests use an in-memory Pool shim that
implements just enough of `pg.Pool` for the lifecycle queries; the
real-Postgres RLS property-based test in `@fora/db-migrator` is the
integration tier. A v0.2 testcontainers job will close the seam.

```bash
pnpm test
```

## Follow-ups (deferred, tracked)

- **Forge AI-135** — Stage transition engine (uses the seven-stage spine
  in `agent_run_stages`; this service exposes the read-side, Forge AI-135
  owns the write-side).
- **Forge AI-136** — Event bus + `agent_run_events` (append-only table;
  ADR-0009 §5 trigger; this service emits the bus events in 0.2).
- **Forge AI-137** — Human-approval router + `agent_run_approvals`
  (separate table; uses the `request_confirmation` primitive per
  ADR-0008).
- **v1.1 ADR** — `POST /v1/runs/{id}/soft-delete` + `/restore`
  endpoints (ADR-0009 §6).
- **v1.1 ADR** — In-process JWT validation; today the gateway owns it.
