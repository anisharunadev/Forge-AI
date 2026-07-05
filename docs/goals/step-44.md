> **Status:** completed
/goal

Address 6 specific improvements to the Stories page in Forge AI Agent OS. The page looks good but has URL, integration, and feature gaps. Read .claude/design-system/ first.

USER ISSUES TO FIX:
1. URL: `localhost:3000/project-intelligence/stories` should be just `/stories` (separate route, not nested)
2. Bidirectional Jira sync: Forge ↔ Jira (auto + manual)
3. Auto-injected context needs a bigger model (more context window)
4. New Story dialog is too minimal — needs markdown editor + better form
5. Every status change can trigger an AI agent or command (Forge core integration)
6. Terminal should accept Jira ticket URL directly and start working

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "route refactor nested URL clean separate path" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "bidirectional sync Jira integration two-way status webhook" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "rich markdown editor form auto-grow toolbar" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Jira ticket URL paste terminal command context injection" --domain ux-guideline -f markdown

Adopt every rule. Then implement:

==========================================================
FIX 1 — URL REFACTOR (separate route)
==========================================================

ISSUE: Stories is nested under `/project-intelligence/stories` — should be its own top-level route.

REFACTOR:
- Move src/app/(workspace)/project-intelligence/stories/ → src/app/(workspace)/stories/
- Update all internal links pointing to /project-intelligence/stories → /stories
- Update sidebar nav to point to /stories
- Add a redirect from old URL to new URL: /project-intelligence/stories → /stories (301 permanent, or 302 temporary with "moved" message)
- Update breadcrumbs: "Workspace / Stories" instead of "Workspace / Project Intelligence / Stories"
- Verify all router links, sidebar, dashboard tiles, command palette entries updated
- Update any place in code that hardcodes the old path

EFFECT: stories becomes a peer to /projects, /agents, /workflows in the IA — not a child of project-intelligence. The project context is shown IN the stories page (project switcher at top), not via the URL.

==========================================================
FIX 2 — BIDIRECTIONAL JIRA SYNC
==========================================================

ISSUE: stories need to sync with Jira both directions (Forge → Jira, Jira → Forge).

ARCHITECTURE:
- Sync engine in src/lib/jira-sync/ that watches both sides
- Uses the Jira connector (Step 31) for API access
- Uses Webhooks for Jira → Forge direction
- Uses REST API for Forge → Jira direction

DIRECTION 1: FORGE → JIRA (push on changes)
- Trigger events: story created, story updated, status changed, assignee changed, comment added
- Mapping: Forge Story ↔ Jira Issue (configurable per project)
- Default field mapping:
  - Forge story ID → Jira Issue key (e.g., ST-123 → ACME-456)
  - Forge title → Jira Summary
  - Forge description → Jira Description
  - Forge status (Backlog / To Do / In Progress / In Review / QA / Done) → Jira status
  - Forge assignee → Jira Assignee
  - Forge priority → Jira Priority
  - Forge labels → Jira Labels
  - Forge estimate → Jira Story Points (custom field)
- On change: push to Jira with retry + conflict detection
- Show sync status on each story: 🔄 (syncing) / ✓ (synced) / ⚠️ (conflict) / ✗ (failed)

DIRECTION 2: JIRA → FORGE (pull on changes)
- Trigger: Jira webhook fires on issue update
- Webhook URL configured per Jira project
- Validate webhook signature
- Update Forge story with new Jira data
- Field mapping: same as above, reverse direction

CONFLICT RESOLUTION:
- If both sides changed at the same time: last-write-wins by default
- Show conflict UI when detected: "Forge changed X, Jira changed Y — which to keep?"
- Manual conflict resolution per field

MANUAL SYNC:
- "Sync now" button on each story (in detail drawer header)
- "Sync all" button on the page (syncs all unsynced stories)
- "Re-sync" on failed syncs

SYNC INDICATOR:
- Top of page: "✓ Synced · Last sync 2m ago" or "⟳ Syncing 3 of 14 stories"
- Per-story badge: small Jira icon + sync status

SYNC UI (in story detail drawer):
- "Jira sync" section in the Context tab (or new "Sync" tab)
- Shows: Jira issue link, last sync time, sync status, field mapping
- "Sync now" button + "Re-sync" if failed
- "View in Jira →" link

==========================================================
FIX 3 — BIGGER MODEL FOR CONTEXT INJECTION
==========================================================

ISSUE: "Start implementation" auto-injects context, but the model is too small to handle it well.

FIX:
- DEFAULT MODEL for "Start implementation" flow: Claude Sonnet 4.5 (already in model picker)
- BUT: the context injection should be smart about WHAT to include
- Add a "Context size" indicator on the Start implementation modal:
  - Estimated tokens: "2,400 / 200,000 context window" (with progress bar)
  - Color: emerald if <50%, amber if 50-80%, rose if >80%
- If estimated context >80% of model window: show warning
  - "Context is large. Consider using a bigger model:"
  - Suggested: Claude Sonnet 4.5 (200K), Claude Opus 4 (200K), GPT-4o (128K)
