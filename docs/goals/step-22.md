> **Status:** completed
/goal

Modernize the Workflows page in Forge AI Agent OS — turn it into a visual workflow builder (n8n-style) using React Flow. Tokens, shell, empty/error states, and Steps 7–21 are done. Read .claude/design-system/ first.

USER INTENT (clear from brief): users want to compose multi-step workflows by connecting nodes — commands, manual approval gates, custom prompts, API calls, agent invocations — then run them. Two paths: pick a predefined org template OR build from scratch. Same canvas, different starting point. Think n8n / Zapier / LangGraph studio but for the Forge command catalog.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "node graph editor workflow builder canvas visual programming" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "React Flow node connection drag drop palette workflow" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "workflow execution live status node animation DAG directed graph" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "workflow template library marketplace gallery dark mode" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/workflows/page.tsx (find exact path). Keep route. Rebuild as a visual builder with TWO modes:
- Mode A: Template Gallery (default landing) — browse + start from predefined workflows
- Mode B: Workflow Canvas — the React Flow editor (shared by both "from template" and "from scratch" paths)

INSTALL: `pnpm add reactflow` (or `@xyflow/react` for the maintained v12+). Pick whichever version the project already uses — React Flow v12+ is now `@xyflow/react`.

==========================================================
MODE A — TEMPLATE GALLERY (default landing on /workflows)
==========================================================

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Workflows" --text-3xl font-700 with lucide Workflow icon in --accent-primary
- Body "Compose multi-step AI workflows. Connect commands, approvals, and custom logic into a DAG your team can run, schedule, or trigger from events."
- Top-right: "From scratch" primary outline button (PlusSquare icon) → opens Mode B with empty canvas

KPI STRIP (4 tiles, 120px tall):
- Workflows (indigo) — total count + delta
- Runs today (cyan) — total executions + sparkline
- Avg duration (amber) — minutes + delta
- Success rate (emerald) — % + sparkline

TAB BAR (below KPIs, segmented control):
- Templates (default) | My workflows | Shared with me | Drafts
- Count badges on each

TEMPLATE GRID (3 cols ≥1440px, 2 cols ≥1024px, 1 col <1024px, gap-4, mt-6):

Template card:
- bg --bg-surface, --radius-lg, border --border-subtle, p-20px, hover lift --shadow-md, 200ms
- Top: 48×48 --bg-inset --radius-md with the workflow's lucide icon in semantic color + workflow name --text-md font-600 + "by Forge Team" --text-xs --fg-tertiary
- Below: 60px tall mini preview — a tiny static SVG of the DAG (just boxes + lines, monochrome, --fg-muted) so users can see the shape at a glance. Render previews from a precomputed JSON in /public/workflow-previews/
- Description --text-sm --fg-secondary, mt-3, clamp 2 lines
- Node count badge ("8 nodes" mono --text-xs) + category badge
- Bottom row: "Use template" primary button (Play icon) on right
- Click anywhere on card OR "Use template" → opens Mode B with the template pre-loaded onto canvas
- Hover: 3-dot menu (Preview / Duplicate / View source)

PREDEFINED TEMPLATES (provide 6 starter JSON definitions in src/data/workflow-templates.ts):
1. **Ideation → PRD pipeline**: Trigger → Capture idea → AI score → Manual approval → Generate PRD → Save to Knowledge base
2. **Bug fix workflow**: Trigger (webhook from Sentry) → Reproduce issue → AI root-cause → Manual review → Open fix branch → Run tests → Notify
3. **New feature workflow**: Trigger → Scaffold code → AI implement → Run tests → Manual QA approval → Deploy preview → Notify team
4. **Code review workflow**: Trigger (PR opened) → AI review → Score quality → Manual approval → Auto-merge if pass
5. **Refactor workflow**: Trigger → Analyze module → AI propose plan → Manual approval → Apply refactor → Run tests → Open PR
6. **Deploy workflow**: Trigger (manual or scheduled) → Run health checks → Manual approval gate → Deploy → Smoke test → Notify

