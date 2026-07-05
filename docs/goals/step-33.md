> **Status:** completed
/goal

Massive modernization of the Forge Command Center in Forge AI Agent OS — currently a simple command catalog (categories + cards + recent runs). User wants to integrate the GSD-core spec-driven development methodology (renamed to `packages/forge-core/` — already done per the screenshot). The Command Center should become a real developer workbench: ticket-driven entry, full SDLC phases (Spike → Plan → Execute → Verify → Validate → Deploy), multi-work management, and orchestration across all Forge modules. Read .claude/design-system/ first.

USER INTENT (from the brief):
1. **Download GSD-core, rename all modules from `gsd` → `forge`** — already done (file tree shows `packages/forge-core/workflows/`, `skills/forge-*`, etc.)
2. **Integrate all forge-* skills, agents, commands into Forge AI** — this is the integration task
3. **Spec-driven development** — the GSD methodology: define spec → auto-generate execution plan → execute phases → verify → deploy
4. **Command Center should help developers** — not just a command list, but an active workbench
5. **Ticket-driven trigger** — "I have this ticket, what should I do?" entry point
6. **Full SDLC workbench** — Ideation → Architecture → Development → Testing → Deployment, end-to-end
7. **Faster delivery cycle** — the goal of the whole redesign

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "developer workbench IDE integrated terminal ticket workflow" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "spec driven development GSD phased execution plan" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Jira ticket driven workflow automation development" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "progress phase tracker SDLC pipeline status visualization" --domain chart -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "command center marketplace catalog browse filter dark mode" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/forge-command-center/page.tsx. Keep route. Total rebuild — this is the most important page in the app. The Command Center becomes the developer's home, not just a command catalog.

==========================================================
ZONE 1 — HEADER (rebuilt)
==========================================================

