# Feature: Dashboard (Mission Control)

> **Status:** Complete — wired to real backend (Step 57 Phase 5)
> **Route:** `apps/forge/app/dashboard/page.tsx`
> **Root component:** `apps/forge/components/dashboard/MissionControl.tsx`
> **Backend:** `backend/app/api/v1/dashboard.py` + `backend/app/services/dashboard.py`
> **Schemas:** `backend/app/schemas/dashboard.py`
> **Frontend SDK:** `apps/forge/lib/api/dashboard.ts` (types) + `dashboard-hooks.ts` (TanStack Query hooks)
> **Constitutional rules:** R2 (multi-tenant), R4 (typed artifacts), R6 (auditability), R7 (observability)

---

## Purpose

The Dashboard is the **landing page for every persona after login**. It aggregates operational signals across agents, runs, costs, approvals, and ideas into one Bento grid so the user understands the state of their tenant at a glance — without navigating to a sub-page.

It is **NOT** a static report. It streams data via TanStack Query polling (KPIs 30s, activity 15s, alerts 10s, insights 60s) and renders a `ConnectivityBanner` when the backend is unreachable so the user never sees a frozen page.

Per PRD §1.4 the dashboard is "the first thing every persona sees, the last thing every persona updates" — it's both a read surface and a write surface (pinned items, layout customization, alert acknowledgement).

---

## Architecture (single-page, all client-driven)

```
MissionControl (root, single client component)
├── Zone 0  PageBreadcrumb (shared shell)
├── Zone 1  GreetingBar (refresh + tenant health + customize + bell + theme)
├── Zone 1b ConnectivityBanner (shown when API unreachable)
├── Zone 1c QuickCommandBar (Cmd+K focus shortcut)
├── Zone 2  KPIStrip (6 tiles, 30s poll)
├── Zone 3  Bento rows (live + curated tiles, configurable order)
├── Zone 4  CustomizeDrawer (push layout, drag-to-reorder widgets)
├── Zone 5  NotificationCenter (popover anchored on bell)
└── Zone 6  FirstRunOnboarding (when zero data — i.e. fresh tenant)
```

**Why a single client component:** The tiles share preferences (`useDashboardPrefs()`) + snapshot + connectivity state. Co-locating avoids prop-drilling and lets all tiles react to the same stale/orphan state.

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/dashboard` | `MissionControl` | Main page — server component wrapper, `export const dynamic = 'force-dynamic'` |

### Backend (FastAPI)

All routes prefixed `/api/v1/dashboard/`. Every route uses `@audit()` decorator and `require_permission("dashboard:read")` or `"dashboard:write"`.

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/dashboard/kpis` | `dashboard:read` | Aggregated KPI strip (agents + runs + cost + tokens + approvals + ideas) |
| `GET` | `/dashboard/activity` | `dashboard:read` | Team activity feed (`?since=24h`, `?actor_id=...`) |
| `GET` | `/dashboard/pinned` | `dashboard:read` | List user's pinned items |
| `POST` | `/dashboard/pinned` | `dashboard:write` | Pin an item (workflow / run / agent / idea / story) |
| `DELETE` | `/dashboard/pinned/{pin_id}` | `dashboard:write` | Unpin (optimistic UI on client) |
| `PATCH` | `/dashboard/pinned/reorder` | `dashboard:write` | Reorder pinned items (drag-drop persistence) |
| `GET` | `/dashboard/insights` | `dashboard:read` | AI-generated insights for this tenant |
| `POST` | `/dashboard/insights/{id}/read` | `dashboard:write` | Mark insight as read |
| `POST` | `/dashboard/insights/{id}/dismiss` | `dashboard:write` | Dismiss insight (hide from feed) |
| `GET` | `/dashboard/alerts` | `dashboard:read` | Active alerts (severity-graded) |
| `POST` | `/dashboard/alerts/{id}/read` | `dashboard:write` | Mark alert as read |
| `POST` | `/dashboard/alerts/read-all` | `dashboard:write` | Mark all alerts as read |
| `GET` | `/dashboard/layout` | `dashboard:read` | User's widget layout (per-preset or custom) |
| `PUT` | `/dashboard/layout` | `dashboard:write` | Save user's widget layout |

---

## Data touched

### Tables (read-heavy, some writes)

| Table | Purpose |
|---|---|
| `agents` | active/total agent counts, top agents |
| `runs` (workflow runs) | runs_today, runs_yesterday, success rate, duration |
| `audit_events` | team activity feed (last 24h) |
| `cost_entries` | total_cost_today, cost_by_day, cost_by_model |
| `approvals` | pending_approvals, critical_approvals |
| `ideas` | ideas_this_week, ideas_scored, recent ideas |
| `dashboard_pinned_items` | user-pinned shortcuts |
| `dashboard_layouts` | per-user widget order + visibility |
| `dashboard_ai_insights` | AI-generated insights |
| `dashboard_alerts` | severity-graded alerts |

