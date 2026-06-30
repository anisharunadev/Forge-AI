# Feature: Architecture Center (ADRs + Contracts + Risks + More)

> **Status:** Wired to real backend (Step 58 Phase 6) + Step 30 modernization
> **Route:** `apps/forge/app/architecture/page.tsx`
> **Tabs:** 9 (Overview / ADRs / API Contracts / Task Breakdowns / Risk Registers / Traceability / Versions / Tech Radar / Diagrams)
> **Backend modules:** `backend/app/api/v1/architecture/` — 9 sub-routers, **42 routes total**
> **Backend services:** `backend/app/services/architecture/` — 8 services (ADR gen, contract gen, risk register, task breakdown, traceability, versioning, approval, standards attestation, acceptance criteria)
> **Constitutional rules:** R1 (LiteLLM for generation), R2 (multi-tenant), R3 (human approvals on ADRs + contracts + versions), R4 (typed artifacts), R5 (KG-backed traceability), R6 (auditability)

---

## Purpose

The Architecture Center is the **technical design authority** for the platform. It owns ADRs (Architecture Decision Records in MADR format), API contracts (OpenAPI / GraphQL / gRPC / AsyncAPI), task breakdowns, risk registers, traceability graphs, version snapshots, the tech radar, and diagrams.

Per PRD §1.4 the Architecture Center serves **tech leads** (draft + approve ADRs), **engineers** (consume contracts), and **stewards** (audit risk + traceability).

**Key capabilities:**
- **9-tab hub** — Overview / ADRs / API Contracts / Task Breakdowns / Risk Registers / Traceability / Versions / Tech Radar / Diagrams
- **LLM generation** — `POST /architecture/adrs` generates a MADR-format ADR from a prompt + project context
- **API contract generation** — `POST /architecture/contracts` produces OpenAPI 3.0 / GraphQL SDL / gRPC proto / AsyncAPI specs
- **Task breakdown** — `POST /architecture/task-breakdowns` decomposes an ADR or contract into tasks
- **Risk register** — scored risks (likelihood × impact) with mitigation strategies
- **Traceability** — KG-backed graph linking ADRs ↔ contracts ↔ tasks ↔ risks ↔ stories
- **Versioning** — snapshot architecture state at milestones; diff + rollback
- **Tech radar** — quadrant view (Adopt / Trial / Assess / Hold)
- **Diagrams explorer** — browse generated diagrams (C4, sequence, ER)
- **Human approval gates** — every ADR / contract / version needs human approval (per Rule 3)
- **Standards attestation** — declare compliance with coding/design/architecture standards

---

## Architecture

```
ArchitectureCenterPage (/architecture)
└── Hero band (ARCHITECTURE eyebrow + Health snapshot + Activity feed)
└── Tabs (9)
    ├── Overview              — KPI strip + activity feed + cross-tab chips
    ├── ADRs                  — ADR list + ADRViewer + ADRCreateDialog + ADRSidebar
    ├── API Contracts         — APIContractList + APIContractViewer
    ├── Task Breakdowns       — TaskBreakdownTree (hierarchical)
    ├── Risk Registers        — RiskRegisterKanban + RiskHeatMap + RiskRegisterTable
    ├── Traceability          — TraceabilityMatrix + TraceabilityGraph
    ├── Versions              — VersionTimelineView + MigrationGuide
    ├── Tech Radar            — TechRadar (quadrant)
    └── Diagrams              — DiagramsExplorer + ConsumerFlow
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/architecture` | Architecture Center | 9-tab hub |

### Backend (FastAPI)

All routes use `@audit()` decorator. Tenant scoping enforced via `principal.tenant_id`.

**42 backend routes across 9 sub-routers:**

#### ADRs (`backend/app/api/v1/architecture/adrs.py`) — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/adrs` | Generate new ADR (LLM via LiteLLM) |
| `GET` | `/api/v1/architecture/adrs` | List ADRs (paginated) |
| `GET` | `/api/v1/architecture/adrs/{id}` | Get one ADR |
| `POST` | `/api/v1/architecture/adrs/{id}/supersede` | Supersede with new ADR (creates audit chain) |

