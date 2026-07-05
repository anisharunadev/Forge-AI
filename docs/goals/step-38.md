> **Status:** completed
/goal

Fix the shared-tab issue (Projects and Stories are both highlighted in the sidebar) and modernize both Project Intelligence + Stories with deeper cross-module integration. The headline feature: **start implementing a story → opens a terminal session with the story's full context injected**. Read .claude/design-system/ first.

USER ISSUES (from the screenshot):
1. **Bug**: Projects and Stories tabs are both highlighted/active when viewing either page — sidebar state isn't tracking routes properly
2. **Project Intelligence is too minimal** — just shows "This project is fresh" empty state, needs more
3. **Stories need cross-module integration** — especially Story → Terminal flow ("start implementation")
4. **Modernize both for Forge AI** — make them feel like first-class surfaces, not afterthoughts

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "project management overview dashboard metrics team velocity" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "user story implementation start action task workflow" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "cross-module integration context injection narrative flow" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "sidebar active state route matching nested navigation" --domain ux-guideline -f markdown

Adopt every rule. Then build:

==========================================================
FIX 1 — SIDEBAR ACTIVE STATE BUG (fix the shared tab)
==========================================================

The sidebar shows BOTH Projects and Stories as active. This is happening because:
- Either the route matcher is too broad (e.g., `/projects` and `/stories` both match `/projects/*`)
- Or the active state isn't being set on route change
- Or Projects and Stories are rendered as the same route

FIX:
- Audit src/components/sidebar.tsx (or wherever nav is)
- Each nav item should match its EXACT route: `/projects` for Projects, `/stories` for Stories
- Use Next.js `usePathname()` with exact matching, not prefix matching
- If a parent route has children (`/projects/[id]`), only the parent highlights when on the index
- For nested routes, the parent highlights but the specific child doesn't (e.g., on `/projects/123`, only Projects highlights, not Stories)
- Test all routes: `/projects`, `/projects/123`, `/stories`, `/stories/456` — each should highlight correctly
- Add visual divider between Projects and Stories if they're both under "Centers" but should feel distinct

==========================================================
FIX 2 — PROJECT INTELLIGENCE (more features, less empty)
==========================================================

Project Intelligence currently shows just an empty state. Make it a real project hub.

KEEP existing structure (from Step 20) + ADD:

HERO BAND (already good — project context bar + h1 + description):
- Add: "Project health" composite score (0-100) with sub-scores (Velocity, Quality, Coverage, Risk)

NEW SECTION: "PROJECT AT A GLANCE" (when project is selected):
- bento grid with:
  - **Project metrics** (4 KPI tiles): Stories open, Stories in progress, Velocity, Cycle time
  - **Recent activity timeline** (last 10 events)
  - **Team load** (horizontal stacked bar per member)
  - **Upcoming milestones** (next 3 deadlines with countdown)

NEW SECTION: "ARTIFACT TREE" (visual hierarchy):
- Shows: PRD → Epics → Stories → Tasks → Runs (all linked for this project)
- Tree visualization with counts at each level
- Click any node → opens that entity
- "Empty state at this level" indicators
- "+ Add [level]" quick action at each level

NEW SECTION: "PROJECT INTEGRATIONS":
- Shows which Forge modules are active for this project:
  - ✅ Ideation: 12 ideas captured
  - ✅ Architecture: 4 ADRs documented
  - ✅ Stories: 47 stories tracked
  - ✅ Workflows: 3 workflows configured
  - ✅ Terminal: 12 active sessions
  - ✅ Knowledge: 8 artifacts linked
  - ⚠️ Connectors: 2 connected (Zendesk, GitHub)
- Each row: lucide icon + module name + count + status
- Click → navigates to that module filtered by this project

NEW SECTION: "PROJECT TEAM" (new):
- Member list: avatar + name + role + last activity + stories owned
- "Invite member" primary button (opens Dialog)
- Role badges (Owner, Maintainer, Contributor, Viewer)
- Permission matrix preview

NEW SECTION: "PROJECT TIMELINE" (new — the wow):
- Visual roadmap view of the project
- Gantt-style: weeks across X, epics/stories as bars
- Color-coded by status, owner, or priority
- Drag to reschedule
- Click bar → opens that story
- "Today" indicator (vertical line)
- Milestones as diamond markers
- Dependencies as arrows between bars

==========================================================
FIX 3 — STORIES (the headline: cross-module integration)
==========================================================

KEEP existing Stories kanban from Step 21 + ADD the killer feature.

STORY CARD — new affordance:
- **"Start implementation"** button on stories in "Ready" / "To Do" status
- Click → opens a Modal: "Start implementing this story"
  - Shows: which agent will work on it (selected by AI based on story type)
  - Shows: which terminal session will be opened (Claude Code / Codex / etc.)
  - Shows: context that will be auto-injected (PRD, linked ADRs, related code files)
  - Shows: estimated effort + plan
  - "Start" primary button
  - On click: opens Terminal Center with a NEW session, story's full context pre-injected (from Step 32's context injection)
  - Toasts: "Story ST-123 in progress · Terminal session opened"

