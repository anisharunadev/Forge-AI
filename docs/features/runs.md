# Feature: Runs (Run Center + Live Stream)

> **Status:** Wired to real backend (Step 56 Phase 4) — assumes Steps 56 + 63 fixes applied
> **Route:** `apps/forge/app/runs/page.tsx` (index)
> **Detail route:** `apps/forge/app/runs/[id]/page.tsx`
> **Root components:** `RunCenterPage` (list) + `WorkflowRunDetail` (detail)
> **Backend — SDLC runs:** `backend/app/api/v1/runs.py` + `backend/app/services/sdlc_run_manager.py`
> **Backend — Workflow runs:** `backend/app/api/v1/workflows.py` (separate routes — see [Workflows](./workflows.md))
> **Constitutional rules:** R2 (multi-tenant), R3 (human approval gates), R4 (typed artifacts), R6 (auditability), R7 (observability — SSE live stream)

---

## Purpose

The Runs Center is the **execution surface for workflow runs and SDLC runs**. A "run" is one execution of a workflow definition — it has a status, a timeline of step results, a cost, and (for active runs) a live SSE event stream.

The Runs Center serves two audiences:
1. **Operators** — start runs, monitor progress, cancel if needed, approve at gates
2. **Stewards / Auditors** — review cost, duration, and approval history after the run completes

Per PRD §1.4 the Runs Center is the operator's "single pane of glass" for active AI work.

---

## ⚠️ Two Run Models in Forge

Forge has **two distinct run concepts**, both routed through `/runs/[id]` depending on the run type:

| Concept | Owned by | Backed by | Endpoint prefix | SSE stream |
|---|---|---|---|---|
| **SDLC run** | LangGraph orchestrator (legacy) | `sdlc_run_manager.py` | `/api/v1/runs/...` | `GET /runs/{id}/stream` |
| **Workflow run** | Workflow executor (current) | `workflow_executor.py` | `/api/v1/workflows/runs/...` | `GET /workflows/runs/{id}/events` |

**The Runs Center (`/runs`) primarily shows WORKFLOW runs** (per Step 56 v2 decision: workflow runs have clearer user value). The `WorkflowRunDetail` component at `/runs/[id]` reads from `useWorkflowRun()` which hits `/api/v1/workflows/runs/{id}`.

**The SDLC runs routes still exist** for backward compatibility with the legacy orchestrator. The `sdlc_run_manager.py` provides `create_run`, `get_run`, `cancel_run`, `resume_run`, `stream_run` endpoints.

---

## Architecture

```
RunsIndexPage (/runs)
└── RunCenterPage
    ├── Hero band (CENTER eyebrow + Live status pill + Refresh button)
    ├── KPI strip (Active / Succeeded today / Failed today / Total cost)
    ├── Filter bar (status pills + agent/command/date filters)
    ├── Virtualized table (TanStack Virtual — 10k+ rows smooth)
    └── Run detail drawer (720px right slide-in, 7 tabs)

RunDetailPage (/runs/[id])
└── WorkflowRunDetail
    ├── Header: workflow name + status badge + live stream pill + actions (Cancel / Resume)
    ├── Run metrics (tokens, cost, duration)
    ├── Node execution timeline (from state.stepResults + live SSE)
    ├── Approval gates drawer (when WAITING_APPROVAL)
    └── Cost breakdown + budget meter
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/runs` | `RunCenterPage` | List of runs (virtualized) + drawer |
| `/runs/[id]` | `WorkflowRunDetail` | Run detail with live SSE stream |
| `/analytics/usage/workflow/[run_id]` | Usage drill-down | Per-run cost breakdown (F-829 Phase C) |

### Backend (FastAPI)

#### Workflow Runs (`backend/app/api/v1/workflows.py`) — **PRIMARY**

All routes use `@audit()` decorator and `require_permission(...)`.

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/workflows/runs/{run_id}` | `workflows:read` | Get one workflow run |
| `POST` | `/api/v1/workflows/runs/{run_id}/cancel` | `workflows:run` | Cancel a workflow run |
| `POST` | `/api/v1/workflows/runs/{run_id}/resume` | `workflows:run` | Manually resume a `WAITING_APPROVAL` run |
| `GET` | `/api/v1/workflows/runs/{run_id}/events` | `workflows:read` | **SSE stream** — live events |
| `GET` | `/api/v1/workflows` | `workflows:read` | List workflows (also lists `latest_run_id`) |
| `POST` | `/api/v1/workflows/{id}/runs` | `workflows:run` | Start a run |

#### SDLC Runs (`backend/app/api/v1/runs.py`) — **LEGACY**

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/runs` | `runs:write` | Create SDLC run |
| `GET` | `/api/v1/runs` | `runs:read` | List SDLC runs |
| `GET` | `/api/v1/runs/{id}` | `runs:read` | Get one |
| `GET` | `/api/v1/runs/{id}/stream` | `runs:read` | SSE stream (state snapshots) |
| `POST` | `/api/v1/runs/{id}/resume` | `runs:write` | Resume via approval response |
| `POST` | `/api/v1/runs/{id}/cancel` | `runs:write` | Cancel |
| `GET` | `/api/v1/runs/{id}/artifacts` | `runs:read` | List generated artifacts |
| `GET` | `/api/v1/runs/{id}/cost` | `runs:read` | Cost summary |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `workflow_runs` | Run records (status, timing, current_step_id, state JSONB) |
| `workflow_run_steps` | Per-step result envelopes |
| `workflows` | Workflow definition (joined for `latest_run_id`) |
| `audit_events` | Every mutation + step event logged |
| `cost_entries` | Per-call cost records (joined for cost summary) |
| `artifacts` | Generated artifacts (ADRs, PRDs, etc.) |

