/goal

Ship the killer features of the Command Center — the pieces that turn it from "command catalog" into "actual developer workbench." This is focused scope: Ticket-as-entry-point, full GSD methodology in UI, cross-module orchestration, plus the 3 quick wins as the implementation path. Read .claude/design-system/ first.

WHY THIS STEP IS DIFFERENT: this isn't a UI redesign — it's a **product pivot**. The moment a developer pastes a Jira ticket and Forge orchestrates spike → plan → execute → verify → deploy, you have a fundamentally different product. Focus 100% of effort on that orchestration flow.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "developer workbench ticket-driven workflow orchestration conductor" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "spec driven development phased pipeline visualization progress" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Jira GitHub Linear ticket fetch integration sync development" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "phase progress tracker pipeline status indicators completion" --domain chart -f markdown

Adopt every rule. Then build — in this exact order (each is a quick win that builds on the previous):

==========================================================
QUICK WIN 1 — TICKET MODE SHELL (foundation, ~2 hrs)
==========================================================

REPLACE the current Command Center page hero with a TICKET-DRIVEN entry point. This becomes the new default landing.

LAYOUT:

TOP — TICKET INPUT BAR (full width, --bg-elevated, --radius-xl, --shadow-md, p-20px):
- Header: h1 "Command Center" --text-2xl font-700 + Sparkles icon
- Sub: "The workbench for Forge AI. Paste a ticket to start, browse commands, or drive specs through the SDLC."
- INPUT BAR (--bg-surface, --radius-lg, p-16px, flex gap-3, mt-4):
  - Lucide Ticket icon (20px in --accent-cyan)
  - Input field w-full, h-48px, --text-md: placeholder "Paste a Jira ticket, GitHub issue, or ticket ID..."
  - Source quick-pick chips below input (when empty): "Jira: ACME-123" / "GitHub: org/repo#456" / "Linear: ENG-789" — click to autofill
  - Recent tickets row (when empty): last 5 tickets as compact cards (source icon + id + title + status badge + "Resume →")
  - RIGHT: "Forge it ⚡" primary button (cyan, h-48px, disabled when input empty)

KEEP the existing Catalog view below this — but it's now SECONDARY. Ticket input is the hero.

EMPTY STATE (truly first time): "Welcome to your Forge workbench." + 3 starting cards: "Paste a ticket" / "Start a spec" / "Browse commands"

==========================================================
QUICK WIN 2 — TICKET FETCH + ANALYSIS (the wow)
==========================================================

When user pastes a ticket and clicks "Forge it ⚡":

TICKET FETCH (animated, ~1.5s):
- Input bar shows loading state: "Fetching ACME-123..." with cyan spinner
- Progress indicators: "Connecting to Jira" → "Fetching ticket" → "Analyzing context" → "Loading linked entities"

TICKET ANALYSIS CARD (appears below input, --bg-surface, --radius-lg, p-24px, mt-4, slide-down 250ms):
- HEADER: ticket icon (Jira blue / GitHub dark / Linear violet) + ticket id (mono, --text-md) + title --text-md font-600 + status badge (Open cyan / In Progress amber / Done emerald) + priority badge (P0 rose / P1 amber / P2 cyan / P3 muted) + source link icon
- META ROW: reporter avatar + assignee avatar + created date + last updated
- AI SUMMARY: "What this ticket is about" — 1-paragraph AI-generated summary in --bg-elevated, --radius-md, p-12px with Sparkles icon header
- ENTITY LINKS GRID (chips showing linked Forge entities):
  - "💡 Linked idea: IDEA-042 (Ideation Center)" → click navigates
  - "📜 Linked ADR: ADR-005 (Architecture)" → click navigates
  - "📋 Linked story: STORY-108 (Stories)" → click navigates
  - "🤖 Suggests agent: Code-Reviewer (Agents)" → click navigates
  - "📁 Affected files: 3 (auto-detected)" → click expands file list
  - "🔗 Related tickets: 2 (cluster)" → click expands cluster
- ACTION ROW: "Create spec from this ticket" primary + "Link to existing spec" outline + "Just dispatch to run" ghost

SAMPLE DATA (mock Jira payload):

ACME-123: Implement OAuth2 PKCE flow for mobile app Status: Open | Priority: P1 | Reporter: Marcus | Assignee: Arun Affected: auth-service, mobile-app Related: ACME-119 (PKCE spike), ACME-130 (refresh token rotation) AI Summary: Implement OAuth2 Authorization Code flow with PKCE for the mobile client. Includes refresh token rotation. Touches auth-service (backend) and mobile-app. Estimated 3-5 days based on similar past tickets.



==========================================================
QUICK WIN 3 — GSD PHASE PIPELINE VISUALIZATION
==========================================================

After ticket is fetched, BELOW the analysis card, render the GSD PHASE PIPELINE — the visual representation of the work:

