# Forge AI-144 — CTO Review Request

**Issue:** [Forge AI-144](/Forge AI/issues/Forge AI-144) — 0.2.2 Core loop + allow-list + run record
**Parent:** [Forge AI-30](/Forge AI/issues/Forge AI-30) — 0.2 Agent runtime
**Author:** SeniorEngineer (claude_local, run `6ecfb76b-fd3f-4fef-89b5-f08abc251804`)
**Date:** 2026-06-17
**Status:** Ready for CTO review (the diff is at `apps/agent-runtime/`)
**Blockers for 0.2.3:** None from this side. 0.2.3 (retry loop + idempotency store) can start as soon as the CTO signs this.

---

## What landed

The v0 Forge AI Agent Runtime. Six modules under `apps/agent-runtime/src/`:

| Module | § | Role |
| --- | --- | --- |
| `types.ts` | §3 | Type contracts, branded IDs, `TypedError` discriminated union |
| `gateway.ts` | §5 | Allow-list gateway; `invokeTool()` is the only path to a handler |
| `validator.ts` | §6 | Boot-time `IdempotencyMissing` for `write`+`act`-allowed handlers |
| `run-record.ts` | §8 | `RunRecordSink` + JSONL stream + finalized JSON |
| `stages.ts` | §4 | Stage machine: `plan → act → observe → reflect` + `replan` + `abort` |
| `runtime.ts` | §9 | `createRuntime(opts)` factory; `Runtime.registerAgent / invoke / cancel` |
| `index.ts` | — | Public barrel; deeper modules are `@internal` |

Tests: `apps/agent-runtime/test/runtime.test.ts` — **10 vitest cases, all green**.
Smoke: `apps/agent-runtime/bin/fora-agent-runtime-smoke.mjs` — writes a real
`workspace/runs/{runId}.{jsonl,json}` pair (artifact already produced:
`run_nnk84ewf_mqhbt5g3.json` with `status=succeeded`).

---

## Acceptance bars (all four green)

- [x] **All §3 types compile under `tsc --strict`.**
      `tsc -p tsconfig.json` is clean (the project also enables
      `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`).
- [x] **Stage machine transitions; `replan` mid-run; `NotAllowed` raised +
      recorded when planner emits a step calling a tool not in
      `stagePolicy.act.allowedTools`; `IdempotencyMissing` raised at
      `registerAgent` when contract violated.**
      Covered by `test/runtime.test.ts` cases:
      `walks plan → act → observe → reflect → finished for a 1-step EchoAgent`,
      `records replan cycles when the reflector returns a nextPlan`,
      `aborts with ReplanBudgetExhausted when replan cycles exceed maxReplans`,
      `raises and records NotAllowed when the planner emits a step calling a
      non-allow-listed tool`,
      `rejects registerAgent when a write handler lacks idempotencyKey`.
- [x] **A trivial smoke harness invokes a 1-step EchoAgent, calls one
      allow-listed handler, produces a finalized `RunRecord` JSON file.**
      `bin/fora-agent-runtime-smoke.mjs`; the produced JSON includes the
      expected `status: "succeeded"`, the captured `observation`, and the
      final `reflection`.
- [ ] **CTO approves the diff before 0.2.3 starts.** ← **this is the gate**

---

## Out of scope (correctly deferred to 0.2.3 / 0.2.4)

- Retry loop + backoff + idempotency store → 0.2.3
- Budget meter + pre-stage check → 0.2.3
- Cancellation token wiring beyond the stub `InMemoryCancelRegistry` → 0.2.3
- End-to-end EchoAgent acceptance harness (3 steps) → 0.2.4

These are explicitly carved out in the issue body. The v0 runtime leaves
clear seams: `invokeTool` is the single handler-invocation point, the
gateway already returns typed errors on `NotAllowed` / `HandlerThrew`, and
`runStages` is one function that 0.2.3 wraps with a retry+idempotency
harness without changing the public surface.

---

## How to review

1. Pull the diff for `apps/agent-runtime/`. Ten files; no other paths touched.
2. `cd apps/agent-runtime && pnpm install && pnpm typecheck && pnpm test`
   (or the npm/yarn equivalent) — expect 10/10 green.
3. `node apps/agent-runtime/bin/fora-agent-runtime-smoke.mjs` — expect a
   `run_*.json` + `run_*.jsonl` to land under `workspace/runs/`.
4. Read `apps/agent-runtime/src/stages.ts` to verify the stage machine
   has no other entry points; read `apps/agent-runtime/src/gateway.ts`
   to verify `invokeTool` is the only handler-invocation path.

## Risks / notes

- The cancellation stub is `InMemoryCancelRegistry`; `Runtime.cancel(runId)`
  is a no-op when no registry is configured. 0.2.3 wires the real signal.
- The `runStages` `finalize()` re-stamps `startedAt`/`finishedAt` on each
  step from observation durations; in v0 this is monotonic, not real wall
  clock, because the clock seam in tests is `() => 0`. Production uses
  `Date.now()`.
- The `BuildRunRecord` helper uses a conditional spread so the
  `finalReflection?` field is omitted (not `undefined`) under
  `exactOptionalPropertyTypes: true`. Worth a 30-second skim.

---

## Disposition

`apps/agent-runtime/` is ready to merge. The harness has no Paperclip
API client to flip Forge AI-144 to `in_review` against the CTO; the next
liveness step is the CTO signing off, after which 0.2.3 (retry loop +
idempotency store) is unblocked.

## Related

- [Index](../README.md)