### Pydantic schemas

**Workflow runs (`backend/app/schemas/workflow.py`):**

- `WorkflowRunRead` — `{id, workflow_id, status, started_at, finished_at, triggered_by, current_step_id, state: dict}`
- `state.stepResults` — per-node envelope: `{step_id: {status, duration_ms, output, cost_usd, error}}`

**SDLC runs (`backend/app/schemas/runs.py`):**

- `SDLCRunStateResponse` — `{run_id, tenant_id, project_id, status, current_phase, stages, error, thread_id}`
- `SDLCRunListResponse` — `{runs: list[SDLCRunStateResponse], total}`
- `CostSummaryResponse` — `{run_id, total_usd, by_phase: dict[str, float], prompt_tokens, completion_tokens, by_model: dict[str, float]}`

### TypeScript types (`apps/forge/lib/api.ts`)

```typescript
export interface RunRecord {
  // ... full shape mirrored from backend
}

export interface StageRecord {
  // ... full shape mirrored from backend
}

export interface CreateRunInput {
  readonly project_id: string;
  readonly initial_context?: string;
  readonly workspace_path?: string;
  readonly repo_path?: string;
}
```

### Run status enums

**Workflow runs (`backend/app/db/models/workflow.py`):**

```python
class WorkflowRunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
```

---

## Live SSE Stream (Workflow Runs)

The detail page opens an `EventSource` connection via `useRunLiveEvents(runId)`.

### Backend: `GET /api/v1/workflows/runs/{run_id}/events`

```python
@router.get("/runs/{run_id}/events")
async def stream_run_events(
    run_id: UUID,
    principal: Principal,
    db: DbSession = None,
) -> StreamingResponse:
    """SSE stream: emit one ``data:`` line per workflow event for this run.

    Replays the current run state on connect, then forwards every
    workflow event whose ``payload.run_id`` matches. The stream closes
    when the run reaches a terminal status.
    """
    # Authorization — the run must belong to the caller's tenant.
    try:
        run = await _workflow_service.get_run(db, tenant_id=principal.tenant_id, run_id=run_id)
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail="run_not_found") from exc

    initial_snapshot = {...}  # current run state
    
    async def event_generator():
        # 1. Send initial snapshot
        yield _sse_format(initial_snapshot)
        
        # 2. Subscribe to event bus for events with matching run_id
        async for event in bus.subscribe():
            if event.payload.get("run_id") != str(run_id):
                continue
            if event.type not in _RUN_SCOPED_EVENTS:
                continue
            yield _sse_format({"type": event.type, "payload": event.payload, "timestamp": ...})
            
            # 3. Close on terminal status
            if event.type == EventType.WORKFLOW_RUN_COMPLETED:
                break
```

**Events that flow through:**

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

### Frontend: `useRunLiveEvents` (apps/forge/lib/hooks/useWorkflows.ts)

```typescript
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

**Connection states** rendered in the header:

| Status | UI |
|---|---|
| `idle` | No badge |
| `connecting` | Amber pulsing dot + "Connecting…" |
| `open` | Emerald dot + "Live" pill |
| `closed` | Muted dot + "Closed" |
| `error` | Rose dot + "Reconnecting…" (auto-reconnects) |

---

## Cost Summary

`GET /api/v1/runs/{id}/cost` returns `CostSummaryResponse`:

```python
class CostSummaryResponse(BaseModel):
    run_id: UUID
    total_usd: float
    by_phase: dict[str, float]  # phase → USD
    prompt_tokens: int
    completion_tokens: int
    by_model: dict[str, float]  # model → USD
```

The frontend renders this in the run detail page as:
- Total cost (big number, top)
- Cost by phase (horizontal bar chart)
- Cost by model (Recharts pie chart, max 5 slices)
- Token breakdown (input vs output)

---

## Approval Gates (Per Rule 3)

When the executor reaches an `approval` node:

```
Executor → approval node
       ↓
