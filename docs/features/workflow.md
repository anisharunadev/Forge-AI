# Feature: Workflows (DAG Orchestrator)

> **Status:** Wired to real backend (Step 56 Phase 4) — assumes Step 63 fixes applied (TenantSwitcher dedupe, stories URL fix)
> **Route:** `apps/forge/app/workflows/page.tsx` (index)
> **Detail route:** `apps/forge/app/workflows/[id]/page.tsx` (editor)
> **Run detail:** `apps/forge/app/runs/[id]/page.tsx`
> **Root components:** `WorkflowCenter`, `WorkflowEditor`, `WorkflowRunDetail`
> **Backend:** `backend/app/api/v1/workflows.py`
> **Executor:** `backend/app/services/workflow_executor.py`
> **Schemas:** `backend/app/schemas/workflow.py`
> **Constitutional rules:** R1 (LiteLLM proxy via `route_to_gsd`), R2 (multi-tenant), R3 (human approval gates), R4 (typed artifacts), R6 (auditability)

---

## Purpose

The Workflows Center is the **DAG-based orchestration surface**. A workflow is a graph of nodes (trigger / command / approval / script) connected by edges that the executor walks in topological order. Workflows are how operators codify "when X happens, run Y, ask for approval at Z, then call script S" — replacing ad-hoc scripts with auditable, replayable, budget-bound automation.

Per PRD §1.4 the Workflows Center serves **tech leads** (design), **operators** (run + monitor), and **stewards** (audit + governance).

---

## Architecture

```
WorkflowsIndexPage (/workflows)
└── WorkflowCenter
    ├── Hero band ("Workflows" + Create button + Templates tab)
    ├── KPI strip (workflows / runs today / avg duration / success)
    ├── Tab strip: My workflows | Templates | Shared | Drafts
    ├── Filter bar (search + status)
    └── WorkflowCard grid (each = one Workflow)

WorkflowEditorPage (/workflows/[id] + /workflows/[id]/edit)
└── WorkflowEditor
    ├── Canvas (React Flow / @xyflow/react)
    ├── Node palette (Trigger / Command / Approval / Script)
    ├── Property panel (per-node config)
    ├── Toolbar (Save / Publish / Test run)
    └── Version history (per-workflow)

RunDetailPage (/runs/[id])
└── WorkflowRunDetail
    ├── Run header (workflow name + status + cost + duration)
    ├── Live event stream (SSE via useRunLiveEvents)
    ├── Step list (each step's status + cost + duration + output)
    ├── Approval gates (Approve / Reject buttons when WAITING_APPROVAL)
    └── Cost breakdown + budget meter
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/workflows` | `WorkflowCenter` | List + templates + drafts |
| `/workflows/[id]` | `WorkflowEditor` (read mode) | View workflow definition |
| `/workflows/[id]/edit` | `WorkflowEditor` (edit mode) | Edit + save + publish |
| `/runs/[id]` | `WorkflowRunDetail` | Run detail with live SSE stream |
| `/analytics/usage/workflow/[run_id]` | Usage analytics for a run |

### Backend (FastAPI)