HERO BAND (compact, professional — like Linear's command bar):
- Eyebrow "FORGE COMMAND CENTER" --text-xs --fg-tertiary
- h1 "Command Center" --text-2xl font-700 with lucide SquareTerminal icon in --accent-cyan
- Body "The workbench for Forge AI. Run commands, manage specs, drive tickets through the SDLC. Backed by packages/forge-core/ (GSD-core)."

TOP-RIGHT CLUSTER:
- **My work button** (lucide Briefcase + badge "3 active") — opens My Work drawer
- **Notifications bell** with badge
- **Profile avatar** + tenant context

==========================================================
ZONE 2 — MODE SWITCHER (the new top-level nav)
==========================================================

REPLACE the simple command catalog view with THREE MODES:

MODE SWITCHER (segmented control, large):
1. **🎫 Ticket mode** (default) — "I have a ticket, help me work it"
2. **📋 Spec mode** — "I have an idea, let's spec it out"
3. **📚 Catalog mode** — current command catalog (browse)

Each mode has its own layout, workflow, and visual treatment.

==========================================================
ZONE 3 — TICKET MODE (the new default — the headline wow)
==========================================================

This is the killer feature. Developer pastes a ticket, Forge orchestrates the entire workflow.

LAYOUT:

TOP — TICKET INPUT BAR (full width, --bg-elevated, --radius-xl, --shadow-md, p-16px, flex gap-3):
- Lucide Ticket icon
- Input field — placeholder "Paste a Jira ticket URL, GitHub issue, or ticket ID..." w-full, h-44px
- Examples (small chip links below input when empty): "Jira: ACME-123" / "GitHub: org/repo#456" / "Linear: ENG-789" / "Manual ticket..."
- RIGHT: "Forge it ⚡" primary button (cyan, when input has value)
- Recent tickets row (when input empty): last 5 tickets with status badges

MIDDLE — TICKET ANALYSIS CARD (appears after ticket entered):
- bg --bg-surface, --radius-lg, p-24px, border --border-subtle, mt-4
- HEADER: ticket icon (Jira / GitHub / Linear colored) + ticket id (mono) + title --text-md font-600 + status badge + priority badge + source link
- SUMMARY: AI-generated 1-paragraph summary of the ticket (what's needed)
- ENTITY LINKS: chips showing linked entities from Forge:
  - Linked idea (from Ideation): "IDEA-042"
  - Linked story (from Stories): "STORY-108"
  - Linked ADR (from Architecture): "ADR-005"
  - Linked files (from GitHub): 3 files mentioned
  - Linked agents (from Agents): "Code-Reviewer"
- AI SUGGESTED WORKFLOW: below the card, horizontal pipeline visualization:
  - Spike (forge-spike) → Plan (forge-plan) → Execute (forge-execute-phase) → Verify (forge-verify-phase) → Validate (forge-validate-phase) → Audit (forge-audit-fix) → Deploy (forge-deploy)
  - Each step: lucide icon + name + duration estimate + "Start" button
  - Current step highlighted
  - Completed steps with emerald check
  - Skippable steps (small "skip" link)

BOTTOM — PHASE EXECUTION PANEL (when a phase is started):
- Selected phase expands into a full workbench
- Phase header: lucide icon + phase name + "What this does" brief
- Phase inputs: form fields specific to the phase
  - For Spike: "What do you want to research?" (textarea)
  - For Plan: "Acceptance criteria" (markdown)
  - For Execute: code preview + diff
  - For Verify: test results
- Phase outputs: live preview of what was generated
- Action bar: "Run phase" primary + "Skip" outline + "View artifacts" link
- Phase timeline: which phases completed, current, pending
- "Resume work" button if returning to in-progress

EXAMPLE: User pastes "ACME-123"
1. Ticket fetched, parsed, displayed
2. AI summary: "Implement OAuth2 PKCE flow for mobile app, with refresh token rotation"
3. Workflow suggested: Spike → Plan → Execute → Test → Deploy
4. User clicks "Start" on Spike → fills research question → AI generates spike doc
5. Phase advances to Plan → AI drafts execution plan with sub-tasks
6. Phase advances to Execute → opens Code Reviewer agent → produces PR
7. Phase advances to Verify → runs tests → shows pass/fail
8. Phase advances to Deploy → triggers deploy workflow

==========================================================
ZONE 4 — SPEC MODE (the second wow)
==========================================================

For ideas not yet tied to a ticket — full spec-driven development workflow.

LAYOUT (3-column on desktop ≥1440px):

LEFT (300px, --bg-surface, border-r --border-subtle, p-16px):
- **Specs list**:
  - Header: "MY SPECS" + count + "+ New spec"
  - Filter: All / Drafting / Planning / Executing / Completed / Archived
  - Each spec: id + title + status badge (Draft amber / Planning cyan / Executing indigo / Completed emerald / Archived muted) + progress bar
  - Active spec highlighted
  - "+ Start from template" button

CENTER (flex-1, --bg-base, p-32px):
- **Spec editor**:
  - HEADER: spec title (editable inline) + version + status badge + "Share" + 3-dot menu
  - TABS:
    1. **Overview** (default) — markdown description of the spec, problem statement, goals
    2. **Requirements** — list of functional + non-functional requirements (checklist)
    3. **Plan** — AI-generated execution plan with phases, sub-tasks, dependencies, estimates
    4. **Execution** — live status of execution, agent runs, artifacts produced
    5. **Verification** — test results, validation evidence
    6. **History** — version history with diffs

- **Bottom of spec**: 
  - "Start execution" button (large, primary)
  - "Export as ADR" + "Export as PRD" + "Generate ticket" buttons

RIGHT (320px, --bg-surface, border-l --border-subtle, p-16px):
- **Phase progress tracker**:
  - Visual pipeline (vertical): Spike → Plan → Execute → Verify → Validate → Deploy
  - Each: status (Pending / In Progress / Completed / Skipped) + duration + artifacts count
- **Linked entities**:
  - "This spec implements...": linked ADRs / standards
  - "Related specs": similar/dependent specs
- **AI suggestions**:
  - "Add test coverage requirement"
  - "Reference ADR-003 for API design"
  - "Consider performance NFR"

SPEC CREATION WIZARD (from "+ New spec"):
- Step 1: Source — Start blank / From idea / From ticket / From template
- Step 2: Title + brief description (markdown)
- Step 3: AI proposes structure (problem / goals / requirements / NFRs / risks / plan)
- Step 4: Review + refine
- Step 5: Save as draft OR "Forge to execution"

==========================================================
ZONE 5 — CATALOG MODE (the current view, polished)
==========================================================

Keep the command catalog from Step 7 but ENHANCE:

- Add **Featured commands** carousel at top (most-used this week)
- Add **Recently used by your team** (from team activity)
- Add **Suggested for your tickets** (AI matches commands to active tickets)
- Connector each command with: phase (Spike/Plan/Execute/Verify/Deploy), tags, dependencies
- "Add to spec" button on each command → adds as a step in your spec
- "Trigger from ticket" button → starts workflow with this command
- Search filters: by phase / by tag / by agent used / by category

==========================================================
ZONE 6 — MY WORK DRAWER (right slide-in, 400px)
==========================================================

THE DEVELOPER'S HOME — see all your active work:

SECTIONS:
- **Active tickets** (N) — tickets currently in progress, with phase status
- **Active specs** (N) — specs being drafted or executed
- **Active runs** (N) — agent runs currently running (with live progress bars)
- **Pending approvals** (N) — your approvals waiting
- **Recent artifacts** — files/PRs/decisions you produced recently
- **Today's focus** — what the AI thinks you should focus on (based on ticket priorities, deadlines, team activity)

Each item clickable → navigates to it.
"Resume work" button on in-progress items.
"Mark complete" + "Archive" actions.

==========================================================
ZONE 7 — GSD PHASE WIDGET (always visible)
==========================================================

FLOATING WIDGET (bottom-left of viewport, persists across pages):
- Shows current phase + active work
- Mini progress indicator: which GSD phase you're in (Spike/Plan/Execute/Verify/Validate/Audit/Deploy)
- Click expands to full workbench view
- Designed to feel like a Slack/HelpScout beacon

==========================================================
ZONE 8 — COMMAND EXECUTION ENGINE
==========================================================

When user clicks "Run" on any command (Catalog or Spec/Ticket mode):
- Modal opens with command details + input form
- "Execute" button:
  - If requires AI agent: spawns agent run (visible in Runs center)
  - If requires Claude Code: opens terminal session with context injected
  - If requires workflow: triggers workflow
  - If requires connector: invokes connector
- Real-time progress: stream updates to a progress drawer
- "Open in runs" link when started
- "View artifacts" link when complete

==========================================================
ZONE 9 — INTEGRATION WITH FORGE-CORE PACKAGE
==========================================================

The `packages/forge-core/` package contains all the GSD skills/agents/commands. Forge Command Center should:
- Read manifest of available skills from `forge-core/skills/` (file tree shown in screenshot)
- Display them in Catalog mode with metadata
- Map each to a phase (Spike/Plan/Execute/etc.)
- Provide a UI to invoke any of them
- Track usage + outcomes

UI COMPONENT: <ForgeSkillCard>
- Skill name (mono)
- Phase badge (color-coded per phase)
- Description
- Inputs (form schema)
- Outputs (artifacts produced)
- "Run" button

AVAILABLE SKILLS TO DISPLAY (from screenshot):
- forge-add-tests, forge-ai-integration-phase, forge-audit-fix, forge-audit-milestone, forge-audit-uat, forge-autonomous, forge-capture, forge-cleanup, forge-complete-milestone, forge-config, forge-debug, forge-discuss-phase, forge-docs-update, forge-eval-review, forge-execute-phase, forge-explore, ...

PHASE MAPPING (recommended):
- **Discovery**: forge-capture, forge-explore, forge-spike
- **Planning**: forge-plan, forge-discuss-phase, forge-ultraplan
- **Execution**: forge-execute-phase, forge-ui-phase, forge-ai-integration-phase, forge-add-tests, forge-debug
- **Verification**: forge-verify-phase, forge-validate-phase, forge-eval-review
- **Deployment**: forge-deploy, forge-cleanup
- **Audit**: forge-audit-fix, forge-audit-milestone, forge-audit-uat
- **Maintenance**: forge-docs-update, forge-config, forge-update

==========================================================
ZONE 10 — TICKET INTEGRATION (Jira / GitHub / Linear)
==========================================================

Use Connectors (Step 31) to fetch tickets:
- Connector Picker (already exists) when entering Ticket mode
- Auto-fetch ticket details, comments, linked PRs
- Two-way sync: status updates in Forge → status updates in Jira
- Comment thread: AI can post updates back to Jira ticket
- Attachments: link Forge artifacts to ticket

WORKFLOW TRIGGERS:
- "When ticket assigned to me → create spec automatically"
- "When ticket status changes to In Progress → start execution phase"
- "When ticket has 'forge' label → use forge-core skills"

==========================================================
ZONE 11 — AI SUGGESTIONS ENGINE (the wow under the wow)
==========================================================

Based on current work + ticket context + team activity + Forge knowledge, AI suggests:

- "You typically start tickets with forge-spike. Start?"
- "This ticket touches payment service — here's the related ADR + standards"
- "Three people are working on related tickets — coordinate?"
- "Estimated complexity: Medium (2-3 days). Previous similar tickets took 1.8 days."
- "Suggested workflow: Plan → Execute → Verify → Deploy (skip Spike, pattern is established)"

SUGGESTIONS APPEAR:
- In Ticket mode: as contextual cards
- In Spec mode: as "AI suggestions" panel
- In My Work: as "Today's focus" recommendations
- In Catalog: as "Suggested for your tickets" section

==========================================================
ZONE 12 — KEYBOARD SHORTCUTS
==========================================================

- ⌘K: Global command palette (also invokes Command Center)
- ⌘T: New ticket
- ⌘⇧S: New spec
- ⌘R: Run last command
- ⌘⇧P: Command palette (Forge-specific)
- ⌘/: Show shortcuts
- ⌘1-7: Jump to phase (Spike/Plan/Execute/Verify/Validate/Audit/Deploy)

==========================================================
ZONE 13 — EMPTY / FIRST-RUN / ERROR STATES
==========================================================

- First-run: "Welcome to your Forge workbench. Pick a starting point:" + 3 cards: "Paste a ticket" / "Start a new spec" / "Browse commands"
- No active work: "All caught up ✓" + "Start something new" buttons
- Ticket fetch failed: ErrorState from Step 13 + retry
- Skill execution failed: "X failed at phase Y" + "Retry from phase" or "Get help" (opens Co-pilot with context)

==========================================================
CONSTRAINTS
==========================================================

- The forge-core package is the source of truth for available skills — UI reads from it
- Ticket mode is the DEFAULT landing — most common entry point
- Keep current Catalog view accessible (for power users who want to browse)
- All skill invocations produce a "run" visible in Runs center
- Dark mode only
- Lucide icons throughout
- Animations respect prefers-reduced-motion
- Real-time progress: WebSocket or SSE for live updates
- Mock ticket data: use sample Jira/GitHub payloads

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/command-center/
- Skill manifest reader in src/lib/forge-core/ that reads from packages/forge-core/
- 3 modes wired: Ticket / Spec / Catalog
- Sample ticket data: 3-5 tickets in different states
- Sample spec data: 2 specs in different phases
- All forge-* skills from the screenshot displayed + runnable
- Ticket → Spec → Workflow → Run integration end-to-end (mocked)
- My Work drawer functional
- Floating GSD phase widget working
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep forge-core package structure, keep GSD file naming convention (spike.md, plan.md, etc.), keep existing commands working
