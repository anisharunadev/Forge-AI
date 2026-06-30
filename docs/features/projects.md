# Feature: Projects (Project Intelligence + Epics + Sprints + Stories)

> **Status:** Wired to real backend (Step 58 Phase 6) + Step 20 modernization
> **Route:** `apps/forge/app/project-intelligence/page.tsx` (landing) + `apps/forge/app/project-onboarding/page.tsx` (wizard)
> **Sub-routes:** `apps/forge/app/project-intelligence/epics/[id]/page.tsx` + `drafts/[id]/page.tsx`
> **Backend:** `backend/app/api/v1/projects.py` (4 routes) + `backend/app/api/v1/stories.py` (12 routes for stories + 4 for sprints + 1 for epics = **17 routes**)
> **Constitutional rules:** R2 (multi-tenant), R3 (human approval for changes), R4 (typed artifacts), R6 (auditability)

---

## Purpose

The Projects surface is the **canonical project container** in Forge. A Project is the per-tenant container that owns epics, sprints, stories, briefs, drafts, and all project-scoped artifacts.

Per PRD §1.4 the Projects surface serves **all four personas** — engineers (stories), tech leads (epics + sprints), PMs (briefs + drafts), stewards (audit).

**Key capabilities:**

**Project Intelligence (`/project-intelligence`):**
- **4 views** — All / Mine / At-risk / Recent
- **3 stages** — Dev / QA / DevOps
- **4-tile KPI strip** with sparklines (stories in flight, completed this sprint, at risk, blocked)
- **Two-column bento** — left: typed artifacts (epics, briefs, drafts, active stories); right: metrics (velocity, burndown, team load, recent activity)
- **Persona-gated** — PM full chrome; eng-lead / cto audit read-only
- **Day-one bootstrap** — first-time setup wizard with `/{project_id}/bootstrap` background job

**Project Onboarding (`/project-onboarding`):**
- Multi-step wizard for new project setup
- Reads from `backend/app/services/project_onboarding/wizard.py`

**Epics:**
- **6 statuses** — Planning / In-progress / On-track / At-risk / Blocked / Completed
- Hierarchy: Epic → Stories
- Auto-progress rollup (% complete from stories)

**Sprints:**
- **3 statuses** — Planning / Active / Completed
- Time-boxed (start_date + end_date)
- Story capacity tracking (total_points + completed_points)
- "Current sprint" shortcut

**Stories:**
- **7 statuses** — Backlog / Todo / In-progress / In-review / QA / Done / Blocked
- **4 priorities** — P0 / P1 / P2 / P3
- **5 estimates** — XS / S / M / L / XL
- **6 sources** — Manual / Jira / GitHub / Linear / Ideation / PRD / Auto
- **5 Jira sync statuses** — Synced / Pending / Conflict / Failed / Disconnected
- Bulk updates, comments, linked artifacts (PRDs, ADRs, ideas, epics, runs)
- Run tracking (`active_run_id`, `last_run_id`, `run_count`)

---

## Architecture

```
ProjectIntelligencePage (/project-intelligence)
└── Modernized landing surface (Step 20)
    ├── Sticky project context bar (selector + breadcrumbs + actions)
    ├── Animated-gradient hero band + view toggle
    ├── KPI strip (4 tiles + sparklines)
    └── Two-column bento
        ├── Left: typed artifacts (epics / briefs / drafts / active stories)
        └── Right: metrics (velocity / burndown / team load / activity)

ProjectOnboardingPage (/project-onboarding)
└── Multi-step wizard for new project setup

EpicDetailPage (/project-intelligence/epics/[id])
└── Epic view + stories list + progress

DraftDetailPage (/project-intelligence/drafts/[id])
└── Draft PRD view + edit + submit for review

[Stories managed inline via Kanban in Ideas tab + Stories tab]
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/project-intelligence` | ProjectIntelligence | Landing surface |
| `/project-onboarding` | ProjectOnboarding | New project wizard |
| `/project-intelligence/epics/[id]` | EpicDetail | Single epic + stories |
| `/project-intelligence/drafts/[id]` | DraftDetail | Draft PRD view |

