# Step 25 — Mission Control Dashboard (Deliverable)

The Step 18 dashboard layout has been **fully replaced** with a curated
Mission Control surface. All previous "two CTA card + broken runs list"
content has been retired; the new route reads as a real AI-workforce
operations center on first load.

---

## Files Modified / Created

### Replaced
- `apps/forge/app/dashboard/page.tsx` — now a thin server wrapper that
  mounts `<MissionControl />` (was: `DashboardShell` + `RealtimeRunsList`
  + `DemoStateCard` + `OrchestratorUnreachable` + `EmptyState`).

### Created
- `apps/forge/components/dashboard/MissionControl.tsx` — orchestrator
  that wires all zones together (the new dashboard root).
- `apps/forge/components/dashboard/GreetingBar.tsx` — Zone 1: greeting,
  tenant health pill, customize button, theme toggle, bell, plus the
  shared `BentoTile` primitive + accent helpers.
- `apps/forge/components/dashboard/KPIStrip.tsx` — Zone 2: six 140 px
  KPI tiles with sparklines + delta chips.
- `apps/forge/components/dashboard/BentoLive.tsx` — Zone 3 Rows 1-2:
  Live Activity, Your Agents, Today's Runs Timeline, Cost Breakdown
  (RadialBar), Runs Over Time (Area), Top Agents (Bar).
- `apps/forge/components/dashboard/BentoCurated.tsx` — Zone 3 Rows
  3-7: Pending Approvals, Recent Ideas, AI Insights, Personal Stats,
  Pinned, Quick Actions, Team Activity, Recent Alerts.
- `apps/forge/components/dashboard/CustomizeDrawer.tsx` — Zone 4:
  widget toggles, three presets (Engineering Lead, Product Manager,
  Operator), refresh interval radio, density radio. Also exports
  `PinManagerDrawer` for the Pinned tile.
- `apps/forge/components/dashboard/NotificationCenter.tsx` — Zone 5:
  bell popover with last 10 alerts, mark-read, critical border.
- `apps/forge/components/dashboard/preferences.ts` — typed localStorage
  hook + widget catalog + preset factory.
- `apps/forge/components/dashboard/mock-data.ts` — curated Acme Corp
  snapshot used while the orchestrator is unreachable.
- `apps/forge/components/dashboard/types.ts` — shared TS shapes
  (KPI, Agent, Alert, Insight, Pin, etc.).

---

## Layout Sketch (Zone by Zone)

```
┌──────────────────────────────────────────────────────────────────┐
│ Zone 1 — Greeting Bar (sticky, 8px radius)                       │
│  Good afternoon, Arun  ✋          [● healthy] [grid] [theme] [🔔3]│
│  Tuesday, June 25 · Acme Corp · 3 agents · 2 projects            │
├──────────────────────────────────────────────────────────────────┤
│ ⚠ Orchestrator unreachable · ./scripts/dev-up.sh · Retry in 12s  │
├──────────────────────────────────────────────────────────────────┤
│ Quick Command Bar                                                 │
│ [🔍 Ask Forge… or /]      [⚡ New run]  [✦ Open Co-pilot]          │
└──────────────────────────────────────────────────────────────────┘

┌───────┬───────┬───────┬───────┬───────┬───────┐
│ KPI 1 │ KPI 2 │ KPI 3 │ KPI 4 │ KPI 5 │ KPI 6 │  ← 140 px, sparklines
└───────┴───────┴───────┴───────┴───────┴───────┘

Zone 3, Row 1 (320 px)
┌──────────── Live Activity ──────────┬── Agents ──┬── Runs ──┐
│  00:01  Aria  ✓ completed   4m12s   │ [Atlas]    │ ▮▮▮ now  │
│  00:01  Atlas ✦ started     —       │ [Aria]     │  ▮▮      │
│  00:02  Mira  ✗ failed      2m04s   │ [Mira]     │          │
│  ...                                │ ...        │          │
└─────────────────────────────────────┴────────────┴──────────┘

Zone 3, Row 2 (280 px)
┌── Cost ────┬──────── Runs · 24h ────────────┬── Top agents ──┐
│   ◯◯◯     │ /\__/\__/\__/\__                 │ Atlas ▮▮▮▮▮ 142 │
│  Agents    │  Succeeded / Failed / Running    │ Aria  ▮▮▮▮  118 │
│  Models    │                                  │ ...             │
└────────────┴──────────────────────────────────┴────────────────┘

Zone 3, Row 3 (240 px)
┌── Approvals (3) ──┬── Recent ideas ──┐
│ ADR-018           │ 87  Auto-rollback│
│ v2.4.1 Deploy     │ 74  Token budget │
│ Security review   │ 62  Heatmap      │
└───────────────────┴──────────────────┘

Zone 3, Row 4 (240 px)
┌────────── AI insights (flex-2) ──────────┬── Your impact ──┐
│ ┃ Today's AI insights · Generated 2h ago │ Runs: 47  +12   │
│ ┃ Your team ran 23% more workflows…      │ Time:  ~14h     │
│ ┃ Cost spike detected in "Refactor"…     │ Cost: $32.40    │
│ [Ask Co-pilot →] [View details] [×]      │ ▮▮▮▮▮▮▮▮ 94%   │
└──────────────────────────────────────────┴─────────────────┘

Zone 3, Row 5 (200 px)
┌── Pinned (6) ──────┬── Quick actions ────┐
│ ⌘⌘ ⌘⌘ ⌘⌘           │ New feat ⌘⇧N       │
│ ⌘⌘ ⌘⌘ ⌘⌘           │ Fix bug ⌘⇧B        │
│ Manage →           │ Terminal ⌘⇧T        │
│                    │ Create idea ⌘⇧I     │
└────────────────────┴─────────────────────┘

Zone 3, Row 6 (220 px, full width)
┌── Team activity · All/Eng/Prod/Design ────────────────────────┐
│ ● Arun started 3 workflows                       3m            │
│ ● Priya approved ADR-017                        12m            │
│ ● Marcus's agent fixed checkout-flow            24m            │
└───────────────────────────────────────────────────────────────┘

Zone 3, Row 7 (200 px, full width)
┌── Recent alerts · All / Unread / Critical ── Mark all read ──┐
│ ⚠ Cost ceiling 64% used                          [Action req] │
│ ⚠ Lyra failed twice in a row                       21m ago    │
│ ✓ Production deploy succeeded                       1h ago    │
└───────────────────────────────────────────────────────────────┘

Floating (Zone 5): Notification popover from the bell
                ✦ Co-pilot FAB (already exists, kept)
```

