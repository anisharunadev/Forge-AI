# ADR-008: Append-only WORM audit trail

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group

## Context and Problem Statement

Constitution Rule 6 (Mandatory Auditability) and PRD NFR-020 require that every action - agent run, LLM call, tool use, cost accrual, artifact change, terminal command - be auditable. Audit records must be tamper-evident for SOC2-controls-ready posture (NFR-001) and must persist for compliance retention.

The audit trail must capture:

- **Who**: actor (user, agent, system, scheduled job).
- **What**: action and target.
- **When**: occurred_at (with timezone).
- **How**: model, prompt hash, tool name, cost.
- **Result**: result hash (or status).

We must choose the storage and integrity mechanism.

The forces at play:

- NFR-020 mandates auditability; this is non-negotiable.
- NFR-002 (GDPR) collides with audit immutability: right-to-erasure requires some path to remove personal data from audit records.
- SOC2 CC6/CC7 controls require tamper-evidence (not just append-only).
- The audit trail is high-volume: every LLM call, every terminal byte, every workflow transition.
- Audit records must be queryable in real time (Steward review, governance dashboards) - not just shipped to cold storage.

## Decision Drivers

- Rule 6: Mandatory auditability
- NFR-020: Audit retention
- NFR-001: SOC2-controls-ready posture
- NFR-002: GDPR right-to-erasure (must be reconciled with immutability)
- NFR-039: Terminal command audit
- Queryability for Steward review and governance dashboards

## Considered Options

- PostgreSQL audit table with DB-level INSERT-only triggers + daily hash chain (chosen)
- Application-level immutability (no DB-level constraint)
- External WORM storage (S3 Object Lock)
- Append-only Kafka

## Decision Outcome

Chosen option: **Append-only audit table with DB-level INSERT-only constraints and a daily hash chain for tamper detection**.

Architecture:

- Audit table `audit_log` in PostgreSQL 17 with columns:
  - `id` (UUID, primary key)
  - `occurred_at` (timestamptz)
  - `actor` (jsonb: user_id, agent_id, system component)
  - `action` (text: typed action code, e.g., `agent.run.started`, `llm.call.completed`, `terminal.command.executed`, `artifact.superseded`, `approval.granted`)
  - `target` (jsonb: target entity reference)
  - `tenant_id`, `project_id` (Rule 2)
  - `payload` (jsonb: structured event data, redacted of PII)
  - `model` (text, nullable: provider/model identifier)
  - `prompt_hash` (text, nullable: SHA-256 of prompt)
  - `result_hash` (text, nullable: SHA-256 of result)
  - `cost` (numeric, nullable: USD)
  - `chain_hash` (text: SHA-256 of this row plus previous day's chain_hash)
  - `day_bucket` (date: for daily hash chain grouping)
- DB-level triggers reject UPDATE and DELETE on the audit_log table for non-superuser roles.
- A nightly job computes the daily chain hash: `chain_hash = SHA256(prev_chain_hash || concat(sort_by_id) || day_bucket)`. The final hash of each day is signed and stored in a separate, locked table (`audit_chain_anchors`) with the timestamp.
- GDPR reconciliation: pseudonymization, not erasure. When a data subject exercises right-to-erasure, the `actor` field's `user_id` is replaced with a salted hash. The audit metadata (action, target, timestamp) is preserved.
- Terminal bytes (NFR-039) are recorded via a dedicated `terminal_audit` table that references `audit_log` by id for indexing.
- The audit database lives in a separate AWS account from primary data (cross-account topology for blast-radius isolation).

### Consequences

Positive:

- Tamper-evident: any modification of a historical row invalidates the daily chain hash.
- Queryable in real time (it's a normal PostgreSQL table).
- Low cost: no separate WORM storage tier for the hot path.
- GDPR-compatible via pseudonymization.
- Tenant-scoped via `tenant_id`; RLS applies (ADR-002).

Negative:

- Cannot retract bad records (only supersede via a new audit row pointing back to the old one).
- Pseudonymization is a one-way transformation; original actor identity is gone after the GDPR request.
- Daily chain hash job requires monitoring; missing an anchor breaks tamper detection.

Neutral:

- Audit retention period (7 years per industry standard) is captured as a row lifecycle policy, not enforced at the DB level.

## Alternatives Considered

### Application-level immutability (no DB-level constraint)

Pros:

- Simple to implement; just `INSERT` only from the application layer.

Cons:

- Bypassable: any service with database credentials can UPDATE or DELETE.
- A single compromised service breaks the integrity invariant.
- SOC2 controls expect DB-level enforcement, not application-level promises.
- Rejected: integrity must be enforced at the DB layer.

### External WORM storage (S3 Object Lock)

Pros:

- Strong WORM guarantees from AWS.
- Cheap cold storage.

Cons:

- Harder to query in real time; must hydrate back into a database for Steward review.
- Cross-account topology still needed; net architecture is more complex.
- Latency for the hot path is poor.
- Rejected: queryability is a hard requirement; cold-storage WORM does not satisfy it.

### Append-only Kafka

Pros:

- High throughput.
- Native retention semantics.

Cons:

- Not queryable in real time without a downstream database (re-introduces the dual-write problem).
- Tamper-evidence via Kafka is weaker than a database hash chain.
- Rejected: queryability and tamper-evidence are weaker than the chosen option.

## Pros and Cons of the Chosen Option

Pros:

- Tamper-evident via DB constraints plus daily hash chain.
- Queryable in real time (normal PostgreSQL queries, RLS applies).
- Tenant isolation via the same RLS machinery as the rest of Forge.
- Cost-effective: no separate WORM tier for the hot path.
- GDPR-compatible via pseudonymization.

Cons:

- Tamper detection is reactive (mismatch is found on chain verification, not at write time).
- Daily chain job is a single point of failure for the integrity invariant; needs monitoring.

## References

- [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q5 SOC2-Ready Patterns, GDPR vs immutability)
- ADR-001: Cloud-only AWS deployment (separate audit account topology)
- ADR-002: PostgreSQL 17 + Apache AGE + pgvector (audit table co-located)
- ADR-003: Hybrid MDM + Steward priority conflict resolution (conflict events recorded here)
- ADR-005: LiteLLM Proxy as Provider Abstraction Layer (LLM calls audited here)
- ADR-006: Terminal Center via xterm.js + native PTY (terminal bytes audited here)
- ADR-007: LangGraph as SDLC agent orchestrator (agent runs audited here)
- Constitution Rule 2 (Multi-tenancy), Rule 6 (Mandatory auditability)
- PRD NFR-001, NFR-002, NFR-020, NFR-039