# Changelog — 0.1 Master Orchestrator

All notable changes to the Master Orchestrator surface are recorded here.
This file follows [Keep a Changelog](https://keepachangelog.com/) and the
project's `customer/glossary.md` §7 conventions.

## [0.1.0] — 2026-06-20 — CTO close-gate

### Added

- `apps/orchestrator/` — `@fora/orchestrator@0.1.0` Fastify service:
  - `src/server.ts` (26.5 K) — Fastify factory + healthz + per-tenant request
    stamping (ADR-0003 §4.2)
  - `src/router.ts` (17.7 K) — approval router algorithm (`decide`,
    `routeGate`, `extendApproval`, `cancelApproval`, `recoverStaleTarget`)
  - `src/gates.ts` (7.3 K) — typed gate table (`GATES`, `GATE_BY_KIND`,
    `findGate`, `ttlMs`)
  - `src/approvals-repo-pg.ts` (17.3 K) — `PgApprovalsRepo` (Forge AI-168)
  - `src/repo.ts` (17.3 K) — soft-delete-aware run repo (ADR-0009 §6)
  - `src/rehydrate.ts` (4.3 K) — `buildRecoveryTickets(pool, tenantId)`
  - `src/gate_wiring.ts` (9.0 K) — bridge between router and engine (Forge AI-173)
  - `src/sweeper.ts` (4.6 K) + `sweeper-worker.ts` (7.3 K) — TTL sweeper
    + cron worker (Forge AI-172)
  - `src/paperclip-client-http.ts` (11.3 K) — `PaperclipHttpClient` adapter
    (Forge AI-169 / Forge AI-177)
  - `src/pagerduty.ts` (11.2 K) — `PagerDutyPager` adapter (Forge AI-171)
  - `src/idempotency.ts` (5.9 K) — `Idempotency-Key` envelope
  - `src/adapters/event-bus-nats.ts` (NATS) — `NatsApprovalEventBus` adapter
    (Forge AI-170)
  - `src/state-machine.ts` (3.7 K) — lifecycle predicates
    (`canTransition`, `isTerminal`, `nextStatus`)
  - `src/test-doubles.ts` (18.4 K) — `InMemoryApprovalsRepo`,
    `InMemoryStageEngine`, `RecordingEventBus`, `RecordingPaperclipClient`,
    `RecordingPager`, `TestClock`
  - `src/config.ts` (1.8 K) — typed env loader
  - `src/types.ts` (5.4 K) — public type contract
  - `src/ports.ts` (11.9 K) — typed port surface
  - `src/router-types.ts` (4.1 K) — router types
  - `src/index.ts` (5.1 K) — public barrel
  - `bin/fora-orchestrator.mjs` — bin entry
- `apps/agent-runtime/src/orchestrator/` — Stage-engine seam (Forge AI-135):
  - `types.ts` (8.4 K) — typed `Stage`, `RunId`, `TenantId`, `StageDecision`
  - `ports.ts` (4.6 K) — `StageEngine` port (the seam with the orchestrator)
  - `state-machine.ts` (4.4 K) — typed FSM
  - `stage-table.ts` (7.0 K) — seven-stage spine + per-stage metadata
  - `advance-stage.ts` (10.4 K) — typed `advanceStage` action
  - `errors.ts` (4.5 K) — typed `InvalidStageTransitionError`
  - `memory-ports.ts` (4.9 K) — Memory 0.4 seam
  - `index.ts` (2.7 K) — barrel
  - `proto/orchestrator.proto` — gRPC proto (Forge AI-135 v0.2)

### Acceptance

- 12 / 12 Forge AI-110 AC primitives shipped.
- 16 / 16 orchestrator test files pass; 171 / 171 vitest assertions pass;
  typecheck clean.
- End-to-end acceptance (full seven-stage walk with board approvals) is
  blocked on `master-orchestrator` hire (planned) + MVP-7 demo runbook
  (Forge AI-349, blocked).

### Deferred to v0.2 (gated children)

- **0.1.7 — gRPC stage engine adapter** (Forge AI-135 follow-up) — implements the
  same `StageEngine` port against `@fora/agent-runtime` runtime. The seam is
  in place; the gRPC client is the v0.2 deliverable.
- **0.1.8 — In-process JWT validation** (v1.1 ADR) — move JWT validation
  from the gateway into the Orchestrator.
- **0.1.9 — `POST /v1/runs/{id}/soft-delete` + `/restore`** (v1.1 ADR).
- **0.1.a — End-to-end demo runbook** (Forge AI-349) — drives a full seven-stage
  walk with explicit board approvals; gated on `master-orchestrator` hire.

### Schema

- `agent_runs` — soft-delete-aware (ADR-0009 §6)
- `agent_run_stages` — 7 rows per run, status enum
  (`pending | running | waiting_approval | approved | rejected | returned`)
- `agent_run_approvals` — typed approval records (Forge AI-168)
- `agent_run_idempotency_keys` — Idempotency-Key dedupe (Forge AI-134)

### Known limitations

- Active cost-ceiling check lands with the Cost agent (Forge AI-149 / Forge AI-150)
  in v0.2; v0.1 surfaces `Forge AI_DEFAULT_COST_CEILING_USD` as an env hook.
- The Memory 0.4 typed seam (`memory-ports.ts`) is in place; the canonical
  Memory 0.4 surface ships with the Memory system (Forge AI-118).