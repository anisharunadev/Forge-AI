/goal

Modernize the Analytics page in Forge AI Agent OS. Tokens, shell, empty states, error states, and Steps 7–15 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "analytics dashboard KPI chart grid dark" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "data visualization dashboard chart type selection" --domain chart -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard information hierarchy primary metric secondary" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/analytics/page.tsx. Keep route. Rebuild.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Analytics Center" --text-3xl font-700 with lucide BarChart3 icon in --accent-primary
- Body "Platform-wide metrics for the last 30 days. Cost, throughput, acceptance, and knowledge reuse at a glance."
- Top-right: Date range picker (Popover: Last 7d / 30d / 90d / Custom), Compare to previous period toggle, Export (CSV / JSON) icon button

KPI TILE ROW (4 tiles, 160px tall, gap-4):
- Total Cost (30d): --text-3xl font-700 number + dollar icon + delta "↓ 2.4%" rose/--accent-emerald based on direction + 40px sparkline
- Active Runs: same shape, Activity icon, cyan
- Acceptance Rate: same shape, CheckCircle2 icon, emerald
- Knowledge Reuse: same shape, BookMarked icon, violet

CHART GRID — bento layout (2 rows on desktop ≥1280px):

ROW 1 (2 equal tiles, 320px tall):
- Cost trend (30d): Recharts AreaChart, indigo gradient fill, X axis dates (auto-format: "Mon", "Tue"...), Y axis USD. Show legend if multi-series. Tooltip on hover with formatted value. "USD per day" label top-right
- Runs by status: Recharts BarChart (stacked), 5 stacks (Queued / Running / Succeeded / Failed / Cancelled) with semantic colors. "0 total" top-right when empty

ROW 2 (3 tiles, 280px tall, 2:2:3 ratio):
- Acceptance: Recharts LineChart, emerald, % over time
- Agent usage: horizontal BarChart (top 10 agents by run count), indigo bars
- Approval latency: Recharts AreaChart, amber gradient, p50/p95/p99 lines (or single average if not enough data)

ROW 3 (2 tiles, 280px tall):
- Knowledge reuse: Recharts RadialBarChart (gauge) showing 0% center, ring fills to actual %. Below the ring: "Knowledge reuse" label + 30d delta
- Token usage by model: Recharts PieChart (or stacked horizontal Bar if 5+ slices), indigo/cyan/emerald/amber/rose, max 5 slices

ROW 4 (full width tile, 240px tall):
- Cost breakdown: Recharts BarChart stacked by provider, X = date, stacks = OpenAI / Anthropic / Other
- Below chart: a small horizontal "Provider cost leaderboard" — top 3 providers with rank, name, $ amount, % of total

EMPTY STATE (current screenshot — "No analytics data yet"):
- Replace the current empty state. Use Step 3 EmptyState, illustration = BarChart3
- Title "No analytics data yet"
- Description "Cost, run, and acceptance metrics will appear here once the first agent run completes."
- Primary: "Run your first command" (links to /workflows)
- Secondary: "How analytics works" (links to docs)
- IMPORTANT: when empty state shows, hide the chart tiles (they'd be all-zeros = misleading). Show only KPI tiles with $0.00 / 0 / 0% / 0% placeholders + the empty state below

SKELETON STATE (data loading): each chart tile shows a skeleton with shimmer sweep matching its shape (line for area, bars for bar, ring for gauge)

INTERACTIONS:
- All charts: Tooltip on hover with formatted values + date. Crosshair on line/area charts
- Chart legend items clickable to toggle series visibility
- Click a bar/segment to filter the page (e.g., click "Failed" stack in Runs by status → all charts re-filter to failed runs only)
- Date range change animates chart transitions (Framer Motion + Recharts animation)

EXPORT:
- Export icon top-right → opens Popover with CSV / JSON options. CSV = flattened rows. JSON = raw API response
- Currently disabled when no data — show toast on click

CONSTRAINTS: only the semantic palette (indigo/cyan/emerald/amber/rose/violet); every chart has Tooltip with formatted values; Recharts animation respects prefers-reduced-motion; sparklines inline next to all KPIs; max-width 1600px container; responsive: 2-col tablet, 1-col mobile.

Deliverable: files modified, chart components created in src/components/charts/, layout sketch, 1-paragraph rationale citing skill rules.