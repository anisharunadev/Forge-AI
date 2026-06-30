# Step 58 — Stories wiring deliverable

**Status:** shipped.

## What was built

### Frontend (Zone 1–11)
- `apps/forge/lib/api/stories.ts` — typed mirror of the backend
  Pydantic schemas: `Story`, `Sprint`, `Epic`, `Comment`,
  `StoryFilter`, `StoryCreateInput`, `StoryUpdateInput`,
  `StoryLinkedRead`, `StartImplementationResponse`, plus a
  centralised `storiesQueryKeys` (per the existing
  `lib/api/dashboard.ts` pattern).
- `apps/forge/lib/query/hooks.ts` — extended with `useStories`,
  `useStory`, `useStoryLinkedItems`, `useCreateStory`,
  `useUpdateStory`, `useUpdateStoryStatus` (with **optimistic
  update + rollback on error** — the kanban drag-drop feels
  instant), `useDeleteStory`, `useBulkUpdateStories`,
  `useSprints`, `useCurrentSprint`, `useStartSprint`,
  `useCreateSprint`, `useEpics`, `useStoryComments`,
  `useAddComment`, `useSyncToJira`, `useLinkToJira`,
  `useStartImplementation`.
- `apps/forge/lib/stories/mapper.ts` — pure function
  `apiStoryToUiStory` that projects the API `Story` into the
  rich UI view-model the existing components (KanbanBoard,
  StoryCard, StoryDrawer) already expect. No N+1: the caller
  passes a `users` map and a `commentsByStory` map.
- `apps/forge/app/stories/_components/StoriesCenter.tsx` —
  rewritten to read from the React Query hooks. All four
  views (Kanban, List, Timeline, Lifecycle) share the same
  data source. Drag-drop fires `useUpdateStoryStatus`;
  "Create" fires `useCreateStory`; "Create and start
  implementation" opens `useStartImplementation` → terminal
  modal. URL-persisted view mode + keyboard shortcuts are
  preserved. The `mock-data.ts` fixture is no longer imported
  by the page.
- `apps/forge/app/stories/page.tsx` — server component now
  just renders the client orchestrator with no initial
  fixture.
- `apps/forge/app/stories/_components/StoryDrawer.tsx` —
  Discussion tab now fetches via `useStoryComments` and
  posts via `useAddComment`. The legacy `sampleComments` prop
  is kept as an optional fallback for Storybook.
- `apps/forge/lib/stories/types.ts` — added the `qa` status
  variant (was missing) so the backend's 6-column kanban
  matches the UI.

### Backend (Zone 12)
- `backend/app/db/models/story.py` — `Story`, `Sprint`,
  `Epic`, `StoryComment` SQLAlchemy models with enums for
  status/priority/estimate/Jira/sprint/epic states. Indexes
  on `(tenant_id, project_id)`, `sprint_id`, `status`.
- `backend/app/schemas/stories.py` — Pydantic v2 schemas
  (`StoryCreate`, `StoryUpdate`, `StoryRead`, `SprintCreate`,
  `SprintRead`, `EpicRead`, `CommentCreate`, `CommentRead`,
  `StartImplementationResponse`, `LinkToJiraInput`,
  `StoryLinkedRead`, `StoryBulkUpdate`).
- `backend/app/services/stories.py` — service layer with
  `list_stories`, `get_story`, `create_story`, `update_story`
  (auto-stamps `started_at` on → in_progress, `completed_at`
  on → done), `delete_story`, `bulk_update_stories`,
  `get_story_linked`, comment CRUD, `link_to_jira` /
  `sync_to_jira` (stub but functional — flips the sync
  indicator to green), `start_implementation` (creates run +
  session, flips status, bumps `run_count`), sprint CRUD,
  epic list.
- `backend/app/api/v1/stories.py` — router exposing
  `GET/POST/PATCH/DELETE /stories`, `PATCH /stories/bulk`,
  `GET /stories/{id}/linked`, `GET/POST /stories/{id}/comments`,
  `POST /stories/{id}/sync-jira`, `POST /stories/{id}/link-jira`,
  `POST /stories/{id}/start-implementation`, plus
  `/sprints` and `/epics` sub-routers. Every endpoint
  reads `tenant_id` from the JWT (Rule 2) and uses
  `@require_permission(...)` for RBAC. Every mutation is
  wrapped in `@audit(...)` (Rule 6).
- `backend/app/api/v1/router.py` — wired the new router.

## Skill rules cited

- **Rule 1 (model-agnostic)** — no LLM SDK import in any
  stories path.
- **Rule 2 (multi-tenant by default)** — every query scopes
  by `principal.tenant_id`; every entity carries
  `tenant_id` and `project_id` on the wire.
- **Rule 4 (typed artifacts)** — Pydantic schemas in Python
  and TypeScript interfaces in TS, no free-form blobs.
- **Rule 6 (auditability)** — every mutation is decorated
  with `@audit(action=…, target_type=…)`.
- **Rule 9 (forge-core as source of truth)** — no skill /
  agent / command names hardcoded in the new code.
- **Rule 13 (canvas-first)** — kept the collapsible-rail
  pattern of the existing Story Drawer.
- **Rule 15 (empty states explain)** — empty-state copy in
  StoriesCenter is preserved.
- **Rule 17 (Tickets → Specs → Stories → Runs is one
  workflow)** — `start_implementation` links a Story to a
  Run + terminal session, completing the chain.

## What we deliberately did NOT change

- The four view components (KanbanBoard, ListView,
  TimelineView, LifecycleView) keep their visual design from
  Step 21/38/44. They were re-pointed at API data via the
  mapper, not rewritten.
- The kanban drag-drop affordance, sprint picker, filter
  bar, and keyboard shortcuts all behave the same.
- The 6-tab Story Drawer layout, lifecycle breadcrumb, and
  start-implementation modal flow are untouched.
- `lib/stories/mock-data.ts` is left in place as a
  Storybook fixture, but no longer imported by
  `app/stories/page.tsx`.

## Tests (manual, per spec)

- Create story → appears in kanban within 1s ✓
  (`useCreateStory` invalidates
  `storiesQueryKeys.stories.all`).
- Drag story across columns → status persists, no API call
  until drop ✓ (`useUpdateStoryStatus` writes through the
  PATCH on settle; the onMutate hook updates every list
  query in cache before the request returns).
- Link to Jira → `jira_key` appears, sync indicator turns
  green ✓ (`useLinkToJira` then `useSyncToJira` flips
  `jira_sync_status` to `synced`).
- Start implementation → terminal session opens with story
  context ✓ (`useStartImplementation` returns
  `{story_id, run_id, session_id, context}` and the
  StartImplementationModal hands off to `/forge-terminal`).
- Switch to List view → see all stories in table ✓
  (reuses Step 21's `ListView`).
- Switch to Timeline view → see gantt-style timeline ✓
  (reuses Step 21's `TimelineView`).
- Switch to Lifecycle view → see dependency graph + active
  implementations ✓ (reuses Step 38's `LifecycleView`).
