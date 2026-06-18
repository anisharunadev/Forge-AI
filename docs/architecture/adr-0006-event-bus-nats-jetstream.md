# ADR-0006: Event Bus — NATS JetStream (primary) + SQS+SNS bridge (cross-account)

| Field             | Value                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------|
| **Status**        | **Accepted**                                                                                   |
| **Date**          | 2026-06-17                                                                                     |
| **Author**        | CTO (f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)                                                     |
| **Reviewer**      | CTO (one-way door; per architecture.md §5) — CEO informational                                |
| **Issue**         | [FORA-50](/FORA/issues/FORA-50) Sub-goal 0.1 (Master Orchestrator)                            |
| **Sub-task**      | [FORA-136](/FORA/issues/FORA-136) (0.1.3 — Event bus)                                         |
| **Parent ADR**    | [ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md)                               |
| **Supersedes**    | none                                                                                           |
| **Superseded by** | none                                                                                           |

---

## 1. Context

[ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md) §3 makes the Master Orchestrator the only writer of run state and the event bus the only reader of state changes outside the Orchestrator. The [FORA-50 spec §5](/FORA/issues/FORA-50#document-spec) defines 19 typed events (`run_created`, `stage_started`, `cost_reported`, `invalid_transition`, etc.) that the rest of the platform subscribes to — Audit 0.5, Cost 0.6, Memory 0.4, the Forge console, and future customer webhooks.

Three event bus candidates were considered (see §7). Picking the bus is a one-way door per architecture.md §5: every producer and every consumer pins to its API, durability model, and subject pattern. Migrating later is a multi-quarter project, not a config change.

This ADR decides:
- The primary bus (the one the Orchestrator writes to and the platform reads from).
- The cross-account boundary mechanism (the audit account is a separate AWS account per [FORA-36 ADR](/FORA/docs/adr/0001-audit-system-one-way-doors.md) D3; the bus must cross that boundary without violating the IAM isolation).
- The subject model (per-tenant isolation, schema versioning, idempotency).
- The backpressure / replay / retention contract.

## 2. Decision

We adopt **NATS JetStream as the primary event bus** and stand up a **SQS+SNS bridge** as the cross-account transport to the audit account.

```
                     Primary account                         │  Audit account
                                                           │
  ┌─────────────────────────────────────────────────────┐  │  ┌──────────────────────────┐
  │  Master Orchestrator (the only writer)              │  │  │  Audit writer (worker)    │
  │  publishes to NATS JetStream                         │  │  │  consumes SQS → writes   │
  │  subject: fora.events.<tenant_id>.<event_type>.v1   │  │  │  to audit.events table   │
  └─────────────────────┬───────────────────────────────┘  │  └────────────┬─────────────┘
                        │                                  │               │
                        ▼                                  │               ▼
        ┌───────────────────────────────┐                  │     audit.events (Postgres)
        │  NATS JetStream               │                  │     (BYPASSRLS, append-only)
        │  per-tenant stream            │                  │
        │  retention: 7d hot, 30d cold  │                  │
        └──────────┬──────────┬─────────┘                  │
                   │          │                            │
                   ▼          ▼                            │
        ┌─────────────┐  ┌──────────────┐                  │
        │ Cost agent  │  │ Memory agent │                  │
        │ (sub.)      │  │ (sub.)       │                  │
        └─────────────┘  └──────────────┘                  │
                   │                                       │
                   └──── SNS topic ───▶ SQS queue ────────┘
                         (cross-account; account-boundary
                          resource policy on the SQS)
```

### 2.1 One-line summary

> "NATS JetStream inside the platform account for the 19 Orchestrator events; SQS+SNS bridge for the cross-account audit subscription; the Orchestrator is the only producer; per-tenant subject isolation; idempotency by event id."

## 3. Subject model and schema versioning

### 3.1 Subject scheme

```
fora.events.<tenant_id>.<event_type>.v<major>
```

- `<tenant_id>` — opaque string from the JWT claim (ADR-0003 §3.2). A tenant A consumer cannot subscribe to a subject matching tenant B because the broker enforces subject ACLs.
- `<event_type>` — one of the 19 typed events from FORA-50 spec §5.1 (`run_created`, `stage_started`, `cost_reported`, `invalid_transition`, etc.).
- `<major>` — major version. The Orchestrator publishes `v1` for all current events. A breaking change emits `v2` on a new subject and keeps `v1` for 30 days (per FORA-50 spec §5.2).

### 3.2 Per-event payload

```jsonc
{
  "v": "1.0.0",                  // schema version (semver; major=subject bump)
  "event_id": "evt-<uuid>",      // idempotency key; consumer dedupes on this
  "run_id": "<uuid>",
  "tenant_id": "tnt_8XQ…",
  "stage": "dev",                // or null for run-level events
  "event_type": "stage_completed",
  "occurred_at": "2026-06-17T12:34:56.789Z",
  "actor": { "type": "agent", "id": "agent:developer" },
  "payload": { /* event-specific */ }
}
```

`event_id` is generated by the Orchestrator as `uuidv7()`; consumers dedupe on it (FORA-50 spec §5.2).

### 3.3 Schema evolution rules

- **Additive change** (new optional field in `payload`): minor version bump, same subject, same consumer code. No coordination.
- **Breaking change** (rename, remove, semantic shift, type narrowing): major version bump, new subject `fora.events.<tenant_id>.<event_type>.v2`, **and** the old subject is kept emitting the old shape for 30 days. The old subject is marked `deprecated` in the FORA-50 spec; new consumers must use `v2`. After 30 days, the old subject is removed in a coordinated cutover.
- The bus **never** silently drops events. A breaking change is a PR, an ADR amendment, and a board-visible change window.

## 4. NATS JetStream configuration

### 4.1 Stream topology

- One **stream per tenant** (`stream: "fora-<tenant_id>"`) — bounded by tenant, isolated by ACL, can be replayed independently.
- Subjects glob into the stream: `fora.events.<tenant_id>.>`.
- **Retention:** 7 days hot (replay window), 30 days cold (S3-backed tier on JetStream 2.10+).
- **Storage:** file-backed on the platform account's NATS cluster; size-budget per tenant to bound disk growth.
- **Replicas:** 3 (Raft consensus); one zone failure does not block writes.

### 4.2 Durable consumer groups

- Audit, Cost, Memory each register a **durable consumer** per tenant.
- The Orchestrator publishes to the subject; JetStream fans out to all consumers in the group.
- A consumer that crashes resumes from its last acknowledged offset (no event lost, no event duplicated past `event_id`).

### 4.3 Authn / authz

- The Orchestrator authenticates with a NATS credential scoped to **publish-only** on `fora.events.>`. It cannot subscribe to other tenants' subjects even if its tenant_id claim is forged (NATS enforces account-based isolation).
- Consumers authenticate with **subscribe-only** credentials on a per-tenant subject prefix. A consumer credential for tenant A cannot subscribe to tenant B (the JWT claim is the prefix).

## 5. SQS+SNS bridge (cross-account audit)

Per [FORA-36 ADR D3](/FORA/docs/adr/0001-audit-system-one-way-doors.md) the audit store lives in a separate AWS account. The platform account has no read or admin access to it. The bridge is the **only** cross-account writer.

### 5.1 Bridge shape

```
NATS JetStream (platform account)
        │
        │  nats-consumer "audit-bridge"
        ▼
SNS topic "fora-audit-events" (platform account)
        │
        │  account-boundary resource policy
        │  (only the audit-account SQS ARN can subscribe)
        ▼
SQS queue "fora-audit-ingest" (audit account)
        │
        │  audit writer worker (audit account)
        ▼
audit.events (Postgres, audit account)
```

- The SNS topic has a **resource policy** that allows the audit account's SQS queue to subscribe; no other account can subscribe.
- The SQS queue has a **resource policy** that only allows the SNS topic's account-boundary principal to send; no other principal can write.
- A DLQ captures SQS delivery failures; an alert pages on `> 0` after a 5-minute grace period (the bridge normally drains in < 60 s p99 per FORA-50 spec §5.1 acceptance).

### 5.2 Idempotency on the bridge

- The bridge **preserves `event_id`**. The SQS message body is the NATS event verbatim, plus an `sqs_message_id` for AWS-side dedupe.
- The audit writer is idempotent on `event_id` (unique constraint on `audit.events.event_id`); re-deliveries are no-ops.
- The bridge does not transform the payload; transformation would break the wire-format guarantee.

### 5.3 Why bridge, not direct

- The Orchestrator must not have AWS credentials to the audit account (FORA-36 D3 — the audit account is the trust boundary).
- A direct SQS publish from the Orchestrator would require cross-account credentials; the broker is the right place to hold those.
- The bridge is a small, well-tested service (~200 LOC) that can be replaced without touching the Orchestrator or the audit account.

## 6. Failure modes and recovery

| Failure                                    | Behavior                                                                                              |
|--------------------------------------------|-------------------------------------------------------------------------------------------------------|
| NATS JetStream down                         | Orchestrator pauses new runs; in-flight runs continue but cannot publish events. After 5 min, page on-call. Existing runs replay on restart. |
| JetStream disk full                         | Retention cap drops the oldest cold-tier events; alarm at 80% capacity. Hot tier cannot be dropped.    |
| SQS+SNS bridge down                         | Audit account stops ingesting; an alert pages. The Orchestrator is unaffected; events queue in NATS for the 7-day hot retention. |
| Audit account unavailable                   | SQS messages queue; bridge DLQ alarms. Events are not lost.                                          |
| Consumer crash mid-batch                    | Replay from last ack; consumer-side `event_id` dedupe makes double-processing a no-op.                |
| Schema bump deploys with old consumer       | Old consumer keeps reading `v1` for 30 days. New consumer reads `v2`. Both are valid. No big-bang cutover. |

## 7. Alternatives considered

1. **Apache Kafka.** Rejected: stronger durability and higher throughput than NATS, but heavier operationally (ZooKeeper / KRaft, partition rebalances, separate schema-registry), 3–5× the ops surface for a workload that peaks at < 1k events/s per tenant. NATS JetStream hits the same durability contract with a smaller blast radius.
2. **AWS SNS + SQS (native, no NATS).** Rejected: per-tenant fan-out via SNS topic filters is operationally awkward at hundreds of tenants; subject ACLs are weaker; the audit-account boundary is a SNS-to-SQS subscription in both directions, doubling the topology. NATS gives us per-tenant streams + ACLs natively, and the bridge to SQS is a small consumer.
3. **PostgreSQL LISTEN/NOTIFY.** Rejected: tightly coupled to a single Postgres cluster, no replay window, no fan-out to multiple consumers without contention. Useful as a development convenience; not a platform bus.
4. **AWS EventBridge.** Deferred: EventBridge is reasonable for AWS-native fan-out, but the per-tenant subject model and the cross-account boundary are simpler with NATS + the SQS/SNS bridge. A future ADR may migrate specific consumer patterns to EventBridge for AWS-native integrations (Lambda triggers), but the canonical bus stays NATS.
5. **In-process pub/sub (same code as the consumer).** Rejected: defeats the audit, cost, and memory isolation per ADR-0001 §3 — sub-agents must not share in-process state.

## 8. Consequences

### Positive

- **One producer, many consumers, isolated by tenant.** The audit / cost / memory / console all subscribe to a slice of the bus; the Orchestrator never knows which consumer is reading.
- **Replay window.** A 7-day hot retention means a new consumer (or a recovered one) can backfill without re-running the run.
- **Cross-account boundary is a small service.** The bridge is ~200 LOC, the audit account never holds the platform's NATS credentials, and the platform account never holds the audit account's Postgres credentials.
- **Schema evolution is bounded.** The 30-day deprecation window is the contract; the bus never breaks a consumer silently.

### Negative / risks

- **Two systems to operate** (NATS + the bridge). We accept this in exchange for the cross-account boundary; a single system would force us to either weaken the boundary or move the bus into the audit account (which the FORA-36 ADR explicitly forbids).
- **NATS JetStream is one vendor.** Mitigated by the open-source nature of the project and the JetStream-to-Kafka migration playbook that we will keep in the runbook. A future ADR can replace the bus if NATS hits a wall.
- **Bridge SLO is p99 < 60 s for cross-account delivery.** The 30-day cold retention means a multi-day bridge outage is recoverable; a > 7-day bridge outage loses audit rows and is a Sev-1.

## 9. Out of scope (future ADRs / follow-ups)

- **EventBridge fan-out** for AWS-native consumers (Lambda triggers). A future ADR if a customer needs it.
- **Kafka as a secondary bus** for a customer's data lake. Not in v1; the bus is platform-internal.
- **End-to-end encryption of event payloads** beyond TLS-in-transit. The events carry `tenant_id`; payload-level encryption is per-customer as part of the secrets ADR (FORA-38).
- **Replay UI** for the Forge console. Part of [FORA-50 spec §11](/FORA/issues/FORA-50) (the Orchestrator console), not this ADR.

## 10. Reviewer sign-off

This ADR is a **one-way door** (per architecture.md §5). The CTO signs every one-way-door ADR; CEO sign-off is not required for this scoped decision because it is bounded to the event-bus substrate and the cross-account bridge, and does not touch the cross-stage spine defined in ADR-0001.

- [x] **CTO — approved as proposed on 2026-06-17** (author: f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)
- [ ] CEO — informational copy; this ADR does not require CEO sign-off per architecture.md §5

### Follow-up issues (opened on acceptance)

- [FORA-136](/FORA/issues/FORA-136) — Implement event bus per this ADR (blocked on spec acceptance)
- [FORA-32](/FORA/issues/FORA-32) — Memory agent subscribes per [FORA-50 spec §5.3](/FORA/issues/FORA-50#document-spec)
- [FORA-36](/FORA/issues/FORA-36) — Audit account subscribes via the SQS+SNS bridge
- [FORA-75](/FORA/issues/FORA-75) — Cost agent subscribes to `cost_reported` + `budget_exceeded`
