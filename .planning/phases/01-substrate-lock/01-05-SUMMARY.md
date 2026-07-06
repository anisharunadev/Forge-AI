---
phase: 1
plan: 01-05
subsystem: agents
tags: [code-validator, langgraph, f-501, pydantic, ops-04, substrate-lock]
dependency_graph:
  requires: [01-01, 01-03, 01-09]
  provides: [code_validator_subgraph, validation_report_artifact, f-501-wiring]
  affects: [merge_gate, codedeploy_hook, audit_log]
tech_stack:
  added: []
  patterns: [langgraph-stategraph, pydantic-v2, async-subprocess-with-timeout, injectable-tool-runner, audit-on-every-mutation]
key_files:
  created:
    - agents/__init__.py
    - agents/code_validator/__init__.py
    - agents/code_validator/state.py
    - agents/code_validator/graph.py
    - agents/code_validator/nodes/__init__.py
    - agents/code_validator/nodes/lint_node.py
    - agents/code_validator/nodes/typecheck_node.py
    - agents/code_validator/nodes/security_scan_node.py
    - backend/tests/test_code_validator_subgraph.py
  modified:
    - backend/app/schemas/validation_report.py
    - backend/app/agents/code_validator.py
    - backend/app/agents/code_validator_state.py
decisions:
  - Code Validator sub-graph lives at the TOP-LEVEL `agents/code_validator/` (not under `backend/app/agents/`) to keep it independent of the SDLC supervisor package — locked Phase 1 decision.
  - The sub-graph is DETERMINISTIC: zero LLM calls; the no-LLM invariant is asserted by `test_subgraph_no_llm_call` (MagicMock on `litellm_client.completion`).
  - Per-scanner finding types (`LintFinding` / `TypeCheckFinding` / `SecurityFinding`) are defined in `agents/code_validator/state.py` as the canonical home; the schema layer re-exports them for wire-format stability.
  - `ValidationReport` is the typed Rule-4 artifact with `verdict: Literal["pass","warn","fail"]`, `is_blocking` property, and `to_kg_payload()` for the React Flow KG renderer.
  - The F-502 schema's `ValidationReport` (F-005 audit-trail surface) was extended with optional F-501 fields (defaults to None) to keep legacy callers (`validation_reports.py`, `merge_gate.py`, `explainability.py`) working.
  - Tool execution is INJECTABLE: each node accepts `_runner` and `_audit_record` as keyword-only params so tests run hermetically without `ruff` / `mypy` / `bandit` or a real DB.
  - The backend entry `run_code_validator(state)` is decorated with `@require_approval_phase(SDLCPhase.IMPLEMENTATION)` (threat model T-01-05-5) so direct calls without a recorded approval raise `ApprovalRequiredError`.
  - The new `run_code_validator` is additive — the existing `run_code_validator_with_approval` adapter is preserved for F-501 fan-out callers.
metrics:
  duration: 45m
  completed_date: 2026-07-07
  tasks: 3
  commits: 3
  tests_added: 6
  tests_passing: 6
status: complete
---

# Phase 1 Plan 01-05: F-501 Code Validator sub-graph

Wired F-501 (Code Validator sub-graph) as an independent LangGraph
supervisor that emits a typed `ValidationReport` artifact — with no
shared prompt template with `sdlc_agent.py` (per the locked Phase 1
decision in STATE.md).

## What was built

### `agents/code_validator/` — top-level independent package

A new top-level Python package (NOT under `backend/app/agents/`) that
hosts the Code Validator sub-graph. The package is INTENTIONALLY
independent of the SDLC supervisor: no import of `sdlc_agent` or
`sdlc_state`, no shared prompt template, no shared state type.

| File | Purpose |
|---|---|
| `agents/__init__.py` | Top-level agents package marker |
| `agents/code_validator/__init__.py` | Re-exports public surface |
| `agents/code_validator/state.py` | `CodeValidatorState` + 3 finding models + `ValidationReport` (canonical) |
| `agents/code_validator/graph.py` | `build_code_validator_graph()` + `code_validator_graph` |
| `agents/code_validator/nodes/__init__.py` | Re-exports 3 node functions |
| `agents/code_validator/nodes/lint_node.py` | `lint_node` (ruff, 60s timeout) |
| `agents/code_validator/nodes/typecheck_node.py` | `typecheck_node` (mypy, 120s timeout) |
| `agents/code_validator/nodes/security_scan_node.py` | `security_scan_node` (bandit, 120s timeout) |

