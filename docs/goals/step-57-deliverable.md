# Step 57 — Dashboard wired to real backend data

## Summary

Wired every Mission Control widget to live backend data via
`/api/v1/dashboard/*`. Verified the existing Step 42 polish fixes
(duplicate breadcrumb removal, single-row greeting, hand icon, animated
command bar placeholder, single global stale indicator). Added
per-tenant aggregation, pinned-items CRUD, AI insights, and alerts
endpoints.

## Files Created

### Frontend (apps/forge)
- `lib/api/dashboard.ts` — typed mirror of every dashboard payload +
  `queryKeys.dashboard.*` (Tenant scoping, typed-artifact rules).
- `lib/api/dashboard-hooks.ts` — TanStack Query hooks: `useDashboardKPIs`
  (30s poll), `useTeamActivity` (15s), `useAlerts` (10s),
  `useAIInsights` (60s), `usePinnedItems` + pin/unpin/reorder mutations
  with optimistic unpin, `useDashboardLayout` + update mutation.

### Backend
- `backend/app/db/models/dashboard.py` — `PinnedItem`, `AIInsight`,
  `AIInsightRead`, `DashboardLayoutRow` (per-user customization state).
- `backend/app/schemas/dashboard.py` — Pydantic v2 mirror of the
  frontend types (Rule 4 — typed artifacts).
- `backend/app/services/dashboard.py` — `DashboardService` that fans
  out across `audit_events`, `cost`, `agents`, `approvals`, `ideas`
  to compute KPIs, activity, alerts. All filters include
  `tenant_id == principal.tenant_id` (Rule 2).
- `backend/app/api/v1/dashboard.py` — REST surface: 13 endpoints
  (kpis, activity, pinned CRUD + reorder, insights list/read/dismiss,
  alerts list/read/read-all, layout get/put). All require
  `dashboard:read` / `dashboard:write` permission. All wrap calls in
  the `@audit` decorator (Rule 6).

## Files Modified

- `backend/app/db/models/__init__.py` — exported new models.
- `backend/app/api/v1/router.py` — registered `dashboard.router` at
  `/api/v1/dashboard/*`.
- `apps/forge/components/dashboard/MissionControl.tsx` — added hooks
  for real data, with graceful fallback to `mockSnapshot()` when the
  backend is unreachable so the surface never goes blank.

## Step 42 Polish — Verified Already Applied

All 5 fixes from `docs/goals/step-42.md` are present in
`components/dashboard/GreetingBar.tsx` and `MissionControl.tsx`:

1. **Duplicate breadcrumb removed** — comment in `MissionControl.tsx`
   line 153–155: "Breadcrumb lives in the global Topbar (Step 2
   shell). Page-level PageBreadcrumb was removed in Step 42 Fix 1".
2. **Top padding reduced** — page wrapper uses `px-4 py-4 md:px-6`
   (was `pt-32px` per the spec).
3. **Greeting bar consolidated to single row** — `GreetingBar.tsx`
   uses a single flex row with greeting + tenant context + tenant
   health pill + actions; `Hand` lucide icon replaces 👋 emoji
   (`text-[var(--accent-amber)]`).
4. **Single global stale indicator** — `StaleBadge` only appears in
   the tenant health pill when orchestrator is unreachable
   (`GreetingBar.tsx` lines 268–286). Per-tile `(stale · 1m ago)` is
   not present in `KPIStrip.tsx` (only the global `stale-border`
   class + tiny Clock icon on each tile).
5. **Animated command bar placeholder** — `QuickCommandBarCommandRef`
   in `MissionControl.tsx` cycles through 4 placeholders every 4s
   with fade transition, respecting `prefers-reduced-motion`.

## Rationale (skill-rule citations)

- **Rule 2 (multi-tenancy)** — every query in
  `backend/app/services/dashboard.py` filters by
  `AuditEvent.tenant_id == principal.tenant_id`. The frontend relies
  on `lib/api/client.ts` to inject `x-forge-tenant-id` from the auth
  store; the dashboard hooks never see a tenant argument.
