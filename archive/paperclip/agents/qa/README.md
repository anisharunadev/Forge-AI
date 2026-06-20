# QA Agent (Forge AI-43, Forge AI-72)

Stage 4 of the Forge AI SDLC pipeline. Sits between the Dev stage (PR
merged, CI green) and the Security stage. Produces a runnable test
suite for a merged PR and a coverage report, then hands off.

Stage 4 actually has two sub-stages wired by this directory:

- **Forge AI-72 — Test generator** (`test_generator.py`): a deterministic
  `CodeDiff` (from Forge AI-70) → `TestPlan` + emitted test files. v0.1
  is rule-based; the same diff + the same signals always produces
  the same plan + the same bytes. Supports jest / phpunit / pytest
  / playwright / cypress / pact across the four tiers
  (unit / integration / e2e / contract).
- **Forge AI-43 — QA runner** (`agent.py`): takes a `TestPlan` (which may
  have been produced by Forge AI-72, or hand-built by the DevOps
  orchestrator) and runs it through the per-tier generators
  (`generators.py`), producing a `TestRun` and a `CoverageReport`.

The pipeline is:

```
Dev (CodeDiff from Forge AI-70)
       │
       ▼
  TestGenerator (Forge AI-72)            ◀── this directory, test_generator.py
       │
       │ TestPlan + emitted test files
       ▼
  QaAgent.run() (Forge AI-43)            ◀── this directory, agent.py
       │
       │ TestRun.verdict ∈ {pass, fail, needs_attention}
       ▼
  Security stage
```

## What it does

Given a `TestPlan` (built by the DevOps orchestrator from the merged
PR metadata and the project knowledge layer), the agent:

1. **Collects** three slices of evidence: the PR diff, the project's
   `tech-stack.md`, and the customer `conventions.md`.
2. **Validates** the `TestPlan` (ADR-0004 §4 invariants). A broken
   plan is rejected fast with `status="blocked"`.
3. **Runs every tier's generator** in `TIER_RUN_ORDER`:
   `unit` → `integration` → `e2e` → `contract`.
4. **Builds a `CoverageReport`** alongside the `TestRun` (the
   Security stage consumes both).
5. **Returns an `AgentResult`** that downstream stages can read
   directly. The `verdict` field (`pass` | `fail` | `needs_attention`)
   is the gate token for the QA → Security transition.

The v1 implementation is a **deterministic scaffold**: no real LLM
call, no real MCP-backed PR diff. Generators emit well-formed
skeleton files; a human or a future LLM-backed generator fleshes
them out.

## Layout

```
agents/qa/
  schemas.py        # TestPlan, TestRun, CoverageReport + validate() (ADR-0004)
  collectors.py     # one collector per source (PR diff, tech-stack, conventions)
  generators.py     # one stub generator per tier + run_generators() + coverage
  agent.py          # QaAgent.run(test_plan) -> AgentResult
  fixtures/         # checked-in fixture_pr.diff used by the smoke test
  evidence/         # produced artifacts (skeleton files, run reports)
  README.md         # this file
```

## Public surface

```python
from agents.qa.agent import QaAgent
from agents.qa.schemas import TestPlan, TierPlan, SCHEMA_VERSION

plan = TestPlan(
    schema_version=SCHEMA_VERSION,
    plan_id="tplan-...",
    run_id="run-...",
    contract_id="hnd-...",
    source_pr="Forge AI-org/checkout-api#482",
    branch="qa/test-gen",
    commit_sha="<40 lowercase hex>",
    base_branch="main",
    target_branch="main",
    tiers=[
        TierPlan(tier="unit",        framework="pytest",     command="pytest -q tests/unit"),
        TierPlan(tier="integration", framework="pytest",     command="pytest -q tests/integration"),
        TierPlan(tier="e2e",         framework="playwright", command="playwright test e2e/"),
        TierPlan(tier="contract",    framework="pact",       command="pact verify pacts/"),
    ],
)

with QaAgent(out_dir="agents/qa/evidence/skeleton/") as agent:
    result = agent.run(plan)
# result.status       in {passed, partial, failed, blocked}
# result.test_run     -> dict (TestRun.to_dict())
# result.coverage_report -> dict (CoverageReport.to_dict())
# result.emitted_files -> [path, ...]
```

The `agent.run()` call is idempotent: the same `TestPlan` (same
`idempotency_key`) produces the same `test_run_id` and the same
emitted files. Re-running on the same plan is safe.

## Tiers and selection rules

Per `workspace/memory/qa.md` §2:

| Tier         | When selected                                            | `required` |
| ------------ | -------------------------------------------------------- | ---------- |
| `unit`       | every change touching business logic                     | true       |
| `integration`| every change crossing a service boundary                 | true       |
| `e2e`        | only when the diff includes UI or a critical API path    | false      |
| `contract`   | only when the diff crosses a public boundary (API, MCP)  | true       |