### Backend (FastAPI)

#### Projects (`backend/app/api/v1/projects.py`) — 4 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/projects/{id}/bootstrap` | `projects:write` | Day-one bootstrap (returns 202 + BootstrapResult) |
| `GET` | `/api/v1/projects/{id}/bootstrap` | `projects:read` | Read bootstrap result |
| `GET` | `/api/v1/projects/{id}/bootstrap/status` | `projects:read` | Read bootstrap progress |
| `POST` | `/api/v1/projects/{id}/bootstrap/rerun` | `projects:write` | Re-run bootstrap |

#### Stories (`backend/app/api/v1/stories.py` — `router`) — 12 routes

Prefix: `/api/v1`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/stories` | List stories (filter by status / priority / epic / sprint) |
| `POST` | `/api/v1/stories` | Create story |
| `GET` | `/api/v1/stories/{id}` | Get one story |
| `PATCH` | `/api/v1/stories/{id}` | Update story |
| `DELETE` | `/api/v1/stories/{id}` | Archive (soft-delete) |
| `PATCH` | `/api/v1/stories/bulk` | Bulk update (reorder / mass-transition) |
| `GET` | `/api/v1/stories/{id}/linked` | Get linked artifacts (PRDs, ADRs, ideas, epics, runs) |
| `GET` | `/api/v1/stories/{id}/comments` | List comments |
| `POST` | `/api/v1/stories/{id}/comments` | Add comment |
| `POST` | `/api/v1/stories/{id}/sync-jira` | Trigger Jira sync |
| `POST` | `/api/v1/stories/{id}/link-jira` | Link to existing Jira issue |
| `POST` | `/api/v1/stories/{id}/unlink-jira` | Unlink from Jira |

> ⚠️ URL fix from Step 63: backend serves `/stories/stories` (router prefix `/stories` + path `/stories`). Frontend hooks updated to call this.

#### Sprints (`backend/app/api/v1/stories.py` — `sprints_router`) — 4 routes

Prefix: `/api/v1/sprints`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/sprints` | List sprints (filter by status / project) |
| `GET` | `/api/v1/sprints/current` | Get current active sprint |
| `POST` | `/api/v1/sprints` | Create sprint |
| `POST` | `/api/v1/sprints/{id}/start` | Transition PLANNING → ACTIVE |

#### Epics (`backend/app/api/v1/stories.py` — `epics_router`) — 1 route

