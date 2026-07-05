> **Status:** completed
/goal

Modernize the Dashboard page — the first thing users see on login. Tokens, shell, empty states, error states, and Steps 7–17 are done. Read .claude/design-system/ first.

CURRENT STATE (bad): two static CTA cards + a broken empty state. The dashboard should feel like a live mission control for an AI workforce — not a dead end. The user's brief: "curate more running agents, more information."

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "live dashboard real-time activity feed KPI bento" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard personal greeting context quick action shortcut" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "real-time streaming UI live update websocket activity indicator" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard chart KPI sparkline area bar donut dark" --domain chart -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/dashboard/page.tsx (find exact path). Keep route. Total rebuild.

GREETING BAR (top, --bg-base with subtle aurora gradient bg, p-32px, mb-8):
- Left: "Good {morning|afternoon|evening}, Arun 👋" h1 --text-3xl font-700 --fg-primary (replace 👋 with lucide Hand icon, NEVER emojis as UI icons — actually use lucide Sparkles or Hand metal)
- Sub: "Tuesday, June 25 · Acme Corp (Dev Demo) · 3 agents active across 2 projects" --text-sm --fg-secondary
- Right: tenant health pill (emerald pulsing dot + "All systems normal" or amber + "Orchestrator unreachable" — see CONNECTIVITY section)
- Far right: 3 quick action buttons — "+ New run" primary (Zap icon), "Command palette" outline (Command icon), "Ask Co-pilot" outline (Sparkles icon, cyan accent)

ORCHESTRATOR WARNING BANNER (conditional — current screenshot shows this):
- When API unreachable: bg rgba(245,158,11,0.08), border rgba(245,158,11,0.30), --radius-lg, p-16px, mb-6
- Left: TriangleAlert in --accent-amber
- Title "Orchestrator unreachable" --text-sm font-500
- Body "Forge console could not reach the orchestrator REST API at FORA_FORGE_API_URL (default http://localhost:4000). Start it with `./scripts/dev-up.sh` or check the orchestrator logs. or run the full stack: pnpm dev:stack" --text-xs --fg-secondary
- Mono code chips: "./scripts/dev-up.sh" and "pnpm dev:stack" — copy on click
- Right: "Retry now" ghost button + auto-retry indicator "Attempt 3/∞ · next in 8s"
- When reconnected: banner animates out (slide up + fade), success toast "Orchestrator reconnected"

KPI STRIP (6 tiles, 140px tall, gap-4, mb-8):
1. Active Agents (cyan, lucide Bot icon) — live count + "X of Y online" + 40px sparkline
2. Runs Today (indigo, lucide Play icon) — count + delta vs yesterday + sparkline
3. Success Rate (emerald, lucide CheckCircle2 icon) — % + delta + sparkline
4. Avg Latency (amber, lucide Clock icon) — ms + delta + sparkline
5. Cost Today (rose, lucide DollarSign icon) — $ + delta vs daily ceiling + progress bar showing ceiling usage
6. Tokens Used (violet, lucide Coins icon) — count formatted + delta + sparkline
Each tile: bg --bg-surface, --radius-lg, border --border-subtle, hover lift --shadow-md, 200ms

MAIN BENTO GRID (3 rows on desktop ≥1440px, 2 cols ≥1024px, 1 col <1024px, gap-4):

ROW 1 (3 tiles, 320px tall):
TILE A (flex-2): "LIVE ACTIVITY" — real-time activity feed
- Header: h3 "Live activity" --text-md font-600 + emerald pulsing dot + "Streaming" badge + "Pause" toggle
- List (max 20, virtualized if more): each entry = timestamp (--text-xs mono --fg-tertiary) + agent avatar (24px) + agent name + action verb (color-coded: started=cyan, completed=emerald, failed=rose, paused=amber) + target + duration. New entries slide in from top with subtle highlight (emerald background fade-out over 2s)
- Footer: "View all runs →" --text-sm --accent-primary link

TILE B (flex-1): "YOUR AGENTS" — agent status grid
- Header: h3 "Your agents" --text-md font-600 + count "N registered"
- 3-column grid of agent mini-cards (up to 9 visible, scroll for more): each = 64×64 square with agent icon + status dot (emerald=idle, cyan pulse=running, amber=paused, rose=error) + name --text-xs font-500 truncated + current task --text-xs --fg-tertiary truncated. Hover: shows tooltip with full status. Click: navigates to /agents
- Footer: "Manage agents →" link