- INJECTION ORDER (priority — most important first):
  1. Story description + acceptance criteria (always)
  2. Linked PRD section (if any)
  3. Linked ADRs (top 3 most relevant)
  4. Recent conversation history (last 5 messages)
  5. Related code files (if connected via source connector)
  6. Pattern examples from past similar stories
- Use "context summarization" feature: for large contexts, summarize older parts and inject the summary + recent parts in full

START IMPLEMENTATION MODAL ENHANCEMENT:
- Add a "Model" picker (default: best model for code = Claude Sonnet 4.5)
- Add "Context" preview: list of items that will be injected with toggle to include/exclude each
- Add "Estimated cost" based on selected model + context size
- Add "Working directory" picker (which project + branch)

==========================================================
FIX 4 — NEW STORY DIALOG: MARKDOWN EDITOR + BETTER FORM
==========================================================

Current New Story dialog has: Title, Description (plain text), Epic, Sprint, Priority, Estimate, Labels, Assignee.

REPLACE with:

LAYOUT (--bg-elevated, max-width 640px):
- TITLE: "New story" h2 + "Create a user story with rich description, acceptance criteria, and subtasks."

FORM (single column, --text-sm, vertical):
- **Title** (required): Input field
- **Description** (markdown supported): Rich markdown editor (reuse from Step 12)
  - Toolbar: B / I / H / link / list / code / quote / @ mention
  - Auto-grow 3 to 12 lines
  - Variable insertion: {{user_problem}}, {{desired_outcome}}
- **Acceptance criteria** (markdown supported): Checkbox list editor
  - Default 3 placeholder items: "Given [context]...", "When [action]...", "Then [outcome]..."
  - Click to edit, + to add new
- **Subtasks** (optional): Mini task list
  - Add subtask → text input → checkbox
  - Drag to reorder
- **Metadata row** (2-col grid):
  - LEFT: Epic (Combobox) + Sprint (Combobox)
  - RIGHT: Priority (RadioGroup) + Estimate (RadioGroup)
- **Labels** (Combobox, multi-select with create)
- **Assignee** (Combobox, searchable)
- **Linked items** (optional): "Link to existing entities"
  - Tabs: PRDs | ADRs | Ideas | Epics | Tasks
  - Search + add

FOOTER:
- "Save as draft" ghost + "Create" primary + "Create and start implementation" outline (NEW — this is the killer flow)

"CREATE AND START IMPLEMENTATION" FLOW:
- After creating the story, immediately opens the Start Implementation modal (from Fix 3)
- Pre-filled with the new story
- One click from "idea" to "coding session"

==========================================================
FIX 5 — Forge core INTEGRATION: STATUS CHANGES TRIGGER COMMANDS
==========================================================

ISSUE: every status change should be able to trigger an AI agent or command (Forge core methodology).

ENHANCEMENT: add "Workflow" to each status column / transition:

WHEN A STORY MOVES BETWEEN STATUSES, USER CAN OPTIONALLY:
- Run a command (any forge-* command)
- Invoke an agent (any registered agent)
- Trigger a workflow (any saved workflow)
- Open in terminal (with story context)

UI:
- On each story card: when in "In Progress" status, show "Run" actions:
  - "▶ Run with [agent]" dropdown (pick agent: Claude Code, Codex, etc.)
  - "⚡ Run command" dropdown (pick from forge-* commands)
  - "🔄 Trigger workflow" (pick from saved workflows)
  - "🖥 Open in terminal" (with full context)
- On each column header: "Automate this column" link
  - Opens panel: "When a story enters this column, automatically run: [command/agent]"
  - Examples:
    - "To Do → In Progress: Run forge-spike" (auto research)
    - "In Progress → In Review: Run forge-audit" (auto code review)
    - "In Review → Done: Run forge-deploy" (auto deploy)
  - Per-column automation list (can have multiple)
  - Toggle to enable/disable each automation
  - Run history: "Last 10 runs of this automation"

Forge core PHASE WIRING (the killer integration):
- Each Kanban column maps to a Forge core phase:
  - Backlog → (not started)
  - To Do → Spike
  - In Progress → Execute
  - In Review → Verify + Validate
  - QA → Audit
  - Done → Deploy
- "Run Forge core phase" button on each story in the right column
- Shows: "This will run: Spike → Plan → Execute (estimated 2h 30m)"
- Confirmation modal
- "Run phase" primary → opens terminal with context, starts phase pipeline

==========================================================
FIX 6 — TERMINAL: JIRA TICKET URL DIRECTLY
==========================================================

ISSUE: terminal should accept Jira ticket URL directly and start working.

ENHANCEMENT: in the terminal input area (or in the Forge Command Palette from Step 32), users can paste:
- `ACME-123` (Jira key)
- `https://acme.atlassian.net/browse/ACME-123` (full URL)
- `github.com/org/repo#456` (GitHub issue)
- `linear.app/workspace/issue/ENG-789` (Linear)