---

## Rationale

> **Skill rules adopted.** Per the ui-ux-pro-max searches, the dashboard
> follows the *Real-Time Monitoring* style (live indicators, connection
> status, smooth stream updates), the *Data-Dense Dashboard* style (8-12
> px gaps, KPI tiles, sorted bars with value labels), and the chart
> pairing rules (RadialBar for part-to-whole, Area for time-series,
> Bar for compare-categories, Sparkline for trends). Every status is
> paired with an icon (never color-only), focus-visible rings follow
> the global :focus-visible rule in `globals.css`, and `prefers-reduced-
> motion` is honored via the existing media block (no bespoke animations
> needed). Connectivity handling degrades every tile to "—" rather than
> fake zeros, surfaces an amber banner above the KPI strip, and exposes
> a `Retry now` button — matching the offline UX checklist the search
> flagged.

---

## Curation Notes (features added beyond the original spec)

The user explicitly asked for "more features curated, not just the
basics." The following tiles and behaviors were added on top of the
spec'd three rows:

| Zone | Tile | Why added |
| --- | --- | --- |
| Row 3 | **Pending Approvals** | Mission control for any operator has to surface "what needs *me*" first — ADRs and deploys gating on the user. |
| Row 3 | **Recent Ideas** | Cross-links ideation center with the dashboard so ideas keep momentum. |
| Row 4 | **AI Insights** | Co-pilot-generated daily digest with markdown-rendered summary + accent strip + Show-more expander + dismiss affordance. Gives the page a real "AI workforce" voice. |
| Row 4 | **Personal Stats** | Three KPI stats + a 47/50 weekly-goal progress bar — reinforces ownership of usage. |
| Row 5 | **Pinned** | 6-slot grid with right-click-to-unpin + dashed empty state with "Show me how" link. Customization-aware. |
| Row 5 | **Quick Actions** | 2×2 grid of `⌘⇧N / ⌘⇧B / ⌘⇧T / ⌘⇧I` shortcuts so the dashboard is actionable in one keystroke. |
| Row 6 | **Team Activity** | Full-width timeline with filter pills (All/Eng/Prod/Design). Sets social proof + surfaces teammates' contributions. |
| Row 7 | **Recent Alerts** | Inbox-style alert list with `Mark all read`, filter pills, and critical rose left-border + "Action required" badge. |
| Zone 4 | **Customize drawer** | 480 px right-sheet with widget toggles + 3 presets (Engineering Lead, Product Manager, Operator) + refresh interval + density. Persists per-user in localStorage. |
| Zone 4 | **Pin Manager** | Sibling drawer that browses a 10-item catalog and lets the user add/remove up to 8 pins. |
| Zone 5 | **Notification popover** | Bell-click popover with last 10 alerts, mark-read affordance, critical pulse on bell. |
| Zone 1 | **Connectivity banner** | Full-width amber strip above the KPI strip with `Retry now` + auto-retry countdown + code chips for `dev-up.sh` / `pnpm dev:stack`. Animates out when reconnected. |
| Zone 1 | **Quick Command Bar** | Inline ⌘K-focusable command input + `+ New run` primary button + `Open Co-pilot` cyan outline. |
| All | **Per-tile degraded states** | When `snapshot.online === false`: KPI numbers become "—", Live Activity shows inline ErrorState, agents get "Last seen" tone, AI Insights gets a stale badge. |
| All | **localStorage preferences** | Refresh interval, density, widget visibility, pin set persist across reloads and survive user impersonation. |

---

## Connectivity Handling

- `mockSnapshot().online === false` is the current dev state.
- All KPIs render `—` (em-dash) instead of fake zeros.
- The Sparkline component gracefully renders a 1-px hairline when its
  data array has length < 2.
- Live Activity tile switches to an inline `<ErrorState>` with a
  "Retry now" call-to-action.
- A full-width amber banner sits between the greeting and the KPI
  strip, exposing the dev-up scripts and an auto-retry countdown.
- When the backend is wired in, swap `mockSnapshot()` for a
  `forgeFetch('/v1/dashboard')` call inside `MissionControl.tsx` —
  every tile reads the same `snapshot` shape, so no other code
  changes are required.

---

## Build Status

- `pnpm typecheck` produces zero errors in `components/dashboard/**`
  (the remaining errors are pre-existing in
  `app/project-intelligence/stories/_components/KanbanBoard.tsx` and
  unrelated to Step 25).
- The dashboard ships with no new dependencies; all icons come from
  `lucide-react`, all charts from `recharts` + the existing
  `<Sparkline>` primitive, all primitives from
  `@/components/ui/*` and `@/components/shell/*`.
- Tokens throughout: `--accent-*`, `--fg-*`, `--bg-*`, `--border-*`,
  `--radius-*`, `--shadow-*` — never literal hex, never `bg-black`.
- Reduced-motion: all animations live in the global
  `globals.css` rules and are auto-disabled by the
  `prefers-reduced-motion` media block.