PHASE PIPELINE (horizontal scroll on overflow, --bg-elevated, --radius-xl, p-24px, mt-4):
- Header: h3 "Suggested workflow" + Sparkles + "AI-recommended phases" + total estimate "3-5 days"
- Sub: "You can skip, reorder, or add custom phases"
- Pipeline: 7 phase cards in a horizontal connected line

PHASE CARDS (each):
- Connected to next via animated dashed cyan line (when in progress)
- 120px wide, --bg-surface, --radius-md, p-12px, border 1px (color per phase)
- Phase header: lucide icon + phase name --text-xs uppercase tracking-widest
- Phase body: duration estimate (e.g., "~30m" "~2h")
- Status badge:
  - Pending: muted dot + "Pending"
  - In Progress: cyan pulse + "Running"
  - Completed: emerald check + duration
  - Skipped: muted strikethrough
  - Optional: amber "Skip" link
- Hover phase: shows full description + what it produces
- Click phase: opens phase execution panel

PHASES (color-coded):
1. **Spike** (indigo, Search icon) — "Research the codebase, surface unknowns" — ~30m — maps to forge-spike
2. **Plan** (cyan, ClipboardList icon) — "Draft execution plan with sub-tasks" — ~15m — maps to forge-plan
3. **Execute** (violet, Code icon) — "Implement the change via AI agent" — ~2-4h — maps to forge-execute-phase
4. **Verify** (emerald, CheckCircle icon) — "Run tests, validate behavior" — ~15m — maps to forge-verify-phase
5. **Validate** (cyan, ShieldCheck icon) — "Manual + automated validation" — ~30m — maps to forge-validate-phase
6. **Audit** (amber, FileSearch icon) — "Code review, standards check" — ~15m — maps to forge-audit-fix
7. **Deploy** (emerald, Rocket icon) — "Deploy to production" — ~30m — maps to forge-deploy

USER CAN:
- Click "Run" on any phase → starts that phase
- Drag to reorder phases
- Toggle "Skip" to mark a phase skippable
- Click "+ Add phase" to insert custom phase (uses /forge-* skill picker)
- Click phase card to expand details (the spec drawer)

"START FULL WORKFLOW" button at the bottom: runs all phases sequentially, opening each as it completes

==========================================================
THE KILLER FEATURE — PHASE EXECUTION PANEL
==========================================================

When user clicks "Run" on any phase, a PHASE EXECUTION PANEL slides up from the bottom (full width, h-70vh, --bg-elevated, --shadow-2xl, --radius-t-xl):

PANEL STRUCTURE:
- HEADER (sticky top, --bg-elevated, border-b --border-subtle, p-16px flex between):
  - LEFT: phase icon (color) + phase name --text-md font-600 + ticket reference (mono) + status badge
  - CENTER: phase progress indicator (e.g., "Step 2 of 4" + horizontal progress bar)
  - RIGHT: "Minimize" + "Open in terminal" + "Close" icon buttons
- BODY (split view):
  - LEFT (60%): phase-specific workspace:
    - **Spike**: research question input + AI-generated research findings (markdown)
    - **Plan**: acceptance criteria input + AI-generated plan (markdown with sub-task checkboxes)
    - **Execute**: code editor with diff view + AI agent working (live streaming output)
    - **Verify**: test runner output + pass/fail visualization
    - **Validate**: validation checklist + evidence collection
    - **Audit**: code review findings + standards check results
    - **Deploy**: deployment status + health checks
  - RIGHT (40%): live activity feed:
    - Agent runs (if any): "Code-Reviewer is reviewing your code..."
    - File changes: "auth-service/oauth.py modified"
    - Connector calls: "GitHub: opened PR #1234"
    - AI reasoning: streaming explanations
- FOOTER (sticky bottom, --bg-elevated, border-t --border-subtle, p-16px flex between):
  - LEFT: "Estimated time remaining: ~12m"
  - CENTER: "Cancel" + "Pause" buttons (when running)
  - RIGHT: "Mark complete" outline + "Continue to next phase →" primary (when complete)

WHEN PHASE COMPLETES:
- Success animation: emerald pulse around the phase card in the pipeline
- Sound: subtle chime (if not muted)
- Toast: "Spike complete. Plan phase ready to start."
- Phase card updates: emerald check + actual duration
- Auto-advance option: "Continue to Plan phase automatically?" toggle (default off)

==========================================================
CROSS-MODULE ORCHESTRATION (the conductor pattern)
==========================================================

When phases run, they AUTOMATICALLY trigger the right Forge modules:

ORCHESTRATION MAP:
- **Spike phase**: triggers Ideation Agent → captures context → links to ADR if architecture question
- **Plan phase**: triggers Stories agent → breaks down into stories → estimates
- **Execute phase**: triggers Claude Code Terminal session (Step 32) with full context injected → produces code + PR
- **Verify phase**: triggers Test Runner agent → reports pass/fail
- **Validate phase**: triggers Acceptance Validator → checks against criteria
- **Audit phase**: triggers Code-Reviewer agent → checks standards
- **Deploy phase**: triggers Deploy workflow → updates Jira ticket status