### Pydantic schemas (source of truth: `backend/app/schemas/dashboard.py`)

- `DashboardKPIs` — flat shape with all KPI fields + time-series arrays (`runs_by_day`, `cost_by_day`, `cost_by_model`) + top lists (`top_agents`, `top_workflows`)
- `TeamActivity` — actor + action + target_type + target_id + timestamp
- `PinnedItemRead` / `PinnedItemCreate` / `PinnedItemReorder`
- `AIInsightRead` — id, kind, title, body, severity, generated_at, read_at
- `AlertRead` — id, severity, type, message, link, raised_at, read_at
- `DashboardLayout` — list of `DashboardWidget` (type + enabled + position + config)

### TypeScript types (mirror: `apps/forge/lib/api/dashboard.ts`)

Same shapes as Pydantic, camelCase, all Date fields → `string` (ISO 8601). The two files **MUST** stay in lock-step.

---

## KPI Strip (Zone 2)

6 tiles, 140px height each, 30s poll via `useDashboardKPIs()`:

| Tile | Field | Accent | Icon | Stale treatment |
|---|---|---|---|---|
| Active agents | `active_agents` / `total_agents` | indigo | `Bot` | Last known value + "(stale · 2m ago)" subscript |
| Runs today | `runs_today` (delta vs `runs_yesterday`) | cyan | `Play` | Sparkline at 0.5 opacity |
| Success rate | `success_rate` (%) | emerald | `CheckCircle2` | Hover tooltip with last refresh time |
| Avg latency | `avg_duration_seconds` | amber | `Clock` | Same as above |
| Cost today | `total_cost_today` (delta vs `daily_cost_cap`) | rose | `Coins` | Same as above |
| Tokens used | `total_tokens_today` (input + output) | violet | `DollarSign` | Same as above |

Each tile: `text-3xl font-700` number + `text-sm text-fg-tertiary` label + 60px Recharts Sparkline + delta line in semantic color.

---

## Bento Grid (Zone 3)

13 widgets configurable via `CustomizeDrawer`. Default order (`engineering-lead` preset):

| # | Widget | Tile file | Type |
|---|---|---|---|
| 1 | Live activity | `BentoLive.tsx → LiveActivityTile` | Live (real-time feed) |
| 2 | Your agents | `BentoLive.tsx → YourAgentsTile` | Live |
| 3 | Today's runs timeline | `BentoLive.tsx → TodaysRunsTimelineTile` | Live |
| 4 | Cost breakdown | `BentoLive.tsx → CostBreakdownTile` | Live |
| 5 | Runs over time | `BentoLive.tsx → RunsOverTimeTile` | Live |
| 6 | Top agents | `BentoLive.tsx → TopAgentsTile` | Live |
| 7 | Pending approvals | `BentoCurated.tsx → PendingApprovalsTile` | Curated |
| 8 | Recent ideas | `BentoCurated.tsx → RecentIdeasTile` | Curated |
| 9 | AI insights | `BentoCurated.tsx → AIInsightsTile` | Curated |
| 10 | Personal stats | `BentoCurated.tsx → PersonalStatsTile` | Curated |
| 11 | Pinned | `BentoCurated.tsx → PinnedTile` | Curated |
| 12 | Quick actions | `BentoCurated.tsx → QuickActionsTile` | Curated |
| 13 | Team activity | `BentoCurated.tsx → TeamActivityTile` | Curated |
| 14 | Recent alerts | `BentoCurated.tsx → RecentAlertsTile` | Curated |

Three preset layouts: `engineering-lead` (default), `product-manager`, `operator`. User can save a custom layout via `PUT /dashboard/layout`.

---

## Edge cases

| State | Treatment |
|---|---|
| **Empty (zero data)** | `<FirstRunOnboarding>` overlay — walks user through creating their first agent |
| **Loading (initial fetch)** | KPI tiles show skeleton with shimmer; tiles show skeleton placeholders |
| **Stale (backend unreachable >30s)** | `ConnectivityBanner` shows above the page; KPI tiles show last known value + `(stale · 2m ago)` subscript; sparklines fade to 0.5 opacity |
| **Permission denied** | Backend returns 403; frontend shows `<ErrorState>` with "Contact your admin" copy |
| **Tenant switch** | Every query key carries `tenant_id`; switching forces refetch via TanStack Query invalidation |
| **Theme switch (dark ↔ light)** | All colors from CSS vars (`var(--accent-*)`); swap is instant, no flash |
| **`prefers-reduced-motion`** | Shimmer disabled, layout animations become instant transitions, sparkline fade-in removed |
| **Window resize** | Bento grid reflows via CSS grid; no horizontal scroll at 1280/1440/1920px |