Each template definition: { id, name, description, category, icon, color, nodes: [...], edges: [...], tags }

MY WORKFLOWS TAB: same card grid, but for user-created workflows (each with status: Draft / Published / Archived + last edited + run count)

SHARED TAB: workflows other team members have shared (with owner avatar)

DRAFTS TAB: auto-saved drafts that haven't been named yet

EMPTY STATE (no workflows in any tab): Step 3 EmptyState, illustration = Workflow, title "No workflows yet", description "Start from a template or build from scratch. Workflows let you chain commands into repeatable automations.", primary "Browse templates", secondary "From scratch"

==========================================================
MODE B — WORKFLOW CANVAS (the editor)
==========================================================

LAYOUT (3-column, full viewport height below top bar):

TOP BAR (56px, --bg-elevated, border-b --border-subtle):
- Left: back arrow (ArrowLeft) + workflow name (editable inline, click to edit, autosaves) + version badge ("v3" mono, click to see version history) + status dot (Draft amber / Published emerald)
- Center: execution status pill — when idle: "Draft" muted; when running: "Running · step 3 of 8" with progress bar + animated cyan dot; when paused: amber "Paused at: Approval gate"; when failed: rose "Failed at: API call"; when succeeded: emerald "Completed in 2m 14s"
- Right cluster: "Variables" outline button (Braces icon) + "Test run" outline button (FlaskConical icon) + "Run" primary button (Play icon, becomes "Stop" with Square icon when running) + 3-dot menu (Duplicate / Export JSON / Import JSON / Delete)

LEFT SIDEBAR (280px, --bg-base, border-r --border-subtle, overflow-y-auto):
- Tabs at top: "Nodes" (default) | "Templates" | "Runs"
- NODES TAB:
  - Search input "Search nodes..."
  - Category accordion sections (expand/collapse, chevron rotates):
    - **Triggers** (indigo): Manual trigger, Webhook, Schedule (cron), Event (from another workflow)
    - **Forge Commands** (cyan): Dynamic list — fetch the user's installed forge-* commands (mock for now with the 6 from Step 7). Each as draggable node
    - **AI** (violet): LLM Prompt (custom prompt), Agent (delegate to registered agent), Embedding, Vision
    - **Logic** (muted): Condition (if/else), Switch, Loop, Parallel, Merge, Filter, Map
    - **Integrations** (amber): HTTP Request, Slack, Email, Database query, File read/write
    - **Human** (rose): Manual approval, Manual input, Comment
    - **Flow** (emerald): Wait (delay), End (success/failure)
  - Each node item: lucide icon (16px in section color) + name --text-sm font-500 + brief --text-xs --fg-tertiary (e.g., "Trigger workflow manually"). Drag handle on hover (GripVertical)
- TEMPLATES TAB: compact list of templates (cards smaller), click to add to canvas at center
- RUNS TAB: history of runs for this workflow — each row = run id (mono) + status dot + started-at + duration + "View" link. Click → opens execution log modal

CENTER — REACT FLOW CANVAS (flex-1, --bg-base):
- React Flow with these props:
  - `nodeTypes`: custom node components (defined below)
  - `edgeTypes`: default + custom animated edge for running state
  - `<Background>` with dots, color rgba(255,255,255,0.06), gap 20px
  - `<MiniMap>` bottom-left, --bg-elevated, maskColor rgba(0,0,0,0.6), node colors by category. pannable + zoomable
  - `<Controls>` bottom-right (zoom in/out/fit/lock). Styled to match dark theme
  - `snapToGrid` true, `snapGrid={[20,20]}`
  - Connection line: smoothstep, stroke --accent-primary, strokeWidth 2
- INITIAL VIEW: fitView with padding 0.2
- Empty canvas state: centered muted text "Drag a node from the left to get started" + arrow pointing to left sidebar + "Or pick a template" link (opens template gallery)

CUSTOM NODE COMPONENTS — define in src/components/workflow-nodes/. Each node has a custom React component:

BaseNode (shared wrapper):
- 220px wide, --bg-elevated, --radius-lg, border --border-default (2px when selected, --accent-primary), shadow --shadow-sm
- Hover: border --border-strong
- Header: lucide icon (16px in section color) + node type label --text-xs uppercase tracking-widest --fg-tertiary (e.g., "COMMAND") + 3-dot menu (Duplicate / Delete / Disable)
- Title row: --text-sm font-600 --fg-primary
- Subtitle (optional): --text-xs --fg-tertiary
- Body (optional, shows node config summary): --text-xs --fg-secondary, 1-2 lines
- Input handle: left side, --accent-primary, circle 12px
- Output handle: right side, --accent-primary, circle 12px (multiple outputs for nodes that branch)
- Status overlay (when running):
  - Running: cyan pulse border + spinner icon overlay top-right
  - Succeeded: emerald check icon top-right
  - Failed: rose X icon top-right (clickable to see error)
  - Skipped: muted, 50% opacity
  - Waiting (e.g., manual approval): amber clock icon with pulse

Node variants:
1. **TriggerNode** — diamond shape (rotated square), emerald border, "Trigger" + type subtitle ("Manual" / "Webhook" / "Schedule: every 6h" / "Event: PR opened")
2. **CommandNode** — rounded rectangle, cyan border, "Command" + command name + "Run forge-dev-new-feature" example
3. **AgentNode** — hexagon shape, violet border, "Agent" + agent avatar + name
4. **LLMPromptNode** — rounded rectangle, violet border with sparkles, "LLM Prompt" + first line of prompt + model chip ("claude-sonnet")
5. **APIRequestNode** — rounded rectangle, amber border, "HTTP Request" + method (GET/POST) badge + URL truncated + "Headers: 3" / "Body: JSON"
6. **ApprovalNode** — diamond shape, rose border, "Manual approval" + approver list (avatar stack) + timeout ("Expires in 24h")
7. **ConditionNode** — diamond shape, muted border, "If" + condition summary ("score >= 7"). Two outputs: "True" (emerald edge) + "False" (rose edge), labeled
8. **WaitNode** — clock shape, muted border, "Wait" + duration ("5 min")
9. **EndNode** — rounded, emerald border, "End" + outcome label ("Success" / "Failure" / "Always")

CONNECTION RULES — validate in `isValidConnection`:
- Trigger nodes can only be starting points (no input handle)
- End nodes can only be endpoints (no output handle)
- Condition nodes must have 2+ outputs
- Cycle detection: warn but allow (workflows can loop with proper care)
- Visual feedback: invalid connections show in rose, valid in --accent-primary

RIGHT SIDEBAR (360px, --bg-base, border-l --border-subtle, overflow-y-auto):

When no node selected — WORKFLOW SETTINGS panel:
- Section: General — name, description (markdown), tags, category
- Section: Inputs — list of input variables the workflow accepts (name, type, default, required)
- Section: Outputs — list of output variables
- Section: Triggers — list of enabled triggers (Manual / Webhook URL / Schedule / Event)
- Section: Permissions — who can run (All / Specific roles / Specific users)
- Section: Sharing — share with team, copy link

When node selected — NODE INSPECTOR panel (slides in from right, replaces workflow settings):
- Header: node icon + name + node type + back arrow to workflow settings
- Configurable fields per node type:
  - Command: command picker (dropdown of forge-* catalog) + input mapping (variable references like {{input.feature_name}})
  - LLM Prompt: prompt textarea (markdown) + model picker + temperature slider + max tokens + system prompt + variable mapping
  - Agent: agent picker + task description + context inputs
  - HTTP: method + URL + headers + body (JSON editor with validation) + auth (Bearer / Basic / API key) + retry policy
  - Approval: approver picker (users / roles) + approval criteria + timeout + escalation policy (after timeout: approve / reject / reassign)
  - Condition: expression builder (left value + operator + right value) with type-aware operators. Examples: `score >= 7`, `status == "passed"`, `branch == "main"`
  - Wait: duration (with unit picker: seconds / minutes / hours / days / until specific date)
  - Trigger: type-specific config (webhook URL, cron expression, event filter)
