/goal

Modernize the Knowledge Graph in Forge AI Agent OS — currently shows node kinds + zoom toolbar + empty state. User wants Obsidian-style connected knowledge: link projects, tickets, PRDs, ADRs, ideas, runs, agents — any artifact — into a navigable graph. Read .claude/design-system/ first.

USER INTENT: This should feel like Obsidian meets GitHub Insights. Click any artifact to see its connections (incoming + outgoing edges = backlinks). Local graph view (just nearby nodes). Search any text across all artifacts. Click through to the underlying entity.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "knowledge graph network visualization force directed graph dark" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Obsidian bidirectional links backlinks graph nodes connections" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "node graph interactivity hover preview click inspect filter" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "graph layout force hierarchical radial grid algorithm" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/knowledge-center/page.tsx (or wherever it lives — find it). Keep route. Rebuild.

INSTALL: `pnpm add react-force-graph-2d d3-force` (lightweight, 2D, perfect for hundreds of nodes). Alternatively use `reactflow` if you prefer (already installed for workflows).

==========================================================
ZONE 1 — HEADER + TOOLBAR
==========================================================

HERO BAND (compact, NOT the giant animated gradient — keep this page lean for the canvas):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Knowledge Graph" --text-2xl font-700 with lucide Network icon in --accent-violet (different accent than other pages to signal "graph mode")
- Body "Unified view across repos, services, ADRs, ideas, risks, tasks, tests, runs, agents. Click a node to inspect. ⌘K to search." --text-sm --fg-secondary

TOOLBAR ROW (below hero, --bg-surface, --radius-lg, p-12px flex gap-3, mb-4):
- LEFT (flex-1):
  - Search input — lucide Search icon, placeholder "Search nodes, edges, or content..." — fuzzy search across all node labels + descriptions. w-full, h-40px. Keyboard ⌘K focuses
- MIDDLE:
  - Zoom controls group (lucide ZoomIn / ZoomOut / Maximize2 for Fit, all icon buttons 32px)
  - Layout selector dropdown: Force-directed (default) / Hierarchical (top-down) / Hierarchical (left-right) / Radial (selected node at center) / Grid / Timeline
- RIGHT:
  - Filters button (lucide Filter icon + count badge "3") → opens filter drawer
  - "Local graph" toggle (lucide Focus icon) — when ON, only shows nodes within N hops of selected
  - "Ingest source" primary button (lucide Database + Plus icon) → opens ingestion modal

==========================================================
ZONE 2 — NODE KIND FILTER (current pattern, polished)
==========================================================

FILTER BAR (below toolbar, --bg-surface, --radius-lg, p-12px flex-wrap gap-2, mb-4):
- "NODE KINDS" label --text-xs --fg-tertiary uppercase tracking-widest
- Each kind as a toggleable chip with icon + count:
  - 📁 Repo (cyan) — count
  - ⚙️ Service (green) — count
  - 🧩 Component (cyan-light) — count
  - 📜 ADR (violet) — count
  - 💡 Idea (amber) — count
  - ⚠️ Risk (rose) — count
  - ✅ Task (yellow) — count
  - 🧪 Test (cyan-bright) — count
  - 🤖 Agent (indigo) — count
  - ▶️ Run (cyan-running) — count
  - 📋 Story (muted) — count
  - 📦 Epic (violet-dark) — count
  - ⚡ Command (indigo-light) — count
  - 📄 PRD (amber-dark) — count
- Active kind: bg rgba(99,102,241,0.10) + colored dot filled + colored text. Inactive: outlined dot + --fg-tertiary
- Right: "Hide all" / "Show all" + "Reset" link

==========================================================
ZONE 3 — GRAPH CANVAS (the main surface)
==========================================================

Use react-force-graph-2d OR custom D3. Recommended: react-force-graph-2d for the 2D rendering + d3-force for the physics simulation.

GRAPH CONTAINER (flex-1, --bg-base, --radius-lg, overflow-hidden, position relative):
- Dotted background (like Step 22 canvas)
- Force-directed layout:
  - Nodes: circles colored by kind (from filter bar colors)
  - Node size: scales with degree (number of connections) — min 8px, max 32px
  - Node label: shown below node, --text-xs --fg-secondary, only when zoomed in enough OR on hover
  - Selected node: 2px outline in --accent-primary, glow effect
  - Hovered node: subtle scale 1.15, label visible, connected edges highlight (others fade to 20% opacity)
