/goal

Modernize the Architecture Center in Forge AI Agent OS — currently has 6 tabs (ADRs / API Contracts / Task Breakdowns / Risk Registers / Traceability / Versions) all with minimal content and a broken empty state on ADRs (says "No ADRs yet" while count shows 6). User wants every tab curated and modernized with as many features as possible. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "architecture decision record ADR viewer editor template" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "API contract OpenAPI viewer endpoint documentation Swagger" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "risk register matrix likelihood impact heat map" --domain chart -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "requirements traceability matrix coverage analysis graph" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "tech radar radar diagram technology assessment adoption ring" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/architecture/page.tsx. Keep route. Total rebuild of every tab.

FIX BUG FIRST: the ADRs tab shows count "6" but says "No ADRs yet" — there's a state mismatch. Audit the data flow before adding features.

==========================================================
ZONE 1 — HEADER + GLOBAL TOOLS
==========================================================

HERO BAND (animated gradient border):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Architecture Center" --text-3xl font-700 with lucide Network icon in --accent-indigo
- Body "ADRs, API contracts, task breakdowns, risk registers, and full traceability from requirement to test."
- Top-right cluster:
  - **Health badge**: composite of (ADRs valid, APIs documented, Tasks tracked, Risks acknowledged, Coverage %) — emerald check or amber/rose for issues
  - **Conflicts warning** (only when >0): rose pill + count + "Resolve →" (reuse from current screenshot)
  - **Architecture diagram link** (NEW): lucide GitMerge icon + "View diagram" link to /architecture/diagram
  - **"New" dropdown** (replaces single "+ New ADR"): Menu with: New ADR / New API / New Task / New Risk / Upload OpenAPI / Import from repo

==========================================================
ZONE 2 — TAB BAR (expanded to 9)
==========================================================

TAB BAR (segmented control, horizontal scroll on overflow):
1. **Overview** (NEW — default) — architecture health dashboard
2. **ADRs** (6) — decision records
3. **API Contracts** (0) — endpoint contracts
4. **Task Breakdowns** (0) — work decomposition
5. **Risk Registers** (0) — risk tracking
6. **Traceability** (0) — requirements → tests chain
7. **Versions** (0) — version history
8. **Tech Radar** (NEW) — technology adoption assessment
9. **Diagrams** (NEW) — visual architecture explorer

Count badges. Color-coded by health: emerald = healthy, amber = warning, rose = conflict.

==========================================================
ZONE 3 — OVERVIEW TAB (new default)
==========================================================

HEALTH DASHBOARD (bento layout):

KPI STRIP (5 tiles, 120px tall):
1. **ADRs accepted** (indigo) — count + "% of decisions documented" + sparkline
2. **APIs documented** (cyan) — endpoint count + "X endpoints across Y services" + sparkline
3. **Tasks tracked** (emerald) — count + completion % + sparkline
4. **Active risks** (rose) — count + trend arrow + sparkline
5. **Coverage** (amber) — requirement-to-test coverage % + sparkline

ROW 1 (3 tiles, 320px tall):

TILE A (flex-2): "ARCHITECTURE HEALTH SCORECARD"
- Composite gauge (Recharts RadialBarChart): overall architecture health score 0-100
- Sub-scores around it: ADRs (X/100), APIs (X/100), Tasks (X/100), Risks (X/100), Coverage (X/100)
- Each sub-score color: emerald ≥80, amber 60-79, rose <60
- "View detailed scorecard →"

TILE B (flex-1): "RECENT DECISIONS"
- Last 5 ADRs/actions: title + date + status badge + author avatar
- Click → opens ADR

TILE C (flex-1): "TOP RISKS"
- Top 3 risks by severity score: title + likelihood × impact badge + owner + "Mitigate" link
- Heat map mini (3×3 grid) showing distribution

ROW 2 (2 tiles, 280px tall):

TILE D (flex-1): "API COVERAGE"
- Donut chart: endpoints documented vs undocumented
- Center: total endpoint count
- Below: list of services with documentation % (progress bar each)

TILE E (flex-1): "TASK COMPLETION"
- Stacked bar: completed (emerald) / in-progress (cyan) / blocked (amber) / not-started (muted)
- Per epic / per sprint breakdown

ROW 3 (full width, 240px tall):

TILE F: "DECISION VELOCITY"
- Line chart: ADRs accepted per week over last 12 weeks
- Shows pace of architectural decisions
- Annotations: spikes with names of major decisions

ROW 4 (full width, 200px tall):

