# Forge AI — Runtime Sessions

**Status:** v1.0 (production bar, 2026-06-17) — meets the Knowledge Layer bar in [../README.md](../README.md#3-the-acceptance-bar)
**Owner:** Runtime owns writes (the Session Agent — see [memory/architecture.md §0.1.1](../memory/architecture.md#1-the-shape-we-are-building) for the role; the actual Session entity is the G0.1.1 contract in the Forge AI-15 plan). CTO owns the schema, the lifecycle, and the recovery model. The on-call SRE co-signs the recovery section.
**Stage gate:** A session is **the container for a run**. A run starts when its first stage is `in_progress` and ends when the run's terminal artifact reaches `approved` (or the run is `cancelled` / `failed`). The session lifecycle is bound to the run, not to the issue; an issue can be re-opened and re-run, but a session is closed.
**Glossary:** Every acronym below (JWT, JSONL, p50, p99, SLO, SLA, KMS, RPO, RTO, PII, DPA, OIDC) is defined in [../customer/glossary.md](../customer/glossary.md). If you find a term used here that is not in the glossary, file a glossary PR; do not redefine it in this file.
**Linked Paperclip issues:**
- Parent Epic: [Forge AI-26](/Forge AI/issues/Forge AI-26) — Epic 10 — Knowledge Layer
- Sub-goal: [Forge AI-101](/Forge AI/issues/Forge AI-101) — 10.4 Runtime output mounts
- Plan of record: [Forge AI-15](/Forge AI/issues/Forge AI-15#document-plan) — BMAD → Paperclip Hierarchy Plan (G0.1.1 Session Management, G0.1.2 Context Management)
**Related:** [artifacts/README.md](../artifacts/README.md) (the outputs of this run), [audit/README.md](../audit/README.md) (every event below has a matching audit row), [../memory/architecture.md](../memory/architecture.md) (the staged workflow this session is driving)

---

## 1. What this folder is

`sessions/` is the **runtime's state volume**. While `artifacts/` answers "what did the platform produce?", `sessions/` answers "what is the platform doing right now, and what did it do at 14:23:08 last Tuesday?" It is the durable, append-only event log that lets a sub-agent recover from a crash, lets the on-call SRE reconstruct a failure, and lets the cost agent bill accurately.

A session is **one run's life story**. The Master Orchestrator creates a session when a run starts, appends one event per state transition, and closes the session when the run reaches a terminal state. There is exactly one open session per `run_id`. A new run gets a new session; a resumed run reopens the existing session.

## 2. The layout

```
sessions/
├── README.md                       # this file — the schema, the lifecycle, the recovery model
├── SCHEMA.md                       # the canonical JSON Schema for a session record
├── events.jsonl                    # append-only event log; one event per line, global
├── open/                           # sessions that are not yet terminal; one directory per session
│   └── <session_id>/
│       ├── session.json            # latest snapshot; rewritten on every event
│       ├── plan.json               # the plan-then-act artefact the agent emitted
│       └── context.json            # the context bundle the agent was working from
├── closed/                         # sessions that have reached a terminal state
│   └── <YYYY>/<MM>/<session_id>/
└── recovered/                      # sessions that were recovered from a crash; preserved for audit
    └── <YYYY>/<MM>/<session_id>/
```

Three rules:

- **`events.jsonl` is the source of truth.** The per-session `session.json` is a snapshot; if it disagrees with `events.jsonl`, the event log wins. The snapshot exists to make the cold-started sub-agent's read cheap.
- **`open/` is hot, `closed/` is warm, `recovered/` is cold.** The hot tier is on the runtime's local NVMe; the warm tier is on S3 Standard; the cold tier is on S3 Glacier Instant Retrieval.
- **No file is ever deleted.** A session is append-only from create to terminal to retention-expired. A "recovered" session is not a failure mode; it is a normal terminal state for any session that lost its orchestrator mid-run.

## 3. The session record

The session snapshot is rewritten on every event; the event log is the canonical history. The fields below are the ones a sub-agent or the on-call SRE reads first.

```json
{
  "session_id": "sess_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "schema_version": "1.0.0",
  "tenant_id": "acme-corp",
  "run_id": "run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "issue_id": "Forge AI-101",
  "status": "in_progress",
  "current_stage": "architect",
  "owner": {
    "actor_type": "agent",
    "actor_id": "agent:architect",
    "display_name": "Architect"
  },
  "started_at": "2026-06-17T14:18:02.014Z",
  "last_event_at": "2026-06-17T14:23:08.142Z",
  "stage_started_at": "2026-06-17T14:22:55.000Z",
  "tokens": { "in": 1842, "out": 3117 },
  "cost_usd": 0.0418,
  "budget": {
    "token_ceiling": 200000,
    "usd_ceiling": 5.00,
    "tokens_remaining": 198158,
    "usd_remaining": 4.9582
  },
  "stages": [
    { "stage": "ideation", "status": "approved", "artifact_id": "art_01J7Z3X4K2N9PQ8R5V6T0YBWAB", "started_at": "...", "ended_at": "..." },
    { "stage": "architect", "status": "in_progress", "artifact_id": null, "started_at": "...", "ended_at": null }
  ],
  "approval_chain": [
    { "stage": "ideation", "approval_id": "appr_01J7Z3X4K2N9PQ8R5V6T0YBWAC", "decided_by": "user:cto@acme-corp", "decision": "approve", "decided_at": "..." }
  ],
  "recovery": {
    "attempt_count": 0,
    "last_recovered_at": null,
    "last_recovery_reason": null
  },
  "context_ref": "open/sess_01J7Z3R8M4F1Q9B2C7D5E6H7K0/context.json"
}
```

`SCHEMA.md` carries the full JSON Schema (draft 2020-12). A session record that does not validate is rejected at create time and the run does not start.

## 4. The event log

Every state transition is an event. The event log is append-only JSONL; one event per line, ordered by `event_at`. The event is the source of truth; the session snapshot is derived from it. A snapshot that disagrees with the log is treated as a corruption and the runtime re-derives the snapshot from the log on the next read.

```json
{
  "event_id": "evt_01J7Z3X4K2N9PQ8R5V6T0YBWAC",
  "schema_version": "1.0.0",
  "session_id": "sess_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "run_id": "run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "tenant_id": "acme-corp",
  "event_type": "stage.transition",
  "event_at": "2026-06-17T14:23:08.142Z",
  "actor": "agent:orchestrator",
  "payload": {
    "from_stage": "ideation",
    "to_stage": "architect",
    "from_status": "approved",
    "to_status": "in_progress",
    "artifact_id": "art_01J7Z3X4K2N9PQ8R5V6T0YBWAB",
    "approval_id": "appr_01J7Z3X4K2N9PQ8R5V6T0YBWAC"
  },
  "audit": {
    "audit_event_id": "01J7Z3X4K2N9PQ8R5V6T0YBWAD"
  }
}
```

The event types are an enum: `session.created`, `session.stage_started`, `session.stage_transition`, `session.stage_completed`, `session.stage_rejected`, `session.artifact_written`, `session.tool_called`, `session.approval_requested`, `session.approval_resolved`, `session.budget_warning`, `session.budget_exceeded`, `session.paused`, `session.resumed`, `session.recovered`, `session.completed`, `session.cancelled`, `session.failed`. Every event type has a documented payload schema in `SCHEMA.md`.

## 5. The lifecycle

A session has five terminal states. The transition graph is unidirectional; there is no path from a terminal state back to `in_progress`. A re-run gets a new session with a new `session_id`; the recovered session is preserved in `recovered/` for forensic review.

```
created  →  in_progress  →  paused
                  │              │
                  │              └──►  in_progress  (resume)
                  │
                  ├──►  completed
                  ├──►  cancelled
                  └──►  failed
```

| State | Who can transition to it | What it means |
| --- | --- | --- |
| `created` | the Master Orchestrator | The session has been written but the first stage has not started. |
| `in_progress` | the Orchestrator (stage_started) | A stage is actively executing. |
| `paused` | the Orchestrator (pause) or the on-call SRE (break-glass) | A budget ceiling was hit, a human approval is pending, or the runtime is degraded. The run can be resumed. |
| `completed` | the Orchestrator (terminal) | The final artifact reached `approved`. The run is `done`. |
| `cancelled` | the user (terminal) | The user explicitly cancelled the run. The partial artifacts are preserved. |
| `failed` | the Orchestrator (terminal) | The runtime exhausted its retries or detected an unrecoverable error. The partial artifacts are preserved; the on-call is paged. |
| `recovered` | the Orchestrator on resume | A new session was created from a `recovered/` session. The old session stays in `recovered/`; the new session is in `open/`. |

## 6. The runtime contract

The Session Agent is the **only** writer of `sessions/`. Sub-agents never call the storage layer directly; the Orchestrator mediates every read and every write. Three reasons:

1. **Atomicity.** A state transition (e.g., `stage.approved` → `next_stage.started`) is a single transactional write that updates the session, writes the event, and writes the audit row together. A partial write is a corruption; the runtime refuses to start a stage whose prior stage's event is not in the log.
2. **Idempotency.** A retry that re-emits a `session.stage_completed` event for the same `stage` and the same `approval_id` is a no-op. The Orchestrator keys events on `(session_id, event_type, idempotency_key)` and the event store dedupes.
3. **Tenant isolation.** A `tenant_id` mismatch between the session and the run is a P0. The Orchestrator checks the tenant on every read; a session that does not match the run's tenant is invisible to the sub-agent.

The read API is a single function:

```typescript
// packages/contracts/src/session-store.ts
export interface SessionStore {
  create(input: {
    runId: RunId;
    issueId: IssueId;
    tenantId: TenantId;
    owner: ActorId;
  }): Promise<SessionRecord>;

  appendEvent(input: {
    sessionId: SessionId;
    tenantId: TenantId;          // mandatory
    eventType: SessionEventType;
    payload: unknown;            // validated against the event type's JSON Schema
    idempotencyKey: string;      // client-supplied; dedupes on retry
  }): Promise<SessionEvent>;

  snapshot(input: {
    sessionId: SessionId;
    tenantId: TenantId;          // mandatory
  }): Promise<SessionRecord>;

  replay(input: {
    sessionId: SessionId;
    tenantId: TenantId;          // mandatory
    afterEventId?: EventId;      // optional cursor for incremental reads
  }): Promise<SessionEvent[]>;
}
```

## 7. Recovery (the SRE's contract with the customer)

A session that loses its orchestrator mid-run is recoverable. The recovery model is the reason this folder exists; without it, every orchestrator crash is a customer-visible failure.

- **RPO (Recovery Point Objective):** 5 seconds. The orchestrator flushes its event log to the durable store every 5 seconds. A crash loses at most 5 seconds of state.
- **RTO (Recovery Time Objective):** 60 seconds. A new orchestrator picks up the session, replays the event log, and resumes the run within 60 seconds of detecting the failure.
- **Detection:** the runtime monitors each orchestrator's heartbeat; an orchestrator that misses three heartbeats (15 seconds) is declared dead.
- **Recovery:** a standby orchestrator takes the lease on the session, replays the event log from the last `session.stage_started` event, and resumes the stage. The new orchestrator writes a `session.recovered` event with the previous `orchestrator_id` in the payload and continues.
- **Failure mode:** if the new orchestrator cannot resume (e.g., the agent crashed with no idempotency key), the session transitions to `failed` and the on-call is paged. The customer is notified within 5 minutes.

The SLO for the recovery path is **99.95% successful recovery within 60 seconds**. A miss is a P1 incident.

## 8. Retention and immutability

| Tier | Window | Storage | Who can write | Who can delete |
| --- | --- | --- | --- | --- |
| **Open** | while `status` is not terminal | `open/<session_id>/` | the Orchestrator | nobody (the directory is renamed to `closed/` on terminal transition) |
| **Closed (warm)** | 13 months from `ended_at` | `closed/<YYYY>/<MM>/<session_id>/` | nobody (read-only) | nobody |
| **Recovered (cold)** | 7 years from `ended_at` | `recovered/<YYYY>/<MM>/<session_id>/` | nobody (read-only) | nobody |
| **Event log** | 7 years from `event_at` | `events.jsonl` (S3 Standard, then Glacier) | the Orchestrator (append) | nobody |

There is no delete operation. There is no overwrite. A session that reaches a terminal state is never modified again; the next state is a new session.

## 9. Anti-patterns (auto-flag in review)

A PR that touches this folder or its schema is auto-flagged for CTO review if it does any of the following:

- Adds a write path that does not go through the Session Agent. (Direct sub-agent writes break atomicity and audit coupling.)
- Allows a terminal session to transition back to `in_progress`. (Use a new session.)
- Removes an event type from the enum. (Event types are append-only; new event types are additive, old types stay in the schema for 7 years.)
- Adds a `DELETE` endpoint to the storage layer. (The folder is append-only by contract.)
- Loosens the tenant check on read. (A cross-tenant read is a P0; see [memory/security.md §4](../memory/security.md#4-authentication-authorisation-tenancy).)
- Changes the RTO or RPO without a corresponding SLO update and CTO sign-off. (The recovery contract is a customer commitment.)

## 10. Related

- The artifact volume that records **what this run produced**: [artifacts/README.md](../artifacts/README.md)
- The audit volume that records **every event below as a row**: [audit/README.md](../audit/README.md)
- The staged workflow this session is driving: [../memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine)
- The Master Orchestrator and the Session Agent in the agent-of-agents diagram: [../memory/architecture.md §1](../memory/architecture.md#1-the-shape-we-are-building)
- The G0.1.1 Session Management and G0.1.2 Context Management contracts in the Forge AI-15 plan: [Forge AI-15](/Forge AI/issues/Forge AI-15#document-plan)
- The audit-log shape this folder cross-references: [../memory/security.md §7](../memory/security.md#7-audit-logging)
- The Knowledge Layer bar this file is held to: [../README.md §3](../README.md#3-the-acceptance-bar)

---

## 11. Change log

- **v1.0 — 2026-06-17** — Initial production bar. Session record, event log, lifecycle, runtime contract, recovery model (RPO 5 s, RTO 60 s, 99.95% SLO), retention, anti-patterns. Cross-references [memory/architecture.md §1](../memory/architecture.md#1-the-shape-we-are-building) for the Master Orchestrator and Session Agent roles, [memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine) for the staged workflow, and the G0.1.1 / G0.1.2 contracts in the Forge AI-15 plan. Owned by Forge AI-101 (10.4 Runtime output mounts) under [Forge AI-26](/Forge AI/issues/Forge AI-26) (Epic 10 — Knowledge Layer).