- Edges: lines between nodes, color-coded by edge type:
  - **References** (default) — --border-default thin line
  - **Depends on** (rose) — solid rose
  - **Blocks** (amber) — solid amber
  - **Implements** (emerald) — solid emerald
  - **Supersedes** (violet) — solid violet, animated dashed
  - **Related to** (cyan) — dashed cyan
- Edge thickness: scales with connection strength (1-3px)
- Edge label: shown on hover (centered, --bg-elevated pill, --text-xs)
- Directional arrows: small triangle at the target end of directed edges
- Click node: selects + opens detail panel (Zone 4)
- Double-click node: navigates to the underlying entity page (e.g., /agents/[id])
- Drag node: temporarily pins position (releasing lets physics take over)
- Right-click node: context menu — Open / Pin position / Hide / Copy link / Find related

OVERLAYS (canvas, position absolute):
- TOP-LEFT: Mini stats — "127 nodes · 342 edges · 14 isolated" --text-xs mono
- TOP-RIGHT: Graph legend toggle — opens legend popover (kind colors + edge types)
- BOTTOM-LEFT: Zoom level indicator "100%" (click to reset)
- BOTTOM-RIGHT: Hint card (fades after first interaction) — "Drag to pan · Scroll to zoom · Click to inspect · Double-click to open"

LOCAL GRAPH (when toggle is ON):
- After selecting a node, show only nodes within N hops (default 2, adjustable slider in toolbar)
- Selected node at center, connected nodes around it
- Other nodes fade to 10% opacity (still visible as a "ghost" background context)
- "Expand 1 more hop" button when zoomed in enough
- "Exit local view" button returns to full graph

EMPTY STATE (current screenshot — graph is empty):
- Replace with richer first-run state:
  - Centered card --bg-elevated, --radius-xl, p-32px, max-w-480px, --shadow-lg
  - 80×80 square with lucide Network 40px in --accent-violet, animate-pulse
  - h2 "Your knowledge graph is empty" --text-xl font-700
  - Body "Connect a source to populate the graph. Forge can ingest GitHub repos, ADRs, ideas, runs, agents, and any artifact type across your project." --text-sm --fg-secondary
  - 3 source cards in a row:
    1. lucide GitBranch "Connect GitHub repo" — primary button
    2. lucide FileText "Import existing ADRs" — outline button
    3. lucide Sparkles "Auto-generate from runs" — outline button
  - Footer: "How the knowledge graph works →" link to docs

LOADING STATE: skeleton with shimmer (animated node circles appearing at random positions, lines connecting)

==========================================================
ZONE 4 — INSPECTION PANEL (right side drawer)
==========================================================

When a node is selected, opens a 400px panel from the right (or 480px on desktop). The "Obsidian backlinks" feature.

PANEL STRUCTURE:
- HEADER (--bg-elevated, border-b --border-subtle, p-16px):
  - Back arrow (closes panel) + node icon + node kind label ("ADR" mono uppercase tracking-widest) + node title (h2 --text-md font-600)
  - 3-dot menu: Open full page / Copy link / Hide from graph / Pin position

- BODY (overflow-y-auto, p-16px, gap-16px):
  - **META CARD** (--bg-surface, --radius-md, p-12px):
    - Author avatar + name + role
    - Created at + last updated
    - Tags (chips)
    - Status (if applicable: ADR Draft/Accepted, Idea scoring, Run completed, etc.)
  - **PREVIEW CARD** (--bg-surface, --radius-md, p-12px):
    - First 200 chars of content / description / code snippet
    - "Read full →" link to entity page
  - **CONNECTIONS CARD** — the Obsidian magic:
    - **Outgoing edges** (this → other): h3 "References (3)" --text-sm font-600 + list of connected nodes (icon + name + relationship type + "Open" chevron)
    - **Incoming edges** (other → this): h3 "Referenced by (5)" --text-sm font-600 + list. THESE ARE THE BACKLINKS
    - Each connection row: lucide icon + node name --text-sm font-500 + relationship type chip ("depends on", "blocks", "implements", etc.) + chevron to navigate
    - Hover any connection: highlights that node on the graph + dims others
  - **ACTIVITY CARD** (if applicable):
    - Recent events for this node (audit-log-style entries)
  - **ACTIONS CARD**:
    - "Open full page" primary button
    - "Find similar" outline button (uses embeddings if available)
    - "Add relationship" outline button (opens modal to pick another node + edge type)

==========================================================
ZONE 5 — FILTERS DRAWER (right side, when clicked)
==========================================================