STORY DETAIL DRAWER — enhanced cross-module:
- HEADER: same as before
- TABS:
  1. **Overview** (default) — description, acceptance criteria, subtasks
  2. **Context** (NEW) — what gets injected when this story starts implementing:
     - Linked PRD (auto-injected)
     - Linked ADRs (auto-injected)
     - Related code files (auto-detected)
     - Linked tasks (auto-injected)
     - Linked tests (auto-injected)
     - Connector data (e.g., from Zendesk ticket that spawned this story)
     - "Customize context" button → toggle which items to inject
  3. **Implementation** (NEW) — code + PR info:
     - Linked PR (if exists): "PR #1234 opened by Arun" with status
     - Branch: "feature/ST-123-payment-pkce"
     - Files changed (count + click to expand)
     - Live coding session: "Active terminal session for this story" + "Open terminal" button
     - AI agent working on it: "Code-Reviewer reviewing your changes"
  4. **Tests** — test results, coverage
  5. **Discussion** — comments
  6. **History** — version history

"START IMPLEMENTATION" BUTTON (prominent, top-right of drawer):
- For stories not yet started
- Click → opens implementation modal (described above)
- After starting: button changes to "View in terminal" (live link to session)

==========================================================
FIX 4 — STORY LIFECYCLE VIEW (the wow)
==========================================================

Add a new "Lifecycle" view to Stories (alongside Kanban / List / Timeline):

TIMELINE VIEW ENHANCED:
- Vertical timeline of all stories grouped by sprint/milestone
- Each story card: status, owner, age
- Connected by dependencies (arrows)
- Click story → opens detail
- Right side: "Active implementations" panel showing live coding sessions for in-progress stories

DEPENDENCY GRAPH VIEW (new):
- Force-directed graph of all stories
- Edges: "depends on" / "blocks" / "related to"
- Color by status
- Click → opens story
- Local view (focus on one story's deps)

==========================================================
FIX 5 — STORY → TERMINAL HANDOFF (the killer integration)
==========================================================

When user clicks "Start implementation" on a story:

OPEN A TERMINAL SESSION WITH:
- Session name: "ST-123: Payment PKCE flow" (auto)
- Agent: selected based on story type (default: Claude Code for code stories, Aider for refactor, etc.)
- Workspace: the story's project
- Pre-injected context (from Step 32):
  - Story description + acceptance criteria
  - Linked PRD section
  - Linked ADRs
  - Related code files (pulled from repo via Source connector)
  - "Task" panel inside terminal: shows the story's acceptance criteria as a checklist the AI is working through
- Initial prompt: "Implement story ST-123: [title]. Acceptance criteria: [list]. Start by exploring the relevant codebase."

AFTER STARTING:
- Story status auto-changes to "In Progress"
- A live indicator in the story card: "🟢 Coding session active"
- Terminal session shows the story in its left panel "Context" (Step 32)
- As the AI makes changes, story card updates: files changed, tests passing
- When implementation is done, story moves to "In Review" with the PR linked

==========================================================
FIX 6 — CROSS-MODULE BREADCRUMB ENHANCEMENT
==========================================================

Every story detail shows its full LIFECYCLE chain as a breadcrumb at the top:
- "📋 Story ST-123" (current) ← 📜 ADR-005 ← 💡 Idea-042 ← 📋 PRD-001 ← 🎫 ACME-123
- Each previous step clickable
- Visual: arrows + icons + IDs
- Shows the "story's journey" from ticket to implementation

==========================================================
FIX 7 — PROJECT INTELLIGENCE ↔ STORIES DEEP LINK
==========================================================

On Project Intelligence page:
- "Active stories" section (in the artifact tree)
- Click story → opens Stories page with that story selected
- On Stories page: project context shown at top
- Switching between Projects and Stories preserves selection

==========================================================
FIX 8 — QUICK ACTIONS EVERYWHERE
==========================================================

Add a "Quick actions" menu to both pages (consistent):
- Projects page: New idea, New PRD, New epic, New story, Open in terminal, Open in Co-pilot
- Stories page: New story, Start sprint, Open in terminal, View in Co-pilot, Generate tasks

==========================================================
FIX 9 — EMPTY STATES (better than "This project is fresh")
==========================================================

PROJECT INTELLIGENCE empty state (when project exists but no artifacts):
- Welcome to "{project name}" card
- 3 quick-start paths:
  1. "📋 Start from a ticket" → open Command Center in Ticket mode (Step 34)
  2. "💡 Capture your first idea" → open Ideation
  3. "🎯 Use a template" → start from PRD/Epic template
- "Or: import from Jira/Linear" with connector buttons

STORIES empty state (when project has no stories):
- "No stories yet for this project" 
- 3 paths: "From a ticket" / "From an idea" / "From scratch"
- "AI will help you break down your next story" promise

==========================================================
FIX 10 — KEYBOARD SHORTCUTS
==========================================================

- ⌘⇧P: New project
- ⌘⇧S: New story
- ⌘⇧T: Start implementation (on selected story)
- ⌘/: Shortcuts

==========================================================
CONSTRAINTS
==========================================================

- Keep all Step 20 (Project Intelligence) and Step 21 (Stories) functionality
- Keep the kanban + list + timeline views
- Don't break the artifact tree or any existing data
- The cross-module flow (Story → Terminal) is the HEADLINE — make it the best-in-class experience
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/projects/ and src/components/stories/
- The sidebar active state bug FIXED
- Project Intelligence with: at-a-glance bento, artifact tree, integrations, team, timeline
- Stories with: Lifecycle view, cross-module breadcrumb, "Start implementation" flow
- The killer Story → Terminal handoff working end-to-end
- Sample data: 3 projects, 12 stories, 4 in-progress implementations
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep kanban from Step 21, keep the existing artifact data model, keep existing story IDs