### Topology

```
START
  └─▶ lint
        └─▶ typecheck
              └─▶ security_scan
                    └─▶ emit_report
                          └─▶ END
```

Linear pipeline. Each node appends to its typed findings slot. The
terminal `emit_report` node computes the deterministic verdict and
builds the typed `ValidationReport`.

### Determinism / no-LLM invariant

The sub-graph is fully deterministic — zero LLM calls. Proven by:

* `grep -rE 'litellm_client\.completion' agents/code_validator/` returns nothing.
* `test_subgraph_no_llm_call` patches `litellm_client.completion` with a `MagicMock` and asserts zero calls during a full graph invocation.

### Verdict rule (threat model T-01-05-4 Repudiation)

| Severity source | Verdict |
|---|---|
| Any `SecurityFinding.severity in ("critical", "high")` | `"fail"` |
| Any `LintFinding.severity == "error"` | `"fail"` |
| Any `TypeCheckFinding.severity == "error"` | `"fail"` |
| Any warning-severity finding | `"warn"` |
| Otherwise (incl. empty findings) | `"pass"` |

### Schema contract — `ValidationReport`

* `tenant_id` (UUID, required, Rule 2)
* `project_id` (UUID, required, Rule 2)
* `run_id` (UUID, required)
* `lint_findings: list[LintFinding]`
* `typecheck_findings: list[TypeCheckFinding]`
* `security_findings: list[SecurityFinding]`
* `verdict: Literal["pass", "warn", "fail"]`
* `produced_at: datetime`
* `summary: str` (human-readable one-liner)
* `@property is_blocking -> bool` (True iff verdict == "fail")
* `to_kg_payload() -> dict` (React Flow KG node)

The F-502 audit-trail `ValidationReport` (F-005 surface) was extended
with the F-501 fields as OPTIONAL with `None` defaults, so existing
callers (`validation_reports.py`, `merge_gate.py`, `explainability.py`)
keep working unchanged.

### Backend entry point

`backend/app/agents/code_validator.py` now exposes:

```python
@require_approval_phase(SDLCPhase.IMPLEMENTATION)
async def run_code_validator(state: SDLCState, *, ...) -> SDLCState:
    """Run the F-501 sub-graph against state.context['files'].
    Raises ApprovalRequiredError without a recorded implementation-phase approval.
    Attaches the typed ValidationReport to state.artifacts['validation_report'].
    """
```

Threat model T-01-05-5 (Code Validator entry bypass) is mitigated —
direct calls without a recorded approval now raise
`ApprovalRequiredError` (plan 01-01 decorator).

The existing `run_code_validator_with_approval` adapter is preserved
for F-501 fan-out callers and is unchanged in behavior.

## Verification

### Tests added — `backend/tests/test_code_validator_subgraph.py` (6 cases)

1. `test_subgraph_produces_validation_report` — full pipeline produces a `ValidationReport` with all required F-501 fields.
2. `test_subgraph_verdict_pass_when_no_findings` — empty findings → `verdict == "pass"`.
3. `test_subgraph_verdict_fail_on_security_critical` — one `SecurityFinding(severity="critical")` → `verdict == "fail"` and `is_blocking == True`.
4. `test_subgraph_no_llm_call` — patches `litellm_client.completion` and asserts zero calls.
5. `test_subgraph_audit_rows_written` — every node writes one audit row with its distinct action.
6. `test_subgraph_independent_of_sdlc_supervisor` — `agents.code_validator` does not reference `sdlc_agent` or `sdlc_state`.

All 6 tests pass.

### Plan verification commands (all green)

```bash
test -d agents/code_validator          # OK
test -f agents/code_validator/graph.py # OK
grep -nE 'async def lint_node|...' agents/code_validator/nodes/*.py  # 3 matches
! grep -rE 'litellm_client\.completion' agents/code_validator/        # OK
grep -nE 'class ValidationReport' backend/app/schemas/validation_report.py  # 1 match
grep -nE '@require_approval_phase' backend/app/agents/code_validator.py     # 1 match
python -m pytest backend/tests/test_code_validator_subgraph.py -x -v       # 6 passed
```