All routes use `@audit()` decorator and `require_permission(...)`. Tenant scoping enforced via `principal.tenant_id`.

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/workflows` | `workflows:read` | List workflows (optional `?search=`, `?status=`) |
| `POST` | `/api/v1/workflows` | `workflows:write` | Create workflow |
| `GET` | `/api/v1/workflows/{id}` | `workflows:read` | Get one workflow |
| `PATCH` | `/api/v1/workflows/{id}` | `workflows:write` | Update definition / name / description |
| `DELETE` | `/api/v1/workflows/{id}` | `workflows:write` | Archive (soft-delete) |
| `POST` | `/api/v1/workflows/{id}/runs` | `workflows:run` | Start a run (creates `WorkflowRun` in PENDING) |
| `GET` | `/api/v1/workflows/{id}/runs` | `workflows:read` | List runs for this workflow |
| `GET` | `/api/v1/workflows/runs/{run_id}` | `workflows:read` | Get one run |
| `POST` | `/api/v1/workflows/runs/{run_id}/cancel` | `workflows:run` | Cancel a running run |
| `POST` | `/api/v1/workflows/runs/{run_id}/resume` | `workflows:run` | Manually resume a `WAITING_APPROVAL` run |
| `GET` | `/api/v1/workflows/runs/{run_id}/events` | `workflows:read` | **SSE stream** — live event feed |
| `POST` | `/api/v1/workflows/{id}/budget` | `workflows:write` | Declare a cost ceiling |
| `GET` | `/api/v1/workflows/{id}/budget` | `workflows:read` | Get current budget state |
| `GET` | `/api/v1/workflows/{id}/budget/history` | `workflows:read` | Budget spend history |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `workflows` | Workflow definition (name, description, definition JSONB) |
| `workflow_runs` | Run records (status, timing, current_step_id, state JSONB) |
| `workflow_run_steps` | Per-step result envelopes |
| `workflow_budgets` | Cost ceiling declarations |
| `audit_events` | Every mutation + step event logged |

### Pydantic schemas (`backend/app/schemas/workflow.py`)

- `WorkflowDefinition` — `{nodes: list[WorkflowNode], edges: list[WorkflowEdge], settings: WorkflowSettings}`
- `WorkflowNode` — `{id: str, position: Position, data: WorkflowNodeData}` (discriminated union on `data.type`)
- `WorkflowEdge` — `{id: str, source: str, target: str}`
- `WorkflowSettings` — `{cost_ceiling_usd: float | None, timeout_seconds: int | None}`
- `WorkflowCreate` / `WorkflowUpdate` / `WorkflowRead` (adds `id`, `created_by`, `latest_run_id`)
- `WorkflowRunCreate` (currently empty; reserved for future overrides)
- `WorkflowRunRead` (adds `workflow_id`, `status`, `started_at`, `finished_at`, `triggered_by`, `current_step_id`, `state: dict`)
- `BudgetDeclareRequest` / `BudgetRead`

### Node Types (Discriminated Union on `data.type`)

```python
# backend/app/schemas/workflow.py
WorkflowNodeData = Annotated[
    TriggerNodeData | CommandNodeData | ApprovalNodeData | ScriptNodeData,
    Field(discriminator="type"),
]
```

| `type` | Payload | Executor behavior |
|---|---|---|
| `trigger` | `{label: str}` | Marks itself `SUCCEEDED` immediately, advances |
| `command` | `{command_name: str, args?: dict, on_error?: "fail" \| "continue"}` | Calls `route_to_gsd()` (the same path `POST /api/v1/commands/{name}/run` uses). Captures output, duration, cost. |
| `approval` | `{label: str, approver_role?: str, timeout_hours?: int}` | Pauses run, posts to approvals service, sets `current_step_id`, transitions to `WAITING_APPROVAL`. Later `resume_workflow_run()` continues from next step. |
| `script` | `{language: "python" \| "javascript", source: str}` | Runs in `ScriptSandbox`. Captures stdout/stderr, exit code, `network_blocked`. |

### TypeScript Mirror (`apps/forge/lib/workflows/types.ts`)

```typescript
export type WorkflowNodeType = 'trigger' | 'command' | 'approval' | 'script';

export type WorkflowStatus = 'draft' | 'published' | 'archived';

export type WorkflowNodeData =
  | { type: 'trigger'; label: string }
  | { type: 'command'; command_name: string; args?: Record<string, unknown>; on_error?: 'fail' | 'continue' }
  | { type: 'approval'; label: string; approver_role?: string; timeout_hours?: number }
  | { type: 'script'; language: 'python' | 'javascript'; source: string };
```

---

## Run Lifecycle (7 states)

```
PENDING → RUNNING → (WAITING_APPROVAL ↔ RUNNING) → (PAUSED ↔ RUNNING) → SUCCEEDED
                                                                              ↘ FAILED
                                                                              ↘ CANCELLED
