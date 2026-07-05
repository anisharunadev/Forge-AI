> **Status:** completed
/goal

Modernize the Forge Terminal in Forge AI Agent OS — currently shows a cluttered layout with disconnected state, sidecar warning, tips + keyboard card, terminal pane with connection error, and audit log. User wants: (1) much more modern, less cluttered UI, (2) inject context from project intelligence, ADRs, architecture, knowledge — ALL Forge entities, (3) connect to Claude Code, Codex, Kiro, Gemini CLI and more, (4) run any forge command and forge skill from the terminal, (5) configure anything. This is the terminal becoming a **Forge command center** with AI CLI integration. Read .claude/design-system/ first.

USER INTENT (clear): the terminal isn't just xterm.js anymore — it's where users run AI CLIs (Claude Code, Codex, Aider, Kiro, Gemini) with full Forge context injected (project intelligence, ADRs, architecture, knowledge). Plus they can invoke Forge commands and skills from inside the terminal. So the terminal becomes a unified interaction surface.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "terminal emulator xterm.js modern dark mode minimal UI" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "multi-session tabbed terminal Claude Code Codex Gemini CLI" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "context injection AI agent grounding project knowledge attached" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "command palette slash commands skill invocation inline" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/forge-terminal/page.tsx (find exact path). Keep route. Total rebuild of UI + add cross-cutting context provider.

==========================================================
ZONE 1 — HEADER (slim, not heavy)
==========================================================

HERO BAND (compact — terminal pages should feel like tools, not marketing):
- Eyebrow "FORGE TERMINAL CENTER" --text-xs --fg-tertiary
- h1 "Live terminal sessions" --text-2xl font-700 with lucide TerminalSquare icon in --accent-cyan
- Body "Persistent PTY-backed sessions for Claude Code, Codex, Aider, Kiro, Gemini, and your custom agents. Multi-tab, drag-to-reorder, sidecar-aware. Inject Forge context, run forge commands, invoke skills." --text-sm --fg-secondary
- Top-right cluster:
  - **Connection status pill** (Disconnected rose / Connecting amber pulse / Connected emerald with latency ms)
  - **Workspace dropdown** (default + workspace list) — chevron + ⌘W hint
  - **Agent dropdown** (Claude Code / Codex / Aider / Kiro / Gemini CLI / Custom agent) — chevron
  - **"+ New session"** primary button (Plus icon)

==========================================================
ZONE 2 — MAIN LAYOUT (clean, not cluttered)
==========================================================

REDESIGN — kill the side panels, make it ONE focused interface:

LAYOUT (2-column on desktop ≥1280px, stacked <1280px):

LEFT (280px, collapsible to 56px rail, --bg-base, border-r --border-subtle):
- SESSIONS section:
  - Header "SESSIONS" + count badge + "+" icon button
  - List of active sessions: each = small terminal icon + session name + status dot + last activity time
  - Active session: bg rgba(99,102,241,0.10) + 2px left rail
  - Right-click: Rename / Duplicate / Close / Pin
- CONTEXT INJECTION section (NEW):
  - Header "CONTEXT" + count badge + ⚙ configure
  - List of context sources currently injected into this session:
    - 📁 Project: Forge Platform (indigo)
    - 📜 ADR-001 (violet)
    - 📐 Architecture diagram (cyan)
    - 📚 Knowledge: Auth policy v2 (amber)
    - 🤖 Agent: Code Reviewer (cyan)
  - Each: icon + name + scope badge + X to remove
  - "+ Add context" button → opens context picker (see Zone 5)
- SKILLS section (NEW):
  - Header "SKILLS" + chevron
  - Collapsible list of available skills:
    - /forge-prd (generate PRD)
    - /forge-adr (generate ADR)
    - /forge-architecture (architecture preview)
    - /forge-test (write tests)
    - /forge-review (review code)
    - /forge-document (generate documentation)
    - /forge-refactor (refactor code)
    - /forge-deploy (deploy)
  - Each skill: lucide icon + name + brief description
  - Hover: shows full skill definition
  - Click: inserts into terminal as slash command