#### API Contracts (`backend/app/api/v1/architecture/contracts.py`) — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/contracts` | Generate new API contract (OpenAPI / GraphQL / gRPC) |
| `GET` | `/api/v1/architecture/contracts` | List contracts |
| `GET` | `/api/v1/architecture/contracts/{id}` | Get one contract |
| `POST` | `/api/v1/architecture/contracts/{id}/validate` | Validate spec syntax |
| `POST` | `/api/v1/architecture/contracts/{id}/publish` | Publish (creates version) |

#### Risk Registers (`backend/app/api/v1/architecture/risk_registers.py`) — 6 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/risk-registers` | Create new register |
| `GET` | `/api/v1/architecture/risk-registers` | List registers |
| `GET` | `/api/v1/architecture/risk-registers/{id}` | Get one |
| `POST` | `/api/v1/architecture/risk-registers/{id}/risks` | Add risk to register |
| `PATCH` | `/api/v1/architecture/risk-registers/{id}/risks/{risk_id}` | Update risk |
| `GET` | `/api/v1/architecture/risk-registers/{id}/top` | List top N risks by score |

#### Approvals (`backend/app/api/v1/architecture/approvals.py`) — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/approvals` | Request approval (for ADR / contract / version) |
| `GET` | `/api/v1/architecture/approvals` | List approval queue |
| `GET` | `/api/v1/architecture/approvals/{id}` | Get one |
| `POST` | `/api/v1/architecture/approvals/{id}/decide` | Approve / deny / request_changes |
| `POST` | `/api/v1/architecture/approvals/{id}/cancel` | Cancel pending approval |

#### Standards (`backend/app/api/v1/architecture/standards.py`) — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/standards/attest` | Attest compliance with a standard |
| `GET` | `/api/v1/architecture/standards/attestations` | List attestations |
| `GET` | `/api/v1/architecture/standards/check/{artifact_type}/{artifact_id}` | Check artifact against standards |
| `POST` | `/api/v1/architecture/standards/attestations/{id}/revoke` | Revoke attestation |

#### Task Breakdowns (`backend/app/api/v1/architecture/task_breakdowns.py`) — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/task-breakdowns` | Create breakdown (source: adr / api_contract / risk_register) |
| `GET` | `/api/v1/architecture/task-breakdowns` | List breakdowns |
| `GET` | `/api/v1/architecture/task-breakdowns/{id}` | Get one |
| `PATCH` | `/api/v1/architecture/task-breakdowns/{id}/tasks/{task_id}` | Update task |

#### Traceability (`backend/app/api/v1/architecture/traceability.py`) — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/architecture/traceability` | Get full traceability graph |
| `GET` | `/api/v1/architecture/lineage/{artifact_type}/{artifact_id}` | Get lineage (upstream + downstream) |
| `GET` | `/api/v1/architecture/orphans` | List orphaned artifacts (no links) |
| `GET` | `/api/v1/architecture/breaking-changes/{contract_id}` | List breaking changes |

#### Versions (`backend/app/api/v1/architecture/versions.py`) — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/versions` | Create new version snapshot |
| `GET` | `/api/v1/architecture/versions` | List versions |
| `GET` | `/api/v1/architecture/versions/diff` | Diff two versions |
| `POST` | `/api/v1/architecture/versions/rollback` | Rollback to a prior version |

#### Acceptance (`backend/app/api/v1/architecture/acceptance.py`) — 6 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/architecture/acceptance` | Create acceptance criteria |
| `GET` | `/api/v1/architecture/acceptance/{id}` | Get criteria |
| `POST` | `/api/v1/architecture/acceptance/{id}/verify` | Verify criteria |
| `GET` | `/api/v1/architecture/coverage` | Coverage report |
| `POST` | `/api/v1/architecture/coverage/refresh` | Refresh coverage |
| `GET` | `/api/v1/architecture/acceptance/{id}/audit` | Get audit trail |

---

## Data touched

### Tables (`backend/app/db/models/architecture.py`)

