# Feature: Refactor Center (Migration Plans)

> **Status:** Wired to real backend (F-601 + F-213 — Refactor Agent + Jira Push)
> **Routes:** `apps/forge/app/refactor/page.tsx` (list) + `apps/forge/app/refactor/new/page.tsx` (wizard) + `apps/forge/app/refactor/[plan_id]/page.tsx` (detail)
> **Backend:** Orchestrator proxy `/v1/refactor/*` (not FastAPI — Refactor Agent sub-graph)
> **Refactor agent:** `backend/app/agents/refactor_agent.py` + `refactor_agent_state.py`
> **Schemas:** `backend/app/schemas/migration_plan.py`
> **Constitutional rules:** R1 (LiteLLM proxy — `generate_phases` LLM call), R2 (multi-tenant — every plan carries `tenant_id` + `project_id`), R3 (human approval gate — before `push_to_jira`), R4 (typed artifact — `MigrationPlan` is the canonical output), R6 (auditability — every node emits audit event)

---

## Purpose

The Refactor Center is the **phased migration planning surface**. When an operator identifies a heavy-lift refactor (Postgres 14 → 17, monolith → microservices, .NET → Spring, etc.), the Refactor Agent runs a 5-node sub-graph that:

1. **Inventories** the source repo (via AWS Transform)
2. **Plans** the target architecture shape
3. **Generates** the phased migration plan (via LLM)
4. **Builds** the risk register
5. **Pushes** to Jira (F-213) for engineering execution

The plan is a typed `MigrationPlan` artifact that flows through the F-010 artifact registry. Per Rule 3, the human approval gate fires **before** `push_to_jira` — the sub-graph waits for an approval event.

**Key capabilities:**

- **LangGraph sub-graph** — 5-node linear pipeline, F-601
- **Typed `MigrationPlan`** — schema-versioned artifact (Pydantic `extra="forbid"`)
- **3-page UX** — list / wizard / detail
- **Jira push** — synthetic epic + story keys via `usePushMigrationPlanToJira`
- **Live status tracking** — 6 phase statuses with semantic colors
- **Risk register** — 4-level severity (low / medium / high / critical)
- **Effort estimation** — 4 buckets (S / M / L / XL) + hours + days
- **Approval gate** — `pending_approval` → `approved` → `in_progress`

---

## Architecture

```
RefactorListPage (/refactor)
└── Project selector + MigrationPlanList
    ├── MigrationPlanCard per plan (status + summary + risks)
    └── "New analysis" button → /refactor/new

NewRefactorAnalysisPage (/refactor/new)
└── 3-step wizard
    ├── Step 1: Pick a project
    ├── Step 2: Describe the migration (source/target/notes)
    └── Step 3: Review & run (mutation)

RefactorDetailPage (/refactor/[plan_id])
└── Per-plan detail
    ├── Status banner + summary card
    ├── PhaseTimeline (vertical timeline with status icons)
    ├── RiskRegister (severity-sorted)
    ├── EffortEstimate (total + confidence)
    └── PushToJiraButton (synthetic epic)

Backend (LangGraph sub-graph)
START
  └─▶ inventory_source
        └─▶ plan_target
              └─▶ generate_phases  (LLM call via LiteLLM)
                    └─▶ risk_register
                          └─▶ push_to_jira (after approval)
                                └─▶ END

Jira Push (F-213)
└── POST /v1/refactor/plans/{planId}/push-to-jira
    ├── Idempotency-Key header (UUID v4)
    └── Returns { epicKey, storyKeys[], pushedAt }
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/refactor` | RefactorListPage | List of migration plans per project |
| `/refactor/new` | NewRefactorAnalysisPage | 3-step wizard to kick off analysis |
| `/refactor/[plan_id]` | RefactorDetailPage | Per-plan detail (phases + risks + effort) |
| `/refactor/loading.tsx` | (loading) | Loading skeleton |

