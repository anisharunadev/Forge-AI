/goal

The Dashboard is still showing the OLD two-card layout + broken runs section — Step 18 wasn't implemented or got reverted. Now build it properly with the user's additional ask: "we need to curate improve more feature." Read .claude/design-system/ first.

USER INTENT: this is the first page users see on login. It needs to feel like a real mission control for an AI workforce — not a dead-end with two CTA cards. The user explicitly wants MORE features curated, not just the basics.

INVOKE THE SKILL BEFORE CODING (more thoroughly this time — the dashboard is the highest-leverage surface):
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard mission control operations center live KPI activity" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard personal greeting time-aware widget layout customizable" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "real-time streaming live update websocket dashboard tile" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard chart KPI sparkline area bar donut gauge radial" --domain chart -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "notification center inbox alerts activity feed" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "pinned favorites quick actions shortcuts personalized" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/dashboard/page.tsx. Total rebuild.

==========================================================
ZONE 1 — GREETING + COMMAND BAR (top, sticky)
==========================================================

GREETING BAR (h-120px, --bg-base with subtle aurora gradient bg behind, p-32px, mb-6):
- Left cluster:
  - Time-aware greeting h1 --text-3xl font-700 --fg-primary: "Good {morning|afternoon|evening}, Arun"
  - lucide Hand (16px) inline AFTER the name (NOT emoji 👋)
  - Sub: "Tuesday, June 25 · Acme Corp (Dev Demo) · 3 agents active across 2 projects" --text-sm --fg-secondary
- Right cluster:
  - Tenant health pill (emerald pulse + "All systems normal" OR amber + "Orchestrator unreachable" — see connectivity below)
  - "Customize" ghost icon button (lucide LayoutGrid) — opens widget customization drawer
  - Theme toggle (sun/moon)
  - Notifications bell with unread badge (lucide Bell, badge count)

CONNECTIVITY BANNER (full width, only when API down):
- bg rgba(245,158,11,0.08), border rgba(245,158,11,0.30), --radius-lg, p-16px
- TriangleAlert in --accent-amber + title "Orchestrator unreachable" + body explaining + code chips (./scripts/dev-up.sh, pnpm dev:stack) + "Retry now" + auto-retry counter
- Animates OUT when reconnected

QUICK COMMAND BAR (mt-4, full width, --bg-surface, --radius-xl, --shadow-md, p-12px flex gap-3):
- Lucide Search icon left
- Input placeholder "Ask Forge to do anything — try 'summarize today's runs' or / for commands"
- "/" trigger: slash commands popover (reuse from Step 24)
- "@" trigger: context picker
- Right cluster: "+ New run" primary button (Zap icon), "Open Co-pilot" outline button (Sparkles icon, cyan)
- Keyboard: ⌘K focuses this bar (replaces Command palette from Step 2 — better discoverability)

==========================================================
ZONE 2 — KPI STRIP (6 tiles)
==========================================================

KPI TILE ROW (140px tall, gap-4, mb-6):
1. **Active Agents** (cyan, Bot icon) — live count + "X of Y online" + 40px sparkline + click → navigates to /agents
2. **Runs Today** (indigo, Play icon) — count + delta vs yesterday + sparkline + click → /runs
3. **Success Rate** (emerald, CheckCircle2) — % + delta + sparkline + click → /runs?status=success
4. **Avg Latency** (amber, Clock) — ms + delta + sparkline + click → /runs?sort=latency
5. **Cost Today** (rose, DollarSign) — $ + delta + progress bar showing daily ceiling usage + click → /analytics?tab=cost
6. **Tokens Used** (violet, Coins) — count formatted + delta + sparkline + click → /analytics?tab=tokens

Each tile: bg --bg-surface, --radius-lg, border --border-subtle, hover lift + slight glow, 200ms. KPI numbers mono font.

==========================================================
ZONE 3 — MAIN BENTO (3 rows on desktop ≥1440px, 2 cols ≥1024px)
==========================================================