- COMMANDS section:
  - Header "COMMANDS" + chevron
  - Quick access to /forge-* commands
  - Same pattern as skills

CENTER (flex-1, --bg-base):
- SESSION TABS (top, h-44px, --bg-base, border-b --border-subtle):
  - Each tab: terminal icon + session name + status dot + close X on hover
  - Active tab: --bg-elevated, bottom border 2px --accent-cyan
  - Inactive: --bg-base with --fg-tertiary
  - Drag to reorder
  - "+" button creates new session (inherits current workspace + agent)
- LAYOUT TOOLBAR (below tabs, h-44px, --bg-base, border-b --border-subtle, flex between):
  - LEFT: layout switcher segmented control — Single / Split H / Split V / Grid 2×2 (matches current)
  - CENTER: search input "Search terminal output..." w-320px (Ctrl+Shift+F) — opens search bar overlay
  - RIGHT cluster:
    - Theme toggle (dark / terminal green / solarized)
    - Font size - / +
    - Settings icon (terminal settings)
    - More icon (clear scrollback / export log / share session)

TERMINAL PANE (the actual xterm.js):
- Large, fills available space
- Custom theme: bg #000, fg #E5E7EB, cursor #6366F1, selection bg rgba(99,102,241,0.30)
- Bell disabled (visual indicator instead)
- Web links clickable
- Search bar overlay: appears top-right when Ctrl+Shift+F pressed

BOTTOM STATUS BAR (32px, --bg-elevated, border-t --border-subtle, flex between, mono font --text-xs):
- LEFT cluster: connection icon + status text + latency ms + reconnect attempt counter
- CENTER: session id (mono) + agent name + workspace name
- RIGHT cluster: cursor position + encoding (UTF-8) + Ctrl+Shift+P for command palette

==========================================================
ZONE 3 — RIGHT SIDEBAR (context preview, replace audit log)
==========================================================

REMOVE the standalone "Audit log" panel (it was empty and cluttered). INTEGRATE command audit into the terminal output via colored entry markers (✓ emerald, ✗ rose, ⏱ amber for slow, etc.). Use the freed space for:

CONTEXT PREVIEW PANEL (320px, --bg-base, border-l --border-subtle):
- Shows what's currently injected into the selected session
- For each context item: icon + name + preview (first 200 chars) + "Open in Forge" link
- Empty: "No context injected. Click + Add context to inject Forge knowledge."

COLLAPSE the sidebar by default — show as a rail icon (lucide Layers 18px). Click expands.

==========================================================
ZONE 4 — CONNECTION WARNING (when disconnected — current state)
==========================================================

When sidecar is disconnected (current screenshot state):
- Inline banner AT TOP OF TERMINAL PANE (NOT a separate full-width banner):
  - bg rgba(245,158,11,0.08), border-b 1px rgba(245,158,11,0.30), p-12px
  - Left: TriangleAlert icon in --accent-amber
  - Middle: "Terminal sidecar not running" --text-sm font-500 + body "Start the PTY sidecar: pnpm dev:terminal (auto-retry 2/5)"
  - Right: "Try again" + "View logs" buttons + X dismiss
- In the terminal pane itself: shown ASCII art connection screen + spinner + "Connecting..." (replaces current "Terminal connection error" generic state)
- Bottom status bar pulses amber with "DISCONNECTED · retrying..."
- When reconnected: status bar pulses emerald briefly with "CONNECTED"

==========================================================
ZONE 5 — CONTEXT INJECTION (the big new feature)
==========================================================

THE WOW FEATURE — any Forge entity can be injected as context into a terminal session.

CONTEXT PICKER (modal, opens from "+ Add context" in left panel):
- Dialog, --bg-elevated, max-width 720px, h-80vh
- TABS across top: All / Projects / ADRs / Architecture / Knowledge / Agents / Commands / Files
- Search input — semantic search across all Forge entities
- Each entity card: lucide icon + name + type badge + description (1 line) + "+ Add" button
- Selected entities appear as chips at top of dialog (with remove X)
- "Inject N items" primary button bottom

