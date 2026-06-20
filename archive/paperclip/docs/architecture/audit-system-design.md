# 0.5 Audit System — Design (v0.1)

**Issue:** [Forge AI-36](/Forge AI/issues/Forge AI-36)
**Status:** proposed (rev 1, 2026-06-17)
**Owner:** CTO (until `audit-agent` is hired)
**Parent:** [Forge AI-16 Epic 0 — Forge AI Platform Foundation](/Forge AI/issues/Forge AI-16)
**Plan:** [Forge AI-15 plan §1 Epic 0](/Forge AI/issues/Forge AI-15#document-plan)
**Related:** [architecture.md §6 data model, §7 API design](../../workspace/memory/architecture.md), [security.md §7 audit logging](../../workspace/memory/security.md), [tech-stack.md §4 data layer](../../workspace/project/tech-stack.md)

> If a future sub-agent is woken cold on the audit system, **this file is the entry point**. The schema, the hash chain shape, the append-only enforcement model, the cross-account boundary, the read API contract, and the tool-call integration contract are all defined here. Read this end-to-end before changing any audit code.

---

## 1. Goals

The audit system is the **forensic record of every agent action in the platform**. The non-negotiable properties:

1. **Append-only.** No in-place edits. No in-place deletes (except by the explicit admin-override path, which is itself audited).
2. **Tamper-evident.** Hash-chained records so a verifier detects any tampering, deletion, or reordering.
3. **Tenant-scoped.** Every row carries `tenant_id`. Every read filters by tenant. A query that does not is a bug.
4. **Tool-call-granular.** Every tool call from a sub-agent emits exactly one audit event.
5. **Cost-aware.** The event payload carries the cost of the action in cents and the token usage in / out. The cost agent (0.6) reads from this store — no parallel ledger.
6. **Cross-account durable.** A compromise of the runtime account cannot rewrite history. The audit store lives in a separate AWS account with its own IAM boundary.
7. **Inspectable.** A board user can pull the audit trail for a single run and reconstruct the agent's decision path.

## 2. Non-goals (v1)

- **Not a log analytics product.** We do not build a SIEM, a query DSL, or a dashboard. Postgres and the read API are enough. OpenSearch is a v1.1 conversation.
- **Not a streaming pipeline.** v1 ships the append path; an SQS-based replica to the audit account is a v1.0 stretch (see §6).
- **Not a compliance product.** The retention defaults match SOC 2; the admin override matches SOC 2; the per-tenant override is the customer contract lever.
- **Not free-form text storage.** The metadata field is restricted to a typed shape (see §4). Bodies of prompts and tool calls are stored in S3, addressable by digest, never in Postgres. This is the cost-and-PII lever.
- **Not the source of truth for the agent's plan.** The plan lives in the orchestrator state store (0.1). The audit log records that the plan existed and what it produced — the plan itself is not duplicated into the audit log.

## 3. Storage model

### 3.1 Database and account boundary

- **Engine:** PostgreSQL 16 (per [tech-stack.md §4](../../workspace/project/tech-stack.md)).
- **Cluster:** a dedicated **RDS instance in the audit account** (per [security.md §7](../../workspace/memory/security.md)). The platform account's writer ships events across the account boundary; the audit account has no inbound path except the writer.
- **Schema:** a dedicated `audit` schema inside the audit account's Postgres. No other service reads or writes the `audit` schema.
- **Read replica:** the read API uses a read-replica pointed at the same cluster. The writer never reads; the reader never writes. They are separate roles.

### 3.2 Tables

```sql
-- The event table. Append-only at the DB level (see §5).
CREATE TABLE audit.events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid        NOT NULL,
  agent_id          text        NOT NULL,
  tenant_id         text        NOT NULL,
  stage             text        NOT NULL CHECK (stage IN
                      ('ideation','architect','dev','qa','security','devops','docs','platform')),
  tool              text        NOT NULL,           -- e.g. 'jira.createIssue', 'llm.invoke'
  input_digest      text        NOT NULL,           -- sha256 hex of canonicalized input
  output_digest     text        NOT NULL,           -- sha256 hex of canonicalized output
  input_ref         text,                           -- s3:// key when input body is persisted; null otherwise
  output_ref        text,                           -- s3:// key when output body is persisted; null otherwise
  cost_cents        bigint      NOT NULL DEFAULT 0,
  prompt_tokens     integer     NOT NULL DEFAULT 0,
  completion_tokens integer     NOT NULL DEFAULT 0,
  wall_ms           integer     NOT NULL,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  prev_hash         text,                           -- hex of previous record_hash in (tenant_id, run_id) chain
  record_hash       text        NOT NULL,           -- hex sha256 of canonical (this row w/o record_hash) || prev_hash
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_run      ON audit.events (tenant_id, run_id, recorded_at);
CREATE INDEX idx_events_agent    ON audit.events (tenant_id, agent_id, recorded_at);
CREATE INDEX idx_events_stage    ON audit.events (tenant_id, stage, recorded_at);
CREATE INDEX idx_events_recorded ON audit.events (tenant_id, recorded_at);

-- Per-tenant retention setting. One row per tenant; default retention is 395 days (13 months hot).
CREATE TABLE audit.retention_policy (
  tenant_id        text        PRIMARY KEY,
  retention_days   integer     NOT NULL DEFAULT 395 CHECK (retention_days >= 30),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text        NOT NULL
);

-- Admin override log. Records every deletion / hard-redaction event. Retained for 7 years
-- independent of the event retention policy. This is the SOC 2 chain-of-custody record.
CREATE TABLE audit.admin_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text        NOT NULL,
  action            text        NOT NULL CHECK (action IN
                      ('event_deleted','event_redacted','retention_purge_run','retention_policy_changed')),
  target_event_id   uuid,                          -- null for retention_purge_run
  reason            text        NOT NULL,
  admin_actor_id    text        NOT NULL,           -- user id of the human admin (never an agent)
  prev_hash         text,                           -- hex of previous record_hash in (tenant_id) chain
  record_hash       text        NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_log_tenant ON audit.admin_log (tenant_id, recorded_at);
```

### 3.3 Indexes and query patterns

The (tenant_id, run_id, recorded_at) index serves the dominant read: "give me the audit trail for this run, in order." Every read path is a `WHERE tenant_id = $1 AND ...` — no exceptions. The (tenant_id, recorded_at) index serves retention and the board-level "show me everything in the last hour" view.

## 4. Event schema (canonical, machine-readable)

```typescript
// packages/contracts/src/audit-event.ts
export interface AuditEventV1 {
  readonly id: string;            // uuid v4
  readonly runId: string;         // uuid v4, set by the orchestrator
  readonly agentId: string;       // e.g. "audit-agent", "coding-agent"
  readonly tenantId: string;      // from the JWT, never from the caller
  readonly stage: StageName;      // 'ideation' | 'architect' | 'dev' | 'qa' | 'security' | 'devops' | 'docs' | 'platform'
  readonly tool: string;          // e.g. "jira.createIssue", "llm.invoke", "audit.query"
  readonly inputDigest: string;   // sha256 hex of canonicalized input payload
  readonly outputDigest: string;  // sha256 hex of canonicalized output payload
  readonly inputRef?: string;     // s3:// key when body is persisted (tools in audit.always_log)
  readonly outputRef?: string;    // s3:// key when body is persisted
  readonly costCents: number;     // LLM + tool cost in cents; integer
  readonly promptTokens: number;  // integer, 0 for non-LLM tools
  readonly completionTokens: number; // integer, 0 for non-LLM tools
  readonly wallMs: number;        // integer, wall-clock duration
  readonly metadata: AuditMetadataV1; // typed, see below
  readonly prevHash: string | null; // hex of previous record_hash in (tenantId, runId) chain
  readonly recordHash: string;    // hex sha256 of canonical (everything except recordHash) || prevHash
  readonly recordedAt: string;    // ISO 8601 UTC with millisecond precision
}

export interface AuditMetadataV1 {
  readonly model?: { provider: string; name: string; cacheHit?: boolean };
  readonly toolArgsRedacted?: boolean;  // true when args contained PII and were dropped from the S3 payload
  readonly toolResultRedacted?: boolean;
  readonly traceId?: string;             // OTel trace id, when available
  readonly spanId?: string;
  readonly caller?: { agentId: string; stage: StageName };  // who triggered this call
  readonly approvalId?: string;          // human approval ticket id, when the tool required one
}
```

**Metadata is typed, not freeform.** A new metadata field is a contract change and requires an ADR + a major version bump on the event schema. This is the PII lever — the contract cannot drift into storing PII by accident.

**Bodies of prompts and tool calls live in S3**, not in Postgres. The `inputRef` / `outputRef` carry the S3 key. The S3 bucket is in the audit account, SSE-KMS encrypted, with bucket policy denying delete. The `input_digest` / `output_digest` are the integrity proof — the body can be re-fetched and re-hashed to verify.

## 5. Hash chain

### 5.1 Shape

The chain is **per (tenant_id, run_id)**, not per tenant. This gives:

- An isolated chain per workflow. A verifier can check one run without walking the full tenant log.
- A natural fit for the dominant read pattern: "show me the audit trail for this run."
- A manageable chain length per verification.

The `prev_hash` of the first event in a run is `null`. The `record_hash` of every event is:

```
record_hash = SHA256( canonical_json(event with record_hash set to null) || prev_hash )
```

`canonical_json` is the JSON serialization with sorted keys, no whitespace, UTF-8, and `record_hash` set to `null` so the hash is self-consistent. The library lives in `packages/audit-hash` and is shared between the writer and the verifier.

### 5.2 Verification

The read API exposes `POST /v1/tenants/{tenant}/audit/runs/{runId}/verify` (admin-scoped). It walks the chain, recomputes each `record_hash`, and reports:

- `verified: true` if every record's `record_hash` matches the recomputed value and every `prev_hash` matches the previous record's `record_hash`.
- `verified: false` plus the offending event id and the reason (`hash_mismatch`, `prev_hash_mismatch`, `event_missing`, `event_redacted`).

A redacted or deleted event is a chain break, not a verification failure. The response carries the break point and the corresponding `audit.admin_log` row that authorized it.

### 5.3 Admin override is a chain break by design

When an admin deletes or redacts an event, the deletion is itself recorded in `audit.admin_log`, **and** a synthetic `audit:event_deleted` event is appended to the main chain so the chain's monotonicity is preserved. The verifier reports the deletion as a "redacted" record — the chain is intact, the body is gone, and the admin log carries the reason.

## 6. Append-only enforcement

This is the property that matters most. We enforce it at three layers; the database is the floor.

### 6.1 Database role (the floor)

Two roles, both created in the audit account's Postgres:

- `audit_writer` — `INSERT` on `audit.events` and `audit.admin_log`. **No `UPDATE`, no `DELETE`, no `TRUNCATE`.** `SELECT` only on `audit.retention_policy` and `audit.admin_log` (for the writer's own self-check).
- `audit_reader` — `SELECT` on all `audit.*` tables. No writes of any kind.
- `audit_admin` — `INSERT` and `DELETE` on `audit.events` and `audit.admin_log`. `SELECT` and `UPDATE` on `audit.retention_policy`. **The `audit_admin` role's credentials are held by a single human, in 1Password, rotated every 90 days, with usage alerted on.** No agent — not the CTO, not the audit-agent, not the runtime — has the `audit_admin` credentials. The admin override is a human action, full stop.

The writer application connects as `audit_writer`. The read API connects as `audit_reader`. The retention job and admin override run as `audit_admin` from a separate, human-initiated process.

### 6.2 Triggers (the belt)

```sql
CREATE OR REPLACE FUNCTION audit.deny_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit.events is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_update BEFORE UPDATE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION audit.deny_modification();
CREATE TRIGGER events_no_delete BEFORE DELETE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION audit.deny_modification();
```

The triggers run for `audit_writer` and `audit_reader` (they cannot modify) and for `audit_admin` (so the admin path goes through the explicit function, not a raw DELETE).

### 6.3 Cross-account boundary (the wall)

- The audit account is a **separate AWS account** with its own IAM boundary, per [security.md §7](../../workspace/memory/security.md).
- The platform account has **no `audit_admin` credentials**. The only cross-account access is the writer SQS queue, with an account-boundary resource policy.
- The writer is a single-purpose Lambda / worker in the platform account, with the only permission being `sqs:SendMessage` to the audit account's queue.
- The audit account consumes the queue and inserts via the `audit_writer` role. The audit account cannot reach back into the platform account.

A compromise of the runtime account cannot rewrite history because the runtime account has no write path into the audit account's database, and no `audit_admin` credentials.

### 6.4 Admin override (the only path that breaks append-only)

```sql
CREATE OR REPLACE FUNCTION audit.admin_delete_event(
  p_event_id    uuid,
  p_reason      text,
  p_admin_id    text
) RETURNS uuid AS $$
DECLARE
  v_tenant_id text;
  v_admin_log_id uuid;
BEGIN
  -- Verify the caller is audit_admin (role check is enforced at login; this is a sanity check).
  IF current_user <> 'audit_admin' THEN
    RAISE EXCEPTION 'audit.admin_delete_event requires the audit_admin role';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM audit.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found', p_event_id;
  END IF;

  -- 1. Insert the admin_log record first (append-only path).
  INSERT INTO audit.admin_log (tenant_id, action, target_event_id, reason, admin_actor_id)
  VALUES (v_tenant_id, 'event_deleted', p_event_id, p_reason, p_admin_id)
  RETURNING id INTO v_admin_log_id;

  -- 2. Delete the event (audit_admin path).
  DELETE FROM audit.events WHERE id = p_event_id;

  -- 3. Insert a synthetic event in the main chain noting the deletion.
  -- (Implemented as a separate insert via audit.events; record_hash continues from the deletion's prev.)
  PERFORM audit.record_event(
    v_tenant_id,                -- tenant
    (SELECT run_id FROM audit.events WHERE id = p_event_id),
    'audit',                    -- stage
    'audit.event_deleted',      -- tool
    jsonb_build_object('deleted_event_id', p_event_id, 'reason', p_reason, 'admin_actor_id', p_admin_id, 'admin_log_id', v_admin_log_id)
  );

  RETURN v_admin_log_id;
END;
$$ LANGUAGE plpgsql;
```

The function is the **only** path that can `DELETE FROM audit.events`. There is no other grant, no other function, no `psql` session with the credentials. The audit-admin role's credentials are in 1Password, rotated every 90 days, and every use is alerted on (CloudTrail → PagerDuty).

## 7. Read API (REST, tenant-scoped, OpenAPI 3.1)

All endpoints under `/v1/`. All requests authenticated via OIDC JWT (per [tech-stack.md §9](../../workspace/project/tech-stack.md)). Tenant is derived from the JWT — never from the URL or body.

| Method | Path | Purpose | Scope |
| --- | --- | --- | --- |
| `GET` | `/v1/audit/runs?since=&until=&stage=&agentId=&limit=&cursor=` | List runs in the tenant | board, ceo, audit-reader |
| `GET` | `/v1/audit/runs/{runId}` | All events for a run, in order | board, ceo, audit-reader |
| `GET` | `/v1/audit/events/{eventId}` | Single event (no body, only digest + ref) | audit-reader |
| `GET` | `/v1/audit/events/{eventId}/body?kind=input\|output` | Fetch the persisted body (S3 signed URL, time-limited) | audit-reader |
| `POST` | `/v1/audit/runs/{runId}/verify` | Walk the chain, return verification report | audit-admin |
| `GET` | `/v1/audit/retention` | Get the tenant's retention policy | board, ceo |
| `PATCH` | `/v1/audit/retention` | Update the tenant's retention policy | audit-admin |
| `GET` | `/v1/audit/admin-log?since=&until=` | Read the admin override log | audit-admin |
| `GET` | `/v1/audit/cost/by-run/{runId}` | Cost rollup for a run (used by 0.6 Cost agent) | cost-reader |
| `GET` | `/v1/audit/cost/by-agent?agentId=&since=&until=` | Cost rollup for an agent | cost-reader |

The body-fetch endpoint is the only path to the unredacted prompt/tool body. It is gated by `audit:read-body` permission and the S3 URL is signed for 60 seconds. The body is fetched via the audit account's S3, never via the platform account.

**Error envelope** (per [architecture.md §7](../../workspace/memory/architecture.md)):

```json
{ "error": { "code": "TENANT_MISMATCH", "message": "event belongs to a different tenant", "requestId": "..." } }
```

**Idempotency keys** on `PATCH /v1/audit/retention` (per [architecture.md §7](../../workspace/memory/architecture.md)). Reads are idempotent by definition.

**OpenAPI 3.1 spec** is published from the same source as the validator (`packages/contracts/src/audit-api.openapi.yaml`). The spec is the contract.

## 8. Retention

- **Default:** 395 days hot (13 months, per [security.md §7](../../workspace/memory/security.md)). Cold storage in S3 Glacier for 7 years; the cold copy is generated by the retention purge job and signed.
- **Per-tenant override:** `audit.retention_policy.retention_days` is the single knob. The minimum is 30 days. The maximum is 7 years. The override is itself audited in `audit.admin_log` with `action = 'retention_policy_changed'`.
- **Job:** a daily cron in the audit account, run as `audit_admin`, identifies events older than `retention_days` for each tenant, writes a `retention_purge_run` row to `audit.admin_log`, ships the events to a per-tenant S3 Glacier prefix with a manifest, then deletes the rows.
- **PII redaction vs. retention:** a `toolArgsRedacted` event body has its S3 object replaced with `{ "redacted": true, "redaction_reason": "...", "hash": "..." }` before the retention purge. The chain integrity is preserved (the `output_digest` still verifies), and the body is irrecoverable. The redaction is itself audited.

## 9. Tool-call integration (the contract for 0.2 Runtime and 0.1 Orchestrator)

Every sub-agent wraps its tool calls in a function the runtime provides. The runtime, in turn, calls the audit SDK. The sub-agent does not call the audit SDK directly — that would let a misbehaving sub-agent skip the audit. The wrapper is the only path.

```typescript
// packages/audit-sdk/src/with-audit.ts
export async function withAudit<T>(ctx: {
  tenantId: string;
  runId: string;
  agentId: string;
  stage: StageName;
  tool: string;
  approvalId?: string;
  traceId?: string;
  spanId?: string;
}, call: () => Promise<T>): Promise<{ result: T; event: AuditEventV1 }> {
  const startedAt = Date.now();
  let inputCanonical: string;
  let result: T;
  let err: unknown;
  try {
    result = await call();
    return { result, event: await emit(ctx, startedAt, null) };
  } catch (e) {
    err = e;
    await emit(ctx, startedAt, e);
    throw e;
  }
}
```

`emit` writes to a local durable buffer (the platform's queue), which a worker drains and ships to the audit account. The platform never inserts directly into the audit DB — it ships, the audit account inserts. **The platform cannot lose events silently** because the queue is SQS with a 14-day retention and a DLQ; the worker has a metric `audit.events.dropped` that pages on `> 0`.

The cost-tracking integration is the same call. The runtime reports `costCents`, `promptTokens`, `completionTokens` in the audit event; the cost agent (0.6) reads from the audit store via the `/v1/audit/cost/by-run/...` endpoints, and never maintains a parallel ledger.

## 10. Acceptance criteria — how the design satisfies them

| Acceptance criterion | Mechanism |
| --- | --- |
| Every tool call from a sub-agent emits exactly one audit event. | The runtime wraps every tool call in `withAudit`; the SDK emits exactly one event per call. Sub-agents cannot bypass the wrapper. |
| A board user can pull the audit trail for a single run and reconstruct the agent's decision path. | `GET /v1/audit/runs/{runId}` returns the events in `recorded_at` order with `tool`, `input_digest`, `output_digest`, `costCents`, `metadata.caller`. The board can follow the chain. |
| Deleting/editing an audit record requires explicit admin override and itself emits an audit record. | `audit.admin_delete_event` is the only path; the admin log carries the reason; a synthetic `audit:event_deleted` event continues the chain. |
| Cost-tracking system 0.6 reads from this store rather than maintaining a parallel ledger. | The cost agent consumes `/v1/audit/cost/by-run/{runId}` and `/v1/audit/cost/by-agent`. The audit event carries the cost. There is no second place to write cost. |

## 11. Open questions (for follow-up heartbeats)

- **Multi-region audit shipping.** v1 ships single-region. When we add eu-west-1 (Q2 2027 per [tech-stack.md §5](../../workspace/project/tech-stack.md)), the audit account boundary is per-region. This is a v1.1 follow-up.
- **Self-host on the customer's cloud.** A reference deployment of the audit store on the customer's own account (BYOK + customer-owned audit). The cross-account writer pattern still applies; the platform account's writer has a per-customer cross-account role. This is a v2 conversation.
- **Per-tool redaction policy.** Today, the `audit.always_log` list is global. A per-tenant override (the customer decides which tools get bodies persisted vs. digest-only) is a v1.1 follow-up.
- **Token-level audit (every LLM token, not every tool call).** Out of scope for v1; covered by Langfuse traces ([tech-stack.md §7](../../workspace/project/tech-stack.md)). The audit event carries the rollup, not the tokens.

## 12. Definition of done (for Forge AI-36)

Forge AI-36 (this design) is `done` when:

- The design document is reviewed by the CEO and Security Engineer (when hired) and any required changes are folded in.
- ADR-0001 captures the one-way door decisions.
- The child implementation issues are created and assigned.
- The audit-agent hire is in flight (or, until hired, the CTO owns the charter).

Forge AI-36 is **not** the implementation. Implementation lives in the child issues.

---

*End of design v0.1.*
