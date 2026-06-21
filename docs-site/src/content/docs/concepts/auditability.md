---
title: Auditability
description: The append-only audit ledger — what it records, how it is anchored, and how to query it.
---

Forge's audit ledger is the canonical record of every action that happens on the platform. It is append-only, hash-chained, mirrored to a separate AWS account, and queryable by tenant, project, actor, command, and time.

## What is this?

The **audit ledger** is a PostgreSQL table (`audit_log`) in the primary account, mirrored to a separate audit account via CloudTrail + S3 Object Lock. Every row is hash-chained to the previous row, anchored daily.

| Field | Source | Purpose |
|---|---|---|
| `id` | Sequence | Primary key |
| `ts` | Wall clock | Timestamp at row creation |
| `tenant_id` | Application | Multi-tenant filter |
| `project_id` | Application | Project filter (nullable for org-level events) |
| `actor_type` | Application | `user`, `system`, `agent` |
| `actor_id` | Application | `user.id`, `system:agent:<name>`, etc. |
| `forge_command` | Application | The `forge-*` command invoked |
| `args_hash` | SHA-256 | Hash of the args blob (not the args themselves) |
| `prompt_hash` | SHA-256 | Hash of the prompt (if an LLM call) |
| `model` | LiteLLM | Model id (if an LLM call) |
| `tool` | Application | Tool name (if a tool call) |
| `artifact_id` | Application | Affected artifact (if any) |
| `result_hash` | SHA-256 | Hash of the result |
| `cost_usd` | LiteLLM | Cost in USD (if an LLM call) |
| `chain_hash` | SHA-256 | Hash of `previous_chain_hash || hash(row)` |
| `anchor_ref` | Application | Reference to the daily S3 anchor (nullable until anchor) |

## Why does it exist?

Three concrete drivers:

1. **SOC2-controls posture** (NFR-001). Auditors need a tamper-evident record of who did what, when, with which model, and at what cost.
2. **Forensic reconstruction**. When something goes wrong (a bad deploy, a leaked secret, a cost spike), the audit ledger is the ground truth.
3. **Approval accountability**. A HITL approval is a typed event in the ledger. The approver's identity is preserved even if the user is later deleted.

## What problem does it solve?

| Problem | Without audit ledger | With audit ledger |
|---|---|---|
| "Who approved this deploy?" | Lost in chat | Single row in `audit_log` |
| "Why is our LLM cost so high?" | Guess from bills | Aggregate by `forge_command` and `model` |
| "Was the agent or the human responsible?" | Unclear | `actor_type` is on the row |
| "Can we prove the audit log wasn't tampered with?" | No | Hash chain + daily S3 anchor |

## How does it work?

### Append-only

The `audit_log` table has no `UPDATE` or `DELETE` grants for the application role. Rows can only be inserted. Revocation is enforced at the database role level, not at the application level.

### Hash chain

Each row's `chain_hash` is `SHA256(previous_chain_hash || SHA256(row_contents))`. A tampered row breaks the chain from that point forward.

### Daily anchor

Every 24 hours, the latest `chain_hash` is anchored to S3 Object Lock in the audit account. The anchor is itself a hash of `(chain_hash || date)`. S3 Object Lock prevents deletion or modification of the anchor.

```text
  Primary account                       Audit account
  +-------------------+                 +-------------------------+
  | audit_log table   |   daily export  | S3 Object Lock bucket   |
  |  - row N          | --------------> |   anchors/2026-06-21.json|
  |  - chain_hash_N   |                 |     chain_hash_N        |
  |                   |                 |     sha256(ch_N, date)  |
  +-------------------+                 +-------------------------+
```

A separate CloudTrail stream mirrors every database event into the audit account, providing an independent record even if the primary `audit_log` is destroyed.

### Querying

The audit ledger is queryable by:

- `tenant_id` (RLS filter)
- `project_id` (RLS filter)
- `actor_id`
- `forge_command`
- Time range
- Artifact id

Aggregate queries (cost by command, approvals by reviewer, top actors) are pre-computed in views.

## How do I use it?

As a developer:

```sql
SELECT ts, actor_id, forge_command, cost_usd
FROM audit_log
WHERE tenant_id = 'acme-corp'
  AND ts > now() - interval '24 hours'
ORDER BY ts DESC;
```

As an operator:

- The Audit Explorer UI provides filtered browsing.
- Pre-built views answer the standard questions ("who approved what this week", "what was the cost by command", "which workflows hit the approval gate").

As a security reviewer:

- Use `forge-sec-audit-export` to produce a tenant-scoped bundle (admin, requires approval).

## When should I use it?

Every workflow produces audit rows. The question is **what you query**:

- **Cost spikes** — aggregate by command and tenant.
- **Approval patterns** — group by reviewer and command.
- **Anomalies** — actor-id making unusual command invocations.
- **Compliance reports** — `forge-sec-audit-export`.

## Related

- [Observability](/concepts/observability/)
- [Multi-tenancy](/concepts/multi-tenancy/) — how the ledger is isolated
- [Constitutional rules](/concepts/constitutional-rules/) — R6
- [ADR-008: Append-only WORM audit trail](/architecture/adr-008-worm-audit/)
- [forge-sec-audit-export](/commands/security/)
