# 0.1 — Master Orchestrator (Design + Contract)

| Field            | Value                                                                                                              |
|------------------|--------------------------------------------------------------------------------------------------------------------|
| **Sub-goal of**  | [Forge AI-16 Epic 0 — Forge AI Platform Foundation](../../issues/Forge AI-16)                                              |
| **Status**       | **in_review** (v0.1 close-gate — CTO-authored, Board confirmation pending)                                          |
| **Author**       | CTO (`f4d4bf77-…`)                                                                                                |
| **Reviewer**     | Board (`request_confirmation` close-gate)                                                                            |
| **Date**         | 2026-06-20                                                                                                        |
| **Stage**        | Architect (per Forge AI-7 DocAgent / Knowledge Layer §0 conventions)                                                  |
| **Version**      | v0.1 (first rev — pinned; do not edit, copy + bump)                                                                |

---

## 0. Quick start (read first)

The Master Orchestrator is the **spine** that owns a Forge run's session lifecycle,
stage transitions, event-bus emissions, and human-approval routing across the seven
SDLC stages (Ideation → Architect → Dev → QA → Security → DevOps → Docs). The CTO
delivers v0.1 here as the platform foundation; the planned `master-orchestrator`
hire executes v0.2 against it.

Three concrete artifacts ship at v0.1 close-gate:

1. `@fora/orchestrator@0.1.0` — Fastify service in `apps/orchestrator/`,
   session lifecycle (create / pause / resume / cancel) + Idempotency-Key + soft-delete
   (ADR-0009) + crash-recovery tickets (`buildRecoveryTickets`).
2. `@fora/agent-runtime` orchestrator seam in `apps/agent-runtime/src/orchestrator/` —
   the `StageEngine` port + the seven-stage spine + `advanceStage` typed action
   (Forge AI-135, Forge AI-173).
3. Gate-routing wiring in `apps/orchestrator/src/gate_wiring.ts` — the
   `ApprovalEvent → RunLifecycleEvent` bridge between the Forge AI-137 router and the
   Forge AI-135 engine, plus the typed `NatsApprovalEventBus` (Forge AI-136/Forge AI-170),
   `PaperclipHttpClient` (Forge AI-169/Forge AI-177), `PagerDutyPager` (Forge AI-171), and
   `PgApprovalsRepo` (Forge AI-168) adapters that close the loop.

## 1. Acceptance criteria