TILE G: "ACTIVITY FEED"
- Timeline of last 10 architecture-related events across all tabs
- Color-coded by entity type
- "View full activity →"

==========================================================
ZONE 4 — ADRS TAB (FIXED + ENHANCED)
==========================================================

MASTER-DETAIL LAYOUT (320px list + flex-1 editor):

LEFT SIDEBAR (sticky, --bg-surface, --radius-lg, border-r --border-subtle):
- Header: search input "Search ADRs..."
- Filter chips (multi-select): Status (All / Draft / Accepted / Deprecated / Superseded / In Review) | Component (All / Backend / Frontend / Infra / Data / Mobile / AI) | Author | Tag
- Sort dropdown: By date / By status / By component / By impact
- "+ New ADR" button bottom

ADR LIST ROWS:
- ADR id (mono "ADR-001") + title --text-sm font-500
- Component badge (color-coded: Backend indigo, Frontend cyan, Infra amber, Data emerald, AI violet)
- Status badge (Draft amber / Accepted emerald / Deprecated muted / Superseded violet / In Review cyan)
- Author avatar + last edited --text-xs --fg-tertiary
- Linked tasks count badge ("3 tasks" mono)
- Impact score chip (1-10 with color: rose ≥8, amber 5-7, emerald ≤4)
- Active row: bg rgba(99,102,241,0.10) + 2px left rail

ADR DETAIL EDITOR (right panel, --bg-base):
- HEADER: ADR id badge + status badge + title (editable inline, h1 --text-2xl font-700) + 3-dot menu (Duplicate / Export / Archive / Convert to RFC)
- Below: Author + Date + Component + Last reviewed date + Review cadence

TABS IN EDITOR:
1. **Content** (default) — markdown editor with template scaffolding
   - Standard ADR sections auto-populated: Context / Decision / Consequences / Alternatives considered
   - Editor: rich markdown with toolbar + code highlighting
   - Right side: "ADR template" reference (collapsible)
   - Footer: word count + last saved + "Save draft" + "Request review"
2. **Impact** — what depends on this decision
   - Linked tasks (from Task Breakdowns)
   - Linked risks (from Risk Registers)
   - Linked APIs (from API Contracts that implement this)
   - Linked stories (from Stories)
   - Linked runs (workflows that touched this)
   - Backlinks: which other ADRs reference this
   - Coverage: how much of the codebase references this decision
3. **Discussion** — comment thread
   - Markdown comments
   - @mention support
   - "Resolved" state per comment thread
4. **Versions** — timeline of all versions with diff viewer
   - Each version: timestamp + author + change summary
   - Click → side-by-side or unified diff
   - "Restore this version" button
5. **Reviews** — approval workflow
   - Reviewers list with avatar + status (Pending / Approved / Changes requested / Rejected)
   - Review comments per reviewer
   - "Request review from" button
   - Auto-trigger when status moves from Draft → Accepted

AI-ASSISTED ADR CREATION:
- "+ New ADR" opens modal with template picker
- Option: "Generate from codebase" — AI analyzes recent commits, PRs, discussions, surfaces a draft ADR
- AI-suggested structure with auto-filled sections

==========================================================
ZONE 5 — API CONTRACTS TAB
==========================================================

SERVICE-FIRST LAYOUT (left list of services + right detail):

LEFT: services list
- Search + filter (Documented / Undocumented / Has breaking changes / Recently updated)
- Each service card: icon + name + endpoint count + status (documented emerald / undocumented rose / out-of-sync amber) + last updated

RIGHT: selected service detail
- HEADER: service name + version + OpenAPI spec link + "Sync from repo" + "Export" buttons
- KPI strip: Total endpoints / Documented % / Avg response time / Error rate / Breaking changes since last version

TABS:
1. **Endpoints** (default) — virtualized table
   - Columns: Method badge (GET cyan, POST emerald, PUT amber, DELETE rose, PATCH violet) | Path | Description | Auth (icon) | Request schema | Response schema | Status (200/4xx/5xx distribution)
   - Click row → endpoint detail drawer with full OpenAPI spec + "Try it" interactive console
   - "Try it" panel: input fields auto-generated from request schema, send button, response viewer with syntax highlighting
   - Add new endpoint manually: opens form
2. **Schemas** — list of data models
   - Each schema: name + field count + used by N endpoints + JSON schema viewer
   - "Diff against previous version" button
3. **Consumers** — which internal/external services call these endpoints
   - List with service name + call count + error rate + last call
   - Sankey diagram showing call flow (upstream → service → downstream)
4. **Producers** — which services implement endpoints
   - Reverse view: implementation status per endpoint