POST /api/v1/approvals (payload.kind="workflow")
       ↓
WorkflowRun.transition(WAITING_APPROVAL)
current_step_id set to approval node id
       ↓
SSE event: WORKFLOW_RUN_PAUSED → UI shows "Awaiting approval"
       ↓
Approver clicks Approve → POST /approvals/{id}/decide
       ↓
WorkflowExecutor.resume(run_id) → next step starts
       ↓
SSE event: WORKFLOW_RUN_RESUMED + WORKFLOW_STEP_STARTED
```

In the `WorkflowRunDetail` UI:

```typescript
const isPaused = run.status === 'waiting_approval';
const isTerminal = ['succeeded', 'failed', 'cancelled'].includes(run.status);

{isPaused ? (
  <Button onClick={() => resume.mutate(run.id)} disabled={resume.isPending}>
    <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
  </Button>
) : !isTerminal ? (
  <Button variant="outline" onClick={() => cancel.mutate(run.id)}>
    <Pause className="mr-1.5 h-3.5 w-3.5" /> Cancel
  </Button>
) : null}
```

Per Rule 3, the "Resume" button is **only shown when status is `waiting_approval`**. Auto-advance past approval is forbidden.

---

## Status Tone Mapping

From `WorkflowRunDetail.tsx`:

```typescript
const STATUS_TONE: Record<string, Tone> = {
  queued: 'idle',
  running: 'cyan',              // animated pulse
  waiting_approval: 'amber',     // pulsing — primary attention
  paused: 'amber',
  succeeded: 'emerald',
  failed: 'rose',
  cancelled: 'idle',
};

const STEP_TONE: Record<string, Tone> = {
  pending: 'idle',
  running: 'cyan',
  waiting_approval: 'amber',
  succeeded: 'emerald',
  failed: 'rose',
  skipped: 'idle',
};
```

Per design system rules: every status pairs **icon + color + text** (never color-only). The badge text is the actual status name (e.g. "waiting_approval" displays as "Waiting approval").

---

## Polling vs SSE Decision

| Source | When to use | Why |
|---|---|---|
| **SSE (`useRunLiveEvents`)** | Run detail page (`/runs/[id]`) | Real-time step transitions, low latency |
| **TanStack polling (`useRunDetail`)** | Run detail page fallback | When SSE fails (auto-reconnect) |
| **TanStack polling (`useRunsIndex`)** | Run list page (`/runs`) | List view, 30s staleTime is fine |
| **No real-time** | Run list page | Avoid 100s of SSE connections |

The `useRunDetail` hook stops polling once the run reaches a terminal state:

```typescript
const NON_TERMINAL = new Set<RunRecord['status']>([
  'created', 'running', 'waiting_approval', 'paused',
]);