### Backend (Orchestrator proxy)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/refactor/projects/{projectId}/plans` | List tenant-scoped plans |
| `GET` | `/v1/refactor/plans/{planId}` | Fetch single plan |
| `POST` | `/v1/refactor/analyses` | Trigger new analysis (Idempotency-Key required) |
| `POST` | `/v1/refactor/plans/{planId}/push-to-jira` | Push finalized plan to Jira (Idempotency-Key required) |

> **Note:** The frontend uses orchestrator proxy paths (`/v1/refactor/*`), not FastAPI paths. The Refactor Agent sub-graph runs in the orchestrator service and proxies these calls.

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `artifacts` | `MigrationPlan` persisted (artifact_type: `migration_plan`) |
| `audit_events` | Per-node audit event |
| `approval_gates` | Human approval before `push_to_jira` |

### Pydantic schemas (`backend/app/schemas/migration_plan.py`)

```python
class MigrationPhaseStatus(str, Enum):
    """Lifecycle state of a single MigrationPhase."""
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    BLOCKED = "blocked"
    DEFERRED = "deferred"


class MigrationPhase(ForgeBaseModel):
    """A single phase of a phased migration plan.

    Each phase is independently shippable: it has a clear scope, a set
    of files/services it touches, an effort estimate, and explicit
    prerequisites so downstream agents (e.g. F-401 implementation)
    can plan sprint-sized work against it.
    """
    model_config = ConfigDict(extra="forbid")
    id: str = Field(default_factory=lambda: str(uuid4()))
    order: int = Field(..., ge=0, le=1_000)
    name: str = Field(..., min_length=3, max_length=200)
    description: str = Field(..., min_length=10, max_length=10_000)
    status: MigrationPhaseStatus = MigrationPhaseStatus.PLANNED
    scope_files: list[str] = Field(default_factory=list, max_length=10_000)
    scope_services: list[str] = Field(default_factory=list, max_length=1_000)
    estimated_effort_days: float = Field(..., ge=0.0, le=10_000.0)
    estimated_cost_usd: float = Field(default=0.0, ge=0.0)
    prerequisites: list[str] = Field(default_factory=list, max_length=500)
    acceptance_criteria: list[str] = Field(default_factory=list, max_length=100)


class EffortEstimate(ForgeBaseModel):
    """Aggregate effort estimate across the whole migration."""
    total_effort_days: float = Field(..., ge=0.0)
    total_cost_usd: float = Field(default=0.0, ge=0.0)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    assumptions: list[str] = Field(default_factory=list, max_length=100)


class MigrationPlan(ForgeBaseModel):
    """The typed migration-plan artifact produced by the Refactor Agent.

    Rule 2 compliance: every instance carries ``tenant_id`` and
    ``project_id`` so the artifact is correctly scoped across the
    multi-tenant registry.
    """
    model_config = ConfigDict(extra="forbid")
    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    project_id: UUID
    source_inventory: SourceInventory
    target_architecture: TargetArchitecture
    phased_plan: list[MigrationPhase] = Field(..., min_length=1, max_length=100)
    risk_register: list[RiskItem] = Field(default_factory=list, max_length=500)
    effort_estimate: EffortEstimate
    dependencies: list[str] = Field(default_factory=list, max_length=500)
    generated_by: str = "refactor_agent"
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

### TypeScript mirror (`apps/forge/lib/api.ts`)

```typescript
export type RefactorEffort = 'S' | 'M' | 'L' | 'XL';

export type RefactorPhaseStatus =
  | 'pending'
  | 'analyzing'
  | 'awaiting_approval'
  | 'in_progress'
  | 'complete'
  | 'blocked';

export interface RefactorRisk {
  readonly id: string;
  readonly phaseId: string;
  readonly title: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly mitigation: string;
  readonly owner: string;
}

export interface RefactorPhase {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly summary: string;
  readonly effort: RefactorEffort;
  readonly estimateHours: number;
  readonly status: RefactorPhaseStatus;
  readonly tasks: ReadonlyArray<string>;
}