TILE C (flex-1): "TODAY'S RUN TIMELINE" — gantt-style strip
- Header: h3 "Today's runs" + count "N runs"
- 24-hour horizontal timeline (00:00 → 24:00): each run = horizontal bar positioned by start time, length = duration. Bar color = status (emerald/rose/amber/cyan). Hover bar: shows run ID + agent + duration. Click: opens run detail drawer (reuses Step 14's drawer)
- "Now" indicator: vertical line at current hour with cyan pulse

ROW 2 (3 tiles, 280px tall):
TILE D (flex-1): "COST BREAKDOWN" — Recharts RadialBarChart
- Header: h3 "Cost by category" + "Last 24h" + total $ center
- Radial: 4 rings (Agents, Models, Tools, Infrastructure) with semantic colors. Hover: tooltip with $ + %

TILE E (flex-2): "RUNS TIMELINE" — Recharts AreaChart
- Header: h3 "Runs · last 24h" + legend (Succeeded emerald / Failed rose / Running cyan)
- Stacked area, X = hour, Y = count. Gradient fills. Crosshair on hover with formatted tooltip

TILE F (flex-1): "TOP AGENTS" — Recharts horizontal BarChart
- Header: h3 "Top agents · 7d"
- Top 5 agents by run count, indigo bars, value labels at end. Hover: tooltip with full stats

ROW 3 (2 tiles, 240px tall):
TILE G (flex-1): "PENDING APPROVALS" — compact list
- Header: h3 "Needs your attention" --text-md font-600 + count badge (amber if >0)
- Empty: muted "All caught up ✓" with emerald check icon
- Populated: top 3 approval requests — each row = submitter avatar + title + submitted-at + Approve (emerald outline) / Reject (rose outline) inline buttons
- Footer: "View all approvals →"

TILE H (flex-1): "RECENT IDEAS" — compact list
- Header: h3 "Recent ideas" --text-md font-600
- Top 3 ideas from Ideation Center — each row = score badge + title + author + status dot + relative time
- Footer: "Open ideation center →"

ROW 4 (full width, 240px tall): "QUICK LAUNCH" — command palette-style grid
- Header: h3 "Quick launch" --text-md font-600 + sub "Common commands and destinations" --text-sm --fg-secondary
- 8 mini-cards in 4-col grid: each = lucide icon (in semantic color) + label --text-sm font-500 + shortcut hint. Examples:
  1. New feature run (Sparkles, indigo, ⌘⇧N)
  2. Fix bug run (Wrench, amber, ⌘⇧B)
  3. Review PR (GitPullRequest, violet)
  4. Browse agents (Bot, cyan)
  5. Open terminal (Terminal, emerald, ⌘⇧T)
  6. View audit log (Shield, indigo)
  7. Analytics (BarChart3, violet)
  8. Settings (Settings, muted)
- Click: navigates OR opens command palette with that action focused

CONNECTIVITY HANDLING — the dashboard must work gracefully when orchestrator is down:
- All KPI tiles show "—" + "--" sparkline instead of fake zeros
- Live activity tile: shows error-state.tsx (from Step 13) inline — "Live activity paused — orchestrator unreachable. Recent activity will resume when reconnected."
- Agent grid: shows last-known state with "Last seen Xm ago" timestamp, status dot becomes muted
- Timeline: shows last 24h with "(stale)" badge — does NOT animate
- "Retry now" button visible top-right of dashboard
- When reconnected: all tiles simultaneously refresh with a subtle emerald pulse border (1s)

PERSONALIZATION:
- Greeting time-aware (morning/afternoon/evening based on user's timezone from Step 9's settings)
- Quick actions customizable in user menu (gear icon next to avatar → "Customize dashboard" — opens a modal with toggle list of which tiles to show, drag to reorder). Save to localStorage
- Dashboard remembers last visited tab if you implement tabbed sections later

PERFORMANCE:
- Stream live updates via WebSocket with reconnection logic (reuse Step 15's pattern)
- Throttle KPI tile sparklines to update max once per 5s
- Lazy-load charts below the fold (Recharts is heavy)
- Skeleton shimmer on initial load — match exact tile shapes, not generic boxes
- prefers-reduced-motion: disable streaming slide-in animation, pulse effects become static, transitions 0ms

CONSTRAINTS:
- All KPI numbers in mono font (JetBrains Mono) for alignment
- Every tile has a clear "what am I looking at" sub-label or tooltip
- Color is NEVER the only signal (icon + text always paired)
- Max-width 1600px container, p-32px outer
- Responsive: at <1024px the bento grid collapses to single column with KPI tiles in a 2×3 grid
- All empty/error/loading states use components from Steps 3, 13, 14
- Lucide icons only — no emojis
- All copy in the tone of voice established in Steps 3 and 16 (action-oriented, benefit-framing)

Deliverable: files modified, new dashboard sub-components in src/components/dashboard/, layout sketch in text, 1-paragraph rationale citing which skill rules shaped each row, and the full KPI tile spec as a reference doc for the team.