---

## Forbidden patterns

AI agents modifying the dashboard MUST NOT:

- ❌ Add new fields to `DashboardKPIs` without updating both `schemas/dashboard.py` AND `lib/api/dashboard.ts` (lock-step)
- ❌ Use direct SDK imports for LLM calls — every LLM call via LiteLLM proxy
- ❌ Hardcode tenant_id — always derive from auth context (`useAuth().tenant.id`)
- ❌ Skip `@audit()` decorator on dashboard mutations (`POST /pinned`, `PATCH /reorder`, `PUT /layout`, etc.)
- ❌ Skip `require_permission("dashboard:read")` / `("dashboard:write")` on routes
- ❌ Use `bg-black` — use `--bg-base` (`#09090B`) and the layered surface system
- ❌ Use emoji as icons — `lucide-react` only
- ❌ Add spinners for async loading — use skeleton with shimmer
- ❌ Bypass TanStack Query — never `fetch` directly in components; use the hooks
- ❌ Skip the empty/loading/error states — every tile needs all three
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Add a new widget without adding it to `ALL_WIDGETS` in `preferences.ts`
- ❌ Refetch KPIs faster than 30s — backend caches for 15s, polling faster wastes cycles

---

## Verification checklist

- [ ] `apps/forge/app/dashboard/page.tsx` renders `<MissionControl />` with `data-testid="dashboard-page"`
- [ ] All 13 backend routes return 200 with valid Bearer token + tenant scope
- [ ] `curl .../dashboard/kpis` returns valid `DashboardKPIs` JSON shape
- [ ] KPI strip shows 6 tiles, each with number + label + sparkline + delta
- [ ] Bento grid renders all 14 widgets (KPI strip is Zone 2; widgets are Zone 3)
- [ ] CustomizeDrawer opens when clicking the gear; drag-reorder persists via `PATCH /pinned/reorder`
- [ ] Layout switcher (engineering-lead / product-manager / operator) changes widget order
- [ ] ConnectivityBanner appears when backend is unreachable (kill `docker compose stop backend`)
- [ ] Stale treatment appears within 30s of backend going down (last known value + subscript)
- [ ] Pinned item add/remove persists across page reloads
- [ ] AI insights appear; marking as read moves them to "read" state
- [ ] Alerts badge in bell icon shows unread count; "Mark all as read" calls `POST /alerts/read-all`
- [ ] FirstRunOnboarding overlay shows when `total_agents === 0`
- [ ] Theme toggle switches dark ↔ light without flash
- [ ] `prefers-reduced-motion` disables shimmer + layout animations
- [ ] Lighthouse Accessibility ≥ 90 on this page
- [ ] No console errors or warnings
- [ ] Tenant switch (TenantSwitcher in header) refetches KPIs + tiles

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — KPI tile colors, accent tokens
- [API conventions](../standards/api-conventions.md) — FastAPI patterns used here
- [Data model](../standards/data-model.md) — `tenant_id` + RLS rules
- [Architecture rules](../standards/architecture-rules.md) — R2 + R6 enforcement
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full dashboard route list
- [DB schema](../reference/db-schema.md) — `dashboard_*` tables
- [Auth (OIDC)](./auth.md) — `useAuth()` provides `tenant` and `user`
- [Co-pilot](./copilot.md) — sibling feature using same layout primitives

---

## Maintenance notes

**When to update this doc:**

- A new KPI field is added to `DashboardKPIs` → update the KPI Strip table
- A new widget is added → update the Bento Grid table AND `ALL_WIDGETS` in `preferences.ts`
- A new preset layout is added → update the `presetLayout()` list in `preferences.ts` section
- A new poll interval is tuned → update the Edge cases table
- A new permission is added → update the Routes table

**Files to keep in sync (the lock-step triangle):**

```
backend/app/schemas/dashboard.py     ←  source of truth
         ↓ mirrors
apps/forge/lib/api/dashboard.ts      ←  TypeScript types
         ↓ consumed by
apps/forge/lib/api/dashboard-hooks.ts ←  TanStack Query hooks
         ↓ used by
apps/forge/components/dashboard/      ←  UI components
```

If any link in this chain drifts, the dashboard breaks silently. Always update all four.