| Table | Purpose |
|---|---|
| `architecture_adrs` | ADR records (MADR format: title, context, decision, consequences, alternatives) |
| `architecture_api_contracts` | API contract specs (OpenAPI / GraphQL / gRPC / AsyncAPI) |
| `task_breakdowns` | Hierarchical task decomposition (parent_artifact_id + tasks JSONB) |
| `risk_registers` | Risk register containers + nested risks |
| `architecture_approvals` | Human approval records (ADR / contract / version) |
| `standards_attestations` | Compliance attestations |
| `architecture_versions` | Version snapshots |
| `acceptance_criteria` | Acceptance criteria + verification status |
| `audit_events` | Every mutation logged |

### ADR columns (MADR format)

```python
class ADR(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "architecture_adrs"
    number: int                   # Per-project auto-incrementing
    title: str                    # max 500 chars
    status: str                   # proposed | draft | approved | published | superseded
    context: str                  # The forces at play
    decision: str                 # The change we're proposing
    consequences: dict            # {positive: [...], negative: [...], neutral: [...]}
    alternatives: list[dict]      # [{name, summary, rejected_because}]
    related_adrs: list[str]       # Cross-references
    generated_by: str | None      # 'human' | 'forge-adr-generator'
    reviewed_by: str | None
    approved_by: UUID | None
    approved_at: datetime | None
```

### API Contract columns

```python
class APIContract(Base, ...):
    __tablename__ = "architecture_api_contracts"
    name: str
    version: str                  # semver
    spec_type: str                # 'openapi' | 'graphql' | 'grpc' | 'asyncapi'
    spec_content: dict            # The parsed spec (JSONB)
    status: str                   # draft | published | deprecated
    source_artifact_id: UUID | None  # FK to artifacts.id (the source PRD or idea)
    generated_by: str | None      # 'human' | 'forge-contract-generator'
    approved_by: UUID | None
```

### Risk Register + Risk columns

```python
class RiskRegisterResponse(...):
    id: UUID
    name: str
    risks: list[RiskResponse]
    mitigation_strategy: str
    status: str                   # active | archived
    generated_by: str | None
    approved_by: UUID | None

class RiskResponse(...):
    id: str
    title: str                    # max 500 chars
    category: str                 # technical | security | operational | business | compliance
    likelihood: int               # 1-5
    impact: int                   # 1-5
    score: int                    # likelihood × impact (computed)
    mitigation: str
    owner: str
```

**Risk category enum (5):**
```python
category: str = Field(..., pattern="^(technical|security|operational|business|compliance)$")
```

**Risk scoring:**
- `score = likelihood × impact` (1×1=1 to 5×5=25)
- Score thresholds: 1-5 = Low (emerald), 6-12 = Medium (amber), 13-25 = High (rose)
- `GET /risk-registers/{id}/top` returns top N by score

### Frontend enums (`apps/forge/lib/architecture/data.ts`)

**`ADRStatus` (5):**
```typescript
export type ADRStatus =
  | 'proposed'    // Initial draft, AI-generated
  | 'draft'       // Human editing
  | 'approved'    // Approved by reviewer, not yet published
  | 'published'   // Effective
  | 'superseded'; // Replaced by newer ADR
```

**`ContractKind` (4):**
```typescript
export type ContractKind = 'openapi' | 'graphql' | 'grpc' | 'asyncapi';
```

### TypeScript mirror (`apps/forge/lib/architecture/data.ts`)

Mirrors all wire-format shapes. The legacy `MOCK_*` fixtures in `mock-fixtures.ts` provide offline rendering.

---

## 9 Tabs (Step 30 layout)