Opens a 380px drawer from right with three sections:

A. NODE KINDS: same chips as filter bar but bigger + with counts
B. EDGE TYPES: multi-select chips — show/hide edges by type (references, depends on, blocks, implements, supersedes, related to)
C. TIME: date range picker + quick presets (Last 7d / 30d / 90d / All)
D. AUTHORS: multi-select Combobox of users
E. TAGS: chip cloud with counts — click to filter
F. ISOLATED NODES: toggle to hide nodes with zero connections

Footer: "Apply" primary button + "Reset" link

==========================================================
ZONE 6 — INGESTION MODAL
==========================================================

When "Ingest source" clicked:
- shadcn Dialog, --bg-elevated, max-width 560px
- h2 "Connect a knowledge source" --text-lg font-700
- 5 source options (large cards):
  1. lucide GitBranch "GitHub repository" — input for URL + branch + path filter
  2. lucide FileText "Existing ADR / docs" — file upload (markdown, JSON, YAML)
  3. lucide Sparkles "Forge artefacts" — auto-detect from projects, ADRs, ideas, runs
  4. lucide Plug "Connector" — pick from installed connectors (Jira, Notion, Confluence)
  5. lucide Code "OpenAPI / AsyncAPI" — upload spec, auto-extract services + components
- Each source has its own form, then "Connect & ingest" button
- Progress modal shows: "Found 247 nodes · 89 edges · Linking in progress..."
- Success: "Knowledge graph updated · 247 new nodes · 89 new connections" + "View graph" button

==========================================================
ZONE 7 — ALTERNATE VIEWS (toggle in toolbar)
==========================================================

Three view modes via segmented control in toolbar:

1. **Graph** (default — the canvas above)
2. **List** — virtualized table of all nodes, sortable by:
   - Kind | Name | Connections | Last activity | Author
   - Search filters within
   - Click row → highlights on graph view
3. **Outline** — hierarchical tree by node kind, then by relationship:
   - Kind → Author → Individual nodes
   - Expandable/collapsible
   - Drag to reorder
   - Right-click → context menu

==========================================================
ZONE 8 — KEYBOARD SHORTCUTS
==========================================================

- ⌘K / Ctrl+K: focus search
- F: fit graph to viewport
- L: cycle layouts (next one)
- Esc: deselect node + close panel
- Arrow keys: navigate between nodes (cycle through visible)
- 1-9: jump to node kind (1=Repo, 2=Service, etc.)
- ⌘E: export graph as JSON / PNG
- ⌘I: open ingestion modal

==========================================================
EMPTY / ERROR STATES
==========================================================

- No nodes at all: First-run state (Zone 3 empty state)
- Filters return zero nodes: inline message "No nodes match these filters" + "Clear filters" + "Adjust time range" buttons
- Ingestion failed: error-state.tsx (Step 13) with retry + view logs
- Search returns zero results: "No nodes match '{query}'" + suggestion chips for related searches

==========================================================
PERFORMANCE
==========================================================

- Use canvas rendering (not SVG) for >100 nodes
- Limit to 500 nodes visible at once; show overflow indicator if more
- Physics simulation paused when no interaction (saves CPU)
- Throttle hover effects to 60fps
- Lazy-load node metadata on hover (not on render)
- Virtual scrolling in list view

==========================================================
CONSTRAINTS
==========================================================

- Dark mode only — palette matches Step 1 tokens
- All node kind colors mapped to your semantic tokens (indigo, cyan, emerald, amber, rose, violet)
- Edge types use semantic colors too (no rainbow)
- All icons from lucide
- Respect prefers-reduced-motion (disable physics animation, show static layout)
- The graph must remain usable at 1280px and 1920px widths
- Local graph view must be obvious — when active, show a small "Local: 2 hops" pill in the toolbar
- The panel + graph must coexist (graph resizes when panel opens, not hidden)
- Keep current search + zoom + layout toolbar visible (don't hide them in the panel)
- Keyboard shortcuts must work from anywhere on the page
- All hover tooltips have aria-label for screen readers

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/knowledge-graph/
- Sample data file src/data/sample-graph.ts with at least 50 mock nodes across all kinds + 100 edges with mixed types
- ASCII sketch of the canvas + panel layout
- The 5 ingest source forms (basic markup, no real backend)
- View modes wired up (graph / list / outline all functional)
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep node kind taxonomy as-is, keep existing search behavior, don't break existing ingest endpoints