5. **Versions** — version history of the spec
   - Each version: timestamp + changes (auto-detected breaking changes in rose)
   - Diff between any two versions
   - Migration guide generator
6. **Mock** — generate mock server from spec
   - "Start mock server" button
   - Returns sample data based on schemas

AUTO-SYNC FROM REPO:
- Connect to GitHub repo, pulls OpenAPI/Swagger files
- Auto-detects changes, surfaces diff in UI
- "Sync now" + scheduled sync options

==========================================================
ZONE 6 — TASK BREAKDOWNS TAB
==========================================================

HIERARCHICAL TREE VIEW:
- Tree: Epic → Story → Subtask
- Each level shows different visual treatment
- Expandable/collapsible nodes
- Drag-to-reorder within level
- Multi-select with bulk actions

EACH NODE:
- Title + status dot + owner avatar + estimate (story points) + actual time + progress bar
- Linked ADRs (decisions this task implements)
- Linked risks (mitigation work)
- Linked tests (test coverage)
- Dependencies: "Blocked by" / "Blocks" relationships (visualized)

VIEWS:
1. **Tree** (default) — hierarchical
2. **Kanban** — by status (Backlog / In Progress / In Review / Done)
3. **Timeline** — gantt chart with dependencies as arrows
4. **Matrix** — effort vs impact 2×2 grid

AI FEATURES:
- "Decompose this story" — AI suggests subtasks
- "Estimate effort" — AI suggests story points based on similar past tasks
- "Identify blockers" — AI scans for potential blockers
- "Find dependencies" — AI surfaces likely dependencies

METRICS PER EPIC:
- Velocity, burndown, scope creep, completion %
- Cycle time, lead time
- "Story points delivered vs planned" chart

==========================================================
ZONE 7 — RISK REGISTERS TAB
==========================================================

RISK MATRIX VIEW (5×5 heat map, primary):
- Y axis: Likelihood (Rare / Unlikely / Possible / Likely / Almost Certain)
- X axis: Impact (Insignificant / Minor / Moderate / Major / Catastrophic)
- Each cell: count of risks at that level + click to filter
- Color gradient: emerald (low) → amber (medium) → rose (high)
- Hover cell: tooltip with risk count + names
- Click cell: filters the list below to those risks

RISK LIST (below or beside matrix):
- Filter: Status (Open / Mitigating / Closed / Accepted) | Owner | Linked ADR | Severity
- Each risk: title + severity score (likelihood × impact) + owner + linked ADRs + mitigation plan + status
- Click → risk detail drawer

RISK DETAIL DRAWER:
- HEADER: risk title + severity badge + owner + status
- TABS:
  1. **Description** — markdown (the risk, scenarios, triggers)
  2. **Mitigation** — current plan + tasks (linked from Task Breakdowns) + status
  3. **Linked decisions** — which ADRs address this risk
  4. **History** — when identified, when re-evaluated, trend
  5. **Review** — review schedule + next review date + "Re-evaluate now" button

AI FEATURES:
- "Detect risks" — AI scans codebase, recent incidents, customer feedback for risk patterns
- "Suggest mitigation" — AI suggests actions based on similar past risks
- "Predict likelihood" — AI updates likelihood based on recent events

==========================================================
ZONE 8 — TRACEABILITY TAB
==========================================================

THE WOW FEATURE — full chain visualization:

LAYOUT: matrix view (default) OR graph view (toggle)

MATRIX VIEW:
- Rows: Requirements (from PRDs)
- Columns: ADRs / Tasks / Code files / Tests
- Cells: ● filled (linked), ○ empty (gap), ⚠ partial coverage
- Hover cell: shows link details + "Jump to" link
- Click cell: opens that entity
- Color-coded: emerald = strong trace, amber = weak, rose = gap

FILTERS:
- By requirement (only show rows for selected PRDs)
- By component
- By coverage level (show only gaps)

GAP ANALYSIS:
- "X requirements have no ADR"
- "Y tasks have no tests"
- "Z ADRs reference deleted code"
- List of gaps + "Create [missing link]" buttons