refetchInterval: (q) => {
  const data = q.state.data as RunRecord | undefined;
  if (!data) return 5_000;
  return NON_TERMINAL.has(data.status) ? 5_000 : false;
}
```

---

## Edge cases

| State | Treatment |
|---|---|
| **No runs** | `EmptyState` + "Start a Run" CTA |
| **Run in PENDING** | "Starting..." text + cyan pulsing badge |
| **Run in RUNNING** | Live stream pill + step progress bars + cost ticker |
| **Run in WAITING_APPROVAL** | Amber pulse badge + prominent Approve/Reject buttons + "Awaiting review" copy |
| **Run in PAUSED** | Amber badge + "Resume" button (operator override) |
| **Run in SUCCEEDED** | Emerald badge + final cost + duration + "View artifacts" CTA |
| **Run in FAILED** | Rose badge + error banner with failed step + reason + "Rerun" button |
| **Run in CANCELLED** | Muted badge + "Cancelled by {user}" + "Rerun" button |
| **SSE disconnect** | `EventSource` auto-reconnects; UI shows "Reconnecting..." status pill |
| **Budget exceeded mid-run** | Run auto-pauses with reason `budget_exceeded`; UI shows red budget meter; notification posted |
| **Operator cancels mid-approval** | Works on any non-terminal state; transitions to `CANCELLED`; emits `WORKFLOW_RUN_CANCELLED` |
| **Stale step result (never updated)** | Treat as `pending` until executor emits `WORKFLOW_STEP_STARTED` |
| **Concurrent viewer count** | SSE supports multiple subscribers (broadcast pattern); no per-user limit |
| **Tenant switch** | Every query key carries `tenant_id`; SSE auto-reconnects with new token; refetch via TanStack Query |
| **`prefers-reduced-motion`** | SSE events update instantly; status pulse animations disabled |

---

## Forbidden patterns

AI agents modifying Runs MUST NOT:

- ❌ Use `setInterval` for polling — use TanStack Query's `refetchInterval` with smart predicate
- ❌ Open SSE without auth — JWT must be sent (via query param since EventSource can't set headers)
- ❌ Auto-advance past `WAITING_APPROVAL` — Rule 3 enforcement
- ❌ Show "Resume" button on terminal states
- ❌ Skip `@audit()` on run mutations (cancel, resume)
- ❌ Skip `require_permission(...)` on routes
- ❌ Skip tenant scoping — every query carries `tenant_id` from JWT, never from client
- ❌ Bypass `useRunLiveEvents` and poll manually — SSE is the canonical real-time channel
- ❌ Hardcode run statuses — use `WorkflowRunStatus` enum (7 values)
- ❌ Use direct SDK imports for cost computation — `useWorkflowUsage` proxies to LiteLLM
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Close SSE manually on every event — only close on terminal status
- ❌ Add new event types to `_RUN_SCOPED_EVENTS` without updating the backend filter tuple + frontend consumer

---

## Verification checklist

- [ ] `apps/forge/app/runs/page.tsx` renders `RunCenterPage` with virtualized table
- [ ] `apps/forge/app/runs/[id]/page.tsx` renders `WorkflowRunDetail` with live stream pill
- [ ] `curl .../workflows/runs/{id}` returns run with valid Bearer token + tenant scope
- [ ] `curl .../workflows/runs` (via the workflow run listing endpoint) returns N seeded runs
- [ ] `POST /workflows/runs/{id}/cancel` transitions run to `CANCELLED` + emits event
- [ ] `POST /workflows/runs/{id}/resume` works on `WAITING_APPROVAL` runs
- [ ] `GET /workflows/runs/{id}/events` returns SSE stream with initial snapshot
- [ ] SSE stream closes when run reaches terminal status (`succeeded` / `failed` / `cancelled`)
- [ ] `useRunLiveEvents` returns events with `status: 'open'` while the run is active
- [ ] Cost summary endpoint returns totals + by_phase + by_model
- [ ] KPI strip shows real counts (Active: 7, Succeeded today: 12, etc.)
- [ ] Run detail drawer shows 7 tabs (Overview / Stages / Steps / Logs / Cost / Artifacts / Audit)
- [ ] "Approve" button calls `POST /approvals/{id}/decide` and the run continues
- [ ] "Cancel" button calls `POST /workflows/runs/{id}/cancel` and transitions
- [ ] Run reaches `WAITING_APPROVAL` at an approval node; does NOT auto-advance
- [ ] Budget exceeded → run auto-pauses with reason `budget_exceeded`
- [ ] Virtualized table handles 10k+ runs smoothly (TanStack Virtual)
- [ ] Filter chips (status pills, agent/command/date) update query in real-time
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton rows, not spinners)
- [ ] Tenant switch refetches runs
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — agent state colors
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R3 approval gates + R7 observability
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list
- [DB schema](../reference/db-schema.md) — `workflow_runs`, `workflow_run_steps`
- [Dashboard](./dashboard.md) — "Runs over time" + "Top workflows" widgets
- [Workflows](./workflows.md) — sibling feature (runs are executions of workflows)
- [Agent Center](./agent-center.md) — runs dispatch to registered agents
- [Stories](./stories.md) — "Start implementation" creates a run
- [Audit](./audit.md) — every run mutation writes an audit row
- [Analytics](./analytics.md) — per-run cost drill-down at `/analytics/usage/workflow/[run_id]`
- [LiteLLM integration](../standards/litellm-integration.md) — how costs are computed

---

## Maintenance notes

**When to update this doc:**

- A new `WorkflowRunStatus` added → update lifecycle table + STATUS_TONE mapping
- A new SSE event type added → update `_RUN_SCOPED_EVENTS` tuple + `useRunLiveEvents` consumer
- A new status tone color added → update `STATUS_TONE` + `STEP_TONE` maps
- A new draw tab added → update run detail drawer section

**Files to keep in sync (the lock-step triangle):**

```
backend/app/api/v1/workflows.py        ←  Workflow run routes (primary)
backend/app/api/v1/runs.py            ←  SDLC run routes (legacy)
backend/app/services/sdlc_run_manager.py  ←  In-memory run state
backend/app/services/workflow_executor.py ←  DAG walker (emits events)
backend/app/services/event_bus.py    ←  Typed events source
         ↓
apps/forge/lib/workflows/types.ts     ←  Wire types for workflow runs
apps/forge/lib/api.ts                 ←  Wire types for SDLC runs
apps/forge/lib/hooks/useWorkflows.ts  ←  TanStack + useRunLiveEvents
apps/forge/lib/hooks/useRuns.ts       ←  SDLC run hooks
         ↓
apps/forge/components/runs/RunCenterPage.tsx   ←  List + drawer
apps/forge/components/workflows/WorkflowRunDetail.tsx ←  Detail + SSE consumer
```

If any link in this chain drifts, the Runs Center breaks silently. Always update all six.