- Live preview of the node's output (when testable) — small section showing mock output
- "Test this node" button (runs just this node with sample inputs)
- "View source JSON" expander at bottom

EXECUTION LOG (modal overlay or bottom drawer when running):
- Real-time log stream of the workflow execution
- Each step: timestamp + node name + status + duration + log message
- Color-coded by status
- Click step → highlights corresponding node on canvas
- "Pause" / "Resume" / "Stop" buttons
- When waiting on approval: prominent CTA "Open approval request →"

==========================================================
RUNNING / EXECUTING
==========================================================

When user clicks "Run":
1. Validate workflow (every node properly connected, required configs filled) — show error toast with list if invalid
2. Switch canvas to "executing" mode — animated border on currently running node (cyan pulse), edges from completed nodes turn emerald, edges to running node animate (dashed cyan flowing)
3. Right sidebar auto-switches to Execution Log tab
4. As each node completes: status overlay updates, log entry added, edge color updates
5. On completion: success toast with run duration + "View run" link
6. On failure: failed node shows error tooltip on hover, log shows stack trace
7. Use mock execution for now (setInterval stepping through nodes with realistic delays based on node type — Command 600ms, Approval instant click-to-approve, etc.). Real backend integration later

==========================================================
SAVE / VERSION
==========================================================

- Autosave every 5s of inactivity OR on every meaningful change (debounced)
- Save status indicator: "Saved 2s ago" / "Saving..." / "Save failed, retry"
- Version history: every save creates a version. Sidebar drawer shows timeline of versions with diff (added/removed/modified nodes highlighted). Click version → preview mode (read-only canvas). "Restore" button
- Export: download as JSON file. Import: upload JSON, validates schema, loads onto canvas
- Publish: marks workflow as ready for production. Requires all nodes valid + tested at least once

==========================================================
KEYBOARD
==========================================================

- Space: open node search palette (Command-style popover, search all node types, Enter to add at canvas center)
- Delete / Backspace: delete selected node (with confirm Dialog if has edges)
- Ctrl+Z / Ctrl+Shift+Z: undo/redo (React Flow has this built-in via state history)
- Ctrl+S: force save
- Ctrl+Enter: run workflow
- Esc: deselect node, close panels
- Arrow keys: nudge selected node 1px (Shift+arrow for 10px)

==========================================================
EMPTY / ERROR / LOADING
==========================================================

- Template gallery empty: Step 3 EmptyState
- Canvas empty: in-canvas guidance (see above)
- Invalid workflow on Run: Dialog listing validation errors with "Jump to node" links
- Save failed: error-state.tsx (Step 13) pattern + retry
- Loading workflow: skeleton canvas with placeholder nodes + skeleton sidebars

==========================================================
CONSTRAINTS
==========================================================

- React Flow v12+ (`@xyflow/react`); style with their CSS variables + your Tailwind tokens
- Custom node components fully themeable — match Step 1 tokens exactly
- Edge color = node status: idle (--border-default), running (animated cyan), succeeded (emerald), failed (rose), skipped (muted)
- Every node draggable from palette AND addable via Space palette
- Node configs persist on save, hydrate on load
- Canvas supports 50+ nodes without lag (use React Flow's virtualization)
- MiniMap + Controls styled to match dark theme
- Mobile: canvas only (no sidebars), bottom sheet for node selection
- prefers-reduced-motion: disable edge animations, node pulses, mini-map pulse
- Max canvas size 4000×4000 (overflow scroll)
- All icons from lucide (no emojis)

Deliverable: files modified, new components in src/components/workflow-nodes/ and src/components/workflow/, sample workflow JSON definitions, layout sketch, prop interfaces for each custom node type, 1-paragraph rationale citing skill rules.
