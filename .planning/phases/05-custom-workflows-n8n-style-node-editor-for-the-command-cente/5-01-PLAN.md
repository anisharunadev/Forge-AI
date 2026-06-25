---
plan: 5-01
phase: 5
wave: 1
depends_on: []
files_modified:
  - backend/app/services/workflow_executor.py
  - backend/app/services/script_sandbox.py
  - backend/app/api/v1/commands.py
  - backend/app/api/v1/approvals.py
  - backend/app/services/forge_commands.py
  - backend/app/api/v1/workflows.py
  - backend/tests/test_workflow_executor.py
  - backend/tests/test_script_sandbox.py
autonomous: true
requirements: [F-018, Rule-2, Rule-3, Rule-4, Rule-6]
---

<objective>
Wire the backend workflow executor so saved `WorkflowDefinition` rows can be run. Replaces the Phase B run-row stub (which inserts a `WorkflowRun` row but never advances state) with: a DAG walker that dispatches each node by type (trigger/command/approval/script), a seccomp-guarded subprocess sandbox for `script` nodes, the missing `POST /api/v1/commands/{name}/run` route that closes the `useForgeCommands().run()` "Backend unreachable" gap, and an approval→resume hook so a manual-decide call unblocks a `waiting_approval` run.

Purpose: F-018 v1 — author + execute (real backend dispatch, not simulation). Phase A (React Flow v12 migration) and Phase B (persistence + REST API) are already complete; the run lifecycle is the last missing piece before the Phase D editor can drive end-to-end runs.

Output:
- `backend/app/services/workflow_executor.py` — `WorkflowExecutor.execute / resume / cancel` with topo sort + per-type dispatch + audit emission.
- `backend/app/services/script_sandbox.py` — `ScriptSandbox.run(language, source, timeout_s)` returning `{stdout, stderr, exit_code, duration_ms, network_blocked: bool}`; `preexec_fn` sets `RLIMIT_CPU / RLIMIT_AS / RLIMIT_NPROC` and installs a seccomp filter that blocks `socket(AF_INET, *)`.
- `backend/app/api/v1/commands.py` — `POST /api/v1/commands/{name}/run` (tenant-scoped, `@audit(action="command.run")`, `Principal`-gated); calls `route_to_gsd(name, args)`.
- `backend/app/api/v1/approvals.py` — after a decide call flips a `payload.kind == "workflow"` approval to `granted | denied`, call `WorkflowExecutor.resume(run_id, decision)`.
- `backend/app/services/forge_commands.py` — surface `requires_approval` enforcement in the wrapper.
- `backend/app/api/v1/workflows.py` — add `GET /api/v1/workflows/runs/{runId}/events` SSE stream + `POST /api/v1/workflows/runs/{runId}/resume`.
- `backend/tests/test_workflow_executor.py` + `test_script_sandbox.py` — happy path, approval pause + resume, cancel mid-run, sandbox timeouts, network-blocked script.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@/home/arunachalam.v@claude/plans/jaunty-leaping-hamming.md
@backend/app/services/workflow_service.py
@backend/app/schemas/workflow.py
@backend/app/db/models/workflow.py
@backend/app/db/migrations/versions/0008_custom_workflows.py
@backend/app/api/v1/workflows.py
@backend/app/services/event_bus.py
@backend/app/services/forge_commands.py
@backend/app/api/v1/approvals.py
@backend/app/db/models/approval.py
@backend/app/schemas/common.py
</context>

<must_haves>
truths:
  - "`POST /api/v1/workflows/{id}/runs` enqueues a run, runs the executor, and the resulting `WorkflowRun` row advances through `pending → running → (waiting_approval) → succeeded | failed | cancelled` with `state.stepResults` populated for every node"
  - "`POST /api/v1/commands/{name}/run` returns 200 with the command's typed output; `useForgeCommands().run()` on the frontend no longer falls back to 'Backend unreachable — simulated success'"
  - "`ScriptSandbox.run('python', 'import socket\\ns=socket.socket()', 5)` returns `network_blocked: true` and the seccomp audit row records the blocked syscall"
  - "A run with an `approval` node transitions to `waiting_approval`, the approval-decide endpoint calls `WorkflowExecutor.resume`, and the run resumes to `succeeded` (or `failed` on deny)"
  - "Every step writes an `AuditRecord` (Rule 6) with `tenant_id` + `project_id` (Rule 2) and emits a `WORKFLOW_STEP_*` event on the bus"
  - "`pytest backend/tests/test_workflow_executor.py backend/tests/test_script_sandbox.py` passes; `ruff check backend/app/services/workflow_executor.py backend/app/services/script_sandbox.py` clean"
  - "No direct import of `openai`, `anthropic`, or `google.generativeai` SDKs anywhere in the new code (Rule 1)"

artifacts:
  - path: backend/app/services/workflow_executor.py
    min_lines: 200
    contains: ["class WorkflowExecutor", "async def execute", "async def resume", "async def cancel"]
  - path: backend/app/services/script_sandbox.py
    min_lines: 80
    contains: ["class ScriptSandbox", "RLIMIT_CPU", "AF_INET"]
  - path: backend/app/api/v1/commands.py
    contains: ["POST", "/commands/{name}/run", "@audit"]
  - path: backend/tests/test_workflow_executor.py
    contains: ["def test_", "WorkflowExecutor"]
  - path: backend/tests/test_script_sandbox.py
    contains: ["def test_", "ScriptSandbox", "network_blocked"]
</must_haves>

<verification>
1. `cd backend && python3 -c "from app.services.workflow_executor import WorkflowExecutor; from app.services.script_sandbox import ScriptSandbox; print('imports OK')"` succeeds.
2. `cd backend && pytest tests/test_workflow_executor.py tests/test_script_sandbox.py -v` passes (all tests green).
3. `cd backend && ruff check app/services/workflow_executor.py app/services/script_sandbox.py app/api/v1/commands.py` clean.
4. `grep -RIn "import openai\\|import anthropic\\|import google.generativeai" backend/app/services/workflow_executor.py backend/app/services/script_sandbox.py` returns nothing (Rule 1).
5. Manual: start the API, `curl -X POST .../api/v1/workflows/{id}/runs`, watch the run row transition states in the DB and emit events on `/events`.
</verification>

<notes>
- The detailed sub-plan is in `/home/arunachalam.v@claude/plans/jaunty-leaping-hamming.md` under "Phase C". Cross-reference; do not duplicate.
- Cycle detection + tenant scoping already exist in `WorkflowService.validate_definition` (Phase B). Executor is purely a runtime walker.
- `usescape` for subprocess: prefer `subprocess.run(..., preexec_fn=...)` on Linux; on macOS dev machines fall back to `RLIMIT` only with a logged warning. Sandbox is enforcement-on-Linux; dev on macOS still runs but the seccomp test is xfail on Darwin.
- The "missing command route" the user's `useForgeCommands` hook stubs with "Backend unreachable — simulated success" is the one the frontend already calls — adding it as `POST /commands/{name}/run` (not `/workflows/.../commands/...`) is correct: it's the generic command-dispatch endpoint the Command Center's Run button already uses; the workflow executor reuses it for `command` nodes.
- Lock the run row with `SELECT … FOR UPDATE` inside `execute()` so a concurrent cancel doesn't race the executor's status flip.
- Approval-resume idempotency: the decide endpoint writes the approval row + publishes an event; `WorkflowExecutor.resume` re-reads run.state from the row, not from in-memory.
</notes>
