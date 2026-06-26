---
draft: false
title: ADR-008 — Append-only WORM audit trail
description: The audit ledger is append-only, hash-chained, and mirrored to a separate AWS account with S3 Object Lock.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that the audit ledger is **append-only**, **hash-chained**, and **mirrored to a separate AWS account** with **S3 Object Lock** for daily anchors. The ledger is tamper-evident even against a compromised primary account.

## Context

Forge must satisfy SOC2-controls posture (NFR-001), pen-test readiness (NFR-035), and pilot-customer audit requirements. Every action — agent invocation, model call, prompt, tool, cost, artifact, timestamp, result — must be auditable and tamper-evident.

The forces at play:

- A mutable audit log in the same database as the data is useless against a compromised primary.
- A log without chain-of-custody is not admissible in regulated contexts.
- The pilot customer's compliance team requires an independent record.
- The audit log must be queryable for operations, not just for forensics.

## Decision drivers

- NFR-001: SOC2-controls-ready
- NFR-020: Mandatory auditability
- F-005, F-407: Audit ledger
- Pilot customer compliance requirements

## Considered options

- Append-only PostgreSQL table with hash chain + S3 Object Lock anchor — **chosen**
- Write-once S3 with daily snapshots
- Immutable log service (e.g., QLDB, blockchain)
- Third-party SaaS audit log

## Decision outcome

Chosen option: **Append-only PostgreSQL table with hash chain + S3 Object Lock anchor**, mirrored cross-account.

The shape:

```text
Primary AWS Account                       Audit AWS Account
+-------------------+                     +--------------------------+
| RDS PostgreSQL 17 |                     | RDS PostgreSQL 17        |
| audit_log table   | -- daily export --> | audit_log mirror         |
| (INSERT-only)     |                     | (read-only replica)       |
+-------------------+                     +--------------------------+
        |                                          |
        | chain_hash column                        | S3 Object Lock bucket
        | per row                                  | anchors/YYYY-MM-DD.json
        v                                          v
   hash chain                                   anchor chain
```

## Append-only

The `audit_log` table has INSERT-only grants for the application role:

```sql
REVOKE UPDATE, DELETE ON audit_log FROM forge_app;
GRANT INSERT, SELECT ON audit_log TO forge_app;
```

A separate role (`forge_audit_admin`) can read but not write; a `forge_audit_anchor` role runs the daily anchor Lambda.

## Hash chain

Each row's `chain_hash` is `SHA256(previous_chain_hash || SHA256(row_contents))`. A tampered row breaks the chain from that point forward.

```python
def compute_chain_hash(prev_chain: str, row: dict) -> str:
    row_hash = sha256(canonical_json(row)).hexdigest()
    return sha256(f"{prev_chain}{row_hash}".encode()).hexdigest()
```

## Daily anchor

Every 24 hours, a Lambda in the audit account:

1. Reads the latest `chain_hash` from the mirrored audit_log.
2. Computes the anchor: `SHA256(chain_hash || date)`.
3. Writes the anchor to an S3 bucket with Object Lock in compliance mode.
4. Updates the latest row's `anchor_ref` column.

S3 Object Lock in compliance mode prevents deletion or modification of the anchor until the retention period expires.

## Cross-account mirror

The primary account's CloudTrail and the `audit_log` are mirrored to the audit account:

| Mirror | Method |
|---|---|
| `audit_log` rows | Daily export Lambda |
| All API activity | CloudTrail cross-account delivery |
| LLM proxy audit log | Cross-account replication |

The audit account is on a separate AWS Organization OU with restricted IAM. Even a primary-account compromise cannot delete the audit record.

## Querying

The audit ledger is queryable by:

- `tenant_id` (RLS filter)
- `project_id` (RLS filter)
- `actor_id`
- `forge_command`
- Time range
- Artifact id

Aggregate queries (cost by command, approvals by reviewer, top actors) are pre-computed in views.

## Retention

| Item | Retention |
|---|---|
| `audit_log` rows (primary) | 7 years (configurable) |
| `audit_log` mirror (audit) | 7 years (configurable) |
| S3 anchor bucket | Permanent (compliance mode) |
| CloudTrail mirror | 7 years |

## Verification

A verification script recomputes the chain and compares to the stored `chain_hash`. If any row fails, an alert fires and the audit account's mirror is treated as the source of truth.

## Consequences

**Positive:**

- Tamper-evident even against a compromised primary.
- Independent record in the audit account satisfies SOC2-controls posture.
- Daily S3 anchors provide cryptographic proof at known dates.
- Append-only at the database role level — application code cannot bypass.

**Negative:**

- Operational complexity: two accounts, daily Lambda, mirror job.
- Storage cost: 7-year retention is non-trivial.
- Recovery from a hash break is non-trivial (must use the audit mirror).

**Neutral:**

- The cost ledger and the audit ledger are the same table — one source of truth.

## Alternatives considered

### Write-once S3 with daily snapshots

Pros: Simpler.

Cons: No per-row chain; query latency is high; harder to compute aggregates.

### Immutable log service (QLDB, blockchain)

Pros: Built-in immutability.

Cons: Vendor lock-in; QLDB is AWS-only (we already are, but…); blockchain is overkill.

### Third-party SaaS

Pros: Offload operational burden.

Cons: Pilot customer compliance may reject third-party custody; SOC2 chain-of-custody becomes harder.

## Related

- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
- [Auditability](/concepts/auditability/)
- [forge-sec-audit-export](/commands/security/)
