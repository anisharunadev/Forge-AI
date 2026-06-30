# Feature: Stories (Kanban Center)

> **Status:** Wired to real backend (Step 58 Phase 7) — seed script pending
> **Route:** `apps/forge/app/stories/page.tsx`
> **Detail route:** `apps/forge/app/stories/[id]/page.tsx`
> **Root component:** `apps/forge/app/stories/_components/StoriesCenter.tsx`
> **Backend:** `backend/app/api/v1/stories.py`
> **Schemas:** `backend/app/schemas/stories.py`
> **Constitutional rules:** R2 (multi-tenant), R3 (human approval gates — silent transitions), R4 (typed artifacts), R6 (auditability)

---

## Purpose

The Stories Center is the **kanban + lifecycle surface for user stories**. Each story represents a unit of work that an agent (or human) will execute. Stories flow through a 6-stage lifecycle (BACKLOG → TODO → IN_PROGRESS → IN_REVIEW → DONE — with BLOCKED as a side-state), link to Jira tickets, carry acceptance criteria + subtasks, and roll up into epics and sprints.

Per PRD §1.4 the Stories Center serves **tech leads** (planning + assignment), **engineers** (work execution), and **PMs** (status visibility).

---

## Architecture

```
StoriesCenter (root client component)
├── HeroBand (CENTER eyebrow + view toggle: Kanban/List/Timeline/Lifecycle)
├── KPIStrip (5 tiles: Total in sprint / Backlog / In Progress / In Review / Done)
├── FilterBar (sprint scope + search + priority + label + estimate + assignee filters)
├── KanbanBoard (default view, 5 columns, @dnd-kit)
│   ├── KanbanColumn × 5 (Backlog / To Do / In Progress / In Review / Done)
│   └── StoryCard × N (draggable)
├── ListView (alternative view, sortable table)
├── TimelineView (horizontal swimlanes by week)
├── DependencyGraph (story → handoff contracts visualization)
├── StoryDrawer (6-tab drill-down on card click)
│   ├── LifecycleBreadcrumb (full provenance chain)
│   ├── StartImplementationModal (run agent on this story)
│   └── ForgeRunActions
├── NewStoryDialog (create)
├── QuickActionsMenu (bulk operations)
└── ShortcutsHelp (Cmd+/ overlay)
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/stories` | `StoriesCenter` | Main page — kanban + list + timeline |
| `/stories/[id]` | `StoryCard` + `BlockedByList` + `HandoffContractViewer` | Drill-down page |
| `/stories?view=kanban\|list\|timeline\|lifecycle` | query param | Persists view mode |
| `/stories?sprint_id={id}` | query param | Filters by sprint |

### Backend (FastAPI)

All routes use `@audit()` decorator and `require_permission("stories:read")` or `("stories:write")`.

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/stories` | `stories:read` | List stories (filter: `project_id`, `sprint_id`, `status`, `assignee_id`, `search`) |
| `POST` | `/api/v1/stories` | `stories:write` | Create story |
| `GET` | `/api/v1/stories/{id}` | `stories:read` | Get one |
| `PATCH` | `/api/v1/stories/{id}` | `stories:write` | Update (any field) |
| `DELETE` | `/api/v1/stories/{id}` | `stories:write` | Soft-delete (sets `deleted_at`) |
| `PATCH` | `/api/v1/stories/bulk` | `stories:write` | Bulk update (assign sprint, change status, etc.) |
| `GET` | `/api/v1/stories/{id}/linked` | `stories:read` | Get linked Jira + PRs + runs |
| `GET` | `/api/v1/stories/{id}/comments` | `story_comments:read` | List comments |
| `POST` | `/api/v1/stories/{id}/comments` | `story_comments:write` | Add comment |
| `POST` | `/api/v1/stories/{id}/sync-jira` | `stories:write` | Sync to Jira (push status + assignee) |
| `POST` | `/api/v1/stories/{id}/link-jira` | `stories:write` | Link to existing Jira ticket |
| `POST` | `/api/v1/stories/{id}/start-implementation` | `stories:write` | Trigger an agent run on this story |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `stories` | Core story records (title, description, status, priority, estimate) |
| `story_comments` | Comments / discussion on a story |
| `story_links` | Linkage to Jira, GitHub PRs, runs, blocks |
| `epics` | Epic parent (a story belongs to 0 or 1 epic) |
| `sprints` | Sprint parent (a story belongs to 0 or 1 sprint) |
| `audit_events` | Every mutation logged |

### Pydantic schemas (`backend/app/schemas/stories.py`)

- `StoryBase` — `title`, `description`, `status: StoryStatus`, `priority: StoryPriority`, `estimate: StoryEstimate`, `labels`, `epic_id`, `sprint_id`, `assignee_id`, `acceptance_criteria: list[AcceptanceCriterion]`, `subtasks: list[Subtask]`, `linked_items: list[LinkedItem]`
- `StoryCreate` — adds `reporter_id`, `project_id`, `source: StorySource`, `source_id`
- `StoryUpdate` — all fields optional
- `StoryRead` — adds `id`, `tenant_id`, `project_id`, `reporter_id`, `jira_key`, `jira_url`, `jira_synced_at`, `jira_sync_status`, `active_run_id`, `last_run_id`, `run_count`, `source`, `source_id`, `created_at`, `updated_at`
- `StoryBulkUpdate` — `story_ids: list[UUID]`, `patch: StoryUpdate`
- `StoryLinkedRead` — wraps linked Jira / PRs / runs

### Enums (`backend/app/db/models/story.py`)

```python
class StoryStatus(str, enum.Enum):
    BACKLOG = "BACKLOG"
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    IN_REVIEW = "IN_REVIEW"
    QA = "QA"
    DONE = "DONE"
    BLOCKED = "BLOCKED"