A tier listed in the plan but with no registered generator returns
`status="not_implemented"` — a real status, never a fake pass. The
`derive_run_status()` rule reduces per-tier results to a single
`RunStatus`: any `failed` → `FAILED`; mix of `passed` and
`not_implemented` (no failures) → `PARTIAL`; all `passed` → `PASSED`;
no results → `BLOCKED`.

## Sources (v1 collectors)

| Source       | Path                                              | Mode    |
| ------------ | ------------------------------------------------- | ------- |
| `pr_diff`    | `agents/qa/fixtures/fixture_pr.diff` (v1 stub)    | sample  |
| `tech_stack` | `workspace/project/tech-stack.md`                 | sample  |
| `conventions`| `workspace/customer/conventions.md`               | sample  |

Each collector returns a normalised `InputSignal` with
`mode="sample"` in v1. The `mode` is honest provenance: v1 never
calls a real MCP for these sources. When a real source ships
(Forge AI-49: GitHub MCP for `pr_diff`), the collector flips `mode` to
`"live"` without changing the rest of the shape. The agent does
not care which mode a signal is in — it just iterates the dict.

Collectors are injectable: pass a `collectors={"pr_diff": ...,
"tech_stack": ..., "conventions": ...}` dict to `QaAgent(...)` to
swap the source without changing the agent body.

## Schemas (ADR-0004)

The handoff contract is locked at `SCHEMA_VERSION = "1.0.0"`. Three
top-level dataclasses are exported:

- **`TestPlan`** — what the agent intends to run, per tier. Carries
  the join keys the Audit and Security stages need: `run_id`,
  `contract_id`, `branch`, `commit_sha`, `base_branch`,
  `idempotency_key`. A `TestPlan` missing any of these is rejected
  by `TestPlan.validate()`.
- **`TestRun`** — what actually happened. Per-tier results with
  counts, p50/p99, sample failures, and the `verdict` field
  (`pass` | `fail` | `needs_attention`) that the Security stage
  reads as its gate token.
- **`CoverageReport`** — line / branch / mutation coverage
  (where available), per tier, with `coverage_id` and `test_run_id`
  join keys. v1 reports zeros (real numbers come from the runner
  in Phase 2); tiers that were `skipped` or `not_implemented`
  report `available=False`.

`InputSignal` is re-used from `agents.ideation.schemas` so
collectors across agents emit the same shape. The re-export keeps
`from agents.qa.schemas import ...` self-contained.

Additive changes are a minor version bump. Breaking changes are
a major bump and a new ADR. A payload whose `schema_version` is
ahead of the running code is rejected (fail closed).

## Generators (v1: deterministic stubs)

```python
GENERATORS = {
    "unit":        generate_unit,
    "integration": generate_integration,
    "e2e":         generate_e2e,
    "contract":    generate_contract,
}
```

Each generator takes `(test_plan, tier_plan, signals, out_dir)` and
returns a `TierResult`. v1 generators never call an LLM. They emit
at least one well-formed skeleton file per tier (the `evidence`
field on every `TestCase` is the path to that file), and return:

- `status="passed"`     — one or more files emitted.
- `status="skipped"`    — selection rule did not match (e.g. e2e
  skipped when diff has no UI/critical-API path).
- `status="not_implemented"` — registered as the tier value but
  no generator implemented yet (e.g. mutation scoring).

`run_generators()` iterates the plan in `TIER_RUN_ORDER`, calls the
right generator, and assembles the `TestRun`. The
`build_coverage_report()` helper builds a stub `CoverageReport`
from the `TestRun` (real numbers land in Phase 2).

## Production wiring

```python
from agents._shared.mcp_client import StdioMcpClient
from agents.qa.agent import QaAgent

with StdioMcpClient("github", [...], env=github_env) as gh:
    collectors = {
        "pr_diff":    lambda: collect_pr_diff(github_client=gh),
        "tech_stack": lambda: collect_tech_stack(),
        "conventions":lambda: collect_conventions(),
    }
    agent = QaAgent(collectors=collectors,
                    out_dir="agents/qa/evidence/skeleton/")
    result = agent.run(plan)
```

## v2 extension points (Phase 2)

The skeleton is the surface; the v2 work slots in **without
changing `QaAgent.run()`**:

1. **LLM-driven test synthesis.** Replace the body of each
   generator in `GENERATORS` with a call to the synthesis MCP that
   returns a filled-out test body. The selection rules, file
   paths, and `TierResult` shape stay the same.
2. **Real PR diff collector.** Swap the fixture-based
   `collect_pr_diff` for a GitHub-MCP-backed one (Forge AI-49). The
   `InputSignal.mode` flips to `"live"` automatically.
3. **Real coverage numbers.** Replace the `build_coverage_report`
   stub with one that parses `coverage.py` / `istanbul` output.
   `CoverageReport.validate()` already enforces the shape.
4. **GitHub posting.** Push emitted tests onto a `qa/test-gen`
   branch and open a PR (separate issue). The agent writes the
   files under `out_dir`; the publisher reads them.
5. **Self-healing** (Forge AI-37). The agent learns from previous
   runs and rewrites its own generators. **Out of scope for v1.**