ROW 1 (3 tiles, 320px tall, gap-4, mb-4):

TILE A (flex-2): "LIVE ACTIVITY" — real-time activity feed
- Header: h3 "Live activity" + emerald pulse dot + "Streaming" badge + count + Pause/Resume toggle + "Open Runs →" link
- Activity list (max 20, virtualized, latest on top):
  - Each entry: timestamp mono --text-xs --fg-tertiary + agent avatar (24px) + agent name --text-sm font-500 + action verb (color-coded chip: started=cyan, completed=emerald, failed=rose, paused=amber) + target --text-sm --fg-secondary + duration mono
  - New entries slide in from top with emerald highlight fade-out (2s)
  - Click → opens run detail drawer (Step 14)
- Footer: "Pause stream" toggle + "View all runs →"
- Empty (when API down): inline ErrorState from Step 13 + "Recent activity will resume when reconnected"

TILE B (flex-1): "YOUR AGENTS" — agent status grid
- Header: h3 "Your agents" --text-md font-600 + count "N registered" + "+ Register" link
- 3-column grid of mini-cards (up to 9 visible, scroll for more):
  - Each: 64×64 square --bg-elevated --radius-md + agent icon + status dot (emerald=idle, cyan pulse=running, amber=paused, rose=error) + name --text-xs font-500 truncate + current task --text-xs --fg-tertiary truncate
  - Hover: tooltip with full status + last activity
  - Click → /agents/[id]
  - RUNNING agents: pulsing cyan border + small "live" tag
- Footer: "Manage agents →"

TILE C (flex-1): "TODAY'S RUNS TIMELINE"
- Header: h3 "Today's runs" + count + legend dots
- Horizontal 24h timeline (00:00 → now → 24:00 with "now" indicator):
  - Each run = horizontal bar positioned by start, length = duration, color = status
  - Hover bar: tooltip with run id + agent + duration
  - Click bar: opens run drawer
  - Now indicator: vertical cyan line with pulse
- Empty: muted "No runs today yet" + "Run a command →"

ROW 2 (3 tiles, 280px tall, gap-4, mb-4):

TILE D (flex-1): "COST BREAKDOWN" — Recharts RadialBarChart
- Header: h3 "Cost by category" + "Last 24h" + total $ center
- 4 rings: Agents (indigo), Models (cyan), Tools (amber), Infrastructure (rose)
- Hover: tooltip with $ + %

TILE E (flex-2): "RUNS OVER TIME" — Recharts AreaChart
- Header: h3 "Runs · last 24h" + legend (Succeeded emerald, Failed rose, Running cyan)
- Stacked area, X = hour, Y = count, gradient fills
- Crosshair on hover with formatted tooltip
- Click bar segment: filters the runs feed above

TILE F (flex-1): "TOP AGENTS" — Recharts horizontal BarChart
- Header: h3 "Top agents · 7d" + "All →"
- Top 5 agents by run count, indigo bars, value labels
- Hover: tooltip with full stats

ROW 3 (2 tiles, 240px tall, gap-4, mb-4):

TILE G (flex-1): "PENDING APPROVALS" — needs attention
- Header: h3 "Needs your attention" --text-md font-600 + count badge (amber if >0)
- Empty: emerald check icon + "All caught up ✓" muted
- Populated: top 3 approval requests — each row = submitter avatar + title + submitted-at + Approve (emerald outline) / Reject (rose outline) inline buttons + "Open" link
- Footer: "View all approvals →"

TILE H (flex-1): "RECENT IDEAS" — from ideation center
- Header: h3 "Recent ideas" + "All →"
- Top 3 ideas: score badge + title + author + status dot + relative time
- Footer: "Open ideation center →"

ROW 4 (NEW — curated by user request, 2 tiles, 240px tall, gap-4, mb-4):

