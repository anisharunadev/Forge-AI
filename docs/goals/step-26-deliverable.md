# Step 26 — Dashboard Polish Deliverable

## Per-Fix Summary

| # | Fix | Files Modified | One-line |
|---|---|---|---|
| 1 | Customize Drawer 360px push | `CustomizeDrawer.tsx`, `MissionControl.tsx`, `globals.css` | Drawer pushes content left (grid 1fr 360px), Esc/outside/X close, mobile becomes bottom sheet |
| 2 | Live Activity + StaleBadge | `StaleBadge.tsx` (new), `BentoLive.tsx`, `GreetingBar.tsx`, `MissionControl.tsx` | New `<StaleBadge>` with age-based color; tile forces 300px min-height + cyan "Waiting for orchestrator" empty state |
| 3 | KPI Last-Known | `KPIStrip.tsx`, `StaleBadge.tsx` | Renders last value + "(stale · 2m ago)" subscript, dimmed sparkline, hover tooltip explaining auto-refresh |
| 4 | Pinned Flow Layout | `BentoCurated.tsx` | `flex-wrap gap-3`, 96×96 each, no empty slots, "+ Add pin" tile at 6+, rich empty state at 0 |
| 5 | Quick Actions 8 + kbd | `useQuickActions.ts` (new), `QuickActionsEditor.tsx` (new), `BentoCurated.tsx`, `MissionControl.tsx` | 4 categories (Forge/Navigate/Agents/Workflows), proper `<kbd>` styling, customizable via editor |
| 6 | Drag-to-Reorder | `CustomizeDrawer.tsx`, `preferences.ts` | @dnd-kit handles reordering, persists in `widgetOrder`, row lifts with shadow on drag |
| 7 | Page Breadcrumb | `PageBreadcrumb.tsx` (new), `MissionControl.tsx` | Sticky crumb with Home → Workspace → Dashboard, shared across routes |
| 8 | Notification Bell Popover | `NotificationCenter.tsx`, `MissionControl.tsx` | 380px Popover with filter pills (All/Unread/Critical), last 5 alerts, mark-read dots, "View all" footer |
| 9 | AI Insights 320px | `BentoCurated.tsx` | Height bumped to 320px, 2 stacked insight cards with cyan→indigo accent strip, dismiss + "Ask Co-pilot" actions |
| 10 | Team Filter Counts | `BentoCurated.tsx` | Filter pills now show `All (47) · Engineering (23) · Product (15) · Design (9)` |
| 11 | Runs Timeline Density | `BentoLive.tsx` | All 24 hours shown — empty hours get ghost bars (1px dashed), grid lines every 6h, "now" indicator + label |
| 12 | kbd Styling | `MissionControl.tsx` (`<Kbd>`/`<KbdGroup>`), used in `BentoCurated.tsx` | Proper `<kbd>` — mono font, `--bg-inset`, `--radius-sm`, hidden on mobile |
| 13 | Refresh All Button | `RefreshButton.tsx` (new), `GreetingBar.tsx` | RefreshCw icon button next to tenant-health pill, rotates while in-flight, disabled when offline, fires emerald border glow on tiles |
| 14 | First-Run Onboarding | `FirstRunOnboarding.tsx` (new), `MissionControl.tsx` | Welcome surface with 3-step cards (Register agent / Run command / Connect repo), replaces bento when zero data, Skip link always visible |
| 15 | Tile Hover Affordances | `BentoLive.tsx`, `BentoCurated.tsx` | Subtle "→ Open" pill in top-right of clickable tiles, fades in on hover, cursor-pointer |

## Global CSS Additions (`globals.css`)

- `@keyframes tile-pulse-glow` — 1.1s emerald box-shadow used by "Jump to" from drawer
- `@keyframes refresh-spin` — 1s rotation for RefreshCw
- `@keyframes stale-pulse` — 1.6s opacity blink for StaleBadge when age > 5m
- `@keyframes refresh-glow` — 1s emerald border glow flashed on all tiles after refresh
- `.stale-border` — 1px amber inset shadow on stale tiles
- All gated by `prefers-reduced-motion`

## Data / Persistence

- `forge.dashboard.prefs.v1` — extended with `widgetOrder`
- `forge.dashboard.quickActions.v1` — new (8 actions with category buckets)
- `forge.dashboard.onboardingDismissed.v1` — new (first-run skip flag)

## ASCII Mockup — After