6. **Mutation score.** Add a fifth tier and wire a mutation
   tool. `derive_run_status()` already accounts for
   `not_implemented` tiers as `PARTIAL`, not `FAILED`.

## Smoke test

The end-to-end smoke test (run with the project's python venv):

```bash
python3 - <<'PY'
from agents.qa.agent import QaAgent
from agents.qa.schemas import TestPlan, TierPlan, SCHEMA_VERSION

plan = TestPlan(
    schema_version=SCHEMA_VERSION,
    plan_id="tplan-smoke",
    run_id="run-smoke",
    contract_id="hnd-smoke",
    source_pr="Forge AI-org/checkout-api#482",
    branch="qa/test-gen",
    commit_sha="3fde39459dcb4c4395b34e4e9db6ffe9bb09220b",
    base_branch="main", target_branch="main",
    tiers=[
        TierPlan(tier="unit",        framework="pytest",     command="pytest -q tests/unit"),
        TierPlan(tier="integration", framework="pytest",     command="pytest -q tests/integration"),
        TierPlan(tier="e2e",         framework="playwright", command="playwright test e2e/"),
        TierPlan(tier="contract",    framework="pact",       command="pact verify pacts/"),
    ],
)
result = QaAgent(out_dir="/tmp/qa_smoke").run(plan)
assert result.status == "passed"
assert result.test_run["verdict"] == "pass"
assert all(t["status"] == "passed" for t in result.test_run["tier_results"])
assert len(result.emitted_files) >= 4  # one per tier minimum
print("OK", len(result.emitted_files), "files emitted")
PY
```

Exercises: validation, all four tiers, coverage report, and the
`verdict` field that the Security stage reads.

## Where this fits in the SDLC pipeline

```
   Stage 3: Dev (PR merged, CI green)
                  │
                  ▼
        ┌──────────────────┐
        │     Forge AI-43      │  ◀── THIS AGENT
        │   QA / Test Gen  │
        └────────┬─────────┘
                 │ test_run.verdict
                 │ in {pass, fail, needs_attention}
                 ▼
        Stage 5: Security
```

## Knowledge layer

The agent reads (does not write) from the knowledge layer:

- `workspace/project/tech-stack.md` — framework choices per tier.
- `workspace/customer/conventions.md` — naming, layout, severity
  matrix, PR-bar rules.
- `workspace/memory/qa.md` — selection rules, the four tiers,
  the handoff contract, the gate to Security.

A change to any of these is a behavior change to the agent; the
Memory cross-cutting agent gates writes.

## Out of scope (v1)

- LLM-driven test synthesis (Phase 2).
- Self-healing (Forge AI-37).
- Posting emitted tests to GitHub (separate issue).
- Mutation score (placeholder tier, not_implemented).
- Real coverage numbers (stub returns zeros).

## Forge AI-72 — Test generator (sub-stage 4.1)

v0.1 lives in `agents/qa/test_generator.py` and is exercised by
`agents/qa/smoke_test_test_generator.py`. Public surface:

```python
from agents.qa.test_generator import TestGenerator, generate_tests

result = generate_tests(code_diff, out_dir="agents/qa/evidence/test_generator/<plan_id>/")
# result.test_plan         -> TestPlan (consumable by QaAgent.run() below)
# result.generated_files   -> list[GeneratedTestFile] (one per emitted test)
# result.selection_trace   -> list[SelectionTrace] (per-tier rationale)
# result.framework_warnings -> list[str] (no-renderer, unknown-language)
# result.warnings          -> list[str] (no test files generated, etc.)
```

Selection rules (per `workspace/memory/qa.md` §2):

| Tier         | Required | Selection rule                                                        |
| ------------ | -------- | --------------------------------------------------------------------- |
| unit         | yes      | every source file in the diff                                         |
| integration  | yes      | every file under `service/`, `api/`, `mcp/`, `src/server/`            |
| e2e          | no       | only files with a UI extension (`.tsx`/`.jsx`/`.vue`/`.svelte`/`.html`) or under `e2e/`, `pages/`, `routes/`, `critical/` |
| contract     | yes      | only files matching `mcp/**/tools*.json`, `openapi*`, `swagger*`, `api/v*/...` |

Framework resolution (path-extension-driven, not `FileChange.language`-driven):

| Language     | unit / integration  | e2e            | contract  |
| ------------ | ------------------- | -------------- | --------- |
| python       | pytest              | playwright     | pact      |
| typescript   | jest                | playwright     | pact      |
| javascript   | jest                | playwright     | pact      |
| php          | phpunit             | cypress        | pact      |
| (fallback)   | pytest              | playwright     | pact      |

The renderers are pure functions (`(target, symbol) -> str`); the
only I/O is the file write under `out_dir`. v0.1 carries no
`subprocess`, `git`, LLM, or HTTP imports.

Run the smoke test:

```bash
python3 -m agents.qa.smoke_test_test_generator
```

It produces a JSON evidence file at
`agents/qa/evidence/smoke_<UTC>/test_generator.json` and 30+
assertions across 7 fixtures.
