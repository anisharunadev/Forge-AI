---
version: 0.1.0
last-reviewed-by: cto
last-reviewed-at: 2026-06-17
parent-prd: workspace/project/PRD.md
parent-issue: Forge AI-35
sub-goal: "2.3 — Design generation (design-generator)"
epic: Forge AI-18 (Epic 2 — Architecture Agent)
---

# ADR-0002 — Dual-bus: NATS JetStream in-cluster + SQS for cross-account audit shipping

- **Status:** proposed
- **Date:** 2026-06-17
- **Deciders:** CTO; DevOps co-signs; CEO informational
- **Sub-goal:** Forge AI-35 (2.3 — Design generation)
- **Supersedes:** none
- **Superseded by:** none
- **Parent ADRs:** [`docs/architecture/adr-0006-event-bus-nats-jetstream.md`](../../../docs/architecture/adr-0006-event-bus-nats-jetstream.md) (NATS as the in-cluster bus), security memory §7 (audit account boundary)

## Context

The platform emits two classes of events that have different durability, latency, and trust-boundary requirements:

1. **In-cluster events** — stage transitions, cost reports, run-state changes. The producer and the consumer are both inside the platform VPC; latency budget is sub-100 ms; durability is "good enough to recover from a pod restart."
2. **Cross-account audit events** — every agent action, every auth event, every secret read, every config change. The producer is in the runtime account; the consumer is in the **audit account** with its own IAM boundary (security memory §7). Latency budget is 1 s; durability is "13 months hot, 7 years cold, append-only, immutable."

A single bus for both fails one of the two: NATS JetStream cannot cross accounts without a replication layer; SQS has 100 ms+ latency on enqueue and is overkill for in-cluster fan-out. The current codebase already has both (`packages/event-bus`, `apps/event-bus-bridge`, `packages/object-store/src/sqs.ts`); this ADR locks the boundary.

This is a one-way door per architecture memory §5: the dual-bus topology is encoded in the per-app budgets, the audit-account IAM policy, and the runbook. Reverting requires moving the audit log back into the runtime account (a SOC 2 violation) or moving stage events to SQS (a p99 regression).

## Decision

We adopt a **two-bus topology**:

```
producer → NATS JetStream (in-cluster)        → stage consumers
                  └─→ event-bus-bridge (fan-out) → SQS (audit account) → audit_log + S3
```

Rules:

1. **NATS subjects** are namespaced as `fora.events.{tenant_id}.{stage}.{event_type}`. Per-tenant isolation is enforced at the subject level; a tenant cannot publish to another tenant's subject.
2. **The bridge (`apps/event-bus-bridge`) is the only producer to the audit SQS.** No app is allowed to publish directly to the audit account.
3. **The audit account holds its own IAM boundary.** The runtime account has a `sns:Publish` grant into the audit account's SNS topic; the audit account holds the only consumer credentials.
4. **Dedupe** is the responsibility of the producer: every event carries an `event_id` (UUIDv7) and the bridge dedupes on `event_id` for 24 h (Redis) before the SQS publish.
5. **The runtime account cannot read from the audit account.** A compromise of the runtime account can write to the audit log but cannot rewrite history.
6. **Backpressure:** if the bridge falls behind, the NATS consumer applies the per-tenant backpressure in tech-stack §15 (`cbucket:{service}:{tenant_id}`). A tenant that overruns is rate-limited, not failed.

## Consequences

**Easier:**

- The audit log is provably independent of the runtime account — SOC 2 control in security memory §10.
- In-cluster events stay on the in-cluster bus; no public-internet hops for stage transitions.
- The bridge is the only place that knows about SQS — apps stay clean.

**Harder:**

- Two delivery semantics to reason about: NATS at-least-once (consumer dedupes) vs. SQS at-least-once (audit dedupes on `event_id`).
- The bridge becomes a critical path; the runbook (`docs/runbooks/bridge-down.md`, forthcoming) is the only acceptable response.
- Cross-region replication for SQS is a v1.1 conversation (us-east-1 primary, us-west-2 standby, eu-west-1 in Q2 2027).

**Accepted:**

- A tenant-side SQS topic is not allowed. The customer does not get a direct line into the audit log; they get a queryable audit view.
- The bridge runs as a single in-cluster process in v1; a hot-standby is a v1.1 ask.

## Alternatives considered

1. **NATS only, replicated to the audit account.** Rejected: NATS Leaf Nodes + a cross-account trust is operationally heavier than SQS for a write-only, append-only stream. The audit account does not need NATS's full feature set.
2. **Kafka everywhere.** Rejected: Kafka's operational lift is real (ZooKeeper → KRaft, partition rebalancing, tiered storage) and the platform does not need Kafka's throughput in v1. NATS is the right shape for sub-100 ms in-cluster events; SQS is the right shape for cross-account durability.
3. **SQS for everything.** Rejected: 100 ms+ enqueue latency is a stage-transition p99 regression (architecture memory §8 says p99 < 1 s for `AdvanceStage`; that budget cannot absorb 100 ms of SQS enqueue per stage).
4. **A managed event bus (EventBridge, Confluent, Solace).** Rejected: another vendor, another trust boundary, another cost line. The principle in tech-stack §1 ("boring where boring is correct") applies.
5. **Postgres LISTEN/NOTIFY.** Rejected: not durable, not cross-process reliable, no replay, no audit account boundary.
