> **Status:** completed
/goal

Polish the Forge AI Agent OS Dashboard — built in Step 18 v2. Read .claude/design-system/ first. Address the 15 issues I surfaced, in priority order.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard tile empty state stale data last known value" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "side drawer customization drawer width overlay vs push layout" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "notification preview popover hover dropdown alert inbox" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "drag reorder sortable list widget customization preferences" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "first run onboarding empty dashboard zero data state" --domain style -f markdown

Adopt every rule. Then implement each fix:

==========================================================
FIX 1 — CUSTOMIZE DRAWER EATS THE WHOLE SCREEN
==========================================================

Current: drawer covers ~480px on the right, hiding the content you're trying to customize.

Implement:
- Default drawer width: 360px (was 480px)
- DO NOT overlay — PUSH the dashboard content left. Layout: `grid-template-columns: 1fr 360px` when open, transition 250ms ease-out. Body content shifts smoothly.
- Close behavior: clicking outside the drawer, pressing Esc, or clicking the X header button — all close + dashboard returns to full width
- Header of drawer: drag handle (lucide GripVertical 16px in --fg-muted, only visible on hover), "Customize dashboard" title (--text-md font-600), "Reset" text button (left), "Done" primary button (right)
- Mobile (<1024px): drawer becomes a full-screen sheet with backdrop blur, slides up from bottom

==========================================================
FIX 2 — LIVE ACTIVITY TILE MISSING + STALE BADGES
==========================================================

Two issues here:

A. The "Live activity" tile is enabled in the customize drawer but not visible on the dashboard. Either it's below the fold or collapsing to nothing when API is down.

Find the bug:
- Verify the tile is actually rendering — check the bento grid layout logic
- If it renders below the fold: add a "Jump to" anchor in the customize drawer — clicking a widget name in the drawer smooth-scrolls to that tile and pulses it briefly (emerald glow, 1s)
- If it collapses when no data: force a minimum height (300px) and show the empty-state variant — "Waiting for orchestrator..." with a cyan pulse + Clock icon + last sync timestamp

B. Add a global "stale" indicator pattern:
- Create a `<StaleBadge>` component: small inline pill showing the data's age
- Visual: --bg-elevated, --radius-full, --text-xs --fg-tertiary, Clock icon 10px + "{age} ago"
- When orchestrator is unreachable, every tile that depends on live data shows a StaleBadge in its top-right corner with "(stale · 2m ago)"
- Color shifts: <1m = muted, 1-5m = amber, >5m = rose
- Tile ALSO gets a subtle 1px amber border tint (rgba(245,158,11,0.15)) to signal "this is not fresh"

==========================================================
FIX 3 — KPI TILES SHOW "—" WITH NO CONTEXT
==========================================================

Current: when orchestrator is down, KPI tiles show "—" with empty sparklines. Feels dead.

Implement:
- When data is stale but was previously available: show LAST KNOWN value with "(stale · 2m ago)" subscript in --fg-tertiary
- Sparkline still renders with the last-known data, just dimmed (opacity 0.5)
- Show tiny Clock icon (10px) next to the dash when truly no data ever existed
- The delta line ("vs yesterday" / "of 5 online") should show the last delta too, with stale badge
- Add a hover tooltip explaining: "Last updated 2m ago when orchestrator was reachable. Will refresh automatically when connection is restored."

==========================================================
FIX 4 — PINNED TILE DEAD SPACE
==========================================================

Current: shows a 2×3 grid reserving 6 slots even when fewer pins exist. Empty boxes feel awkward.

Implement:
- Flow layout: `flex-wrap gap-3`, items sized 96×96px each
- When fewer than 6 pins: no empty slots, just the actual pins centered or left-aligned
- When 0 pins: replace the entire tile body with the empty-state from Step 18 v2 — "Pin agents, workflows, or pages for one-click access" + "Show me how" link + dashed border placeholder
- "+ Add pin" tile: when 6+ pins exist, show an "Add" tile (dashed border, Plus icon, "Add pin" text) to make the action discoverable

==========================================================
FIX 5 — QUICK ACTIONS EXPAND FROM 4 TO 8
==========================================================

Current: 4 actions in a 2×2 grid feels limited.

Implement:
- Default: 8 actions in a 4×2 grid (96px wide each)
- Categories with subtle dividers between groups:
  - **Forge** (2 actions): Run "New feature" (Sparkles, indigo), Run "Fix bug" (Wrench, amber)
  - **Navigate** (3 actions): Open Terminal (Terminal, emerald), Open Command Center (Command, cyan), Open Co-pilot (Sparkles, violet)
  - **Agents** (2 actions): Talk to Code-Reviewer (Bot, cyan), Talk to Test-Runner (FlaskConical, emerald)
  - **Workflows** (1 action): Run Ideation → PRD pipeline (Workflow, indigo)