```

| Status | Meaning | Set by |
|---|---|---|
| `PENDING` | Created but executor not yet started | `POST /workflows/{id}/runs` |
| `RUNNING` | Executor walking the DAG | Executor on first step |
| `WAITING_APPROVAL` | Paused at an `approval` node | Executor when reaching approval |
| `PAUSED` | Manually paused (future feature) | Operator action (not yet implemented) |
| `SUCCEEDED` | All nodes completed cleanly | Executor |
| `FAILED` | A node failed (and `on_error: "fail"`) | Executor |
| `CANCELLED` | Operator cancelled mid-run | `POST /workflows/runs/{run_id}/cancel` |

**Per Rule 3 (human approval gates):** The executor MUST NOT auto-advance past `WAITING_APPROVAL`. The run stays paused until a human (via `POST /api/v1/approvals/{id}/decide` or `POST /workflows/runs/{run_id}/resume`) explicitly continues it.

---

## Executor (`backend/app/services/workflow_executor.py`)

Walks the DAG in **topological order** and dispatches each node by type:

| Node type | Executor does |
|---|---|
| `trigger` | Marks `SUCCEEDED`, advances |
| `command` | Calls `route_to_gsd(command_name, args)` — captures output, duration, cost |
| `approval` | Posts to approvals service with `payload.kind == "workflow"`. Persists `approval_id` on step result. Transitions to `WAITING_APPROVAL`. Sets `current_step_id`. Returns. |
| `script` | Invokes `ScriptSandbox` — captures stdout/stderr, exit code, `network_blocked` |

**Every step writes a result envelope into `run.state["stepResults"][step_id]`** and emits an event on the bus (`Rule 6`):

```python
# Events emitted during execution
WORKFLOW_RUN_STARTED
WORKFLOW_STEP_STARTED
WORKFLOW_STEP_COMPLETED
WORKFLOW_STEP_FAILED
WORKFLOW_RUN_PAUSED
WORKFLOW_RUN_RESUMED
WORKFLOW_RUN_COMPLETED
WORKFLOW_RUN_FAILED
WORKFLOW_RUN_CANCELLED
```

**Rule 1 enforcement:** The executor dispatches commands via `route_to_gsd` ONLY — it never imports a provider SDK directly. All LLM traffic flows through LiteLLM proxy.

**Rule 2 enforcement:** Every audit row + event carries `tenant_id` + `project_id`.

---

## SSE Live Event Stream (`GET /workflows/runs/{run_id}/events`)

The frontend hook `useRunLiveEvents(runId)` opens an `EventSource` connection:

```typescript
// apps/forge/lib/hooks/useWorkflows.ts
export function useRunLiveEvents(runId: string | null) {
  const [events, setEvents] = useState<RunStreamEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');

  useEffect(() => {
    if (!runId) return;
    
    const token = useAuth.getState().getToken() ?? '';
    // NOTE: EventSource cannot set headers — pass JWT via query param
    const url = `${FORGE_API_BASE_URL}/workflows/runs/${runId}/events?token=${token}`;
    const es = new EventSource(url, { withCredentials: false });
    
    es.onopen = () => setStatus('open');
    es.onerror = () => setStatus('error');
    es.onmessage = (e) => {
      const parsed = JSON.parse(e.data) as RunStreamEvent;
      setEvents((prev) => [...prev, parsed]);
      
      // Close stream on terminal status
      if (['succeeded', 'failed', 'cancelled'].includes(parsed.status)) {
        es.close();
        setStatus('closed');
      }
    };
    
    return () => es.close();
  }, [runId]);
  
  return { events, status };
}
```

**Backend behavior (`stream_run_events`):**
1. Authorize — verify run belongs to caller's tenant
2. Send initial snapshot (current run state)
3. Subscribe to event bus for events with `payload.run_id == this_run_id`
4. Forward each event as `data: {json}\n\n` SSE line
5. Close stream when run reaches terminal status

**Scoping:** `_RUN_SCOPED_EVENTS` tuple lists which event types flow through the stream:
```python
_RUN_SCOPED_EVENTS = (
    EventType.WORKFLOW_STEP_STARTED,
    EventType.WORKFLOW_STEP_COMPLETED,
    EventType.WORKFLOW_STEP_FAILED,
    EventType.WORKFLOW_RUN_PAUSED,
    EventType.WORKFLOW_RUN_RESUMED,
    EventType.WORKFLOW_RUN_COMPLETED,
    EventType.WORKFLOW_RUN_FAILED,
    EventType.WORKFLOW_RUN_CANCELLED,
)
```

---

## Budget Enforcement (`backend/app/services/workflow_budget.py`)

Every workflow can declare a cost ceiling. The `WorkflowBudgetService.check_budget()` is a **pre-call admission control**:

- Before every command node, executor calls `check_budget(spent, projected)`
- If `spent + projected > ceiling` → `Decision.BLOCKED`
- The run is auto-paused with reason `budget_exceeded`
- Surface the budget state at every approval gate (Rule 3)

```python
# budget API
POST /api/v1/workflows/{id}/budget  # declare ceiling
GET  /api/v1/workflows/{id}/budget  # current state
GET  /api/v1/workflows/{id}/budget/history  # spend over time
```

---

## Seed Data (Step 56 v2 — assumed running)

The seed script inserts 6 workflows across 2 projects, plus 3 runs:

| # | Workflow | Project | Status | Steps (count) |
|---|---|---|---|---|
| 1 | PR Review Pipeline | acme-platform | published | 5 (trigger→command→command→approval→script) |
| 2 | Idea → Story → Jira Sync | acme-platform | published | 5 (trigger→command→approval→command→command) |
| 3 | Nightly Security Scan | acme-platform | published | 4 (trigger→command→approval→script) |
| 4 | Deploy to Production | acme-platform | published | 5 (trigger→command→command→approval→script) |
| 5 | Story Refinement Workshop | workflow-editor-v2 | **draft** | 2 (trigger→command) |
| 6 | Architecture Review | workflow-editor-v2 | **draft** | 3 (trigger→command→approval) |

**Runs:**
- 1 running (PR Review Pipeline — current_step_id="c1")
- 1 succeeded (PR Review Pipeline — yesterday, cost $0.42)
- 1 failed (PR Review Pipeline — hour ago, error at command step)

```bash
# To populate (Step 56 v2 script):
docker compose exec backend python -m scripts.seed_workflows
```

---

## Approval Gate Flow (Per Rule 3)

```
Executor reaches approval node
       ↓