```typescript
type TabId =
  | 'overview'      // 1. KPI strip + activity
  | 'adrs'          // 2. Architecture Decision Records
  | 'contracts'     // 3. API Contracts (OpenAPI / GraphQL / gRPC)
  | 'tasks'         // 4. Task Breakdowns (hierarchical)
  | 'risks'         // 5. Risk Registers (kanban + heatmap)
  | 'trace'         // 6. Traceability (matrix + graph)
  | 'versions'      // 7. Versions (timeline + diff)
  | 'radar'         // 8. Tech Radar (quadrant)
  | 'diagrams';     // 9. Diagrams (C4 / sequence / ER)

const TABS = [
  { id: 'overview',  label: 'Overview',          shortLabel: 'Overview',  icon: LayoutGrid,   countTone: 'emerald' },
  { id: 'adrs',      label: 'ADRs',              shortLabel: 'ADRs',      icon: FileText,     countTone: 'emerald' },
  { id: 'contracts', label: 'API Contracts',     shortLabel: 'APIs',      icon: FileCode2,    countTone: 'amber' },
  { id: 'tasks',     label: 'Task Breakdowns',   shortLabel: 'Tasks',     icon: ListTree,     countTone: 'amber' },
  { id: 'risks',     label: 'Risk Registers',    shortLabel: 'Risks',     icon: ShieldAlert,  countTone: 'rose' },
  { id: 'trace',     label: 'Traceability',      shortLabel: 'Trace',     icon: Network,      countTone: 'emerald' },
  { id: 'versions',  label: 'Versions',          shortLabel: 'Versions',  icon: History,      countTone: 'emerald' },
  { id: 'radar',     label: 'Tech Radar',        shortLabel: 'Radar',     icon: Sparkles,     countTone: 'neutral' },
  { id: 'diagrams',  label: 'Diagrams',          shortLabel: 'Diagrams',  icon: GitMerge,     countTone: 'neutral' },
];
```

Each tab shows a count badge colored by `countTone`:
- `emerald` — healthy / positive (Overview, ADRs, Trace, Versions)
- `amber` — needs attention (Contracts, Tasks)
- `rose` — risk surface (Risks)
- `neutral` — informational (Radar, Diagrams)

### Count tone CSS

```typescript
const COUNT_TONE = {
  emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  amber:   'border-amber-500/40 bg-amber-500/10 text-amber-300',
  rose:    'border-rose-500/40 bg-rose-500/10 text-rose-300',
  neutral: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
};
```

---

## ADR Generation Flow (LLM-backed, F-301)

```
1. User clicks "New ADR" → ADRCreateDialog opens
2. User provides: title (required), context (optional), description (optional)
3. POST /architecture/adrs { project_id, title, context, ... }
   ↓
4. adr_generator.py dispatched (background task)
   ↓
5. status: proposed
   ↓
6. LLM call via LiteLLM (Rule 1)
   - prompt = title + context + project KG context
   - tools called: search_knowledge, get_standards, get_template
   ↓
7. LLM returns MADR-format fields:
   - context (expanded)
   - decision (proposed change)
   - consequences (positive/negative/neutral)
   - alternatives ([{name, summary, rejected_because}])
   - related_adrs (cross-references from KG)
   ↓
8. ADR row inserted with number = max(project.adr_number) + 1
   ↓
9. ADR rendered in ADRViewer (MADR markdown)
   ↓
10. User edits → PATCH or directly mutates fields
    ↓
11. User requests approval → POST /architecture/approvals
    ↓
12. Approver decides → POST /architecture/approvals/{id}/decide
    ↓
13. If approved: status → approved → published
    If denied: status → draft (user can revise)
```

`generated_by` = `'forge-adr-generator'` distinguishes AI-drafted from human-written.

---

## API Contract Generation Flow (F-302)

```
1. POST /architecture/contracts { project_id, description, contract_type, name }
   ↓
2. api_contract_generator.py dispatched
   ↓
3. LLM call generates spec (OpenAPI / GraphQL SDL / gRPC proto / AsyncAPI)
   ↓
4. spec_content parsed + stored as JSONB
   ↓
5. status: draft
   ↓
6. POST /architecture/contracts/{id}/validate
   - Syntax check (per spec format)
   - Returns {valid: bool, errors: list[str]}
   ↓
7. If valid → POST /architecture/contracts/{id}/publish
   - Creates architecture_version snapshot
   - status: published
   - Linked to source_artifact_id (the PRD or idea that triggered it)
```

**Contract types (4):**
- `openapi` — REST APIs
- `graphql` — GraphQL schemas
- `grpc` — gRPC proto definitions
- `asyncapi` — Event-driven APIs

---

## Risk Register Scoring