| # | AC (from Forge AI-110 description)                                                                                              | v0.1 status |
|---|-----------------------------------------------------------------------------------------------------------------------------|-------------|
| 1 | Run can be created, advance through all seven stages with explicit board approvals at the gates, and complete without manual orchestrator intervention | Primitives shipped; **end-to-end demo blocked on `master-orchestrator` hire + MVP-7 runbook (Forge AI-349)** |
| 2 | Session lifecycle: create / pause / resume / cancel, with tenant + goal + current-stage + history per run                    | **Done** — `apps/orchestrator/src/router.ts` + `repo.ts` + `rehydrate.ts` |
| 3 | Stage transition engine: enforces seven stages with explicit `next / abort / return` decisions                              | **Done** — `apps/agent-runtime/src/orchestrator/advance-stage.ts` + `state-machine.ts` + `stage-table.ts` (Forge AI-135/Forge AI-173) |
| 4 | Approval gate router: routes per-stage approvals (board / CEO / CTO) via `request_confirmation` / `request_board_approval`  | **Done** — `apps/orchestrator/src/gates.ts` (typed gate table) + `router.ts` (decide / return / extend / recoverStaleTarget) |
| 5 | Event bus: publishes typed events (`stage_started`, `stage_completed`, `approval_requested`, `gate_passed`, `run_aborted`) | **Done** — `apps/orchestrator/src/ports.ts` `EventBus` port + `adapters/event-bus-nats.ts` NATS adapter (Forge AI-170) |
| 6 | Context-loader integration: when a stage starts, asks Memory 0.4 for the per-stage injection table and assembles the agent prompt | **Partial** — `apps/agent-runtime/src/orchestrator/memory-ports.ts` defines the typed seam; runtime mounts (`apps/agent-runtime/src/mounts.ts`) inject context. v0.1 uses the seam but the canonical Memory 0.4 surface ships with the Memory system (Forge AI-118). |
| 7 | Cost-ceiling integration: reads from Cost 0.6 and refuses to enter the next stage if the tenant is over budget                 | **Partial** — `Forge AI_DEFAULT_COST_CEILING_USD=100.00` env hook in `apps/orchestrator/src/config.ts`. The active cost check lands with the Cost agent (Forge AI-149/Forge AI-150 follow-ups) in v0.2. |
| 8 | Audit integration: every transition emits a record via Audit 0.5                                                            | **Done** — every `ApprovalEvent` + `RunLifecycleEvent` is published on the bus; the audit account owns retention per ADR-0009 §5 trigger. |
| 9 | IAM enforcement: every sub-agent invocation is scoped via Auth 0.7                                                            | **Partial** — Orchestrator trusts the upstream gateway per ADR-0003 §4.2 (gateway stamps `x-fora-tenant-id`); IAM broker (Forge AI-125) + customer-cloud-broker (Forge AI-126) shipped. v0.2 moves JWT validation in-process (v1.1 ADR). |
| 10 | Failed stage produces `stage_aborted` event and stops downstream; the run is recoverable                                   | **Done** — `StageEngine.reEnter` + `pauseRun` (Forge AI-135 port); gate-routing wiring `onApprovalExpired` emits `run_paused`; recovery `buildRecoveryTickets` rebuilds the run header on boot |
| 11 | Returning a stage to a prior owner uses the same routing primitive                                                          | **Done** — `routeGate` `ReturnTarget` + `reEnter`; `gate-wiring.test.ts` covers `tests 8–12` |
| 12 | No stage can be skipped; attempting it produces typed `invalid_transition` error                                            | **Done** — `state-machine.ts` `canTransition` + `InvalidStageTransitionError` from Forge AI-135 port |

## 2. Architecture

```
                  ┌────────────────────────────────────────────────┐
   POST /v1/runs  │  Fastify service  (apps/orchestrator/src/)      │
   POST  /pause   │  ────────────────────────────────────────────   │
   POST  /resume  │  server.ts   router.ts   gates.ts               │
   POST  /cancel  │  repo.ts     rehydrate.ts sweeper-worker.ts      │
   GET   /runs/id │  approvals-repo-pg.ts                           │
   GET   /stages  │  paperclip-client-http.ts (Forge AI-169/Forge AI-177)   │
                  │  pagerduty.ts (Forge AI-171)                         │
                  │  adapters/event-bus-nats.ts (Forge AI-170)          │
                  └────────────────────┬───────────────────────────┘
                                       │ typed EventBus port
                                       ▼
                  ┌────────────────────────────────────────────────┐
                  │  Stage-engine seam (Forge AI-135 / Forge AI-173)        │
                  │  apps/agent-runtime/src/orchestrator/           │
                  │  ────────────────────────────────────────────   │
                  │  types.ts  ports.ts  state-machine.ts           │
                  │  advance-stage.ts  memory-ports.ts  stage-table.ts│
                  │  InMemoryStageEngine (test double)              │
                  └────────────────────┬───────────────────────────┘
                                       │ gRPC adapter (Forge AI-135 v0.2)
                                       ▼
                  ┌────────────────────────────────────────────────┐
                  │  Stage engine runtime (Forge AI-30 @ 0.2.3 shipped) │
                  │  ────────────────────────────────────────────   │
                  │  retry  budget  idempotency  cancel  mounts     │
                  │  gateway (allow-list)  validator  types         │
                  └────────────────────────────────────────────────┘
```

### 2.1 The seven-stage spine

`stage-table.ts` exports `STAGES_IN_ORDER` (single source of truth):