AVAILABLE CONTEXT TYPES:
- **Projects** — entire project intelligence
- **ADRs** — single or multiple ADRs
- **Architecture diagrams** — C4 / container / data flow diagrams
- **API contracts** — OpenAPI specs
- **Knowledge** — standards / templates / policies / runbooks / best practices
- **Agents** — agent definitions + permissions
- **Workflows** — workflow definitions
- **Commands** — specific forge-* commands
- **Runs** — past run outputs (for context)
- **Files** — repo files (via source connector)
- **Database tables** — schema + sample data
- **Tickets** — from Jira/Zendesk connector

INJECTION BEHAVIOR:
- When context is injected into a session, it's automatically passed to the AI CLI on each turn
- Format: invisible system prompt additions ("The following context is available: ...")
- User sees: chips in left panel + preview in right panel
- Toggle: "Auto-attach vs Manual attach" — auto means injected on every turn, manual means user types @context to attach

CONTEXT BADGE in terminal prompt area:
- Shows N context items attached: small badge "📎 4" — click to expand list
- Visual indicator of context size (small / medium / large)

==========================================================
ZONE 6 — FORGE COMMAND PALETTE (the second wow)
==========================================================

Press Ctrl+Shift+P (or click ⚡ icon in toolbar) → opens Forge Command Palette OVERLAY:

LAYOUT (centered modal, max-width 720px, --bg-elevated, --radius-xl, --shadow-lg, p-0):
- HEADER: search input "Type a command, skill, or describe what you want..." + "/" prefix for skills
- CATEGORIES (sticky section headers):
  - **Forge Skills** (indigo Sparkles icon): /forge-prd, /forge-adr, /forge-architecture, /forge-test, /forge-review, /forge-document, /forge-refactor, /forge-deploy
  - **Forge Commands** (cyan Command icon): /forge-dev-new-feature, /forge-dev-fix-bug, /forge-dev-refactor, /forge-dev-add-test, /forge-dev-update-deps, /forge-dev-migrate
  - **Connectors** (cyan Plug icon): /connect jira, /connect slack, /send-to-slack, /send-to-jira, /pull-from-zendesk
  - **Quick Actions** (amber Zap icon): Run last command, Open in IDE, Copy session, Share session, Export transcript
  - **Navigation** (indigo ArrowRight icon): Go to Dashboard, Go to Ideation, Open Co-pilot, etc.
- Each row: lucide icon + command name + description + keyboard shortcut if any
- Up/Down navigate, Enter to run, Esc to close
- Footer: "↑↓ navigate · Enter run · / skills · @ context · Esc close"

RUN COMMAND BEHAVIOR:
- Click a command: executes in the current session
- If requires input: prompts inline in the terminal (modal-like)
- Streams output to terminal
- Marks as forge command in audit: cyan ⏵ prefix

==========================================================
ZONE 7 — MULTI-CLI SUPPORT (Claude Code, Codex, Kiro, Gemini)
==========================================================

AGENT DROPDOWN (in header) shows all configured agents:
- Claude Code (cyan Sparkles) — primary, always available
- Codex (indigo Code) — OpenAI
- Aider (emerald GitCommit) — open source
- Kiro (violet Sparkles) — AWS
- Gemini CLI (amber Sparkles) — Google
- Custom agents: + Add custom (configures binary path + env)

AGENT SELECTION:
- New session inherits current agent selection
- Each session stores which agent it's using
- Switch agent mid-session: warns "This will restart the session. Continue?"
- Per-agent settings: model, temperature, max tokens (configure in agent dropdown)

AGENT CONFIGURATION (Settings → Agents):
- For each agent: binary path, default args, env vars, version, capabilities
- "Test connection" button per agent
- "Update" button if newer version available

==========================================================
ZONE 8 — SKILL DEFINITIONS
==========================================================