```
score = likelihood × impact  (1-25)

Risk heat map:
  - 1-5   → Low      (emerald, no action needed)
  - 6-12  → Medium   (amber, monitor)
  - 13-25 → High     (rose, immediate mitigation)

Visual:
  ┌─────────────────────────────────┐
  │ High (rose)                     │
  │ ┌─────────┬─────────┬─────────┐ │
  │ │ 5  25 ● │ 4  20 ● │ 5  25 ● │ │
  │ │ 3  15 ● │ 2  10 ● │ 4  20 ● │ │
  │ ├─────────┼─────────┼─────────┤ │
  │ │ Med 3 15│ Med 2 10│ High 20 │ │
  │ │ 1   5   │ 3  15   │ 4  20   │ │
  │ └─────────┴─────────┴─────────┘ │
  │ Low (emerald)                   │
  └─────────────────────────────────┘
```

`GET /risk-registers/{id}/top?limit=5` returns highest-scored risks for dashboard attention.

---

## Task Breakdown (F-302 extension)

A task breakdown is a hierarchical decomposition of an ADR or API contract into implementable tasks:

```typescript
interface TaskNode {
  id: string;
  title: string;
  description: string;
  estimate_hours: number;
  dependencies: string[];     // Task IDs this task depends on
  assignee: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  children: TaskNode[];       // Nested sub-tasks
}
```

Rendered as `TaskBreakdownTree` (collapsible tree).

**Task breakdown source types (3):**
- `adr` — Generated from an ADR
- `api_contract` — Generated from an API contract (one task per endpoint)
- `risk_register` — Generated from risks (one task per mitigation)

---

## Traceability Graph (F-303)

KG-backed graph linking:

```
Idea → PRD → ADR → API Contract → Task Breakdown → Story
                     ↓
                  Risk Register → Mitigation Task
                     ↓
                  Version Snapshot
```

**Routes:**
- `GET /traceability` — Full graph
- `GET /lineage/{artifact_type}/{artifact_id}` — Upstream + downstream lineage
- `GET /orphans` — Artifacts with no links (governance flag)
- `GET /breaking-changes/{contract_id}` — Breaking changes from this contract

**Visual:** `TraceabilityMatrix` (rows × columns grid) + `TraceabilityGraph` (node-link diagram).

**Orphans treatment:**
- Per Rule 5 (KG-backed knowledge), orphans are a governance concern
- Surfaced in `ArchitectureApprovalReviewer` warnings
- Show on Overview tab as "Orphaned artifacts: N"

---

## Versioning (F-303)

A version is a **point-in-time snapshot** of architecture state:

- All ADRs (status + content)
- All API contracts (specs)
- All task breakdowns
- All risk registers
- Standards attestations

**Routes:**
- `POST /versions` — Snapshot current state
- `GET /versions` — List versions
- `GET /versions/diff?from={v1}&to={v2}` — Diff two versions
- `POST /versions/rollback` — Rollback (creates new version that mirrors old)

Versions are immutable. Rollback creates a NEW version with old content (audit-friendly).

---

## Tech Radar

Quadrant view of technology adoption:

```
         Adopt      |    Trial
         ───────────┼────────────
         Hold       |    Assess
```

Each technology item has:
- Quadrant (Adopt / Trial / Assess / Hold)
- Ring (current state)
- Description
- Date of last movement

`MOCK_TECH_RADAR` provides offline fixtures. Real backend feed planned for next iteration.

---

## Diagrams Explorer

Browse generated diagrams:
- C4 (Context / Container / Component / Code)
- Sequence diagrams
- Entity-relationship diagrams

Diagrams are generated by `architecture.diagram_generator` (future service) or uploaded manually.

`MOCK_DIAGRAMS` provides offline fixtures.

---

## Human Approval Workflow (Per Rule 3)

Every state transition that affects published architecture requires human approval:

```
ADR/Contract/Version creation
       ↓
POST /architecture/approvals { artifact_type, artifact_id, request_type }
       ↓
ArchitectureApproval row created (status=PENDING)
       ↓
Approver sees in queue (Approvals inbox in shell + dedicated tab in some apps)
       ↓
Approver decides:
  - approve  → status=APPROVED → artifact becomes effective
  - deny     → status=REJECTED → artifact archived or sent back
  - cancel   → status=CANCELLED → approval withdrawn
       ↓
Audit row written
```

Per Rule 3, automation MUST NOT auto-approve. The approval gate is the **human authority**.

---

## Cross-Tab Chips (`CrossTabChips`)