POST /api/v1/approvals (payload.kind="workflow", payload.run_id=..., payload.step_id=...)
       ↓
Approval row created in DB, status="pending"
       ↓
WorkflowRun transitioned to WAITING_APPROVAL
current_step_id set to approval node id
       ↓
WORKFLOW_RUN_PAUSED event emitted → SSE pushes to UI
       ↓
Approver sees approval in their inbox (Approvals page)
       ↓
Approver clicks "Approve" → POST /api/v1/approvals/{id}/decide {decision: "approve"}
       ↓
ApprovalExecutor.resume(run_id) called
       ↓
Run transitions to RUNNING, executor continues from next step
       ↓
WORKFLOW_RUN_RESUMED + WORKFLOW_STEP_STARTED events
```

The manual resume endpoint `POST /workflows/runs/{run_id}/resume` exists for the edge case where a run is paused with no live approval row (legacy data, manual operator override).

---

## 9 Visual Node Types vs 4 Backend Node Types

The canvas editor (Step 22-23) supports 9 visual node types for UX richness. They map to the 4 backend kinds via `apps/forge/lib/workflows/adapter.ts`:

| Visual | Backend | Mapping |
|---|---|---|
| `trigger-webhook` | `trigger` | config → `{label: "Webhook: {path}"}` |
| `trigger-cron` | `trigger` | config → `{label: "Cron: {schedule}"}` |
| `trigger-manual` | `trigger` | config → `{label: "Manual"}` |
| `command-llm` | `command` | args → `{model, prompt, max_tokens}` |
| `command-tool` | `command` | args → `{tool_name, params}` |
| `command-jira` | `command` | args → `{action, ticket_key}` |
| `approval-human` | `approval` | `{label, approver_role, timeout_hours}` |
| `script-python` | `script` | `{language: "python", source}` |
| `script-js` | `script` | `{language: "javascript", source}` |

`canvasToWire()` (canvas → wire) and `wireToCanvas()` (wire → canvas) handle the conversion. The wire format stays simple (4 kinds); the UI gets UX richness.

---

## Edge cases

| State | Treatment |
|---|---|
| **No workflows** | `EmptyState` + "New Workflow" CTA + Templates tab |
| **No runs** | KPI strip shows zeros; run list shows empty state |
| **Run in PENDING** | Stream status = "connecting"; UI shows "Starting..." |
| **Run in WAITING_APPROVAL** | Stream pushes `WORKFLOW_RUN_PAUSED` event; UI shows "Awaiting approval"; drawer with Approve/Reject buttons; budget meter visible |
| **Run in FAILED** | Stream pushes `WORKFLOW_RUN_FAILED` event; UI shows error banner with failed step + reason; "Rerun" button |
| **Run in CANCELLED** | Stream closes; UI shows "Cancelled by {user}" |
| **SSE disconnect (network blip)** | EventSource auto-reconnects; UI shows "Reconnecting..." status pill; no event loss (events are re-replayed on reconnect via initial snapshot) |
| **Run budget exceeded mid-execution** | Executor calls `Decision.BLOCKED`; run auto-pauses with `reason="budget_exceeded"`; UI shows red budget meter; notification posted |
| **Concurrent runs of same workflow** | Each run is independent (separate `WorkflowRun` row); no locking needed |
| **Operator cancels mid-approval** | `POST /runs/{run_id}/cancel` works on any non-terminal state; transitions to `CANCELLED`; emits `WORKFLOW_RUN_CANCELLED` |
| **Approval timeout exceeded** | Future feature — `timeout_hours` is recorded but not yet enforced |
| **Tenant switch** | Every query key carries `tenant_id`; refetch via TanStack Query invalidation |
| **`prefers-reduced-motion`** | SSE events update instantly without animation; canvas drag animations disabled |

---

## Forbidden patterns

AI agents modifying Workflows MUST NOT:

- ❌ Auto-advance past `WAITING_APPROVAL` — Rule 3 enforcement
- ❌ Add new node types to `WorkflowNodeData` discriminated union without updating both `schemas/workflow.py` AND `lib/workflows/types.ts` AND `canvasToWire()` AND `wireToCanvas()` (4-way lock-step)
- ❌ Bypass `route_to_gsd` for command nodes — executor MUST NOT import provider SDKs (Rule 1)
- ❌ Skip `@audit()` on any workflow mutation
- ❌ Skip `require_permission(...)` on routes
- ❌ Skip tenant scoping — every query carries `tenant_id` from JWT
- ❌ Hardcode node statuses — use `WorkflowRunStatus` enum (7 values) + `WorkflowStepStatus` enum
- ❌ Skip the budget pre-call check — every command node must check budget before invoking LLM
- ❌ Skip SSE event emission — every step transition emits an event (`WORKFLOW_STEP_*`)
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Add new event types to `EventType` enum without updating `_RUN_SCOPED_EVENTS` tuple in `workflows.py`
- ❌ Poll SSE with `setInterval` — use `EventSource` only

---

## Verification checklist

- [ ] `apps/forge/app/workflows/page.tsx` renders `WorkflowCenter`
- [ ] `curl .../workflows` returns 6 seeded workflows with valid Bearer token + tenant scope
- [ ] `curl .../workflows?status=draft` returns 2 draft workflows (Story Refinement Workshop + Architecture Review)
- [ ] `POST /workflows` creates a new workflow that appears in the list
- [ ] `POST /workflows/{id}/runs` starts a run; status transitions PENDING → RUNNING
- [ ] `GET /workflows/runs/{run_id}/events` returns SSE stream with initial snapshot
- [ ] Run reaches `WAITING_APPROVAL` at an approval node; does NOT auto-advance
- [ ] "Approve" button calls `POST /approvals/{id}/decide` and the run continues
- [ ] "Cancel" button calls `POST /runs/{run_id}/cancel` and the run transitions to `CANCELLED`
- [ ] `useRunLiveEvents` returns events with `status: 'open'` while the run is active
- [ ] SSE stream closes when run reaches terminal status (`succeeded` / `failed` / `cancelled`)
- [ ] Budget exceeded → run auto-pauses with reason `budget_exceeded`
- [ ] Workflow editor canvas drag-drop persists via PATCH
- [ ] Publishing a draft workflow via `usePublishWorkflow` transitions status to `published`
- [ ] Duplicating a workflow clones all nodes + edges
- [ ] Tenant switch refetches workflows + runs
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — agent state colors, canvas node colors
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R4 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list
- [DB schema](../reference/db-schema.md) — `workflows`, `workflow_runs`, `workflow_run_steps`, `workflow_budgets`
- [Dashboard](./dashboard.md) — "Runs over time" + "Top workflows" widgets
- [Agent Center](./agent-center.md) — Command nodes dispatch to agents
- [Stories](./stories.md) — "Start implementation" creates a workflow run
- [Runs](./runs.md) — Runs Center shows both workflow runs + SDLC runs
- [LiteLLM integration](../standards/litellm-integration.md) — how `route_to_gsd` proxies
- [Settings](./settings.md) — Workflow defaults tab

---

## Maintenance notes

**When to update this doc:**

- A new `WorkflowRunStatus` added → update lifecycle diagram
- A new node type added → update `WorkflowNodeData` discriminated union + adapter + canvas renderer
- A new event type added → update `_RUN_SCOPED_EVENTS` tuple + `useRunLiveEvents` consumer
- A new budget rule added → update Budget Enforcement section
- A new visual node type added → update the 9-vs-4 mapping table

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/schemas/workflow.py              ←  source of truth (Pydantic discriminated union)
backend/app/db/models/workflow.py            ←  Workflow + WorkflowRun + 2 enums
backend/app/services/workflow_executor.py   ←  DAG walker
backend/app/services/workflow_budget.py      ←  admission control
         ↓
apps/forge/lib/workflows/types.ts            ←  TypeScript mirror
apps/forge/lib/workflows/data.ts             ←  REST SDK
apps/forge/lib/hooks/useWorkflows.ts         ←  TanStack Query hooks + useRunLiveEvents
         ↓
apps/forge/components/workflows/             ←  WorkflowCenter + WorkflowEditor + WorkflowRunDetail
```

If any link in this chain drifts, the Workflows Center breaks silently. Always update all six.