# 0001 — Audit System: one-way door decisions

- **Status:** proposed
- **Date:** 2026-06-17
- **Deciders:** CTO (Arunachalam V)
- **Issue:** [Forge AI-36](/Forge AI/issues/Forge AI-36)
- **Design doc:** [Forge AI-36#document-design](/Forge AI/issues/Forge AI-36#document-design)
- **Supersedes:** —
- **Superseded by:** —

## Context

Forge AI-36 ships the foundation audit system for the platform. Every other Epic (1–8) and every other sub-goal of Epic 0 (0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8) will read from it or write to it. Per [architecture.md §5](../../workspace/memory/architecture.md), any decision that constrains those downstreams is a one-way door and requires an ADR.

Three decisions in the Forge AI-36 design are one-way doors:

1. **Storage shape.** Where the events live, what roles touch them, and how append-only is enforced.
2. **Hash-chain shape.** Per-(tenant, run) versus per-tenant versus per-(tenant, agent). The chain determines the verification API and the cost of tamper detection.
3. **Cross-account boundary.** Whether the audit store sits in the same AWS account as the runtime or in a separate account with its own IAM boundary.

The other design choices (event payload shape, retention defaults, read API surface, PII redaction rules) are versioned, contract-driven, and can change without breaking downstreams. The three above cannot.

## Decision

### D1. Storage shape — Postgres 16, dedicated `audit` schema, three roles, DB-level append-only enforcement

- **Engine:** PostgreSQL 16 (per [tech-stack.md §4](../../workspace/project/tech-stack.md)).
- **Schema:** `audit.events`, `audit.retention_policy`, `audit.admin_log`.
- **Roles:** `audit_writer` (INSERT-only), `audit_reader` (SELECT-only), `audit_admin` (INSERT + DELETE; credentials held by a single human, 1Password, 90-day rotation, every use alerted).
- **Enforcement:** triggers that raise an exception on UPDATE/DELETE for all roles, including `audit_admin`. The admin path goes through the explicit `audit.admin_delete_event` function.
- **Bodies:** S3 in the audit account, SSE-KMS, bucket-policy deny-delete. Bodies are addressable by `input_ref` / `output_ref`; integrity verified by `input_digest` / `output_digest`.

**Why this and not the alternatives:**

- *DynamoDB / QLDB.* QLDB gives append-only + history but the cost is high and the query model is limited; we'd still need a relational read model for the board views. DynamoDB loses the relational query for retention and admin log lookups. We already operate Postgres for the platform; one engine, fewer ops.
- *Object storage (S3) as the source of truth.* Cheap and durable but no transactions, no per-tenant indexing, no chain verification without re-reading the whole prefix. A poor fit for the "show me this run in order" hot path.
- *WORM via S3 Object Lock.* The right idea for immutability but the chain verification, the per-tenant query, and the admin override are all awkward. A 7-year retention with per-tenant override would be hard to model.

### D2. Hash chain — per (tenant_id, run_id), with `record_hash = SHA256(canonical_json(event w/o record_hash) || prev_hash)`

- The chain head is the (tenant, run) pair. `prev_hash` of the first event in a run is `null`.
- The verifier walks one run at a time. A run with N events costs O(N) to verify.
- A deleted or redacted event is reported as a chain break, not a verification failure. The chain continues with a synthetic `audit:event_deleted` event so the head always advances.

**Why this and not the alternatives:**

- *Per-tenant chain.* Simpler model but the chain gets long, the per-run verification cost grows, and a single noisy tenant's verification work dominates.
- *Per-(tenant, agent) chain.* Mirrors the sub-agent topology but loses the cross-agent decision-path read the board wants ("reconstruct the agent's decision path for this run").
- *No chain (just signed rows).* Each row carries an HMAC of its content signed by an HSM-held key. Detects tampering, but not reordering or deletion (the missing row simply is missing). The acceptance criterion is "deletion is itself an audit record" — the chain gives us that.

### D3. Cross-account boundary — the audit store lives in a separate AWS account, with the platform account able to write but never read or admin

- The audit account is a separate AWS account. RDS lives there. The platform account has no `audit_admin` credentials, no read access to audit RDS, no read access to the audit S3 bucket.
- The platform account's only cross-account path is an SQS queue, with an account-boundary resource policy, consumed by a worker in the audit account that inserts as `audit_writer`.
- The `audit-admin` credentials are held by a single human, in 1Password, rotated every 90 days, every use alerted.

**Why this and not the alternatives:**

- *Same-account audit store with IAM isolation.* Cheaper to operate, but the boundary is a configuration knob a compromised runtime could turn. The blast radius of a runtime compromise becomes the audit log itself, which defeats the purpose.
- *Per-tenant audit store in the customer's account.* Right architecture for a v2 self-host posture. Out of scope for v1; the per-tenant pattern still works on top of this boundary.

## Consequences

- **Easier.** The forensic read of any run is one query and one hash walk. The cost agent has a single read path. The customer contract is the retention override, and the override is itself audited.
- **Harder.** Two accounts to operate, not one. The cross-account writer is a new critical path; a CloudTrail alert on every admin path is a new critical path. The platform account now has an outbound dependency it did not have before.
- **We accept.** A runtime-account compromise can drop new audit events (the queue is empty) but cannot rewrite history. The SQS DLQ + a `audit.events.dropped` metric pages on `> 0` so we know if a drop is happening.

## Alternatives considered

- **QLDB (AWS managed ledger).** Stronger immutability guarantees, but the query model is K/V-ish and we'd build a relational read layer anyway. Cost per insert is several times Postgres. Rejected for the engine choice; the design's append-only property is enforced at the Postgres role/trigger layer.
- **Event-sourcing on Kafka with a compacted topic.** Strong durability but the per-tenant query and the chain walk both get harder. The cost is also several times a row insert. Rejected.
- **Per-tenant S3 prefix with WORM.** A fine lower bound, but the read API and the chain verification both become S3 LIST + re-parse at query time. Rejected.
- **In-process audit (same DB, same role, no enforcement).** Trivially bypassable by a misbehaving sub-agent. Rejected — the acceptance criteria explicitly require "every tool call emits exactly one audit event" and "deleting requires admin override."

## Cross-references

- Design: [Forge AI-36#document-design](/Forge AI/issues/Forge AI-36#document-design)
- Issue: [Forge AI-36](/Forge AI/issues/Forge AI-36)
- Parent Epic: [Forge AI-16 Epic 0 — Forge AI Platform Foundation](/Forge AI/issues/Forge AI-16)
- Plan: [Forge AI-15 plan §1 Epic 0](/Forge AI/issues/Forge AI-15#document-plan)
- Security baseline: [memory/security.md §7](../../workspace/memory/security.md)
- Architecture rules: [memory/architecture.md §5, §6](../../workspace/memory/architecture.md)
- Tech stack: [project/tech-stack.md §4](../../workspace/project/tech-stack.md)