class StoryPriority(str, enum.Enum):
    P0 = "P0"   # critical
    P1 = "P1"   # high
    P2 = "P2"   # medium (default)
    P3 = "P3"   # low

class StoryEstimate(str, enum.Enum):
    XS = "XS"
    S = "S"
    M = "M"      # default
    L = "L"
    XL = "XL"

class StorySource(str, enum.Enum):
    MANUAL = "MANUAL"
    JIRA = "JIRA"
    GITHUB = "GITHUB"
    LINEAR = "LINEAR"
    IDEATION = "IDEATION"
    PRD = "PRD"
    AUTO = "AUTO"

class JiraSyncStatus(str, enum.Enum):
    SYNCED = "SYNCED"
    PENDING = "PENDING"
    FAILED = "FAILED"
    DISCONNECTED = "DISCONNECTED"  # default
```

---

## Lifecycle (6-stage, plus BLOCKED side-state)

```
BACKLOG → TODO → IN_PROGRESS → IN_REVIEW → QA → DONE
                ↑                                        ↓
                └──────── BLOCKED ←──────────────────────┘
```

**Per Rule 3 (human approval gates):** Status transitions are **silent and reversible**, never auto-advanced. The user must explicitly drag the card or click the status pill. Auto-advancing past `IN_REVIEW` → `DONE` is forbidden because it crosses a human approval boundary.

`BLOCKED` is a **side-state**, not a column. Stories with `status=BLOCKED` appear in a separate "Blocked" column when "Show blocked column" is toggled.

---

## Kanban Drag-Drop

Implemented with `@dnd-kit/core` + `@dnd-kit/sortable`:

- **PointerSensor** for mouse / touch
- **KeyboardSensor** for accessibility (Space to pickup, arrows to move, Space to drop, Esc to cancel)
- **Optimistic update** via `useUpdateStoryStatus` — PATCH before resolve, rollback on error
- `aria-live="polite"` announces column changes on drop
- Status dot + text paired (never color-only)
- WIP limit highlighted in rose when exceeded (soft block)

---

## Optimistic Update Pattern (Canonical Example)

```typescript
// From useUpdateStoryStatus (apps/forge/lib/query/hooks.ts)
export function useUpdateStoryStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => api.patch<Story>(`/stories/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: storiesQueryKeys.stories.all });
      const previous = qc.getQueriesData<Story[]>({ queryKey: storiesQueryKeys.stories.all });
      // Apply optimistic update
      for (const [key, stories] of previous) {
        qc.setQueryData<Story[]>(key, (old) =>
          old?.map((s) => (s.id === id ? { ...s, status } : s))
        );
      }
      return { previous };  // for rollback
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      for (const [key, stories] of context?.previous ?? []) {
        qc.setQueryData(key, stories);
      }
      toast.error('Failed to update story status');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}
```

**Why optimistic:** Drag-drop must feel instant. Rollback on error preserves correctness.

---

## Start Implementation Flow

User clicks "Start implementation" in the Story Drawer → `StartImplementationModal` opens → user picks an agent + runtime → `POST /stories/{id}/start-implementation` → backend creates a new run linked to this story → user is navigated to the run detail page.

Per Rule 3, if the story is in `BLOCKED` state, the button is disabled with tooltip "Resolve blockers first".

---

## Jira Integration

- `POST /stories/{id}/link-jira?jira_key=PROJ-123` — attach existing Jira ticket
- `POST /stories/{id}/sync-jira` — push status + assignee + comments to Jira
- The `jira_sync_status` field tracks: `DISCONNECTED` → `PENDING` → `SYNCED` or `FAILED`
- `SyncIndicator` component on the story card shows status badge

Requires the Jira connector to be installed (see [Connector Center](./connector-center.md)).

---

## Story Detail Drawer (6 tabs)

| # | Tab | Content |
|---|---|---|
| 1 | **Overview** | Title, description, acceptance criteria, labels, estimate |
| 2 | **Context** | Epic parent + Sprint + Linked Jira + Linked PRs + Handoff contracts |
| 3 | **Implementation** | Subtasks checklist + Start Implementation button + Active run link |
| 4 | **Tests** | Test files linked + coverage status (from Validator) |
| 5 | **Discussion** | Comments thread + @mention autocomplete |
| 6 | **History** | Audit log of every change to this story |

Header carries the **Lifecycle breadcrumb** showing the story's full provenance: `Jira ticket → Idea → PRD → ADR → Story`. This makes the chain visible end-to-end.

---

## KPI Strip (5 tiles)

| Tile | Field | Accent | Shows |
|---|---|---|---|
| Total in sprint | `count(stories where sprint_id = current)` | indigo | "+N this week" delta + sparkline |
| Backlog | `count(stories where status = BACKLOG)` | gray | "across N projects" |
| In Progress | `count(stories where status = IN_PROGRESS)` | cyan | "+N today" delta |
| In Review / QA | `count(stories where status in [IN_REVIEW, QA])` | amber | "−N since yesterday" delta |
| Done this sprint | `count(stories where status = DONE AND sprint_id = current)` | emerald | "N pts · M% of goal" |

---

## Filter Bar

- Sprint scope toggle: Current sprint / All sprints
- "Show blocked column" toggle (default off)
- Search input (matches title + description)
- Priority chips: `P0 / P1 / P2 / P3`
- Label chips: configurable
- Estimate chips: `XS (1) / S (2) / M (3) / L (5) / XL (8)` (Fibonacci)
- Assignee avatars
- Clear filters button

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Pick up / drop card (drag-drop) |
| `↑ ↓ ← →` | Move picked-up card |
| `Esc` | Cancel pickup |
| `N` | New story (opens `NewStoryDialog`) |
| `/` | Focus search |
| `F` | Toggle filter bar |
| `B` | Toggle blocked column |
| `1 / 2 / 3 / 4` | Switch view (Kanban / List / Timeline / Lifecycle) |
| `Cmd+/` | Show shortcuts help |

All shortcuts honor `isContentEditable` and `isMac` so they don't hijack text inputs.

---

## Edge cases

| State | Treatment |
|---|---|
| **No stories** | `EmptyState` component: "No stories yet" + "New Story" CTA + suggestions ["Code reviewer","Test runner","Doc generator"] |
| **Loading (initial fetch)** | `BoardSkeleton` — 5 column skeletons with shimmer |
| **Drag-drop error (network)** | Rollback optimistic update + toast: "Failed to update story — retry" |
| **Filter result is empty** | Compact EmptyState: "No stories match the current filters" + "Clear filters" CTA |
| **Story in BLOCKED state** | Card has rose accent border + tooltip "Blocked: <reason>" + "Resolve" quick action |
| **Jira sync fails** | SyncIndicator shows red badge + "Retry sync" action; doesn't block local state changes |
| **Bulk update partial failure** | Returns list of successes; toast shows "Updated N, M failed" |
| **Permission denied** | Backend returns 403; UI hides write actions (create / edit / drag) |
| **Tenant switch** | Every query key carries `tenant_id`; refetch via TanStack Query invalidation |
| **`prefers-reduced-motion`** | Drag-drop animations disabled; status changes snap directly |

---

## Forbidden patterns

AI agents modifying Stories MUST NOT:

- ❌ Auto-advance a story past `IN_REVIEW` → `DONE` (crosses human approval boundary, Rule 3)
- ❌ Auto-advance a `BLOCKED` story to anything without user action
- ❌ Use direct SDK imports for Jira calls — use the connector framework
- ❌ Skip `@audit()` on story mutations
- ❌ Skip `require_permission("stories:write")` on create / update / delete / bulk
- ❌ Skip tenant scoping — every query carries `tenant_id` from JWT
- ❌ Hardcode story statuses — use the `StoryStatus` enum (7 values)
- ❌ Hardcode priorities — use `StoryPriority` (4 values)
- ❌ Hardcode estimates — use `StoryEstimate` (5 values)
- ❌ Bypass optimistic update — drag-drop MUST be instant; rollback on error
- ❌ Use spinners for loading — use `BoardSkeleton` with shimmer
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Add new fields to `StoryRead` without updating lock-step: schemas → hooks types → mapper → UI
- ❌ Create stories without a `project_id` — every story belongs to a project

---

## Verification checklist

- [ ] `apps/forge/app/stories/page.tsx` renders with kanban / list / timeline / lifecycle views
- [ ] `curl .../stories` returns ~30 stories with valid Bearer token + tenant scope (after running seed script — see NOTE below)
- [ ] `curl .../stories?status=BACKLOG` returns backlog subset
- [ ] `curl .../stories?project_id=X&sprint_id=Y` returns sprint-scoped subset
- [ ] `POST /stories` creates a new story that appears in the BACKLOG column
- [ ] `PATCH /stories/{id}` with `{status: "IN_PROGRESS"}` moves the card optimistically
- [ ] `PATCH /stories/bulk` with multiple story_ids updates all in one round-trip
- [ ] Drag-drop between columns triggers PATCH and persists on refresh
- [ ] Filter chips update the query in real-time (TanStack Query refetch)
- [ ] KPI strip shows real counts (Total: 30, In Progress: 4, etc.)
- [ ] Story drawer opens on card click, shows 6 tabs with real data
- [ ] "Start implementation" button calls POST and navigates to run detail
- [ ] Jira sync shows status badge (DISCONNECTED / PENDING / SYNCED / FAILED)
- [ ] Keyboard navigation works (Space pickup, arrows move, Space drop, Esc cancel)
- [ ] `prefers-reduced-motion` disables drag animations
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Tenant switch refetches all stories
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## ⚠️ NOTE — Seed script pending

The current codebase has:
- ✅ `backend/scripts/seed_agents.py` (6 agents + 4 providers + 2 runtimes)
- ❌ `backend/scripts/seed_stories.py` — **MISSING**

The Step 58 v2 prompt was supposed to create this, but the test script `test_stories_api.py` was the only artifact committed. To populate stories for the demo tenant, run:

```python
# backend/scripts/seed_stories.py (TO BE CREATED)
# Inserts ~30 stories with statuses:
#   5 BACKLOG, 8 TODO, 4 IN_PROGRESS, 2 IN_REVIEW, 3 QA, 6 DONE, 3 BLOCKED
# Across 2 sprints (sp-25-13 active, sp-25-14 planning)
# Linked to 3 epics (Multi-tenant query isolation, LiteLLM proxy integration, etc.)
# Some linked to Jira (FORA-1234 etc.)
```

When this script is run, the Stories Center will populate with real data. Until then, the page will show the empty state.

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — Story status colors, kanban spacing
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R3 approval gates
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list
- [DB schema](../reference/db-schema.md) — `stories`, `story_comments`, `story_links`
- [Dashboard](./dashboard.md) — Dashboard KPI strip + your-stories widgets
- [Agent Center](./agent-center.md) — Stories link to active runs started by agents
- [Workflows](./workflows.md) — Stories can trigger workflow runs via "Start implementation"
- [Connector Center](./connector-center.md) — Jira connector required for Jira sync
- [Runs](./runs.md) — `start-implementation` creates a run
- [Project Intelligence](./project-intelligence.md) — Stories belong to epics + sprints

---

## Maintenance notes

**When to update this doc:**

- A new `StoryStatus` added → update lifecycle diagram + kanban column list
- A new story source added → update `StorySource` enum
- A new bulk operation added → update bulk update route
- A new Jira sync event added → update Jira Integration section
- A new keyboard shortcut added → update shortcuts table

**Files to keep in sync (the lock-step triangle):**

```
backend/app/schemas/stories.py            ←  source of truth (Pydantic)
backend/app/db/models/story.py            ←  Story + 4 enums
         ↓
apps/forge/lib/api/stories.ts             ←  TypeScript types
apps/forge/lib/query/hooks.ts             ←  TanStack Query hooks
         ↓
apps/forge/lib/stories/mapper.ts          ←  wire → UI shape adapter
         ↓
apps/forge/app/stories/_components/       ←  UI components
```

If any link in this chain drifts, the Stories Center breaks silently. Always update all four.