Prefix: `/api/v1/epics`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/epics` | List epics (filter by project / status) |

> **NOTE:** Epic routes are currently read-only via this endpoint. Mutations go through story mutations (which update `epic_id`). Full epic CRUD planned for a future iteration.

**Total: 4 projects + 12 stories + 4 sprints + 1 epic = 21 routes**

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `projects` | Per-tenant project container |
| `tenants` | Tenant (FK target for projects) |
| `epics` | Epic records |
| `sprints` | Sprint records |
| `stories` | Story records |
| `comments` | Per-story comments |
| `audit_events` | Every mutation logged |

### Projects table (`backend/app/db/models/project.py`)

```python
class Project(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "projects"
    tenant_id: UUID       # FK to tenants.id (Rule 2 — never optional)
    name: str             # max 200 chars
    slug: str             # max 64 chars, indexed
    status: str           # default "active"
    settings: dict        # JSONB
```

### Epics table (`backend/app/db/models/story.py`)

```python
class Epic(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "epics"
    tenant_id: UUID
    project_id: UUID
    title: str
    description: Optional[str]
    status: EpicStatus          # 6 values
    start_date: Optional[datetime]
    target_date: Optional[datetime]
    progress: float             # 0-100, computed from stories
    story_count: int            # computed
    completed_story_count: int  # computed
```

### Sprints table

```python
class Sprint(Base, ...):
    __tablename__ = "sprints"
    tenant_id: UUID
    project_id: UUID
    name: str
    goal: Optional[str]
    start_date: datetime
    end_date: datetime
    status: SprintStatus       # 3 values
    story_ids: list[UUID]
    total_points: int          # sum of story estimates
    completed_points: int      # sum of DONE story estimates
```

### Stories table

```python
class Story(Base, ...):
    __tablename__ = "stories"
    tenant_id: UUID
    project_id: UUID
    reporter_id: UUID
    title: str
    description: Optional[str]
    status: StoryStatus            # 7 values
    priority: StoryPriority        # 4 values
    estimate: Optional[StoryEstimate]  # 5 values
    epic_id: Optional[UUID]
    sprint_id: Optional[UUID]
    assignee_id: Optional[UUID]
    source: StorySource            # 6 values (MANUAL / JIRA / GITHUB / LINEAR / IDEATION / PRD / AUTO)
    source_id: Optional[str]
    jira_key: Optional[str]
    jira_url: Optional[str]
    jira_synced_at: Optional[datetime]
    jira_sync_status: StoryJiraSyncStatus  # 5 values (SYNCED / PENDING / CONFLICT / FAILED / DISCONNECTED)
    active_run_id: Optional[UUID]
    last_run_id: Optional[UUID]
    run_count: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
```

### Enums (`backend/app/db/models/story.py`)

**`StoryStatus` (7):**
```python
BACKLOG = "BACKLOG"
TODO = "TODO"
IN_PROGRESS = "IN_PROGRESS"
IN_REVIEW = "IN_REVIEW"
QA = "QA"
DONE = "DONE"
BLOCKED = "BLOCKED"
```

**`StoryPriority` (4):**
```python
P0 = "P0"
P1 = "P1"
P2 = "P2"
P3 = "P3"
```

**`StoryEstimate` (5):**
```python
XS = "XS"
S = "S"
M = "M"
L = "L"
XL = "XL"
```

**`StorySource` (6):**
```python
MANUAL = "MANUAL"
JIRA = "JIRA"
GITHUB = "GITHUB"
LINEAR = "LINEAR"
IDEATION = "IDEATION"
PRD = "PRD"
AUTO = "AUTO"
```

**`JiraSyncStatus` (5):**
```python
SYNCED = "SYNCED"
PENDING = "PENDING"
CONFLICT = "CONFLICT"
FAILED = "FAILED"
DISCONNECTED = "DISCONNECTED"
```

**`SprintStatus` (3):**
```python
PLANNING = "PLANNING"
ACTIVE = "ACTIVE"
COMPLETED = "COMPLETED"
```

**`EpicStatus` (6):**
```python
PLANNING = "PLANNING"
IN_PROGRESS = "IN_PROGRESS"
ON_TRACK = "ON_TRACK"
AT_RISK = "AT_RISK"
BLOCKED = "BLOCKED"
COMPLETED = "COMPLETED"
```

---

## ProjectIntelligence 4 Views + 3 Stages

**Views (URL param `?view=...`):**
- `all` — All stories in current project
- `mine` — Stories assigned to me
- `at-risk` — Stories in BLOCKED status or past due
- `recent` — Stories updated in last 7 days

**Stages (URL param `?stage=...`):**
- `dev` — Backlog → Todo → In-progress → In-review
- `qa` — QA → Done
- `devops` — Deploy-related (filtered by label/tag)

**Persona gating:**
- `pm` — Full chrome (create / edit / delete / bulk update)
- `eng-lead` — Read + audit + assign
- `cto` — Read-only audit

---

## Sprint Lifecycle

```
PLANNING (stories added, capacity set)
    ↓ [POST /sprints/{id}/start]
ACTIVE (clock running, burndown visible)
    ↓ [end_date reached, auto-transition]
COMPLETED (velocity calculated, retro triggered)
```

**Current sprint shortcut:** `GET /api/v1/sprints/current` returns the most recent `ACTIVE` sprint or the next `PLANNING` sprint if none active.

**Capacity tracking:**
- `total_points` = sum of story estimates in the sprint
- `completed_points` = sum of estimates for stories with status=`DONE`
- `burndown` = remaining points over time

---

## Epic Rollup

Epics auto-compute progress from their stories:

```
progress = completed_story_count / story_count × 100

Epic.status derivation:
  - story_count = 0           → PLANNING
  - 0 < progress < 50         → IN_PROGRESS
  - 50 ≤ progress < 100       → ON_TRACK
  - any BLOCKED stories       → AT_RISK (if not AT_RISK already)
  - 100%                      → COMPLETED
```

---

## Story Linked Artifacts

`GET /api/v1/stories/{id}/linked` returns:

```python
class StoryLinkedRead(BaseModel):
    prds: list[dict[str, str]]      # [{id, title}]
    adrs: list[dict[str, str]]      # [{id, title}]
    ideas: list[dict[str, str]]     # [{id, title}]
    epics: list[dict[str, str]]     # [{id, title}]
    runs: list[dict[str, str]]      # [{id, status, cost_usd}]
```

These come from KG joins. Per Rule 5, traceability is KG-backed.

---

## Story Run Tracking

Each story tracks its run history:

| Field | Meaning |
|---|---|
| `active_run_id` | Currently-running workflow run (NULL if not running) |
| `last_run_id` | Most recent run (any status) |
| `run_count` | Total runs (including failed) |
| `started_at` | First transition to IN_PROGRESS |
| `completed_at` | First transition to DONE |

When `start implementation` is clicked, a new workflow run is created and `active_run_id` is set. When the run reaches DONE or FAILED, `active_run_id` is cleared and `last_run_id` is set.

---

## Comments

Per-story comment thread:

```python
class CommentRead(BaseModel):
    id: UUID
    tenant_id: UUID
    story_id: UUID
    author_id: UUID
    body: str
    created_at: datetime
```

`GET /stories/{id}/comments` lists in chronological order.
`POST /stories/{id}/comments` adds a new comment.

---

## Bulk Updates

`PATCH /api/v1/stories/bulk` accepts:

```python
class StoryBulkUpdate(BaseModel):
    updates: list[dict[str, Any]]  # [{id, status?, priority?, assignee_id?, sprint_id?}]
```

Used for:
- Reorder via drag-drop in Kanban
- Mass-transition (e.g., all `BLOCKED` → `TODO`)
- Sprint assignment (add N stories to sprint at once)

Optimistic concurrency: each story in the batch carries its `updated_at`; conflict returns 409 per-story.

---

## Jira Sync

Three routes:

| Method | Path | Description |
|---|---|---|
| `POST` | `/stories/{id}/sync-jira` | Trigger sync (if `jira_key` exists) |
| `POST` | `/stories/{id}/link-jira` | Link to existing Jira issue (sets `jira_key`) |
| `POST` | `/stories/{id}/unlink-jira` | Unlink (clears `jira_key`) |

**Sync status transitions:**
```
DISCONNECTED → (link-jira) → SYNCED
SYNCED → (user edits story) → PENDING
PENDING → (sync-jira succeeds) → SYNCED
PENDING → (sync-jira fails) → FAILED
SYNCED + (user edits in Jira) → CONFLICT (manual reconcile required)
```

---

## Day-One Bootstrap

For new projects, `POST /api/v1/projects/{id}/bootstrap` triggers a background job that:

1. Creates default sprint (PLANNING)
2. Seeds sample epics + stories (per project type)
3. Sets up integrations defaults
4. Returns `BootstrapResult` immediately (status 202)

`GET /api/v1/projects/{id}/bootstrap/status` polls progress:

```python
class BootstrapStatusRead(BaseModel):
    status: str            # 'running' | 'completed' | 'failed'
    progress: float        # 0-100
    current_step: str      # 'creating_sprints' | 'seeding_epics' | 'integrations'
    error: str | None
```

`POST /api/v1/projects/{id}/bootstrap/rerun` re-runs (only if previous failed).

---

## Seed Data (Step 58 v2 — assumed running)

The default tenant ships with **3 projects + 5 epics + 3 sprints + ~30 stories**:

| Project | Slug | Status | Stories |
|---|---|---|---|
| **Acme Platform** | `acme-platform` | active | 18 |
| **Mobile App v3** | `mobile-v3` | active | 8 |
| **Workflow Editor v2** | `workflow-editor-v2` | active | 4 |

**Epics (5):**
1. Authentication & RBAC (Acme Platform, IN_PROGRESS, 60%)
2. Story Lifecycle (Acme Platform, ON_TRACK, 80%)
3. Mobile Onboarding (Mobile App v3, PLANNING, 0%)
4. Workflow Canvas (Workflow Editor v2, IN_PROGRESS, 35%)
5. Connector Sync v2 (Acme Platform, AT_RISK, 25% — blocked stories)

**Sprints (3):**
1. Sprint 23 (Acme Platform, ACTIVE, 7d remaining, 18 points / 32 total)
2. Sprint 24 (Acme Platform, PLANNING, 14d planned, 24 points)
3. Mobile Sprint 7 (Mobile App v3, ACTIVE, 4d remaining, 12 points / 20 total)

**Stories (~30):**
- Mix of all 7 statuses, all 4 priorities, all 5 estimates
- 5 linked to Jira (jira_key populated)
- 3 with `active_run_id` set (running)
- 2 with `BLOCKED` status

---

## Edge cases

| State | Treatment |
|---|---|
| **No projects** | Empty state + "Create your first project" CTA |
| **Project without bootstrap** | Banner: "Bootstrap not run" + "Run now" button |
| **Bootstrap running** | Progress bar + current_step + cancel button |
| **Bootstrap failed** | Red banner + error + "Retry" button |
| **Sprint with no stories** | "0 points" + "Add stories" CTA |
| **Sprint past end_date** | Auto-transition to COMPLETED + velocity calculated |
| **Story assigned to past sprint** | Warning banner + auto-suggest move |
| **Story BLOCKED for >7 days** | At-risk view highlights + notification |
| **Jira sync conflict** | Manual reconcile UI: "Forge says X, Jira says Y" |
| **Jira sync failed** | Retry button + error details |
| **Bulk update partial failure** | Per-story error reporting + rollback |
| **Comment by archived user** | Show as "Former teammate" |
| **`prefers-reduced-motion`** | Sparkline animations disabled; gradient hero static |

---

## Forbidden patterns

AI agents modifying Projects MUST NOT:

- ❌ Bypass tenant scoping on any project query — Rule 2
- ❌ Skip audit logging on story / sprint / epic mutations — Rule 6
- ❌ Auto-transition `BLOCKED` stories to `TODO` — require human intervention
- ❌ Skip bootstrap progress check before allowing mutations
- ❌ Use the wrong URL prefix (`/stories` vs `/stories/stories`) — Step 63 fix
- ❌ Skip optimistic concurrency check on bulk updates
- ❌ Auto-resolve Jira sync conflicts — always require manual reconcile
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Skip RBAC persona gating on ProjectIntelligence (`pm` vs `eng-lead` vs `cto`)

---

## Verification checklist

- [ ] `/project-intelligence` renders 4-view + 3-stage layout
- [ ] `?view=mine` filters to current user's stories
- [ ] `?view=at-risk` shows BLOCKED stories
- [ ] `?view=recent` shows last-7-days stories
- [ ] `?stage=dev` / `qa` / `devops` filters by stage
- [ ] Persona cookie gates UI chrome (pm full, eng-lead/cto read-only)
- [ ] `curl .../stories` returns ~30 seeded stories
- [ ] `POST /stories` creates new story with status=BACKLOG
- [ ] `PATCH /stories/{id}` updates status (optimistic)
- [ ] `PATCH /stories/bulk` accepts array of updates
- [ ] `GET /stories/{id}/linked` returns PRD + ADR + idea + epic + run links
- [ ] `GET /stories/{id}/comments` lists comments chronologically
- [ ] `POST /stories/{id}/comments` adds comment
- [ ] `POST /stories/{id}/link-jira` sets jira_key
- [ ] `POST /stories/{id}/sync-jira` triggers sync (status PENDING → SYNCED)
- [ ] `POST /stories/{id}/unlink-jira` clears jira_key
- [ ] `GET /sprints` lists 3 seeded sprints
- [ ] `GET /sprints/current` returns ACTIVE sprint
- [ ] `POST /sprints` creates new sprint (PLANNING)
- [ ] `POST /sprints/{id}/start` transitions PLANNING → ACTIVE
- [ ] `GET /epics` lists 5 seeded epics with progress rollup
- [ ] `POST /projects/{id}/bootstrap` returns 202 with BootstrapResult
- [ ] `GET /projects/{id}/bootstrap/status` returns progress
- [ ] `POST /projects/{id}/bootstrap/rerun` re-runs (only on previous failure)
- [ ] `/project-onboarding` wizard renders multi-step setup
- [ ] Epic detail page shows stories + progress
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — KPI tile design
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R2 + R3 + R4 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (21 routes)
- [DB schema](../reference/db-schema.md) — `projects`, `epics`, `sprints`, `stories`
- [Dashboard](./dashboard.md) — "Active sprints" + "Stories in flight" widgets
- [Stories](./stories.md) — sibling feature with deeper detail
- [Workflows](./workflows.md) — Stories trigger workflow runs (`active_run_id`)
- [Runs](./runs.md) — Active runs link to stories
- [Ideation Center](./ideation-center.md) — Push idea → PRD → Story
- [Agent Center](./agent-center.md) — Stories can dispatch to agents
- [Connector Center](./connector-center.md) — Jira sync via connectors
- [Co-pilot](./copilot.md) — "What's the status of story X?" via tool calls
- [Settings](./settings.md) — Project defaults tab
- [Audit](./audit.md) — every mutation logged

---

## Maintenance notes

**When to update this doc:**

- A new `StoryStatus` added → update 7-status table
- A new `StoryPriority` added → update 4-priority table
- A new `StorySource` added → update 6-source table
- A new epic mutation route added → update 1-route note (currently read-only)
- A new view or stage added → update 4-view + 3-stage list

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/projects.py                ←  4 bootstrap routes
backend/app/api/v1/stories.py                 ←  12 stories + 4 sprints + 1 epic = 17 routes (3 routers)
backend/app/db/models/project.py              ←  Project table
backend/app/db/models/story.py                ←  Epic + Sprint + Story tables + 6 enums
backend/app/schemas/stories.py                ←  Pydantic source of truth
backend/app/services/project_onboarding/      ←  Wizard service
backend/app/services/project_intelligence/    ←  9 services (architecture, asset ingestion, etc.)
         ↓
apps/forge/lib/intelligence/data.ts           ←  Frontend data shapes
apps/forge/lib/intelligence/rbac.ts           ←  Persona RBAC
apps/forge/hooks/useStories.ts                ←  TanStack Query hooks (URL fix from Step 63)
         ↓
apps/forge/app/project-intelligence/page.tsx  ←  Landing surface (Step 20)
apps/forge/app/project-intelligence/epics/[id]/page.tsx  ←  Epic detail
apps/forge/app/project-intelligence/drafts/[id]/page.tsx ←  Draft PRD
apps/forge/app/project-onboarding/page.tsx    ←  New project wizard
```

If any link in this chain drifts, the Projects surface breaks silently. Always update all links.

---

## ⚠️ URL fix from Step 63 (IMPORTANT)

The Stories frontend was calling `/stories` but the backend serves `/stories/stories` (router prefix `/stories` + path `/stories`). Fixed in `useStories` hook URL template.

**Backend mounts:**
- `router` (no prefix) → `/api/v1/stories/*`
- `sprints_router` (prefix `/sprints`) → `/api/v1/sprints/*`
- `epics_router` (prefix `/epics`) → `/api/v1/epics/*`

**Frontend must use:**
- `useStories` → `/api/v1/stories` (NOT `/stories`)
- `useSprints` → `/api/v1/sprints`
- `useEpics` → `/api/v1/epics`

AI agents must not assume a single-prefix router. Each router has its own prefix, and the stories router happens to add `/stories` twice.