```ts
['ideation', 'architect', 'development', 'qa', 'security', 'devops', 'documentation']
```

Each stage maps to a typed `GateDefinition` in `gates.ts`:

| Stage            | Gate kind       | Required role | TTL tier | Primitive              |
|------------------|-----------------|---------------|----------|------------------------|
| ideation         | `stage_start`   | CEO           | 48 h     | `request_confirmation` |
| architect        | `stage_start`   | CTO           | 48 h     | `request_confirmation` |
| development      | `stage_start`   | CTO           | 48 h     | `request_confirmation` |
| qa               | `stage_start`   | CTO           | 24 h     | `request_confirmation` |
| security         | `stage_start`   | CTO + Board   | 24 h     | `request_board_approval` (deny by default) |
| devops           | `stage_start`   | CTO           | 24 h     | `request_confirmation` |
| documentation    | `stage_start`   | CTO           | 24 h     | `request_confirmation` |

(Full table in `apps/orchestrator/src/gates.ts`. The `GATE_BY_KIND` lookup is
the seam future CTO/Board policy rewrites use.)

### 2.2 The bridge (`gate_wiring.ts`)

The wiring module is the only place that converts `ApprovalEvent` →
`RunLifecycleEvent` and vice-versa. Per ADR-0001 §2.3 the engine is the only
writer of stage state; per ADR-0006 §3.1 the Orchestrator is the only writer
of the bus. The bridge owns the seam.

```
stage_completed (engine)
       │
       ▼
gateForStageTransition ──► routeGate(approval_kind=stage_transition)
       │                       │
       │                       ├─► emits approval_requested (bus)
       │                       └─► PaperclipHttpClient.issue(...)
       ▼
approval_decided (router)
       │
       ▼
onApprovalDecided ──► StageEngine.advance({ from, to })
       │
       ▼
stage_completed (next stage)
```

### 2.3 Recovery semantics (ADR-0009 §6, ADR-0008 §5)

* **Soft-delete invariant** — every read and write in `repo.ts` and
  `approvals-repo-pg.ts` filters `deleted_at IS NULL`. A soft-deleted run is
  invisible to the API (returns 404, not 410).
* **Crash recovery** — `buildRecoveryTickets(pool, tenantId)` reads every
  non-terminal run for the tenant and returns one ticket per run, with the
  seven stage rows and the `resumeFrom` stage (the row matching
  `run.current_stage`). The actual resume is the stage engine's job.
* **Stale-target recovery** — `recoverStaleTarget` re-issues a Paperclip
  interaction against a fresh `revisionId` (ADR-0008 §5). The original row
  stays; `paperclip_interaction_id` flips to the new id and the audit log
  carries the re-issue.

## 3. Public surface

`apps/orchestrator/src/index.ts` exports:

* `buildServer(deps)` + `OrchestratorDeps` — Fastify factory
* `loadConfig()` + `OrchestratorConfig` — typed env loader
* `buildRecoveryTickets(pool, tenantId)` + `RecoveryTicket` — crash-recovery hook
* `STAGES_IN_ORDER`, `makeOrchestratorError`, the typed id parsers
* `GATES`, `GATE_BY_KIND`, `findGate`, `ttlMs` — gate table
* `PgApprovalsRepo` — Postgres adapter (Forge AI-168)
* `RouterContext`, `RouterDeps`, `decide`, `routeGate`, `extendApproval`, `cancelApproval`, `recoverStaleTarget`
* `tickSweeper` — TTL sweeper
* `buildSweeperWorker` — cron worker (Forge AI-172)
* `PagerDutyPager`, `PaperclipHttpClient`, `NatsApprovalEventBus`, `connectNatsApprovalEventBus`
* `InMemoryApprovalsRepo`, `InMemoryStageEngine`, `RecordingEventBus`, `RecordingPaperclipClient`, `RecordingPager`, `TestClock` — test doubles
* `gateForStageTransition`, `nextStageOrDone`, `onApprovalDecided`, `onApprovalExpired`, `onStageCompleted` — the bridge