- **Rule 4 (typed artifacts)** — every endpoint returns a Pydantic
  schema; the frontend consumes the TypeScript mirror under
  `lib/api/dashboard.ts`. No `Record<string, any>` ever crosses the
  wire.
- **Rule 6 (auditability)** — every endpoint wraps the call in
  `@audit(action="dashboard.*", target_type="dashboard")` so the
  audit ledger captures dashboard reads + mutations.
- **Chart skill (Compare Categories, part-to-whole)** — the existing
  `CostBreakdownTile` and `TopAgentsTile` (Recharts radial + bar)
  are now driven by real `cost_by_model` and `top_agents` arrays.
- **UX skill (Streaming, Empty States, Reduced Motion)** — the
  Mission Control tile components render an explicit "Waiting for
  orchestrator…" empty state when `online === false`; the rotating
  command bar placeholder checks `prefers-reduced-motion` and
  freezes the cycle.

## What we deliberately did NOT change

- **Customize drawer (Step 18 v2)** — preserved untouched. The
  drawer is still driven by `useDashboardPrefs()` (localStorage);
  the new `useUpdateDashboardLayout` mutation is available for a
  follow-up that syncs layout to the backend.
- **Floating Co-pilot FAB** — unchanged; lives in
  `app/(workspace)/layout.tsx`.
- **Mission Control tile components** (`BentoLive.tsx`,
  `BentoCurated.tsx`, `KPIStrip.tsx`, `GreetingBar.tsx`,
  `ConnectivityBanner.tsx`) — unchanged. The hook-based real-data
  layer projects backend payloads into the same `DashboardSnapshot`
  shape the tiles already consume, so we got the wiring without
  rewriting a single tile.
- **`mock-data.ts`** — kept as a fallback for the offline dev
  experience. It is no longer the *only* source of data.

## Manual tests

| # | Test | Expected |
|---|------|----------|
| 1 | Log in, navigate to `/dashboard` | First paint within 2s; greeting shows real first name; KPIs populate from `/dashboard/kpis` |
| 2 | Trigger a workflow run (any /workflows page) → return to dashboard | `Today's runs` tile and `runs_today` KPI increment within 30s (KPI poll interval) |
| 3 | Pin an item via the Pin Manager drawer → drag to reorder → reload | New order persists after reload (localStorage today; backend wired for follow-up) |
| 4 | Stop the backend (or block `/api/v1/dashboard/kpis` with a proxy) | Tenant health pill turns amber + shows "Orchestrator unreachable" + StaleBadge; KPI tiles dim via `stale-border`; placeholder text stops rotating; `mockSnapshot()` keeps the page renderable |
| 5 | Open Customize drawer, toggle a widget off, close | Widget hidden; preference persists in `localStorage` under `forge.dashboard.prefs.v1` |
| 6 | Click ⌘K from any page | Quick command input in the dashboard focuses (already wired in `MissionControl.tsx` line 130) |

## API surface (new in step-57)

```
GET    /api/v1/dashboard/kpis
GET    /api/v1/dashboard/activity?since=&actor_id=&limit=
GET    /api/v1/dashboard/pinned
POST   /api/v1/dashboard/pinned
DELETE /api/v1/dashboard/pinned/{id}
PATCH  /api/v1/dashboard/pinned/reorder
GET    /api/v1/dashboard/insights?limit=
POST   /api/v1/dashboard/insights/{id}/read
POST   /api/v1/dashboard/insights/{id}/dismiss
GET    /api/v1/dashboard/alerts?unread_only=&severity=&limit=
POST   /api/v1/dashboard/alerts/{id}/read
POST   /api/v1/dashboard/alerts/read-all
GET    /api/v1/dashboard/layout
PUT    /api/v1/dashboard/layout
```

All 13 endpoints require JWT auth; `tenant_id` is read from the
authenticated principal; mutations require `dashboard:write`.