EACH CROSS-MODULE TRIGGER shows in the phase panel:
- "🤖 Code-Reviewer agent invoked" (click → opens agent run)
- "📝 Linked to STORY-108" (click → navigates to Stories)
- "🔗 PR #1234 opened on GitHub" (click → opens external link)
- "✓ Jira ticket ACME-123 → In Progress" (auto-updated)

TICKET TWO-WAY SYNC:
- Status changes in Forge → update Jira (via connector)
- Comments posted in Forge → comment on Jira ticket
- Artifacts produced → attach to Jira ticket

==========================================================
SPEC MODE (lightweight version, since main spec UI is in Ideation)
==========================================================

Add a SIMPLE "Spec mode" tab/button in the ticket input bar that allows starting a spec WITHOUT a ticket:

CLICK "Start from spec instead" → opens inline spec creator:
- Title input
- Brief description (markdown)
- "Quick start" templates: "API endpoint" / "Bug fix" / "Refactor" / "New feature" / "Custom"
- "Generate plan" button → AI produces spec skeleton
- Save as draft / Save and start workflow

==========================================================
CATALOG POLISH (the third quick win)
==========================================================

Keep the existing Catalog view but make it secondary. Improvements:
- "Skill cards" for each forge-* skill (read from packages/forge-core/skills/):
  - Phase badge (Spike/Plan/Execute/etc.)
  - Description
  - "Run now" button → opens phase execution panel with that skill loaded
- "Add to spec" button → adds skill as a step in current spec
- "Trigger from ticket" button → starts workflow with this command
- Featured carousel: most-used this week

==========================================================
MY WORK DRAWER (right slide-in, 400px)
==========================================================

Trigger from "My work" button in header (lucide Briefcase + active count badge):

DRAWER SECTIONS:
- **Active tickets** (N) — tickets currently in a phase, with progress bar
- **Active specs** (N) — specs in execution
- **Active runs** (N) — agent runs with live progress
- **Pending approvals** (N) — your queue
- **Today's focus** — AI-suggested priority: "Start work on ACME-123 (P1, deadline tomorrow)"

Each item: clickable, "Resume" button on in-progress, "Mark complete" on done

==========================================================
FLOATING GSD PHASE WIDGET (bottom-left, persistent)
==========================================================

Small circular widget (56×56) visible across all pages:
- Shows current phase icon in semantic color
- Tooltip: "Currently executing: Plan phase for ACME-123"
- Click → expands mini-panel with all active phases
- Disappears when no active work

==========================================================
KEYBOARD SHORTCUTS (must-have)
==========================================================

- ⌘T: New ticket
- ⌘⇧S: New spec
- ⌘R: Run current phase
- ⌘⇧N: Next phase
- ⌘⇧P: Previous phase
- ⌘/: Show all shortcuts
- Esc: Close any open panel

==========================================================
CONSTRAINTS
==========================================================

- Build order: Ticket shell → Ticket fetch → Phase pipeline → Phase execution panel → Cross-module orchestration → Spec mode → Catalog polish → My Work → Floating widget
- Each quick win is independently shippable
- All phase executions MUST be mockable for now (don't require real agent/orchestrator)
- Sample data: 5 Jira tickets, 3 GitHub issues, 2 Linear tickets in different states
- forge-core package skills should be discoverable but mock-running is fine
- Dark mode only
- Lucide icons only
- All animations respect prefers-reduced-motion
- Real-time updates can be SSE/WebSocket (mock with setInterval for now)

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/command-center/
- The Ticket Mode hero (Quick Win 1)
- Ticket analysis card with entity links (Quick Win 2)
- GSD phase pipeline visualization (Quick Win 3)
- Phase execution panel that slides up
- Cross-module orchestration working (mock triggers to other centers)
- My Work drawer
- Floating GSD widget (persistent across pages)
- 3 sample tickets pre-loaded
- Mock phase execution with realistic timing (Spike 8s, Plan 5s, Execute 15s, Verify 4s, Validate 3s, Audit 6s, Deploy 8s)
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep forge-core package, keep existing command catalog accessible, keep the existing Catalog view reachable (now secondary)

==========================================================
HOW THIS STEP FITS WITH PREVIOUS STEPS
==========================================================

This step ASSUMES you've completed:
- Step 7 (Command Catalog baseline) ✅ done
- Step 19/24 (Co-pilot) — for "Get help" context
- Step 28 (Ideation) — for linked ideas
- Step 30 (Architecture) — for linked ADRs
- Step 31 (Connectors) — for Jira/GitHub ticket fetching
- Step 32 (Terminal) — for Execute phase triggering Claude Code
- Step 22 (Workflows) — for Deploy phase workflows

If any of these aren't done, this step will surface gaps. Build those first, then this step turns the gaps into a coherent conductor pattern.

This is the moment the whole product becomes ONE THING instead of 12 siloed pages.