The Overview tab surfaces `CrossTabChips` that link between tabs:

- "Open risks" → switches to Risks tab with filter pre-applied
- "Pending contracts" → switches to Contracts tab
- "Active ADRs" → switches to ADRs tab
- "Latest version" → switches to Versions tab

Each chip is a quick-jump between related content.

---

## Seed Data (Step 58 v2 — assumed running)

The default tenant ships with:

| Artifact | Count | Notes |
|---|---|---|
| ADRs | 6 | 3 published, 2 proposed, 1 superseded |
| API contracts | 5 | 3 openapi, 1 graphql, 1 grpc |
| Risks | 5 | 2 high, 2 medium, 1 low (across 3 registers) |
| Task breakdowns | 2 | 1 from ADR, 1 from contract |
| Approvals | 3 | 2 pending, 1 approved |
| Standards attestations | 4 | 2 active, 1 expiring, 1 expired |
| Versions | 1 | Initial baseline snapshot |

These are seeded via the Step 58 seed script (per-tenant, not in `backend/scripts/`). AI agents must use real counts from the API, not assume these defaults.

---

## Edge cases

| State | Treatment |
|---|---|
| **No ADRs** | Empty state + "Create your first ADR" CTA |
| **ADR in PROPOSED** | Show "AI-generated" badge + "Edit" button |
| **ADR in DRAFT** | Show "Draft" badge + "Save" / "Request approval" |
| **ADR in APPROVED** | Show emerald badge + "Publish" button |
| **ADR in PUBLISHED** | Show "Effective" badge + "Supersede" action |
| **ADR SUPERSEDED** | Show muted badge + link to superseding ADR |
| **ADR superseded without replacement** | Show warning banner |
| **API contract invalid** | Show validation errors with line numbers |
| **Risk with no mitigation** | Show "Unmitigated" badge + auto-suggest mitigation |
| **Risk owner is inactive user** | Show warning banner |
| **Task breakdown with no estimates** | Show "0h" + total estimate rollup |
| **Approval timeout** | After 7 days, auto-deny with reason "No response" |
| **Traceability orphans** | Surface on Overview + warn in approval reviewer |
| **Version diff with breaking changes** | Highlight in rose + require double-approval |
| **Version rollback** | Confirm modal: "This will create a new version. Continue?" |
| **Tech radar stale (no updates in 90d)** | Amber badge + "Refresh" CTA |
| **Diagram generation fails** | Fallback to placeholder + error toast |
| **`prefers-reduced-motion`** | Pulse animations disabled; status dots static |

---

## Forbidden patterns

AI agents modifying Architecture Center MUST NOT:

- ❌ Auto-approve ADRs / contracts / versions — Rule 3 enforcement
- ❌ Bypass LiteLLM proxy for ADR / contract generation — Rule 1
- ❌ Skip tenant scoping — Rule 2
- ❌ Skip audit logging on ADR supersede / approval / rollback — Rule 6
- ❌ Add a new risk `category` without updating the regex pattern in `RiskCreate` schema + RiskRegister UI
- ❌ Add a new `ContractKind` without updating both backend pattern AND frontend `ContractKind` type
- ❌ Skip cross-references in `related_adrs` when superseding — supersession chain must be auditable
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Hardcode risk thresholds — use score buckets (1-5 / 6-12 / 13-25)
- ❌ Hardcode ADR numbers — use per-project auto-incrementing counter

---

## Verification checklist