ON PASTE in terminal:
- Detect URL/ticket pattern
- Show inline preview card (rich, in the input area):
  - "🎫 ACME-123: Implement OAuth2 PKCE flow for mobile app"
  - Status: Open | Priority: P1 | Assignee: Arun
  - AI summary: "Implement OAuth2 Authorization Code flow with PKCE for the mobile client..."
  - Linked entities: STORY-108, ADR-005
- Suggest commands:
  - "/forge-prd ACME-123" (generate PRD from ticket)
  - "/forge-impl ACME-123" (start implementation)
  - "/forge-ticket ACME-123" (create story from ticket)
- User picks command or types their own
- Send → executes with the ticket context pre-injected

IN LEFT PANEL of terminal (from Step 32):
- When a ticket is "active" in the session, show it prominently
- "+ Add ticket" button → opens ticket picker
- Multiple tickets can be attached per session

IN SESSION TAB:
- Show ticket icon in tab name if ticket is attached: "🎫 ACME-123"
- Multiple sessions with different tickets visible at a glance

==========================================================
CONSTRAINTS
==========================================================

- The URL refactor (Fix 1) is critical — do it first as a standalone PR
- Don't break existing bookmarks or external links — add redirects
- Jira sync (Fix 2) requires the Jira connector to be configured (mock for now if not)
- Context injection (Fix 3) is per-session, not global
- Markdown editor (Fix 4) reuses the component from Step 12
- Forge core integration (Fix 5) is per-project configurable
- Terminal Jira URL (Fix 6) requires URL pattern detection
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only
- Don't break any existing functionality

==========================================================
DELIVERABLE
==========================================================

- files modified (route refactor is the biggest change)
- New files: src/lib/jira-sync/* (sync engine)
- Updated src/app/(workspace)/stories/page.tsx and components
- Updated terminal with ticket URL detection
- Updated New Story dialog with markdown editor
- Updated Start Implementation modal with model picker + context preview
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep the existing stories data model, keep kanban + list + timeline views, keep existing keyboard shortcuts
- Build order: Fix 1 (URL) → Fix 4 (Story dialog) → Fix 3 (Context) → Fix 5 (Forge core) → Fix 6 (Terminal Jira) → Fix 2 (Bidirectional sync, biggest)

==========================================================
FIX 5 — FORGE-CORE INTEGRATION: STATUS CHANGES TRIGGER SKILLS
==========================================================

ISSUE: every status change should be able to trigger a forge-core skill, agent, or command.

The forge-core methodology (in packages/forge-core/) is the canonical workflow system. 
Don't reinvent it — wire the Stories kanban into the existing skills.

ON EACH STORY CARD (when in "In Progress" status), show "Run" actions:
  - "▶ Run with [agent]" dropdown (pick from packages/forge-core/agents/)
  - "⚡ Run skill" dropdown (pick from packages/forge-core/skills/ — forge-capture, forge-explore, forge-execute-phase, etc.)
  - "🔄 Run command" dropdown (pick from packages/forge-core/commands/)
  - "🖥 Open in terminal" (with full context pre-injected)

ON EACH KANBAN COLUMN HEADER: "Automate this column" link
  - Opens panel: "When a story enters this column, automatically run: [skill/agent/command]"
  - Examples:
    - To Do → In Progress: Run forge-capture (auto-spike)
    - In Progress → In Review: Run forge-code-review (auto code review)
    - In Review → QA: Run forge-audit-uat (auto UAT)
    - QA → Done: Run forge-complete-milestone (auto mark complete)
  - Per-column automation list (can have multiple)
  - Toggle to enable/disable each automation
  - Run history: "Last 10 runs of this automation"

FORGE-CORE PHASE WIRING (the killer integration):
  - Map each Kanban column to a forge-core skill:
    - Backlog → (not started)
    - To Do → forge-capture / forge-explore
    - In Progress → forge-execute-phase
    - In Review → forge-code-review / forge-eval-review
    - QA → forge-audit-uat
    - Done → forge-complete-milestone
  - "Run forge-core phase" button on each story in the right column
  - Shows: "This will run: forge-capture → forge-execute-phase (estimated 2h 30m)"
  - Confirmation modal
  - "Run phase" primary → opens terminal with context, starts the phase pipeline

READ FROM THE PACKAGE (don't hardcode):
  - Skill manifest: read packages/forge-core/skills/ folder names + their .md frontmatter
  - Agent manifest: read packages/forge-core/agents/ folder
  - Command manifest: read packages/forge-core/commands/ folder
  - Display whatever's in the package — no hardcoded skill list
  - When a new skill is added to the package, it auto-appears in the UI

CONSTRAINTS:
  - The forge-core package is the single source of truth — never hardcode skill/agent/command names in the UI
  - Don't mention "Forge core" anywhere in the UI or in the documentation
  - All forge-* skills are invokable from the UI
  - Per-project configurable automations
  - Run history visible per automation