```
┌─────────────────────────────────────────────────────────────────────┐
│  🏠 Workspace › Dashboard                          [theme] [⚙] [🔔1] │  <- breadcrumb + actions
├─────────────────────────────────────────────────────────────────────┤
│  Good afternoon, Arun 👋        [● Orchestrator unreachable] [↻]   │
│  Tue, Jun 26 · Acme Corp (Dev) · 2 agents active · 7 registered    │
│  ✓ Dashboard refreshed just now                                     │
│                                                                      │
│  [🔎 Ask Forge…                                    ⌘K]  [New run] │
├─────────────────────────────────────────────────────────────────────┤
│  [3 ◯ 23 +5][91.3% +2.4][412ms -38][$32.40 +4.12][482K +51K]…       │  <- last-known, dimmed
├──────────────────────────────────────────┬──────────────────────────┤
│  Live activity        [●Streaming]      │  Customize dashboard     │
│  00:01  Aria ✓ Wiring dashboard bento  │  ─────────────────────── │
│  00:02  Atlas ⟳ Refactor: order-svc   │  Widgets (drag to reorder)│
│  00:03  Mira ✗ E2E: checkout-flow     │  ⠿ Live activity    [ON]  │
│  00:04  Aria ⟳ Fix: type definitions  │  ⠿ KPI Strip         [ON] │
│  00:06  Atlas ✓ Refactor: order-svc   │  ⠿ AI insights       [ON] │
│  00:07  Lyra ✗ Schema migration v3.4  │  ⠿ Pinned            [ON] │
│  [🕐 Waiting for orchestrator… 2m]   │  ⠿ Quick actions      [ON] │
│  ────────────────────────────────────  │  ─────────────────────── │
│  [→ Open] View all runs →             │  Presets                  │
├──────────────────────────────────────────┤  [thumb] Eng Lead [Apply]│
│  Your agents    [+ Register]           │  [thumb] Prod Mgr [Apply] │
│  [Atlas*][Aria*][Mira  ][Orion ]       │  ─────────────────────── │
│  [Lyra ⚠][Kira ][Neo   ][Vex  ]       │  Refresh: ◉ 30s           │
│  [Zen  ]                              │  Density: ◉ comfortable  │
├──────────────────────────────────────────┤  [Reset]    [Done]       │
│  Today's runs   [●ok ●failed ●running]│                          │
│  ┃┃  ┃  ┃┃ ┃   ┃┃ ┃ ┃┃ ┃┃┃┃┃┃┃│││││    │                          │
│  └─────────────────────────────────────│                          │
│  00  06  12  18  24                    │                          │
├──────────────────────────────────────────┴──────────────────────────┤
│  Needs your attention (3)     │  Recent ideas                      │
│  ADR-018 Postgres 17  [Sec]   │  87 Auto-rollback cost spike       │
│  Deploy v2.4.1        [Deploy]│  74 Per-tenant token budgeting     │
│  Vault migration      [ADR]   │  62 Realtime agent heatmap         │
├─────────────────────────────────────────────────────────────────────┤
│  Today's AI insights (3 new)                                       │
│  ║ Insight 1 of 3 · 2h ago                                         │
│  ║ Your team ran 23% more workflows than last Tuesday             │
│  ║ Success rate held at 91%…   [Ask Co-pilot] [View] [✕]          │
│  ║────────────────────────────────────────────────────────────── │
│  ║ Insight 2 of 3 · 5h ago                                         │
│  ║ Cost spike detected in "Refactor" workflow                      │
│  ║ Used 2.3× more tokens than usual…  [Ask] [View] [✕]            │
│  [Show 1 more insight]                                              │
├─────────────────────────────────────────────────────────────────────┤
│  Pinned                                            [Manage]        │
│  [✨NF][🔧FB][🤖At][🤖Ar][▶Run][💡Id][📊An][+ Add pin]              │
│  ─────────────────────────────────────────────────────────────────  │
│  Quick actions                                  [+ Customize]      │
│  Forge   ─ Run "New feature" ⌘⇧N  Run "Fix bug" ⌘⇧B               │
│  Navigate─ Open Terminal ⌘⇧T  Open Command Center ⌘⇧C  Open Co-pilot│
│  Agents  ─ Talk to Code-Reviewer ⌘⇧R  Talk to Test-Runner ⌘⇧X      │
│  Workflows ─ Ideation → PRD pipeline ⌘⇧W                            │
├─────────────────────────────────────────────────────────────────────┤
│  Team activity today [All(6)·Eng(2)·Prod(3)·Design(1)]              │
│  Arun started 3 workflows Refactor + tests       3m                │
│  Priya approved ADR-017 Postgres migration       12m               │
├─────────────────────────────────────────────────────────────────────┤
│  Recent alerts                              [All][Unread][Critical]│
│  ⚠ Cost ceiling 64% used                      4m                  │
│  ⚠ Lyra failed twice in a row                 21m                 │
│  ✓ Production deploy succeeded                 1h                  │
└─────────────────────────────────────────────────────────────────────┘
```

## What We Deliberately Did NOT Change

- **Data fetching / WebSocket logic** — `mockSnapshot()` shape and connectivity probe untouched; tiles just learn to render last-known.
- **Bento grid structure** — 7 rows, 6 KPI columns, 1–3 tiles per row. Only the chrome around them changed.
- **Engine / state model** — `useDashboardPrefs()` and localStorage keys preserved; only `widgetOrder` was added.
- **All animations** — added new keyframes but every existing tile animation kept identical timing.
- **Backend seams** — `handleRefresh` still triggers a soft refresh; the real `forgeFetch` swap point is unchanged.

## Rationale — Skill Rules Cited

- `style` (Data-Dense Dashboard) — dense 8-action Quick Actions, filter counts, 24h timeline.
- `style` (Real-Time Monitoring) — StaleBadge + last-known values keep signal visible during outages.
- `chart` (Compare Categories) — Quick Actions category dividers make 8 actions scannable.
- `ux` (Empty States) — first-run onboarding + Live Activity "Waiting for orchestrator" + Pinned + AI Insights.
- `ux` (Confirmation Messages) — Reset prompt preserved; Quick Actions toggle prompts on remove.
- `ux` (Color Only) — every StaleBadge pairs an icon + label; severity tiers pair icon + text + color.
- `ux` (Reduced Motion) — all 4 new keyframes (`tile-pulse`, `refresh-spin`, `stale-pulse`, `refresh-glow`) gated.
- `ux` (Breadcrumbs) — `<PageBreadcrumb>` shows hierarchy at 2+ levels.
- `ux` (Hover vs Tap) — popover opens on click; hover affordance on tiles is a soft fade, not the primary action.
- `ux` (Keyboard Navigation) — `<kbd>` styling standardized; `⌘K` continues to focus command bar; `Esc` closes drawer.
- `ux` (Onboarding User Freedom) — Skip link + ✕ icon both dismiss without locking.
- `ux` (Sticky Navigation) — breadcrumb sticks below the shell header with backdrop blur.