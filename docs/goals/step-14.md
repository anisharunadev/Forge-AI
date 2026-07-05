> **Status:** completed
/goal

Modernize the Runs page in Forge AI Agent OS. Tokens, shell, empty states, error states, and Steps 7–13 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "data table virtualized list filter sort dark" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "log timeline activity stream run history status" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "error state retry accessible empty state" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/runs/page.tsx. Keep route. Rebuild for both populated and error/empty states.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Runs" --text-3xl font-700 with a lucide Activity icon in --accent-primary
- Body "Every agent execution across this tenant. Click any run to inspect inputs, outputs, traces, and cost."
- Top-right: "Live" status pill (emerald pulsing dot + "Live" --text-xs) when streaming; "Refresh" icon button

KPI STRIP (4 tiles, 120px tall, gap-4):
- Active runs (cyan, count + "running now"), Succeeded today (emerald, count + delta), Failed today (rose, count + delta), Total cost today (indigo, $X.XX + delta)
- Each tile uses Step 1 tokens

FILTER BAR (below KPIs, full width, --bg-surface, --radius-lg, p-16px, gap-3):
- Status pills (All / Running / Succeeded / Failed / Queued) with count badges
- Agent dropdown (Combobox, searchable)
- Command dropdown (Combobox)
- Date range (Popover with calendar)
- "More filters" button (opens Dialog with advanced: cost min/max, duration min/max, tags)

TABLE (virtualized — use @tanstack/react-virtual):
- Columns: Status dot + label · Run ID (mono, truncated, copy on hover) · Agent (avatar + name) · Command name · Started (relative time, absolute on hover) · Duration · Cost (USD) · Tokens · Actions menu
- Row hover: bg rgba(255,255,255,0.04)
- Active row: bg rgba(99,102,241,0.10) + 2px left rail --accent-primary
- Row click: opens run detail drawer (right side, 720px wide, slides in)
- Click row's status cell: navigates to live trace view
- Click row's run ID: copies to clipboard + toast "Run ID copied"
- Bulk select: checkbox column left, "Select all visible" header, "N selected" floating action bar at bottom with bulk actions (Cancel / Rerun / Export)
- Column headers are sortable (click toggles asc/desc, lucide ChevronUp/ChevronDown indicator)
- Pagination: virtualized (infinite scroll loads 50 more on near-bottom), no traditional pagination UI

RUN DETAIL DRAWER (right slide-in):
- Header: Run ID + status badge + close X
- Tabs inside drawer: Overview · Input · Output · Trace · Logs · Cost · Artifacts
- Overview tab: KPI tiles (Duration / Cost / Tokens / Started) + agent info + command used + summary
- Input tab: JSON viewer with syntax highlighting + copy button
- Output tab: rendered markdown + copy button + "Open in editor" link
- Trace tab: timeline of agent steps (vertical timeline, each step = icon + name + duration + status)
- Logs tab: virtualized log stream (mono font, colored by log level: info cyan, warn amber, error rose, debug muted), filterable, with "Jump to bottom" floating button
- Cost tab: breakdown by token type + provider + a small bar chart
- Artifacts tab: list of files produced with download links

EMPTY STATE (no runs yet): use Step 3 EmptyState, illustration = PlayCircle, title "No runs yet", description "Runs appear here once an agent executes a command. Trigger one from the Command Center.", primary "Open Command Center", secondary "Read docs"

EMPTY STATE (filtered to zero): compact Step 3 variant, illustration = SearchX, title "No runs match these filters", primary "Clear filters"

ERROR STATE (current screenshot — "We hit an unexpected error"): use the error-state.tsx from Step 13
- BUT: also auto-detect known error patterns:
  - "Cannot read properties of undefined (reading 'status')" → likely missing run data → "This run's data is incomplete" + "View raw payload" + "Report issue"
  - Network errors → "Connection lost" + "Reconnect" button with retry counter
  - 5xx → "The Runs service is temporarily unavailable" + "Try again" + "Status page" link
- Title + technical message + suggested action + "Report issue" link that opens pre-filled GitHub issue with error context (run never includes PII)

LOADING STATE: skeleton rows matching table layout (not spinners). Show 10 placeholder rows

CONSTRAINTS: virtualized table handles 10k+ rows without lag; drawer supports Esc to close + ArrowLeft to go back; live runs stream updates via WebSocket (mock for now); all chart icons from lucide; prefers-reduced-motion respected; max-width 1600px container.

Deliverable: files modified, package additions (@tanstack/react-virtual), layout sketch, 1-paragraph rationale citing skill rules.