## Deviations from Plan

### 1. [Rule 2 - Backward compatibility] F-501 fields on F-502 ValidationReport are optional with None defaults

- **Found during:** Task 1 schema design
- **Issue:** The plan's `ValidationReport` spec had `tenant_id` / `project_id` / `verdict` / `produced_at` as REQUIRED. The F-502 audit-trail `ValidationReport` is constructed throughout the existing codebase (`backend/app/api/v1/validation_reports.py`, `backend/app/services/explainability.py`, `backend/app/services/merge_gate.py`) without those fields. Marking them required would have broken 4+ call sites.
- **Fix:** Made the F-501 fields OPTIONAL with `None` defaults on the F-502 `ValidationReport`. The F-501 sub-graph ALWAYS populates them. Both contracts coexist on the same row.
- **Files modified:** `backend/app/schemas/validation_report.py`
- **Commit:** `043ab8d8`

### 2. [Rule 2 - Independence] State.py docstrings reference "sdlc_state" by name

- **Found during:** Task 3 independence test
- **Issue:** The independence test searches for `sdlc_agent` or `sdlc_state` in any file under `agents/code_validator/`. Initial drafts of the state.py docstring mentioned both modules by name to explain the independence contract.
- **Fix:** Reworded docstrings to refer to "the SDLC supervisor" / "the SDLC supervisor package" instead of naming the modules. The independence contract is now provable by the test.
- **Files modified:** `agents/code_validator/state.py`, `agents/code_validator/__init__.py`
- **Commit:** `d764e62e`

### 3. [Rule 3 - Test brittleness] Test 4 needed a different ValidationReport import

- **Found during:** Task 3 test development
- **Issue:** The plan's spec for test 4 (no-LLM) was satisfied by importing `ValidationReport` from `app.schemas.validation_report`, but the merged F-502/F-501 `ValidationReport` requires F-502 fields (`report_id`, `validator_version`, `summary: ValidationSummary`, `decision`) that the test does not care about. The test's purpose (assert `is_blocking` on a fail verdict) is cleaner if it uses the sub-graph's own `ValidationReport` from `agents.code_validator.state`.
- **Fix:** Test imports `ValidationReport` from `agents.code_validator` instead of from `app.schemas.validation_report`. Both shapes are correct; the test asserts the sub-graph contract.
- **Files modified:** `backend/tests/test_code_validator_subgraph.py`
- **Commit:** `d764e62e`

## Auth Gates

None.

## Known Stubs

* `run_code_validator_with_approval` (legacy F-501 fan-out adapter) is
  preserved but no longer the canonical entry. Future plans may
  deprecate it once the F-501 fan-out nodes (`scan_secrets`,
  `scan_iac`, `scan_vulns`, `scan_standards`) are migrated or
  removed. Marked with a ponytail comment.

## Threat Flags

None new — the threat model in 01-05-PLAN.md §threat_model is
addressed by the implementation (subprocess timeouts, audit-on-every-
node, no-LLM invariant, approval-gate decorator).

## Self-Check: PASSED

* `agents/code_validator/` package exists.
* `ValidationReport` defined in `backend/app/schemas/validation_report.py` and in `agents/code_validator/state.py`.
* 6 pytest cases pass: `test_subgraph_produces_validation_report`, `test_subgraph_verdict_pass_when_no_findings`, `test_subgraph_verdict_fail_on_security_critical`, `test_subgraph_no_llm_call`, `test_subgraph_audit_rows_written`, `test_subgraph_independent_of_sdlc_supervisor`.
* No `from sdlc_agent` / `from sdlc_state` / `import sdlc_agent` in `agents/code_validator/**`.
* No `litellm_client.completion` call in `agents/code_validator/**`.
* `@require_approval_phase(SDLCPhase.IMPLEMENTATION)` on `run_code_validator`.
* 3 atomic commits: `043ab8d8` (state), `a35edcb3` (nodes), `d764e62e` (graph + tests).
