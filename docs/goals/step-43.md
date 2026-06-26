/goal

Make the Agent Center self-explanatory — users currently don't understand what agents, providers, runtimes, and assignments are or why they need them. Add 6 clarity-focused additions to help users understand and get started. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "onboarding wizard step indicator progressive disclosure guided setup" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "mental model diagram conceptual explanation visual representation" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "empty state contextual value proposition first run guidance" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "feature tour progressive disclosure tooltip onboarding" --domain ux-guideline -f markdown

Adopt every rule. Then implement the 6 additions:

==========================================================
ADDITION 1 — "WHAT IS THIS?" EXPLAINER HERO
==========================================================

Replace the current hero band (just the title + body) with a richer, more educational hero:

LAYOUT (animated gradient border, --bg-base with subtle aurora):

TOP (above the existing h1):
- Eyebrow: "AGENT CENTER" --text-xs --fg-tertiary uppercase tracking-widest
- h1: "Agent Center" --text-3xl font-700 (keep as is)

NEW SECTION: "What is this?" explainer box:
- bg --bg-elevated, --radius-xl, p-24px, mt-4
- Top: lucide Sparkles icon in --accent-cyan + "WHAT IS THIS?" --text-xs uppercase tracking-widest
- Body: "Agents are AI workers that execute forge-* commands. Each agent is powered by a model, runs in a runtime, and is assigned to projects. Together they form your AI workforce — your team of AI collaborators that automate the SDLC."
- Below: 4 small inline chips: "63 forge-* commands" · "13 categories" · "Multi-tenant" · "Audit-everything"
- RIGHT: primary CTA "Guided setup →" (Sparkles icon) + secondary "Skip to catalog" outline

KEEP the existing body "Manage the AI agents, model providers, and task assignments available to this tenant." as a sub-element below the explainer.

==========================================================
ADDITION 2 — VISUAL MENTAL MODEL DIAGRAM
==========================================================

Add a "How it works" section BELOW the explainer hero, BEFORE the tabs:

LAYOUT (--bg-elevated, --radius-xl, p-32px, mt-4):

HEADER: h3 "How it works" --text-md font-600 + sub "The 4 pieces that make your AI workforce work"

DIAGRAM (horizontal flow, 4 boxes connected with arrows):

┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌──────────────┐ │ AGENTS │ ──▶ │ MODEL │ ──▶ │ RUNTIMES │ ──▶ │ ASSIGNMENTS │ │ (workers) │ │ PROVIDERS │ │ (workspaces)│ │ (org chart) │ │ │ │ (brains) │ │ │ │ │ │ Claude Code │ │ Anthropic │ │ Local Docker│ │ Project: X │ │ Codex │ │ OpenAI │ │ K8s cluster │ │ Sprint: 12 │ │ Aider │ │ Bedrock │ │ │ │ │ └─────────────┘ └──────────────┘ └─────────────┘ └──────────────┘


Each box:
- bg --bg-surface, --radius-md, p-16px, border --border-subtle
- Header: lucide icon (Bot/Agents cyan, Cpu/Provider violet, Server/Runtime amber, Link/Assignments emerald) + box name --text-sm font-600
- Body: 2-line description --text-xs --fg-tertiary
- Example chips (mini)

Arrows between boxes:
- Animated dashed cyan line (marching ants animation, 2s loop)
- Arrow icon (lucide ChevronRight or ArrowRight) at the end
- The "powered by", "running in", "assigned to" labels above the arrows

HOVER on any box: scales 1.05, shows a tooltip with examples (e.g., "Claude Code: AI pair programmer that executes forge-dev-* commands")

==========================================================
ADDITION 3 — ONBOARDING WIZARD (4 steps)
==========================================================

Add a "Guided setup" primary button in the hero (Addition 1). Click → opens a multi-step wizard Dialog.

WIZARD DIALOG (--bg-elevated, max-width 720px, h-80vh):
- HEADER: progress indicator (4 steps, current highlighted), "Set up your first agent" h2 --text-lg font-700, "Estimated time: 2 minutes" --text-xs --fg-tertiary
- BODY (changes per step):
- FOOTER: "Back" + "Skip" + "Next →" / "Finish" buttons

STEP 1: CONNECT MODEL PROVIDER
- Title: "Connect a model provider"
- Body: "Agents need a model to think with. Connect at least one provider to power your agents."
- List of provider cards (2-col grid): Anthropic, OpenAI, AWS Bedrock, Google Vertex, Azure OpenAI, Custom endpoint
- Each: lucide icon + name + "Connect" button
- Already-connected providers: show green check + "Connected as: arun@acme.com"
- "Connect" opens a sub-form: API key input (masked), name, test connection button
- "Next" enabled when ≥1 provider connected

STEP 2: REGISTER AGENT
- Title: "Register your first agent"
- Body: "Agents are AI workers. Pick from a template or build your own."
- Two columns:
  - LEFT: Templates (Claude Code, Codex, Aider, Kiro, Custom) — each with description + "Use template" button
  - RIGHT: "Build custom" form (name, type dropdown, version, description)
- "Use template" pre-fills the form on the right
- "Next" enabled when form valid

STEP 3: CONFIGURE RUNTIME
- Title: "Configure a runtime"
- Body: "Runtimes are where your agents actually execute. Local Docker is the default for dev."
- Form: Runtime name, Type (Local Docker / K8s / Custom), Resource limits (CPU, memory), Auto-cleanup toggle
- Show preview: "Your agent will run in an isolated Docker container with 2 CPU / 4GB RAM"
- "Next" enabled when form valid