export interface MigrationPlan {
  readonly planId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly source: string;
  readonly target: string;
  readonly title: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: 'draft' | 'pending_approval' | 'approved' | 'in_progress' | 'complete' | 'archived';
  readonly phases: ReadonlyArray<RefactorPhase>;
  readonly risks: ReadonlyArray<RefactorRisk>;
}

export interface RefactorAnalysisSource {
  readonly projectId: string;
  readonly source: string;
  readonly target?: string;
  readonly notes?: string;
}

export interface JiraPushResult {
  readonly epicKey: string;
  readonly storyKeys: ReadonlyArray<string>;
  readonly pushedAt: string;
}
```

> **⚠️ Schema divergence (adapters required):**
> - **Phase status:** Backend uses `planned / in_progress / completed / blocked / deferred`. Frontend uses `pending / analyzing / awaiting_approval / in_progress / complete / blocked`. Adapter maps: backend `planned → frontend pending`, backend `completed → frontend complete`.
> - **Effort bucket:** Backend uses days (`estimated_effort_days`). Frontend uses both hours (`estimateHours`) AND bucket (`S/M/L/XL`). Adapter calculates bucket from hours: `<8h → S`, `8-24h → M`, `24-72h → L`, `>72h → XL`.
> - **Plan status:** Backend uses `draft / pending_approval / approved / in_progress / complete / archived`. Frontend uses the same 6 values — no adapter needed.

---

## 4 TanStack Query Hooks (`apps/forge/lib/hooks/useMigrationPlans.ts`)

```typescript
// 1. List — 30s polling
export function useMigrationPlans(projectId: string) {
  return useQuery({
    queryKey: migrationQueryKeys.list(projectId),
    queryFn: () => listMigrationPlans(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// 2. Detail — 10s polling while in-flight (4 statuses)
export function useMigrationPlan(planId: string) {
  return useQuery({
    queryKey: migrationQueryKeys.detail(planId),
    queryFn: () => getMigrationPlan(planId),
    enabled: Boolean(planId),
    refetchInterval: (q) => {
      const data = q.state.data as MigrationPlan | undefined;
      if (!data) return 5_000;
      const inFlight =
        data.status === 'draft' ||
        data.status === 'pending_approval' ||
        data.status === 'approved' ||
        data.status === 'in_progress';
      return inFlight ? 10_000 : false;  // smart polling
    },
    staleTime: 10_000,
  });
}

// 3. Mutation — kick off new analysis
export function useTriggerRefactorAnalysis() {
  return useMutation<MigrationPlan, Error, RefactorAnalysisSource>({
    mutationFn: (source) => triggerRefactorAnalysis(source),
  });
}

// 4. Mutation — push to Jira (F-213)
export function usePushMigrationPlanToJira(planId: string) {
  return useMutation<JiraPushResult, Error, void>({
    mutationFn: () => pushMigrationPlanToJira(planId),
  });
}
```

**2 polling cadences:**
- **List page** — 30s constant
- **Detail page** — 10s while in-flight (4 statuses), 5s if no data yet, stops after `complete` / `archived`

**2 mutations:**
- `useTriggerRefactorAnalysis` — kicks off new analysis (Idempotency-Key)
- `usePushMigrationPlanToJira` — pushes finalized plan (Idempotency-Key)

**Idempotency-Key contract:**

```typescript
export async function triggerRefactorAnalysis(
  source: RefactorAnalysisSource,
): Promise<MigrationPlan> {
  const key = crypto.randomUUID();  // UUID v4 per attempt
  return request<MigrationPlan>('/v1/refactor/analyses', {
    method: 'POST',
    idempotencyKey: key,
    body: source,
  });
}
```

Each call generates a fresh `crypto.randomUUID()` — safe to retry without duplicate runs.

---

## LangGraph Sub-Graph (`backend/app/agents/refactor_agent.py`)

### Topology (Linear Pipeline)

```
START
  └─▶ inventory_source
        └─▶ plan_target
              └─▶ generate_phases  (LLM call)
                    └─▶ risk_register
                          └─▶ push_to_jira (after approval)
                                └─▶ END
```

- **Linear** — no conditional edges
- **5 nodes** — each reads from `RefactorAgentState`, returns partial dict
- **Approval gate** — enforced by **parent SDLC supervisor**, NOT inside sub-graph

> "exposes the plan via the artifact registry and waits for a human approval event before `push_to_jira`. The graph itself is linear, so the gate is enforced by the parent SDLC supervisor before scheduling the sub-graph, NOT inside it."

### 5 Nodes (`backend/app/agents/refactor_agent.py`)

| Node | Purpose | Artifact emitted |
|---|---|---|
| `inventory_source` | Calls AWS Transform to enumerate source repo | `source_inventory` dict |
| `plan_target` | Composes target architecture shape from inputs (no Forge translation, DL-029) | `target_architecture` dict |
| `generate_phases` | Synthesizes phased migration plan via LLM (LiteLLM proxy) | `phased_plan` list |
| `risk_register` | Builds risk register from phases + inventory | `risk_register` list |
| `push_to_jira` | Creates synthetic epic + story keys via F-213 | `jira_push_result` dict |

### RefactorAgentState (`backend/app/agents/refactor_agent_state.py`)

```python
class RefactorAgentState(TypedDict, total=False):
    """Typed state for the Refactor Agent sub-graph.

    All fields are optional from LangGraph's perspective (so partial
    merges don't crash) but downstream nodes treat them as required
    once ``inventory_source`` has run.
    """

    # Identity / tenancy (Rule 2)
    run_id: str
    tenant_id: str
    project_id: str
    actor_id: str

    # Inputs
    source_repo_url: str
    source_language: str
    source_framework: str
    target_language: str
    target_framework: str
    target_cloud: str
    constraints: dict[str, Any]

    # Outputs from each node
    source_inventory: dict[str, Any]
    target_architecture: dict[str, Any]
    phased_plan: list[dict[str, Any]]
    risk_register: list[dict[str, Any]]
    effort_estimate: dict[str, Any]
    dependencies: list[dict[str, Any]]

    # AWS Transform orchestration bookkeeping
    aws_transform_job_id: str | None
    aws_transform_status: str
    aws_transform_results: dict[str, Any] | None

    # Approval gate
    pending_approval: bool
    approved_by: str | None
    approval_reason: str

    # Push to Jira (F-213)
    jira_push_result: dict[str, Any] | None

    # Artifact references (post-creation)
    artifact_id: str | None
    artifact_version: int

    # Audit / errors
    phase_history: list[dict[str, Any]]
    errors: list[dict[str, Any]]
    cost_so_far: float


REFACTOR_PHASES: tuple[str, ...] = (
    "inventory_source",
    "plan_target",
    "generate_phases",
    "risk_register",
    "push_to_jira",
)
```

### Sub-Graph Independence (DL-029)

The sub-graph **does NOT translate the plan** — that's the parent's job. Per DL-029, the Refactor Agent produces the typed artifact; the orchestrator handles the translation to Jira / Linear / GitHub Issues via the F-213 connector.

---

## 3-Step Wizard (`/refactor/new`)

```typescript
type Step = 'project' | 'source' | 'review';

const STEP_ORDER: ReadonlyArray<Step> = ['project', 'source', 'review'];

const STEP_LABEL: Record<Step, string> = {
  project: 'Pick a project',
  source: 'Describe the migration',
  review: 'Review & run',
};

const canAdvance =
  (step === 'project' && projectId.trim().length > 0) ||
  (step === 'source' && source.trim().length > 0) ||
  step === 'review';
```

**3 steps:**
1. **Pick a project** — `projectId` input
2. **Describe the migration** — `source` / `target` / `notes` inputs
3. **Review & run** — shows summary + "Run analysis" CTA → `useTriggerRefactorAnalysis().mutate(source)`

On success, router navigates to `/refactor/{planId}` for the detail view.

> "Three-step wizard that kicks off a new migration analysis. Reuses the dialog primitives already shipped in `components/ui`, but renders inline (not in a modal) so the operator can see the breadcrumb + the plan it creates once the analysis completes."

---

## 6 Plan Statuses + Tones

```typescript
const STATUS_TONE: Record<MigrationPlan['status'], string> = {
  draft: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  pending_approval: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  in_progress: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  complete: 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200',
  archived: 'border-forge-700/60 bg-forge-800/40 text-forge-400',
};

const STATUS_LABEL: Record<MigrationPlan['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  in_progress: 'In progress',
  complete: 'Complete',
  archived: 'Archived',
};
```

---

## 6 Phase Statuses + Icons (`PhaseTimeline.tsx`)

```typescript
const STATUS_ICON: Record<RefactorPhaseStatus, React.ComponentType> = {
  pending: Circle,
  analyzing: Loader2,
  awaiting_approval: Pause,
  in_progress: Clock,
  complete: Check,
  blocked: AlertTriangle,
};

const STATUS_LABEL: Record<RefactorPhaseStatus, string> = {
  pending: 'Pending',
  analyzing: 'Analyzing',
  awaiting_approval: 'Awaiting approval',
  in_progress: 'In progress',
  complete: 'Complete',
  blocked: 'Blocked',
};

const STATUS_TONE: Record<RefactorPhaseStatus, string> = {
  pending: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  analyzing: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  awaiting_approval: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  in_progress: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  complete: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  blocked: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};
```

> Note: `analyzing` and `awaiting_approval` are **frontend-only statuses** — they represent transient states during the analysis run that don't have backend Pydantic equivalents. The adapter maps them to backend `in_progress` with a `phase_history` entry explaining the state.

---

## 5 Refactor Components (`apps/forge/components/refactor/`)

| Component | Lines | Purpose |
|---|---|---|
| `MigrationPlanCard.tsx` | 158 | Card per plan (status + summary + risks) |
| `PhaseTimeline.tsx` | 118 | Vertical timeline with status icons + tones |
| `RiskRegister.tsx` | 105 | Severity-sorted risk list |
| `PushToJiraButton.tsx` | 71 | Mutation trigger + result modal |
| `EffortEstimate.tsx` | 50 | Total days + cost + confidence + assumptions |
| **Total** | **502** | |

---

## DEMO Plans Fallback

The pages ship with **DEMO_PLANS** as a static fallback when the orchestrator is unreachable, so dev environments still render:

```typescript
const SEED_PROJECT_ID = 'project-forge-demo';

const DEMO_PLANS: ReadonlyArray<MigrationPlan> = [
  {
    planId: 'plan-001',
    projectId: SEED_PROJECT_ID,
    tenantId: '00000000-0000-4000-8000-000000000ace',
    source: 'postgres-14',
    target: 'postgres-17',
    title: 'Postgres 14 → 17 cutover',
    summary: 'Migrate the primary OLTP cluster from Postgres 14 to 17...',
    createdAt: '2026-06-15T09:00:00Z',
    updatedAt: '2026-06-20T17:20:00Z',
    status: 'in_progress',
    phases: [
      {
        id: 'phase-001-1',
        index: 1,
        title: 'Compatibility scan',
        effort: 'S',
        estimateHours: 4,
        status: 'complete',
        tasks: ['Run check tool', 'Capture extension inventory'],
      },
      // ... 2 more phases
    ],
    risks: [
      {
        id: 'risk-001-1',
        phaseId: 'phase-001-3',
        title: 'Long-running transactions block promotion',
        severity: 'high',
        mitigation: 'Pre-flight advisory lock audit + cancel blocked sessions.',
        owner: 'Priya Shah',
      },
      // ... more risks
    ],
  },
];
```

> "Static fallback when the orchestrator stub isn't running. Mirrors the shape returned by `/v1/refactor/projects/{projectId}/plans` so the UI can render without a backend."

---

## Jira Push Flow (F-213)

```
1. User clicks <PushToJiraButton> on detail page
       ↓
2. usePushMigrationPlanToJira(planId).mutate()
       ↓
3. POST /v1/refactor/plans/{planId}/push-to-jira
   Header: Idempotency-Key: <crypto.randomUUID()>
       ↓
4. Connector Layer translates MigrationPlan → Jira epic + stories
       ↓
5. Returns { epicKey: "FORGE-1234", storyKeys: ["FORGE-1235", ...], pushedAt }
       ↓
6. <PushToJiraButton> shows success state with epicKey
```

**Idempotency:** Each click generates a fresh `crypto.randomUUID()`. If the network drops, retry with the same key returns the same result (orchestrator deduplicates).

---

## Edge cases

| State | Treatment |
|---|---|
| **No plans** | Empty state + "Create your first migration plan" CTA |
| **Plan in `pending_approval`** | Amber badge + "Approve" CTA visible to eligible roles |
| **Plan in `complete`** | Detail polling stops (smart predicate) |
| **AWS Transform down** | `inventory_source` fails + sub-graph aborts + error surfaced in detail page |
| **Jira connector down** | `push_to_jira` fails + error message in `<PushToJiraButton>` |
| **Idempotency-Key collision** | Orchestrator dedupes + returns same result |
| **Cross-tenant plan ID** | 404 (RLS enforcement) |
| **Wizard empty fields** | `canAdvance` returns false + "Next" button disabled |
| **`prefers-reduced-motion`** | Pulse animations disabled on status icons |
| **Phase status: `analyzing` (frontend-only)** | Adapter maps to backend `in_progress` |
| **Effort bucket: huge hours** | Auto-classify: `<8h → S`, `8-24h → M`, `24-72h → L`, `>72h → XL` |

---

## Forbidden patterns

AI agents modifying Refactor MUST NOT:

- ❌ Skip `tenant_id` + `project_id` on the `MigrationPlan` artifact — Rule 2
- ❌ Skip the human approval gate before `push_to_jira` — Rule 3
- ❌ Use direct SDK imports for `generate_phases` — Rule 1 (via LiteLLM proxy)
- ❌ Translate the plan to Jira inside the sub-graph — DL-029 (orchestrator handles via F-213 connector)
- ❌ Add a conditional edge to the sub-graph — must stay linear (5 nodes in order)
- ❌ Skip audit events on each node — Rule 6
- ❌ Skip `Idempotency-Key` header on POST — orchestrator requires it
- ❌ Add a phase status without updating the `RefactorPhaseStatus` literal (6 closed values)
- ❌ Skip `useMigrationPlan` smart polling (4 in-flight statuses)
- ❌ Render plans without severity colors — must use `border-{color}/40 bg-{color}/10 text-{color}-XXX`
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeletons
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist

- [ ] `/refactor` renders list of `MigrationPlanCard`s
- [ ] `/refactor/new` renders 3-step wizard
- [ ] `/refactor/[plan_id]` renders detail (timeline + risks + effort)
- [ ] `GET /v1/refactor/projects/{projectId}/plans` returns list (RLS-scoped)
- [ ] `GET /v1/refactor/plans/{planId}` returns single plan
- [ ] `POST /v1/refactor/analyses` triggers new analysis (Idempotency-Key)
- [ ] `POST /v1/refactor/plans/{planId}/push-to-jira` creates epic + stories (Idempotency-Key)
- [ ] List page polls every 30s
- [ ] Detail page polls every 10s while in-flight (4 statuses), stops after `complete`
- [ ] Wizard advances only when fields valid
- [ ] Wizard mutation navigates to `/refactor/{planId}` on success
- [ ] PhaseTimeline renders correct icons per status (Circle / Loader2 / Pause / Clock / Check / AlertTriangle)
- [ ] RiskRegister sorts by severity (critical first)
- [ ] EffortEstimate renders total days + cost + confidence
- [ ] PushToJiraButton shows `epicKey` on success
- [ ] Status badges render correct tones (6 colors)
- [ ] DEMO_PLANS fallback renders when orchestrator unreachable
- [ ] Cross-tenant plan ID returns 404 (RLS)
- [ ] Idempotency-Key generates fresh `crypto.randomUUID()` per click
- [ ] Empty state renders when no plans
- [ ] Loading state renders during fetch
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — status tones + effort badges
- [API conventions](../standards/api-conventions.md) — Idempotency-Key contract
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R4 + R6 + DL-029
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (4 orchestrator routes)
- [DB schema](../reference/db-schema.md) — `artifacts` (where plans persist)
- [Dashboard](./dashboard.md) — "Recent refactors" widget
- [Architecture Center](./architecture-center.md) — ADR capture from refactor
- [Stories](./stories.md) — Refactor phases surface as sprints/stories
- [Workflows](./workflows.md) — Refactor as workflow step
- [Connector Center](./connector-center.md) — Jira connector for F-213 push
- [Audit](./audit.md) — Every node emits audit event
- [Projects](./projects.md) — Per-project refactor plans
- [Settings](./settings.md) — Refactor thresholds + defaults

---

## Maintenance notes

**When to update this doc:**

- A new node added → update 5-node table
- A new phase status added → update `RefactorPhaseStatus` literal
- A new plan status added → update 6-status table
- Effort bucket heuristic changed → update "8h / 24h / 72h" thresholds
- A new component added → update 5-component list
- Connector integration added → update Jira Push Flow

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/agents/refactor_agent.py            ←  5-node linear LangGraph sub-graph
backend/app/agents/refactor_agent_state.py      ←  RefactorAgentState (TypedDict) + REFACTOR_PHASES
backend/app/agents/prompts/refactor_agent.j2    ←  LLM prompt template
backend/app/schemas/migration_plan.py           ←  Pydantic source of truth (MigrationPhase + EffortEstimate + MigrationPlan)
backend/app/services/artifact_registry.py       ←  Persists MigrationPlan (artifact_type: migration_plan)
backend/app/services/audit_service.py           ←  Per-node audit event
backend/app/services/approval_gate.py           ←  Human approval before push_to_jira
         ↓
apps/forge/lib/api.ts                           ←  TypeScript mirror (4 phase statuses + 6 plan statuses + 4 effort buckets)
apps/forge/lib/hooks/useMigrationPlans.ts       ←  4 hooks (list + detail + 2 mutations)
         ↓
apps/forge/app/refactor/page.tsx                ←  List page (187 lines)
apps/forge/app/refactor/new/page.tsx            ←  Wizard (259 lines)
apps/forge/app/refactor/[plan_id]/page.tsx      ←  Detail page (253 lines)
apps/forge/components/refactor/                 ←  5 components (502 lines)
```

If any link in this chain drifts, the Refactor Center breaks silently. Always update all links.

---

## Why this is a "heavy-lift" surface

The Refactor Center is where **the biggest engineering decisions get made**. A monolith-to-microservices refactor is a 6-month effort touching 50+ services. The 5-node sub-graph breaks this into:

1. **Inventory first** — know what's there before planning
2. **Plan shape, not detail** — the LLM fills in detail later
3. **Phase by sprint-sized chunk** — each phase is independently shippable
4. **Risk register per phase** — every phase has explicit risks + owners
5. **Push to Jira** — engineering execution without leaving Forge

The **human approval gate** (Rule 3) is non-negotiable: an agent can propose a 6-month migration, but only a human can approve pushing 50 epics to Jira. This is where automation meets accountability.