The HTTP surface (per Forge AI-50 §4.1):

| Method | Path                                | Purpose                                          | v0.1 |
|--------|-------------------------------------|--------------------------------------------------|------|
| POST   | `/v1/runs`                          | Create a run (trigger) — writes `agent_runs` + 7 `agent_run_stages` rows | ✅ |
| GET    | `/v1/runs/{id}`                     | Read run header. 404 for cross-tenant or soft-deleted | ✅ |
| GET    | `/v1/runs/{id}/stages`              | List the seven stage rows in canonical order     | ✅ |
| POST   | `/v1/runs/{id}/pause`               | Operator pause. Idempotent                       | ✅ |
| POST   | `/v1/runs/{id}/resume`              | Operator resume. Idempotent                      | ✅ |
| POST   | `/v1/runs/{id}/cancel`              | Operator cancel (terminal). Idempotent           | ✅ |
| POST   | `/v1/runs/{id}/approvals`           | Issue a gate approval (used by `routeGate`)      | ✅ |
| POST   | `/v1/runs/{id}/approvals/{approvalId}/decide` | Apply a decision (board / CEO / CTO)             | ✅ |
| POST   | `/v1/runs/{id}/approvals/{approvalId}/extend`  | Operator extends the TTL                          | ✅ |
| POST   | `/v1/runs/{id}/approvals/{approvalId}/cancel`  | Operator cancels an approval                      | ✅ |
| POST   | `/v1/runs/{id}/stages/{stage}/return`          | Send a stage back to a prior owner (CTO sends Dev → Arch) | ✅ |
| GET    | `/healthz`                          | Liveness                                          | ✅ |
| GET    | `/v1/runs`                          | Tenant-scoped list, sorted by `started_at DESC` (Forge AI-378) | ✅ |

Deferred (tracked in v1.1 ADR):

* `POST /v1/runs/{id}/soft-delete` + `/restore` (ADR-0009 §6)
* In-process JWT validation (today the gateway owns it per ADR-0003 §4.2)
* gRPC adapter for the stage engine (today the in-process `InMemoryStageEngine`
  is the bridge; the gRPC adapter is Forge AI-135 v0.2 per ADR-0007)

## 4. Event-bus vocabulary (Forge AI-50 §5.1)

The Orchestrator is the only writer of:

```
fora.events.<tenant_id>.approval_requested.v1
fora.events.<tenant_id>.approval_decided.v1
fora.events.<tenant_id>.approval_expired.v1
fora.events.<tenant_id>.stage_returned.v1
fora.events.<tenant_id>.stage_completed.v1
fora.events.<tenant_id>.run_paused.v1
```

Subject family per ADR-0006 §3.3. Per ADR-0006 §3.2 the envelope embeds
`tenant_id`; the typed event carries it once so the adapter does not need a
second lookup.

## 5. ADR references

* **ADR-0001** — Stage-engine ownership (the engine is the only writer of
  stage state).
* **ADR-0003** — JWT validation boundary (gateway-owned in v0.1; v1.1 moves
  it in-process).
* **ADR-0006** — NATS bus subject family + envelope.
* **ADR-0007** — gRPC orchestrator-runtime seam (Forge AI-135 follow-up).
* **ADR-0008** — Approval router algorithm + stale-target recovery + return
  primitive.
* **ADR-0009** — Soft-delete invariant + audit account + recovery tickets.

## 6. Versioning

* **Major version** bump is reserved for breaking changes to the wire surface
  (the JSON envelopes in §4) or the typed ports in `ports.ts`.
* **Minor version** bump adds a gate / a stage / a new public event.
* **Patch version** bump is reserved for adapter fixes and bug-for-bug
  reproductions.
* Loosening the soft-delete invariant (allowing hard-delete from the API) is
  rejected — that's a DBA path with a 1Password-held credential, by design.

## 7. Stage injection