SKILL STRUCTURE (each forge skill is a markdown file the CLI can invoke):
- /forge-prd: "Generate a PRD from: $input" — uses Ideation agent + template
- /forge-adr: "Generate an ADR documenting: $decision" — uses Architecture agent
- /forge-architecture: "Generate architecture preview for: $feature"
- /forge-test: "Write tests for: $code"
- /forge-review: "Review this PR: $url"
- /forge-document: "Generate docs for: $module"
- /forge-refactor: "Refactor: $module following $standards"
- /forge-deploy: "Deploy: $service to $env"

Each skill shows:
- Definition (markdown)
- Required inputs
- Optional inputs
- Side effects (creates ADR, opens PR, etc.)
- "Run with inputs" modal form

==========================================================
ZONE 9 — SESSION MANAGEMENT ENHANCED
==========================================================

SESSION CARD (left panel):
- Session name (editable inline)
- Agent used (small avatar/icon)
- Workspace (small badge)
- Status dot (Connected emerald / Streaming cyan pulse / Idle muted / Disconnected rose)
- Last activity timestamp
- Runtime duration
- Right-click: Rename / Duplicate as new / Close / Pin to top / Copy session ID

SESSION DETAIL DRAWER (when right-click → "Session details"):
- Tabs: Overview / Context / History / Logs / Permissions

SESSION SHARING:
- "Share session" — generates link, others can spectate (read-only) or join (read-write)
- Permissions: Read / Write / Admin

SESSION EXPORT:
- Export transcript as Markdown / Plain text / JSON (with metadata)
- Includes: full terminal output + timestamps + context used + commands run + AI responses

==========================================================
ZONE 10 — KEYBOARD SHORTCUTS (consolidated)
==========================================================

Display in a single help overlay (Ctrl+/) and reference in left panel "?" icon:

Ctrl+Shift+T New session Ctrl+Shift+W Close session Ctrl+Tab Next session Ctrl+Shift+Tab Previous session Ctrl+1..9 Jump to session N Ctrl+Shift+F Search terminal Ctrl+Shift+P Command palette Ctrl+L Clear scrollback Ctrl+Shift+C Copy selection Ctrl+Shift+V Paste from clipboard Ctrl++/- Font size Ctrl+Shift+R Reconnect Ctrl+Shift+K Toggle context panel Ctrl+/ Show shortcuts ↑/↓ Command history Tab Autocomplete

==========================================================
ZONE 11 — PERFORMANCE & RESILIENCE
==========================================================

- xterm.js performance: limit buffer to 5000 lines (with warning at 4500)
- WebSocket reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, max
- Visual reconnect state (no silent failures)
- Sidecar health ping every 30s
- Terminal font: JetBrains Mono (already in stack)
- Theme: matches app palette
- All animations respect prefers-reduced-motion

==========================================================
ZONE 12 — EMPTY / ERROR / LOADING
==========================================================

- No sessions: First-run state with "Create your first session" CTA + setup guide
- Disconnected: Inline banner (Zone 4) + ASCII art in terminal
- Connection failed: clear error message + "Check sidecar" + "Try again"
- Loading session: spinner + "Initializing Claude Code in workspace 'default'..."

==========================================================
CONSTRAINTS
==========================================================

- xterm.js + WebLinksAddon + FitAddon + SearchAddon
- Custom theme matching app palette
- No emojis as UI icons (use lucide)
- Keep multi-tab pattern but redesign tab visuals
- Layout switcher (Single / Split / Grid) still works
- Audit log REPLACED by inline command markers (cleaner UX)
- Context injection must be SUBTLE — don't visually clutter the terminal
- All Forge commands must be invokable from terminal via the palette
- Skills execute via the AI CLI's tool calling (mock for now)
- Dark mode only
- Responsive: <1024px collapses to single column, left rail as drawer

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/terminal/
- Context injection provider in src/lib/context/ that any terminal session can use
- Command palette component reusable across the app
- Mock skill definitions for 8 forge skills
- Mock multi-CLI configuration (Claude Code, Codex, Aider, Kiro, Gemini)
- All keyboard shortcuts wired
- Layout switcher + multi-tab working
- Connection states handled (connected, connecting, disconnected, retrying)
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep xterm.js core, keep sidecar architecture (ws://localhost:4001), don't break existing session IDs