- "+ Customize" button in tile header opens Quick Actions editor (similar to Pin manager)
- Each action card: lucide icon (24px in section color) + label --text-sm font-500 + keyboard shortcut in `<kbd>` element (proper kbd styling: mono font, --bg-inset, --radius-sm, --text-xs, px-6px)
- Actions live in a `useQuickActions` hook with localStorage persistence

==========================================================
FIX 6 — CUSTOMIZE DRAWER: ADD DRAG-TO-REORDER
==========================================================

Current: customize drawer shows widget toggles but no way to reorder.

Implement:
- Install `@dnd-kit/core` + `@dnd-kit/sortable` (if not already)
- Each widget row gets a drag handle (lucide GripVertical 14px in --fg-muted, opacity 0 → 1 on row hover)
- Drag to reorder, smooth animation 200ms
- Order persists in localStorage under `dashboard.widget-order`
- Order is the source of truth for tile rendering position — re-render tiles based on this array
- Visual feedback while dragging: row lifts (translate-y, shadow), other rows animate to make space (layout animation via Framer Motion or dnd-kit's default)

==========================================================
FIX 7 — ADD PAGE BREADCRUMB
==========================================================

Current: page starts directly with greeting bar, no top breadcrumb.

Implement:
- Add a small breadcrumb above the greeting bar (mt-4 from top, mb-3 from greeting):
  - lucide Home icon (12px) + "Workspace" (--text-xs --fg-tertiary) + chevron-right (10px --fg-muted) + "Dashboard" (--text-xs --fg-secondary)
  - Click "Workspace" → goes to /workspace (or first available workspace page)
- Same breadcrumb pattern applies to ALL major routes (forge it as a shared `<PageBreadcrumb>` component)
- Breadcrumb is sticky (sticks below the top shell header when scrolling)

==========================================================
FIX 8 — NOTIFICATION BELL POPOVER
==========================================================

Current: bell has badge "1" but clicking does nothing useful (or navigates to a stub page).

Implement:
- Click bell → opens a Popover (shadcn Popover) anchored to the bell, 380px wide, --bg-elevated, --radius-lg, --shadow-lg
- Header: "Notifications" --text-sm font-600 + "Mark all read" link + filter pills (All / Unread / Critical)
- List of last 5 alerts (same data shape as the "Recent alerts" tile):
  - Each: icon (color-coded) + title --text-sm font-500 + body --text-xs --fg-tertiary (1 line) + time mono --text-xs --fg-muted
  - Critical: rose left border + "Action required" badge
  - Unread: subtle emerald dot indicator on left
  - Hover: bg rgba(255,255,255,0.04)
- Footer: "View all notifications →" link → opens a full Notifications page (Step 18 v2 mentioned this — stub it for now with a "Coming soon" empty state)
- Click outside to close, Esc to close
- Bell badge updates in real-time as new alerts arrive (WebSocket integration)
- Tooltip on bell hover (after 500ms): "1 unread · Click to preview"

==========================================================
FIX 9 — AI INSIGHTS TILE: SHOW MORE
==========================================================

Current: insights tile is cut off — only shows "Your team ran 23% more workflows..." then ends.

Implement:
- Tile height: bump to 320px (was 240px) by default
- Show 2 insights stacked vertically OR 1 long insight with "Read more" expansion
- RECOMMEND: 2 insights stacked, each 140px tall, with subtle divider between
- Each insight card: bg --bg-elevated, --radius-md, p-16px, with left accent strip (4px gradient cyan-to-indigo)
- Insight content:
  - Header: Sparkles icon (12px --accent-cyan) + "Insight 1 of 3" --text-xs --fg-tertiary + relative time
  - Title: --text-sm font-600 --fg-primary (1 line)
  - Body: --text-sm --fg-secondary (max 3 lines, truncate with "Read more")
- Action row below each insight: "View details" + "Ask Co-pilot" (prefills Co-pilot with context) + "Dismiss"
- Footer of tile: "Show 1 more insight" expander OR pagination dots if more than 2 insights
- When 0 insights: empty state — "Insights will appear after 24h of activity. Try running some commands first." + "Open Co-pilot" button

==========================================================
FIX 10 — TEAM ACTIVITY FILTER COUNTS
==========================================================

Current: filter pills "All / Engineering / Product / Design" without counts.

Implement:
- Add counts in muted text after each label: "All (47) · Engineering (23) · Product (15) · Design (9)"
- Counts update dynamically based on underlying data
- Pill style: same as current, but add the count in --text-xs --fg-tertiary after the label
- Selected pill: --bg-elevated + --fg-primary + count also in --fg-primary (visible) or stays muted for consistency

==========================================================
FIX 11 — TODAY'S RUNS TIMELINE DENSITY
==========================================================

Current: timeline shows few bars, looks sparse.

Implement:
- Always show ALL 24 hours, even when no runs: empty hours get ghost bars (1px tall, --bg-elevated, dashed)
- Hover any hour (with or without runs): tooltip showing "12:00 · 3 runs · 2m 14s total"
- Hours with runs: solid bars, height proportional to duration
- Add hour labels on hover only (avoid permanent clutter)
- Background: subtle grid lines every 6 hours (00:00 / 06:00 / 12:00 / 18:00) in --border-subtle
- "Now" indicator: vertical cyan line + label "now" (only when within current day)

==========================================================
FIX 12 — QUICK ACTION KEYBOARD HINT STYLING
==========================================================

Current: ⌘N / ⌘B / ⌘T / ⌘I shown as small text under actions. Looks weak.

Implement:
- Replace inline text with proper `<kbd>` elements styled as:
  - bg --bg-inset, --text-xs font-500, mono font (JetBrains Mono), --fg-secondary
  - px-6px py-2px, --radius-sm, border 1px --border-subtle
  - Group multiple kbd (e.g., ⌘⇧N): inline-flex gap-4px, with subtle spacing between
- Kbd sits inside the action card (not below it) — to the right of the label, right-aligned
- Hide on mobile (<768px) — no keyboard hint needed
- Tooltip on action hover: full shortcut + description (e.g., "Run New Feature (⌘⇧N)")

==========================================================
FIX 13 — REFRESH ALL BUTTON
==========================================================

Current: no way to manually trigger a refresh of all dashboard tiles.

Implement:
- Add a small "Refresh" icon button (lucide RefreshCw 14px) next to the orchestrator status pill in the greeting bar
- Click: rotates the icon (animation 1s), triggers a refresh of ALL dashboard data (re-fetches KPI tiles, recent activity, etc.)
- Disabled state when orchestrator is unreachable (icon greyed out, tooltip "Orchestrator unreachable — cannot refresh")
- Successful refresh: subtle emerald pulse on all tiles (1s border glow) to confirm data updated
- "Last refreshed Xs ago" appears below the greeting for a few seconds after manual refresh, then fades

==========================================================
FIX 14 — FIRST-RUN ONBOARDING STATE
==========================================================

Current: new users with zero data see "—" everywhere. No path forward.

Implement:
- Detect "first run" state: user logged in for first time OR zero runs AND zero agents AND zero workflows
- Show a specialized welcome overlay (NOT a modal — replace the bento grid content):
  - Centered, max-width 640px
  - 80×80 square --bg-elevated --radius-xl with lucide Sparkles 40px --accent-cyan, animate-pulse
  - h1 "Welcome to Forge" --text-3xl font-700 --fg-primary mt-6
  - Body "Your AI workforce lives here. Register your first agent, run your first command, and watch this dashboard come alive with live activity, cost insights, and team coordination." --text-sm --fg-secondary mt-3
  - 3-step onboarding cards in a row:
    1. "Register an agent" + lucide Bot + "Start with a template" button
    2. "Run a command" + lucide Play + "Open Command Center" button
    3. "Connect your repo" + lucide GitBranch + "Browse connectors" button
  - Footer: "Skip onboarding" text link (returns to dashboard in current state)
- After onboarding completes (first agent OR first run triggered), the welcome fades out and normal dashboard appears with a brief emerald pulse celebration

==========================================================
FIX 15 — TILE HOVER AFFORDANCES
==========================================================

Current: tiles don't clearly indicate they're clickable. "Manage agents →" hidden in footer.

Implement:
- Each tile gets a subtle "→ Open" link in top-right corner that appears on hover (opacity 0 → 1, 150ms)
- Style: --text-xs --accent-primary font-500 + ArrowRight icon (12px)
- Click: same as clicking the tile (navigates to the relevant page)
- Move existing "Manage X →" footer links to also be the hover affordance (don't duplicate)
- Some tiles (Cost breakdown, Top agents) are NOT clickable — they don't get the affordance
- For clickable tiles: cursor changes to pointer on hover

==========================================================
CONSTRAINTS
==========================================================

- Do NOT touch the underlying data fetching / WebSocket logic — this is purely UX polish
- All new components: <StaleBadge>, <PageBreadcrumb>, <RefreshButton> go in src/components/dashboard/
- Maintain dark mode only
- All animations respect prefers-reduced-motion
- Customize drawer order persists in localStorage; on first load, fall back to default order
- Notification popover uses shadcn Popover primitive
- Drag-and-drop uses existing @dnd-kit installation (from Step 22)
- All new icons from lucide-react
- Quick Actions editor mirrors the Pin Manager pattern (searchable list of available actions)
- Page breadcrumb is a shared component usable across all major routes (just render with custom crumbs)

==========================================================
DELIVERABLE
==========================================================

For each of the 15 fixes:
1. File(s) modified
2. One-line summary of what changed
3. Before/after if applicable

Then:
- A single before/after screenshot mockup (text-based ASCII) of the dashboard showing the polish
- A "what we deliberately did NOT change" note — keep the engine, data model, layout grid intact; only visual + interaction improvements
- 1-paragraph rationale citing which skill rules shaped each fix
