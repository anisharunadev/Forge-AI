# agents/audit — FORA-36

The foundation audit system: append-only event store of every agent
action, with a hash-chained integrity guarantee and a tenant-scoped
read API.  See [docs/adr/0001-audit-system-one-way-doors.md](../../../docs/adr/0001-audit-system-one-way-doors.md)
for the one-way-door decisions and the issue body for the acceptance
bar.

## What this ships

| Deliverable | Where | Notes |
| --- | --- | --- |
| Append-only event store | `store.py` | In-memory + JSONL file in dev; Postgres + SQS in prod (deferred) |
| Structured event schema | `schema.py` | The issue-body contract, verbatim |
| Hash chain | `chain.py` | Per (tenant, run); SHA-256 over canonical JSON + prev_hash |
| Retention hook | `retention.py` | Per-tenant policy; default 13mo hot, 7yr cold |
| Read API | `reader.py` | Tenant-scoped; `read_run`, `read_tenant`, `verify_run`, `cost_summary` |
| Admin override | `admin.py` | Every override emits an `admin_override` event |
| Runtime emit | `emit.py` | One helper per event type; the single audit boundary |
| Feature flag | `feature_flag.py` | `FORA_AUDIT_ENABLED`; default on |

## Schema (issue body, verbatim)

```
runId, agentId, tenantId, stage, tool,
inputDigest, outputDigest, costCents,
promptTokens, completionTokens, wallMs
```

The schema also carries stable internal fields (`eventId`,
`eventType`, `timestamp`, `prevHash`, `recordHash`, and a few
optional ones) — these are part of the on-disk format and any
change bumps `AUDIT_SCHEMA_VERSION`.

## Hash-chain contract

`record_hash = SHA256(canonical_json(event w/o recordHash) || prev_hash)`

- The chain head is the `(tenant_id, run_id)` pair.  Each pair has
  its own independent chain.
- `prev_hash` of the first event in a run is `GENESIS_HASH`
  (64 hex zeros).
- The verifier (`HashChain.verify`) walks one run in append order.
  A break is reported as a `ChainBreak` record with reason
  `prev_hash_mismatch` or `self_hash_mismatch`; a deleted event
  surfaces as `event_redacted` (a synthetic event appended by the
  admin path).

## Read API

`AuditReader` is the only sanctioned read path.  Every method
takes `tenant_id` first and refuses to return events from a
different tenant.  The cost summary is a primary consumer for
[FORA-75 (0.6 Cost tracking)](../../../../issues/FORA-75) — 0.6
reads from this store rather than maintaining a parallel ledger.

## Feature flag

`FORA_AUDIT_ENABLED=1` (default) — events are appended.
`FORA_AUDIT_ENABLED=0` — events are dropped (no-op store).  The
flag is read on every emit; flipping it does not retroactively
restore dropped events.

## Out of scope (deferred to dependent issues)

- Production Postgres role separation + DB-level append-only
  triggers — `PostgresStore` stub is the seam; the actual
  role/trigger SQL is a separate ticket that the DevOps hire owns.
- Cross-account SQS shipping to the audit account — the
  `InMemoryStore` is the dev path; the SQS adapter is a stub.
- Board UI views — consumed by the Forge console team
  (FORA-110 / Phase 1 of the roadmap).

## Running the tests

```
python3 -m agents.audit.tests.test_emit
python3 -m agents.audit.tests.test_chain
python3 -m agents.audit.tests.test_retention
python3 -m agents.audit.tests.test_read_api
```

Each test prints `OK` or `FAIL` with a list of failures.  Evidence
artefacts are written to `agents/audit/evidence/`.