- [ ] `/architecture` renders 9 tabs with count badges
- [ ] `curl .../architecture/adrs` returns 6 ADRs with valid Bearer token + tenant scope
- [ ] `POST /architecture/adrs` generates a new ADR via LiteLLM (status=PROPOSED)
- [ ] `POST /architecture/adrs/{id}/supersede` creates supersession chain
- [ ] `POST /architecture/contracts` generates OpenAPI / GraphQL / gRPC spec
- [ ] `POST /architecture/contracts/{id}/validate` returns validation errors
- [ ] `POST /architecture/contracts/{id}/publish` creates version snapshot
- [ ] `POST /architecture/risk-registers` creates a register
- [ ] `POST /architecture/risk-registers/{id}/risks` adds a risk
- [ ] Risk score = likelihood × impact (verified in computed column)
- [ ] `GET /architecture/risk-registers/{id}/top?limit=5` returns top 5 risks
- [ ] Risk heat map renders correct color buckets (Low/Med/High)
- [ ] `POST /architecture/task-breakdowns` decomposes ADR into tasks
- [ ] `PATCH /architecture/task-breakdowns/{id}/tasks/{task_id}` updates task estimate
- [ ] Task breakdown tree renders hierarchical structure
- [ ] `GET /architecture/traceability` returns full graph (KG-backed)
- [ ] `GET /architecture/lineage/{type}/{id}` returns upstream + downstream
- [ ] `GET /architecture/orphans` returns orphaned artifacts
- [ ] `GET /architecture/breaking-changes/{contract_id}` returns breaking changes
- [ ] `POST /architecture/versions` creates immutable snapshot
- [ ] `GET /architecture/versions/diff` returns diff between two versions
- [ ] `POST /architecture/versions/rollback` creates new version from old
- [ ] `POST /architecture/standards/attest` creates attestation
- [ ] `GET /architecture/standards/check/{type}/{id}` returns compliance check
- [ ] `POST /architecture/standards/attestations/{id}/revoke` revokes attestation
- [ ] `POST /architecture/acceptance` creates criteria
- [ ] `GET /architecture/coverage` returns coverage report
- [ ] Tech Radar renders 4 quadrants
- [ ] Diagrams Explorer browses generated + uploaded diagrams
- [ ] ADR approval → POST /architecture/approvals/{id}/decide
- [ ] Approval deny → ADR status back to DRAFT
- [ ] CrossTabChips navigate between related content
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — count badge tones
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R4 + R5 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (42 routes)
- [DB schema](../reference/db-schema.md) — `architecture_adrs`, `architecture_api_contracts`, etc.
- [Dashboard](./dashboard.md) — Architecture Health widget
- [Co-pilot](./copilot.md) — "Draft an ADR" action via `draft_artifact` tool
- [Ideation Center](./ideation-center.md) — Push destination for architecture
- [Knowledge Center](./knowledge-center.md) — Traceability backed by KG
- [Audit](./audit.md) — every architecture mutation logged
- [Settings](./settings.md) — Architecture defaults tab
- [Standards attestation](./../standards/coding-standards.md) — Standards + attestation

---

## Maintenance notes

**When to update this doc:**

- A new tab added → update 9-tab list
- A new risk `category` added → update category regex
- A new `ContractKind` added → update contract types
- A new scoring threshold added → update heat map buckets
- An ADR status added → update ADRStatus type

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/architecture/                ←  9 sub-routers (42 routes)
backend/app/db/models/architecture.py           ←  4 tables (ADR + APIContract + TaskBreakdown + RiskRegister)
backend/app/schemas/architecture.py             ←  Pydantic source of truth
backend/app/services/architecture/              ←  8 services (gen, contract, risk, breakdown, trace, version, approval, attestation, acceptance)
         ↓
apps/forge/lib/architecture/data.ts             ←  TypeScript mirror (5 statuses, 4 contract kinds, risk scoring)
apps/forge/lib/architecture/mock-fixtures.ts    ←  Offline MOCK_* fixtures
         ↓
apps/forge/app/architecture/page.tsx            ←  9-tab index
apps/forge/components/architecture/             ←  25+ components (ADRViewer, RiskHeatMap, TraceabilityMatrix, etc.)
```

If any link in this chain drifts, the Architecture Center breaks silently. Always update all links.

---

## Bug fix note (Step 30)

The Step 30 modernization fixed a subtle bug:

> The Step 11 page rendered count badges from `adrs.length` but the empty state when `selected === undefined`. The race was: `selected = adrs.find(...) ?? adrs[0]` would fallback to first ADR, but if the URL pointed to a stale id that wasn't in the new array, the find returned undefined and the fallback was `adrs[0]` which only fires when adrs is non-empty.

The fix: a single `resolveSelected<T>` helper that always returns either the matched record, the first record, or undefined — and the empty state ONLY fires when the source array is truly empty. **Count badge and body never disagree.**

This pattern (`resolveSelected`) is now the canonical pattern for all feature pages with stale-id URLs.