STEP 4: ASSIGN TO PROJECT
- Title: "Assign to a project"
- Body: "Pick which project this agent should work on. You can assign to more later."
- Project dropdown (Combobox, searchable)
- Role selector (Default / Custom)
- "Finish" primary button

AFTER WIZARD COMPLETES:
- Success toast: "🎉 Your first agent is set up and ready to work"
- Animation: emerald pulse around the new agent in the Agents list
- Auto-navigate to Agents tab (or stay on overview)
- "Add another" or "Done" buttons

==========================================================
ADDITION 4 — PER-TAB "WHY THIS MATTERS" COPY
==========================================================

Update each tab's empty state with contextual, value-focused copy:

AGENTS TAB EMPTY:
- Title: "No agents registered yet"
- Description: "Agents are AI workers that execute forge-* commands — code review, refactor, deploy, and more. Without one, your workflows can't run. Register your first agent to get started."
- Primary: "Register Agent" (with Sparkles icon)
- Secondary: "Browse agent templates" → opens marketplace/library

MODEL PROVIDERS TAB EMPTY:
- Title: "No model providers connected"
- Description: "Model providers are the LLM backends (Anthropic, OpenAI, Bedrock) that power your agents. Connect at least one to enable agent execution."
- Primary: "Connect Provider" (with Plug icon)
- Secondary: "See all supported providers"

RUNTIMES TAB EMPTY:
- Title: "No runtimes registered"
- Description: "Runtimes are execution environments — local Docker for development, Kubernetes for production. This is where your agents actually do the work. Configure your first runtime to enable agent execution."
- Primary: "Register Runtime" (with Server icon)
- Secondary: "How runtimes work" (docs link)

ASSIGNMENTS TAB EMPTY:
- Title: "No assignments yet"
- Description: "Assignments map agents to projects. Without one, your agent has no work to do. Assign your agent to a project to start orchestrating tasks."
- Primary: "New Assignment" (with Link icon)
- Secondary: "How assignments work"

ALSO add a "Learn more" link in each empty state linking to the relevant docs page.

==========================================================
ADDITION 5 — "GUIDED SETUP" CTA (sticky/prominent)
==========================================================

The "Guided setup →" primary button from Addition 1 is the entry point. Make it prominent:

- In the hero: big primary button (h-44px, --text-md font-500, --accent-primary bg, glow shadow)
- ALSO add a floating "First-time?" tooltip that appears after 3s on first visit:
  - "👋 New to agents? Take the 2-minute tour" — clickable, dismissible
  - Tooltip position: bottom-right of the hero, points to the Guided setup button
  - Auto-dismiss after 10s or on click
  - Persists "dismissed" state in localStorage (don't show again)

After any tab is filled with at least 1 item, replace the "Guided setup" button with a "Add another" button (smaller).

==========================================================
ADDITION 6 — EXAMPLE USE CASES (bottom of page)
==========================================================

Add a "Common patterns" section at the BOTTOM of the Agent Center (after all tabs):

LAYOUT (mt-12, --bg-base):
- Header: h3 "Common agent patterns" --text-md font-600 + sub "Real-world setups teams use"
- Grid (3 cols, gap-4):
  1. **Code reviewer**: Agent=Claude Code, Provider=Anthropic Claude Sonnet, Runtime=local Docker
     "Reviews PRs automatically, flags issues, suggests fixes. Saves ~3h/week per dev."
  2. **Refactor agent**: Agent=Codex, Provider=OpenAI GPT-4o, Runtime=K8s
     "Tackles large refactors across the codebase. Auto-generates PRs with tests."
  3. **Sync agent**: Agent=Custom (HTTP), Provider=Anthropic, Runtime=local Docker
     "Syncs data between Jira, GitHub, Slack, and Forge. Keeps everyone in the loop."
  4. **Test runner**: Agent=Claude Code, Provider=Anthropic, Runtime=local Docker
     "Writes tests, runs them, reports coverage. Increases test coverage by 20% in a sprint."
  5. **Doc generator**: Agent=Aider, Provider=Anthropic, Runtime=local Docker
     "Auto-generates docs from code. Keeps README and API docs in sync."
  6. **Security auditor**: Agent=Custom, Provider=Anthropic, Runtime=isolated K8s
     "Scans for security issues, suggests fixes. Runs nightly on the main branch."

Each card:
- bg --bg-elevated, --radius-lg, p-20px, hover lift
- Top: lucide icon (color per category) + pattern name --text-md font-600
- Body: "Agent: X · Provider: Y · Runtime: Z" --text-xs --fg-tertiary
- Description: 1-paragraph benefit
- "Use this pattern →" button → opens wizard pre-filled with this config

==========================================================
CONSTRAINTS
==========================================================

- Don't break existing functionality (Register Agent dialog, tabs, KPIs, activity heatmap)
- Keep all existing empty states as fallback when not on the "first run" state
- Show the explainer + diagram + setup CTA only when:
  - 0 agents registered AND 0 providers connected AND 0 runtimes AND 0 assignments
  - Otherwise: collapse the explainer/diagram/setup, show a smaller "Your AI workforce" summary card
- Wizard state persists in localStorage (resume if user closes mid-wizard)
- The "Common patterns" section always visible (helps inspiration)
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only (no emojis — but the wave "👋" can be lucide Hand icon)

==========================================================
DELIVERABLE
==========================================================

- files modified
- Before/after sketch of the new Agent Center hero + diagram
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep the 4 tabs, keep the Register Agent dialog, keep the activity heatmap, keep the existing KPIs, keep the "2 Issues" notification badge
- Time estimate: this should take ~4-6 hours (mostly wizard + diagram)