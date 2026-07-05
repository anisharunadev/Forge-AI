> **Status:** completed
/goal

STEP 4 OF 6 — AGENT CENTER REDESIGN. Foundation, shell, and empty states are done. Now redesign the Agent Center page. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING — pull style and chart guidance:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "bento grid dashboard hero KPI" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "KPI sparkline area chart activity heatmap dashboard" --domain chart -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard information density layout" --domain ux-guideline -f markdown

Apply every rule. Then build:

SCOPE: Agent Center route — find the exact path. Keep the route, tabs (Agents / Model Providers / Assignments / Runtimes), and filter dropdowns. Rebuild the Agents tab as a Bento grid. Lightly enhance the other tabs.

AGENTS TAB — bento layout (desktop ≥1280px; single column <1024px):

ROW 1 (full width, 220px tall):
  Hero card "Build your AI workforce" — bg --bg-surface, --radius-xl, p-32px
  Eyebrow "GET STARTED" --accent-primary --text-xs uppercase tracking-widest
  h2 "Build your AI workforce" --text-2xl font-700 --fg-primary mt-2
  Body "Register agents, attach tools, and assign them to projects." --text-sm --fg-secondary mt-3
  Right: primary "Register Agent" + secondary "Import template"
  Animated border: 1px conic-gradient (indigo → violet → cyan) animate-[spin_8s_linear_infinite] masked to card

ROW 2 (4 equal tiles, 160px tall):
  Total Agents (indigo), Active Runs (cyan), Avg Latency (amber), Success Rate (emerald)
  Each: --text-3xl font-700 number + --text-sm --fg-tertiary label + 60px sparkline (Recharts AreaChart, gradient fill) + delta line --text-xs in semantic color

ROW 3 (2/3 + 1/3, 280px tall):
  Left "Recent agents" — up to 5 rows: avatar + name + status dot + last-run timestamp. Hover bg rgba(255,255,255,0.04)
  Right "Activity heatmap" — 7×24 grid, cells --radius-sm, intensity --bg-inset → --accent-primary, caption "Runs in the last 7 days"

ROW 4 (full width, auto):
  "Top performing model providers" --text-md font-600 + "View all" link
  Horizontal Recharts BarChart layout="vertical", 5 providers, indigo bars, value labels

OTHER TABS:
- Model Providers: same bento style — hero "Connect a provider" + 4 KPI tiles (Active / Tokens / Avg cost / Error rate) + table (Provider / Models / Status dot / Usage sparkline / Actions)
- Assignments: header + "New Assignment" button + assignment cards (project + agent + status + due)
- Runtimes: same as providers

TABS: segmented control — bg --bg-inset container, --radius-md, active pill bg --bg-elevated + --text-sm font-500 + --fg-primary + --shadow-sm. Framer Motion layoutId on the active pill so it slides.

FILTER BAR (above bento, below tabs):
- Status pills with counts, type chips, date range, "More filters" with active-count badge and X to clear all

CONSTRAINTS: only the semantic palette for charts (indigo/cyan/emerald/amber/rose), every chart has Tooltip with formatted values, sparklines are hardcoded sample data with clean prop interfaces for later wiring, Framer Motion only for hero border spin + tab pill slide + card hover lift, prefers-reduced-motion respected, max-width 1440px centered p-32px.

Deliverable: file paths, text sketch of the final layout, 1-paragraph rationale citing which skill rules drove the decisions.