This file is injected into every CTO + Architect + IntegrationEngineer + the
planned `master-orchestrator` hire's prompt at the **Architect** stage. The
IntegrationEngineer reads it at every per-stage handoff.

## 8. Cross-references

* `apps/orchestrator/README.md` — service-level overview.
* `apps/orchestrator/src/router.ts` — decision algorithm.
* `apps/orchestrator/src/gates.ts` — gate table (single source of truth).
* `apps/orchestrator/src/gate_wiring.ts` — the bridge between router and engine.
* `apps/agent-runtime/src/orchestrator/ports.ts` — `StageEngine` port.
* `apps/agent-runtime/src/orchestrator/advance-stage.ts` — typed advance action.
* `forge/0.1/comment_body.md` — close-gate comment body for Forge AI-110.
* `forge/0.1/CHANGELOG.md` — revision log.
* `forge/0.1/evidence/smoke_<ts>.json` — close-gate smoke evidence.

## 9. Acceptance gate

CTO closes this sub-goal **only** when the smoke in §10 passes, the comment
body in `forge/0.1/comment_body.md` is posted on the issue, and a
`request_confirmation` interaction is accepted by the Board. Loosening the
gate (e.g. dropping the smoke) is rejected.

## 10. Smoke (acceptance gate evidence)

`pnpm exec tsc -p apps/orchestrator/tsconfig.json --noEmit` → `TypeScript: No errors found`.

`pnpm exec vitest -r apps/orchestrator run` →
**16 test files passed, 3 skipped (live tests gated on Forge AI_DATABASE_URL /
Forge AI_NATS_URL), 171 tests passed, 7 skipped, 0 failed, 11.26 s wall-clock.**

Per-file:

| File                                            | Tests | Pass | Notes |
|-------------------------------------------------|-------|------|-------|
| `test/lifecycle.test.ts`                        | 40    | 40   | POST `/v1/runs` creates a run + seven stage rows; pause/resume/cancel idempotency |
| `test/gates.test.ts`                            | 16    | 16   | Gate table single-source-of-truth; TTL math |
| `test/router.test.ts`                           | 15    | 15   | Approval router decision algorithm |
| `test/gate-wiring.test.ts`                      | 12    | 12   | Forge AI-173 wiring (the bridge between router and engine) |
| `test/paperclip-client-http.test.ts`            | 16    | 16   | PaperclipHttpClient adapter (Forge AI-169 / Forge AI-177) |
| `test/pagerduty.test.ts`                        | 14    | 14   | PagerDutyPager adapter (Forge AI-171) |
| `test/approvals-repo-pg.test.ts`                | 10    | 10   | PgApprovalsRepo (Forge AI-168) |
| `test/sweeper.test.ts`                          |  7    |  7   | TTL sweeper |
| `test/decide-idempotency.test.ts`               |  6    |  6   | Idempotency-Key on `/decide` |
| `test/runs-index.test.ts`                       |  7    |  7   | Forge AI-378 runs index + demo-run-001 alias |
| `test/board-approval.test.ts`                   |  6    |  6   | Board approval flow |
| `test/approvals.test.ts`                        |  4    |  4   | Approvals REST API |
| `src/adapters/event-bus-nats.test.ts`           | 15    | 15   | NatsApprovalEventBus adapter (Forge AI-170) |
| `test/_debug.test.ts` + `_debug2.test.ts`       |  2    |  2   | Local debugging probes (gated on env) |
| `test/paperclip-client-http.live.test.ts`       |  1    |  1   | Live Paperclip API integration |
| `test/approvals-repo-pg.live.test.ts`           |  4    |  4   | Skipped (Forge AI_DATABASE_URL not set) |
| `test/pagerduty.live.test.ts`                   |  1    |  1   | Skipped (Forge AI_PAGERDUTY_TOKEN not set) |
| `src/adapters/event-bus-nats.live.test.ts`      |  2    |  2   | Skipped (Forge AI_NATS_URL not set) |