TILE I (flex-2): "AI INSIGHTS" — Co-pilot generated daily digest
- Header: h3 "Today's AI insights" + Sparkles icon in --accent-cyan + "Generated 2h ago" + refresh icon button
- INSIGHT CARD: bg --bg-elevated, --radius-lg, p-20px, border --border-subtle with a subtle gradient accent strip on the left (cyan-to-indigo, 4px)
- Content: AI-generated summary (markdown rendered) — examples:
  - "Your team ran 23% more workflows than last Tuesday, with 91% success rate. The 'Bug fix workflow' was the top performer, averaging 4m 12s per execution."
  - "Cost spike detected: The 'Refactor' workflow used 2.3× more tokens than usual yesterday. Likely cause: large legacy file (~8k lines) in acme-corp/forge-platform."
- Actions below insight: "View details" + "Ask Co-pilot" + "Dismiss"
- Multiple insights stack: "Show 2 more insights" expander
- Empty (first-time user): muted "Insights will appear after 24h of activity. Try running some commands."

TILE J (flex-1): "PERSONAL STATS" — your contribution
- Header: h3 "Your impact this week" + "Me" badge
- 3 metrics stacked:
  - Runs initiated: 47 + delta
  - Time saved: ~14h + delta (vs manual estimate)
  - Cost approved: $32.40
- Mini progress bar showing "Weekly goal: 50 runs" (current 47/50, 94%)
- Footer: "View your stats →"

ROW 5 (NEW — curated by user request, 2 tiles, 200px tall, gap-4, mb-4):

TILE K (flex-1): "PINNED" — your favorite quick-access items
- Header: h3 "Pinned" + count + "Manage" link
- Grid of pinned items (max 6): each = 56×56 mini-tile with icon + label below. Pinned items can be: agents, workflows, commands, pages. Right-click to unpin. Drag to reorder
- Empty: dashed border container "Pin agents, workflows, or pages for one-click access" + "Show me how" link
- Footer: "Customize pins →"

TILE L (flex-1): "QUICK ACTIONS" — common commands one-click
- Header: h3 "Quick actions" --text-sm font-600 + customize icon
- 4 mini-cards in 2×2 grid: each = icon + label + keyboard shortcut. Suggestions:
  - Run "New feature" (Sparkles, indigo, ⌘⇧N)
  - Run "Fix bug" (Wrench, amber, ⌘⇧B)
  - Open Terminal (Terminal, emerald, ⌘⇧T)
  - Create idea (Lightbulb, cyan, ⌘⇧I)
- Click: dispatches the command directly OR opens Co-pilot with prompt pre-filled

ROW 6 (NEW — curated, full width tile, 220px tall, mb-6):

TILE M: "TEAM ACTIVITY" — what teammates are doing
- Header: h3 "Team activity today" + filter pills (All / Engineering / Product / Design)
- Compact horizontal timeline OR avatar row with stacked avatars + recent actions:
  - "Arun started 3 workflows" (3m ago)
  - "Priya approved an ADR" (12m ago)
  - "Marcus's agent fixed a bug" (24m ago)
- Each entry: actor avatar + action verb + target + time
- Click → navigates to related entity
- Footer: "Open activity feed →"

ROW 7 (NEW — curated, full width tile, 200px tall):

TILE N: "NOTIFICATIONS & ALERTS" — inbox-style recent alerts
- Header: h3 "Recent alerts" + "Mark all read" + filter (All / Unread / Critical)
- List of last 5 notifications:
  - icon (AlertTriangle rose / CheckCircle emerald / Info cyan) + title + body snippet + time
  - Critical items: rose left border + "Action required" badge
  - Click → expands or navigates
- Empty: "No alerts. Quiet day ✓"
- Footer: "Open notification center →" (could open a slide-out panel with full history)

==========================================================
ZONE 4 — CUSTOMIZATION (the curated feature the user wants)
==========================================================

CUSTOMIZE LAYOUT button (lucide LayoutGrid in greeting bar) → opens Drawer from right:

LAYOUT CUSTOMIZATION DRAWER (480px wide):
- Header: "Customize dashboard" + "Reset to default" link + Done button
- Section: WIDGETS — list of all available widgets with toggles
  - Each row: lucide icon + widget name --text-sm + description --text-xs --fg-tertiary + Switch toggle + drag handle for reorder
  - Available widgets: KPI strip, Live activity, Your agents, Today's runs, Cost breakdown, Runs over time, Top agents, Pending approvals, Recent ideas, AI insights, Personal stats, Pinned, Quick actions, Team activity, Recent alerts
- Section: PRESETS — 3 preset layouts:
  - "Engineering Lead" — focused on runs, cost, agents
  - "Product Manager" — focused on ideas, approvals, team
  - "Operator" — minimal, focused on what's broken
  - Each preset card: preview thumbnail (small) + name + Apply button
- Section: REFRESH INTERVAL — radio: Real-time / 30s / 5m / Manual
- Section: THEME — Dark (only option for now) + density (Comfortable / Compact)
- Save persists per user in localStorage + backend profile

PIN MANAGER (from "Manage" link in Pinned tile):
- Drawer: "Pin things for one-click access" + browseable list (agents, workflows, pages, commands)
- Click "Pin" on any item — adds to dashboard
- Drag to reorder
- Max 8 pins

==========================================================
ZONE 5 — FLOATING ELEMENTS
==========================================================

NOTIFICATION CENTER (top-right bell in greeting bar):
- Click bell → opens popover with last 10 alerts (full)
- Each alert: icon + title + body + time + "Mark read" + "View"
- Footer: "All notifications →" (full page)
- Critical alert: rose pulse on bell, badge increments

FLOATING CO-PILOT (already exists from Step 19 — verify visible)
- Bottom-right FAB with cyan/indigo gradient + Sparkles icon
- Already verified visible in screenshots — keep it

==========================================================
CONNECTIVITY HANDLING — graceful degradation
==========================================================

When orchestrator is DOWN (current screenshot state):
- ALL KPI tiles show "—" + "--" sparkline (not fake zeros)
- Live Activity tile: inline error-state, "Recent activity will resume when reconnected"
- Agent grid: shows last-known state with "Last seen Xm ago", status dot muted
- Timeline: shows last 24h with "(stale)" badge — does NOT animate
- AI Insights: "(stale — refresh paused)" badge
- "Retry now" button visible top-right of dashboard
- When reconnected: all tiles simultaneously refresh with emerald pulse border (1s)

==========================================================
LOADING / ERROR / EMPTY
==========================================================

- INITIAL LOAD: skeleton tiles matching exact shape (not generic boxes), shimmer sweep
- FULL EMPTY (new user, no data): dashboard shows the AI Insights tile with a welcome message: "Welcome to Forge! Your dashboard will populate as you start using the platform. Try running a command from the Quick Actions below."
- ERROR (full page fetch fails): use error-state.tsx (Step 13) full variant with retry

==========================================================
PERFORMANCE
==========================================================

- WebSocket for live updates (reuse Step 15 pattern), reconnection logic
- Throttle sparkline updates to max 1 per 5s
- Lazy-load charts below the fold (Recharts is heavy)
- Skeleton shimmer on initial load
- prefers-reduced-motion: disable streaming slide-in, pulse effects become static

==========================================================
CONSTRAINTS
==========================================================

- ALL existing dashboard code in the file gets replaced — clean slate
- Tokens from Step 1 throughout (no pure black, no bg-black)
- KPI numbers in JetBrains Mono
- Color paired with icons (never color alone)
- Max-width 1600px container
- Responsive: <1024px bento collapses to single column, KPI tiles 2×3
- Lucide icons only
- Empty/error/loading components from Steps 3, 13
- Customize drawer must persist to backend (mock with localStorage for now)

Deliverable: files modified, new components in src/components/dashboard/, full layout sketch in text (zone by zone), 1-paragraph rationale citing skill rules, and a "curation notes" section explaining which extra features (insights, personal stats, pinned, quick actions, team, alerts, customization) were added beyond the original spec and why.