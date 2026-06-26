/goal

STEP 3 OF 6 — EMPTY STATES. Shell from Step 2 is done. Fix every dead-end empty state. This is the highest-leverage visual win — the user is staring at empty screens.

SCOPE: every "No X match the current filters" / blank-canvas state across Agent Center, Ideation Center, Projects, Stories, Workflows, Knowledge, Artifacts, Architecture, Runs, Audit, Analytics. Replace each with the EmptyState component.

INVOKE THE SKILL FIRST — empty states are a well-studied UX area, don't reinvent:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "empty state best practices onboarding first run" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "empty state illustration dark mode" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "empty state zero state microcopy" --domain ux-guideline -f markdown

Adopt every rule from the skill outputs. Then:

CREATE src/components/empty-state.tsx:
- Props: illustration (ReactNode), title, description, primaryAction, secondaryAction?, suggestions? (string[])
- Centered, max-width 480px, py-24
- Illustration: 96×96 area, lucide icon in 80×80 rounded --radius-xl square, bg rgba(99,102,241,0.08), icon --accent-primary 40px, opacity 0.7→1 pulse 2.4s
- Title --text-lg font-600 --fg-primary; description --text-sm --fg-secondary mt-2 (max 2 lines)
- Actions mt-6, primary = shadcn Button default --accent-primary, secondary = ghost
- Suggestions (optional) mt-6 flex gap-2 clickable chips --bg-elevated --radius-md --text-xs --fg-secondary, hover bg rgba(255,255,255,0.06)

PAGE-BY-PAGE COPY (title / description / primary / secondary / suggestions):

Agent Center → "Register your first agent" / "Agents are AI workers you can assign runs to. Register one to get started." / "Register Agent" / "Browse templates" / ["Code reviewer","Research analyst","Customer support"]

Model Providers → "Connect a model provider" / "Plug in OpenAI, Anthropic, or any OpenAI-compatible endpoint." / "Connect Provider" / "Read docs"

Assignments → "No assignments yet" / "Assign agents to projects to start orchestrating work." / "Create Assignment"

Runtimes → "No runtimes registered" / "Runtimes are sandboxes where agents execute." / "Register Runtime"

Ideation — Ideas → "Capture your first idea" / "Drop in a rough thought — AI will score it and draft a PRD." / "New Idea" / "See example" / ["AI code reviewer","Slack summarizer","Invoice parser"]

Ideation — Roadmap → "No ideas in the roadmap" / "Approve ideas to move them onto the roadmap." / "Review pending ideas"

Ideation — PRDs → "No PRDs yet" / "PRDs are auto-generated from approved ideas." / "Generate first PRD"

Ideation — Architecture Previews → "No previews" / "Spin up an architecture preview to validate before coding." / "Generate preview"

Ideation — My Approvals → "Inbox zero" / "You're all caught up. New approvals will appear here." / (no primary action)

Projects / Stories / Workflows / Knowledge / Artifacts / Architecture / Runs / Audit / Analytics → same pattern, no "No data" generic copy anywhere.

ALSO: every filtered list with zero results (after filters) shows a compact EmptyState variant — py-12, illustration 64×64, no suggestions, primary "Clear filters" if filters are active.

CONSTRAINTS: shadcn Button only, lucide only, Step 1 tokens, role="status" aria-live="polite" wrapper.

Deliverable: empty-state.tsx path, every modified page file with title+primary, and a 1-line note per page on which skill rule shaped the copy.