GRAPH VIEW:
- Force-directed: nodes = requirements/ADRs/tasks/code/tests
- Edges = "implements" / "depends on" / "tests" / "addresses"
- Click → highlights the chain
- Local graph mode (zoom into a single requirement's full chain)

COVERAGE METRICS:
- Requirement → ADR coverage %
- ADR → Task coverage %
- Task → Code coverage %
- Code → Test coverage %
- End-to-end chain integrity score

REVERSE TRACEABILITY:
- From any test: which requirements does it cover?
- From any code file: which tasks implemented it?
- From any ADR: which requirements drove it?

==========================================================
ZONE 9 — VERSIONS TAB
==========================================================

ARCHITECTURE VERSION TIMELINE:
- Vertical timeline (or horizontal) of architecture versions
- Each version: version number + date + description + changelog (auto-generated from ADR status changes)
- Visual: graph showing what changed in each version (added services, deprecated endpoints, etc.)
- "Compare versions" side-by-side
- "Generate migration guide" button per version pair

DEPRECATION TRACKING:
- List of deprecated APIs, ADRs, patterns
- Each: name + deprecated at version + sunset date + usage count (where it's still used)
- "Find usage" → shows all places still using deprecated items

COMPATIBILITY MATRIX:
- Service × Service grid showing compatibility
- Cell: emerald (compatible) / amber (caveats) / rose (incompatible)
- Hover: details

==========================================================
ZONE 10 — TECH RADAR TAB (new)
==========================================================

ADOPT / TRIAL / ASSESS / HOLD visualization:
- Classic tech radar layout: 4 quadrants (Languages & Frameworks / Tools / Platforms / Techniques) × 4 rings (Adopt / Trial / Assess / Hold)
- Each technology placed in a ring with rationale
- Hover: blip details (description, why this rating, who uses it, alternatives)
- Click blip: full detail with usage stats
- Movement over time: animated transitions between versions

TIMELINE SLIDER:
- Move slider to see tech radar at past dates
- Compare current vs N months ago
- Animates blips moving between rings

==========================================================
ZONE 11 — DIAGRAMS TAB (new)
==========================================================

VISUAL ARCHITECTURE EXPLORER:
- Multiple diagram types in one view:
  - System context (C4 Level 1)
  - Container diagram (C4 Level 2)
  - Component diagram (C4 Level 3)
  - Data flow diagram
  - Sequence diagram
- Each diagram: rendered with a diagram library (e.g., reactflow, mermaid, or custom)
- Side panel: layer toggle (show/hide infrastructure, services, data stores, etc.)
- Click any node: shows full info (linked to API Contracts, Tasks, etc.)
- Edit mode: drag nodes, edit labels, save versions
- Export: PNG / SVG / JSON

DIAGRAM GENERATION:
- AI auto-generates system diagram from imported code/services
- "Refresh from live system" updates the diagram with current state

==========================================================
ZONE 12 — UNIVERSAL FEATURES (every tab)
==========================================================

AI ASSISTANT BADGE: small Sparkles icon in each tab header → opens tab-specific AI helper

KEYBOARD SHORTCUTS:
- ⌘K: global search across all tabs
- ⌘N: new entity (context-aware per tab)
- ⌘/: show shortcuts
- Tab navigation between tabs: ⌘1-9

GLOBAL FILTERS (top bar, persists across tabs):
- Date range
- Author
- Component
- Status
- Saved filters (save current filter combo for reuse)

EXPORT OPTIONS (every tab):
- JSON / CSV / Markdown / PDF
- Bulk export across tabs

BULK ACTIONS:
- Multi-select with checkboxes
- Bulk: Edit status / Assign / Archive / Delete / Export

==========================================================
ZONE 13 — INTER-TAB CONNECTIONS
==========================================================

CROSS-TAB NAVIGATION:
- Every entity references others via inline chips
- ADR → mentions: "3 tasks · 1 risk · 2 APIs" (click any to jump)
- Tasks → references: "Implements ADR-005" (click to open that ADR)
- Risks → references: "Mitigated by ADR-007" (click to open)
- APIs → references: "Implements decision in ADR-012"

GLOBAL SEARCH (⌘K):
- Searches across ALL tabs and ALL entity types
- Returns results grouped by type: ADRs / APIs / Tasks / Risks / Requirements / Code
- Semantic search (uses embeddings)

==========================================================
CONSTRAINTS
==========================================================

- Fix the ADR count vs empty state bug first
- All tabs must be functional with realistic mock data
- AI features are stubbed (mock responses) but UI is complete
- Reuse: markdown editor from Step 12, drawer from Step 14, knowledge graph from Step 27
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only
- Diagrams: pick ONE library (recommend: react-flow for editability, mermaid for read-only)
- Performance: virtualize any list >100 items

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/architecture/
- Sample data: 6 ADRs, 4 services with 30+ endpoints, 12 tasks, 5 risks
- All 9 tabs functional with realistic mock data
- The traceability matrix working (this is the headline wow)
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep ADR numbering convention (ADR-NNN), keep OpenAPI spec format, don't break existing entities