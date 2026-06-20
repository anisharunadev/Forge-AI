# Acceptance harness — Forge AI Agent Runtime

This directory contains the **end-to-end acceptance harness** for the v0
Forge AI Agent Runtime. It proves the acceptance lines in
[Forge AI-30 §13](../../../Forge AI/issues/Forge AI-30#document-plan) line-by-line,
using a tiny `EchoAgent` defined in
[`echo-agent.ts`](./echo-agent.ts).

## Run it

```bash
# From apps/agent-runtime
pnpm test:acceptance:runtime
```

This is the single CI entry point. It runs all five scenarios in one
vitest suite. Failure modes are loud (no silent skips) — a single failed
scenario short-circuits the suite with a structured error message.

You can also run the wider unit suite:

```bash
pnpm test           # 86 tests across 8 files (5 of which are here)
pnpm typecheck
```

## Mapping to Forge AI-30 acceptance

| # | Scenario                         | Forge AI-30 acceptance line (§13)                                | Source                                |
| - | -------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| 1 | `scenario1_happyPath`            | A sub-agent can be invoked, plan a 3-step task, call only allow-listed tools, and produce a structured run record. | [scenarios.ts](./scenarios.ts) |
| 2 | `scenario2_allowListNegative`    | Runtime never calls a non-allow-listed tool; attempts are logged and surfaced as a typed error. | [scenarios.ts](./scenarios.ts) |
| 3 | `scenario3_idempotencyProperty`  | Retries do not duplicate side effects when handlers return idempotency keys. | [scenarios.ts](./scenarios.ts) |
| 4 | `scenario4_budgetAbort`          | Cost ceiling enforcement aborts the run with a typed error rather than silently exceeding budget. | [scenarios.ts](./scenarios.ts) |
| 5 | `scenario5_cancellation`         | (Bonus) Cancellation behaves correctly.                      | [scenarios.ts](./scenarios.ts) |

The mapping is enforced by each scenario's `acceptanceLine` field and is
also surfaced in the `formatScenarioSummary()` line that CI prints on
failure.

## File layout

```
test/acceptance/
├── README.md                  ← you are here
├── echo-agent.ts              ← shared EchoAgent factory + helpers
├── scenarios.ts               ← the 5 scenario functions + formatters
└── acceptance.test.ts         ← vitest entry; wires scenarios into a suite
```

## How each scenario works

Every scenario is a self-contained async function in `scenarios.ts` that
returns a `ScenarioResult`. The `acceptance.test.ts` harness asserts on
that result and surfaces the failures as a single `expect.fail(...)`.

Each scenario uses a fresh `mkdtempSync` workspace so its run record
JSON / JSONL files never collide with another scenario. Look for
`<workspace>/runs/{runId}.json` and `{runId}.jsonl` after a run.

### Scenario 1 — happy path

EchoAgent with `act` allow-list `[notes.append]`, planner emits a
3-step plan. The handler is side-effecting and declares an idempotency
key; each step gets its own per-step key (so the three calls are NOT
deduped against each other).

Asserts:
- 3 ordered step records in `RunRecord.steps`, all `ok: true`, in plan order
- handler called exactly 3 times (no dedup across distinct keys)
- `RunRecord.status == 'succeeded'`
- `RunRecord.budget.spent.tokens > 0` (handler `costHint` is the spend source)
- finalized JSON present on disk

### Scenario 2 — allow-list negative

Same EchoAgent, but the planner emits a single step calling `fs.delete`
(not in the allow-list). Asserts:
- `invokeResult.status == 'failed'`, `error.code == 'NotAllowed'`
- the typed error appears in `RunRecord.errors`
- the `notes.append` handler was never invoked
- the JSONL stream records an `error` event (first-class surface)

### Scenario 3 — idempotency property

EchoAgent with a single `notes.append` step that re-uses the SAME
idempotency key across 5 separate `runtime.invoke` calls. Asserts:
- idempotency cache size == 1
- handler called exactly once (the §6 "at most once per unique key" invariant)
- all 5 invocations end in `status == 'succeeded'` (cache replay)
- invocations 2–5 carry `idempotencyHit` on their step record

The "fault sequence" mentioned in the issue spec
(`[ok, 429, ok, 5xx, ok]`) describes what the handler would do across
repeated attempts. The runtime never gives the handler a chance to do
anything past the first call: the cache prevents the remaining four
attempts from reaching it. The test pins the at-most-once guarantee.

### Scenario 4 — budget abort

EchoAgent with `tokenCeiling: 1`, planner reports `usage: { tokens: 2 }`.
Asserts:
- `invokeResult.status == 'budget_exceeded'`, `error.code == 'BudgetExceeded'`
- the typed error carries `spent.tokens > ceiling.tokenCeiling`
- `RunRecord.status == 'budget_exceeded'`
- the handler was never invoked (pre-stage check fires before `act`)

### Scenario 5 — cancellation

EchoAgent whose handler awaits `ctx.signal` until the run is cancelled,
then throws `CancelledError`. The test uses a barrier (the handler
resolves a promise on entry) so cancel is guaranteed to land mid-act.
Asserts:
- handler was invoked exactly once (and observed `ctx.signal.aborted`)
- `invokeResult.status == 'cancelled'`, `error.code == 'Cancelled'`
- `error.reason == 'acceptance test'`
- `RunRecord.status == 'cancelled'`

## Adding a new acceptance scenario

Each new scenario must map to a Forge AI-30 acceptance line. If you are
adding coverage for a new line, edit
[Forge AI-30 §13](../../../Forge AI/issues/Forge AI-30#document-plan) first and
add the new scenario here.

The shape is:

1. **`echo-agent.ts`** — extend the factory if your scenario needs a
   new tool, handler shape, or planner. Keep `mkEchoAgent` the
   composition root; new scenarios pass `opts` to vary behavior.
2. **`scenarios.ts`** — add `scenarioN_<name>()`. Use `newWorkspace`
   for an isolated tmpdir, return a `ScenarioResult` with `failures`
   populated by `fail(result, message)` if any assertion trips. Do not
   throw; the harness collects failures into one report.
3. **`acceptance.test.ts`** — add an `it('scenario N — …', …)` block
   that calls the new scenario and `expect.fail`s on non-empty
   `failures`.
4. Update the mapping table at the top of this README.

Rules for new scenarios:
- Always use a fresh `mkdtempSync` workspace.
- Never share the `LruIdempotencyStore` across scenarios unless the
  scenario specifically tests cross-invocation dedupe.
- Always pin the run id (`mintRunId`) when the scenario asserts on the
  cancel API. This avoids races with the runtime's default id mint.
- Always assert on `RunRecord.status` (not just `InvokeResult.status`)
  — they can drift if the stage machine changes.
- Always check the `RunRecord.errors` array for typed-error presence.
  Surface as a typed error, not a thrown exception.
- Use the existing `formatScenarioSummary` so CI logs read the same.

## Failure modes

Each scenario collects failures into a `failures: string[]` array. The
test harness short-circuits on the first non-empty `failures` with
`expect.fail(formatScenarioSummary(r))`, which prints the scenario
name, acceptance line, status, facts, and the failing assertion. CI
surfaces the full message; the vitest reporter handles colourising.

If a scenario throws (unhandled error), vitest will surface the stack
trace instead. This is also loud — the harness does not silently skip.
