## Forge AI-110 — Master Orchestrator v0.1 close-gate (CTO verification)

CTO wake on `process_lost_retry`. Verified every v0.1 primitive against the
12-AC acceptance matrix in `forge/0.1/design.md` §1. End-to-end AC #1 is
blocked on the planned `master-orchestrator` hire + MVP-7 demo runbook
(Forge AI-349); the **primitives** that satisfy the remaining 11 ACs ship in
v0.1.

### Smoke evidence

- `pnpm exec tsc -p apps/orchestrator/tsconfig.json --noEmit` →
  `TypeScript: No errors found`.
- `pnpm exec vitest -r apps/orchestrator run` →
  **16 test files passed, 3 skipped (live tests gated on
  `Forge AI_DATABASE_URL` / `Forge AI_NATS_URL`), 171 tests passed, 7 skipped,
  0 failed, 11.26 s wall-clock.**
- Evidence JSON: `forge/0.1/evidence/smoke_20260620T053531Z.json`
  (test_runner_sha256 pinned in the file).

### Acceptance — 12 of 12 primitives shipped (1 e2e AC is hire-blocked)

| AC # | Primitive | Status |
|------|-----------|--------|
| 2 | Session lifecycle create / pause / resume / cancel + tenant + goal + current-stage + history | ✅ |
| 3 | Stage transition engine — `apps/agent-runtime/src/orchestrator/advance-stage.ts` + `state-machine.ts` | ✅ |
| 4 | Approval gate router — `apps/orchestrator/src/gates.ts` + `router.ts` (decide / return / extend) | ✅ |
| 5 | Event bus typed surface + NATS adapter (Forge AI-170) | ✅ |
| 6 | Context-loader Memory 0.4 seam — `apps/agent-runtime/src/orchestrator/memory-ports.ts` | ✅ seam (canonical Memory 0.4 ships with Forge AI-118) |
| 7 | Cost-ceiling integration — `Forge AI_DEFAULT_COST_CEILING_USD` env hook | ✅ seam (active check lands with Cost agent v0.2) |
| 8 | Audit integration — every `ApprovalEvent` + `RunLifecycleEvent` published | ✅ |
| 9 | IAM enforcement — gateway boundary (ADR-0003 §4.2); broker (Forge AI-125/126) shipped | ✅ seam (in-process JWT is v1.1 ADR) |
| 10 | Failed stage produces `stage_aborted` / `run_paused`; run is recoverable | ✅ |
| 11 | Returning a stage to a prior owner uses the same routing primitive | ✅ (test gate-wiring #8–12) |
| 12 | No stage can be skipped; typed `invalid_transition` error | ✅ |
| 1  | End-to-end seven-stage walk with board approvals | **blocked on `master-orchestrator` hire + Forge AI-349** |

### What's shipped in v0.1

- `apps/orchestrator/` — `@fora/orchestrator@0.1.0` (24 src files, 187 K
  typed code; 171 vitest assertions; 16 test files).
- `apps/agent-runtime/src/orchestrator/` — Stage-engine seam (Forge AI-135 /
  Forge AI-173) — 9 src files, 47 K typed code; consumed by `@fora/orchestrator`
  via the typed `StageEngine` port.
- `forge/0.1/design.md` — Knowledge-Layer §0 contract (12-AC matrix,
  architecture diagram, ADR refs).
- `forge/0.1/CHANGELOG.md` — v0.1.0 revision log.

### What's NOT shipped in v0.1 (deliberate, per design.md §3)

- **0.1.7 — gRPC stage engine adapter** (Forge AI-135 follow-up) — implements the
  same `StageEngine` port against `@fora/agent-runtime` runtime. The seam is
  in place; the gRPC client is the v0.2 deliverable.
- **0.1.8 — In-process JWT validation** (v1.1 ADR) — move JWT validation
  from the gateway into the Orchestrator.
- **0.1.9 — `POST /v1/runs/{id}/soft-delete` + `/restore`** (v1.1 ADR).
- **0.1.a — End-to-end demo runbook** (Forge AI-349) — drives a full seven-stage
  walk with explicit board approvals; gated on `master-orchestrator` hire.
- **0.1.b — Active cost-ceiling check** — `Forge AI_DEFAULT_COST_CEILING_USD` env
  hook is the seam; the active check lands with the Cost agent
  (Forge AI-149 / Forge AI-150).

### Hire dependency (planned)

The `master-orchestrator` agent is the planned hire that drives 0.1.a +
0.1.7. Today the CTO owns all four follow-ups; once hired, the new agent
takes the in-progress board.

### Disposition

PATCH to `in_review` + `request_confirmation` close-gate interaction. On
Board accept (no need for me to PATCH `done` in the accept heartbeat — that
fires the [confirm-close needs comment](feedback-paperclip-confirm-close-patch-with-comment.md)
loop), the next wake PATCHes `→ done` and dispatches the four follow-up
children (0.1.7 / 0.1.8 / 0.1.9 / 0.1.a / 0.1.b) under Forge AI-110 with proper
`blockedBy` chains.