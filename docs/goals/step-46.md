/goal

Modernize the Project Onboarding wizard in Forge AI Agent OS. Currently has 6 generic steps — needs to become a 10-step AI-powered setup that uses forge-core, forge-pi, and forge-browser to auto-configure the workspace. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "onboarding wizard multi-step progress indicator skippable" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "AI-powered setup auto-detect configuration intelligent onboarding" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "welcome tour guided product walkthrough feature highlights" --domain ux-guideline -f markdown

Adopt every rule. Then build:

==========================================================
ZONE 1 — HEADER + GLOBAL WIZARD SHELL
==========================================================

KEEP current shell but enhance:

- Hero: animated gradient border (compact, not as big as dashboard)
- Eyebrow: "PROJECT ONBOARDING" --text-xs --fg-tertiary
- h1: "Welcome to Forge" + Compass icon (or Rocket icon)
- Body: "Let's set up your AI workforce. We'll guide you through connecting your stack, registering agents, and launching your first project. Takes ~5 minutes."
- "Skip setup" ghost link (top-right) — for power users
- "Use sample data" ghost link (top-right) — for evaluation mode

PROGRESS INDICATOR (enhanced, replaces current):
- Vertical stepper on the LEFT side (instead of horizontal) — more space-efficient
- Each step: number + title + status (Pending / Active ✓ / Done)
- Active step: highlighted with --accent-primary, glow
- Done steps: emerald check
- Skippable steps show "Skip" link
- Click any completed step to jump back

MAIN CONTENT (center, larger now):
- Max-width 720px (was ~600px)
- More vertical breathing room

RIGHT PANEL — "What is happening" (enhanced, replaces static text):
- Live AI reasoning during each step
- During Step 3 (detect stack): "Analyzing your repo... found 247 TypeScript files, 18 services, 3 databases"
- During Step 5 (first intel): "Mapping your knowledge graph... 47 entities detected"
- Shows what forge-pi is doing in real time
- Animated: text appears word-by-word

==========================================================
ZONE 2 — STEP 1: WELCOME (NEW)
==========================================================

Landing page of the wizard — set the tone.

LAYOUT (--bg-elevated, --radius-xl, p-48px, text-center):
- Large icon: 80×80 --bg-elevated square with lucide Rocket 40px in --accent-cyan, animate-bounce (subtle)
- h2: "Welcome to Forge" --text-2xl font-700
- Body: "Forge is your AI workforce for the SDLC. In the next 5 minutes, we'll set up everything you need to start automating your development workflow."
- 3 cards (horizontal, --bg-base, --radius-lg, p-20px):
  1. lucide Bot "AI Workforce" — "Register agents like Claude Code, Codex, Aider"
  2. lucide Network "Knowledge Graph" — "Auto-build from your codebase, tickets, docs"
  3. lucide ShieldCheck "Governance" — "Configure policies, guardrails, audit"
- PRIMARY CTA: "Get started →" (large, h-48px, --text-md font-500)
- SECONDARY: "Take a quick tour first" (opens 60s product video or interactive walkthrough)
- TERTIARY: "Use sample data" (loads a demo project so they can explore)

==========================================================
ZONE 3 — STEP 2: TENANT SETUP (enhanced)
==========================================================

KEEP current fields + ADD:

- Tenant logo upload (drag-drop, --bg-base, --radius-md)
- Tenant URL slug preview: "forge.example.com/forge-platform" (auto-generated from name)
- Theme selection: Dark (default) — preview thumbnail
- Default agent settings: "Default model: Claude Sonnet 4.5" + change link
- "Skip for now" option

==========================================================
ZONE 4 — STEP 3: CONNECT PROVIDERS (NEW — AI Provider Setup)
==========================================================

BEFORE you can use agents, you need to connect an LLM provider. Use Step 35's LiteLLM config.

LAYOUT (--bg-elevated, p-32px):
- h3: "Connect an AI provider" --text-md font-600
- Body: "Agents need a model to think with. Connect at least one provider to enable AI execution."

- Provider cards (3-col grid): Anthropic, OpenAI, AWS Bedrock, Google Vertex, Azure OpenAI, Custom endpoint
- Each card: lucide icon + name + "Connect" button
- "Connected" state: green check + "Connected as: arun@acme.com" + "Manage" link
- "Connect Anthropic" opens a sub-form:
  - API key input (masked, with eye icon to reveal)
  - Test connection button (calls /api/v1/providers/test)
  - On success: emerald check + "Connected successfully"
- "Add another provider" link
- "Skip — use mock data" option (for offline exploration)

==========================================================
ZONE 5 — STEP 4: CONNECT REPOS (enhanced)
==========================================================

KEEP current + ENHANCE:

- Multi-provider: GitHub, GitLab, Bitbucket, custom Git URL
- OAuth flow: "Sign in with GitHub" button (instead of pasting URL)
- Org selector: pick which GitHub org to import from
- Repo multi-select: checkboxes (not just one at a time)
- "Auto-detect all repos in org" toggle
- "Include private repos" toggle
- "Branch to scan" selector: main / develop / all
- After connecting: shows progress bar (shallow clone running)
- When done: shows "✓ Cloned 3 repos · 247 files · 18 services detected"

==========================================================
ZONE 6 — STEP 5: DETECT STACK (AI-powered, NEW)
==========================================================

USE forge-pi (Step 45) to auto-detect the stack.

LAYOUT (--bg-elevated, p-32px):
- h3: "Detecting your stack" --text-md font-600
- Body: "Forge is analyzing your codebase to understand your architecture. This usually takes 30-60 seconds."

- LIVE SCANNING UI (when forge-pi is running):
  - Animated progress: 5 stages with checkmarks
    - "Reading files..." (15s)
    - "Detecting languages..." (8s)
    - "Mapping services..." (12s)
    - "Identifying patterns..." (10s)
    - "Building knowledge graph..." (15s)
  - Each stage: lucide icon + name + spinner/check + "X files / Y services / Z patterns"
  - Real-time log stream below: "[10:23:45] Found 18 TypeScript services..." "[10:23:52] Detected PostgreSQL 17..." etc.
  - Sample discovered services appear as cards one by one:
    - "auth-service" (TypeScript, Express)
    - "payment-service" (TypeScript, FastAPI)
    - "user-service" (Python, FastAPI)
    - etc.

- DISCOVERED STACK SUMMARY (after scan):
  - "Your stack:"
    - Languages: TypeScript (60%), Python (35%), Shell (5%)
    - Frameworks: React, Next.js, Express, FastAPI
    - Databases: PostgreSQL 17 (with pgvector + AGE), Redis
    - Infrastructure: Docker, Kubernetes
  - "Discovered 18 services · 247 components · 89 dependencies"
  - "✓ Knowledge graph built"

- Optional: "Customize detection" — let user exclude/include certain paths

==========================================================
ZONE 7 — STEP 6: REGISTER AGENTS (enhanced)
==========================================================

KEEP current + ENHANCE with templates:

LAYOUT:
- h3: "Register your AI agents"
- Body: "Pick from recommended agents or build your own. You can always add more later."

- 2-COLUMN LAYOUT:
  - LEFT: "Recommended templates"
    - 6 agent cards: Code Reviewer, Refactor Agent, Test Runner, Doc Generator, Security Auditor, Sync Agent
    - Each: lucide icon + name + description + "Add" button
    - Click "Add" → adds to right column
  - RIGHT: "Your agents (N)"
    - List of selected agents
    - Each with: edit inline (name), pick provider, pick model, advanced settings
    - "Add custom" button
    - Drag to reorder (execution priority)
- "Recommended" section: pre-checked: Code Reviewer + Test Runner (most teams need these)

==========================================================
ZONE 8 — STEP 7: CONFIGURE RUNTIMES (NEW)
==========================================================

BEFORE agents can execute, configure where they run.

LAYOUT:
- h3: "Configure execution environments"
- Body: "Runtimes are where your agents actually do work. Local Docker for dev, Kubernetes for prod."

- 2-COLUMN LAYOUT:
  - LEFT: "Default runtime (Local Docker)"
    - Form: Name, Resource limits (CPU, RAM), Auto-cleanup toggle
    - "Test connection" button
    - Preview: "Agents will run in an isolated Docker container with 2 CPU / 4GB RAM"
  - RIGHT: "Optional: Production runtime"
    - "Connect Kubernetes cluster" or "Connect cloud sandbox"
    - "Skip for now" (use only local)
    - "How runtimes work" docs link

==========================================================
ZONE 9 — STEP 8: INSTALL CONNECTORS (NEW)
==========================================================

Set up external integrations now so they're ready when you start using Forge.

LAYOUT:
- h3: "Connect your tools"
- Body: "Connect Jira, GitHub, Slack, and more. Forge will sync data automatically."

- 4-COLUMN GRID of connector cards:
  - Jira (cyan) — "Connect"
  - GitHub (cyan) — "Connect"
  - Slack (cyan) — "Connect"
  - Linear (cyan) — "Connect"
  - Zendesk (cyan) — "Connect"
  - Notion (cyan) — "Connect"
  - 12+ more (expandable)
- Each: lucide icon + name + "Connect" button (or "Connected" state)
- "Skip — install later" (you can do this from the Connectors center anytime)

==========================================================
ZONE 10 — STEP 9: RUN FIRST INTEL (AI-powered, NEW)
==========================================================

USE forge-pi to run the first intelligence pass — this is the wow.

LAYOUT:
- h3: "Running first intelligence pass"
- Body: "Forge is scanning your codebase, customer feedback, and market signals to seed your dashboard with actionable insights. Usually takes 2-3 minutes."

- LIVE PROGRESS (animated, multi-stage):
  - "📊 Scanning codebase..." (30s) — discovers services, dependencies, tech debt
  - "🎫 Pulling customer feedback from Zendesk..." (20s) — clusters 247 tickets
  - "📡 Checking market signals..." (15s) — pulls 5 competitor news items
  - "🧠 Building knowledge graph..." (45s) — links 47 entities
  - "💡 Generating initial ideas..." (30s) — 3 ideas from top themes
  - "📋 Drafting initial roadmap..." (20s) — 5 features for next sprint

- LIVE LOG STREAM (right side): shows what's happening in real time
- After completion: shows "✓ Intel complete" with summary of what was found

- INSIGHTS DISPLAYED (after completion):
  - 3 cards showing what was discovered:
    - "🎯 Top customer pain: 'Checkout slowness' (47 tickets, ↑32%)"
    - "⚠️ Tech debt hotspot: payment-service.ts (482 lines, 3 nested loops)"
    - "💡 New idea generated: 'Add PKCE to mobile auth' (link to idea)"
  - "Continue →" button to review screen

==========================================================
ZONE 11 — STEP 10: REVIEW & CONFIRM
==========================================================

Final review before activating the workspace.

LAYOUT:
- h3: "Ready to launch"
- Body: "Here's what we set up. Review and confirm to activate your workspace."

- SUMMARY CARDS (3-col grid):
  - "Tenant: acme-corp · us-east-1"
  - "Connected: 1 provider · 3 repos · 3 connectors"
  - "Registered: 2 agents · 1 runtime"

- "WHAT YOU CAN DO NOW" preview cards:
  - "Run a forge-* command" → opens Command Center
  - "Browse your dashboard" → shows real metrics
  - "View your knowledge graph" → shows seeded graph
  - "Chat with Co-pilot" → opens Co-pilot

- "Activate workspace" PRIMARY button (big, --accent-primary bg, glow)
- "Back" ghost button

AFTER ACTIVATION:
- Success animation: emerald pulse around the page
- Toast: "🎉 Your AI workforce is ready"
- Auto-navigate to Dashboard (Step 18 v2) which is now seeded with real data

==========================================================
ZONE 12 — POST-ONBOARDING: WELCOME TOUR
==========================================================

After activating, show a guided tour overlay (first-time only):

7-step tour (each step: highlighted element + tooltip card):
1. "This is your Dashboard — your mission control. See live activity, costs, and your team at a glance."
2. "Use the Command Center to run any forge-* command or start a ticket-driven workflow."
3. "Your Co-pilot is here — it follows you across every page. Press ⌘J to summon."
4. "Knowledge Graph shows how your artifacts connect. Click any node to explore."
5. "The Ideation Center captures ideas and auto-generates PRDs from customer feedback."
6. "Governance Center configures policies, guardrails, and LiteLLM control."
7. "Your terminal is here — Claude Code, Codex, Aider, all configured with your project context."

- "Skip tour" + "Take tour" buttons
- "Don't show again" checkbox
- Persists "toured" state in localStorage
- Powered by react-joyride or driver.js

==========================================================
ZONE 13 — EMPTY/ERROR/LOADING
==========================================================

- LOADING: shimmer skeleton matching wizard layout
- ERROR: "Setup failed at step X. [Retry] [Skip step] [Get help]"
- CONNECTION ERRORS: "Cannot connect to orchestrator. Run pnpm dev:stack to start."

==========================================================
CONSTRAINTS
==========================================================

- Don't break existing steps (Tenant setup, Connect repos) — enhance them
- Each step is skippable (advanced users can skip)
- State persists in localStorage (resume if user closes mid-wizard)
- All forge-* skills invokable from the wizard
- Use forge-pi for AI-powered steps (stack detection, first intel)
- Use forge-browser for any visual verification (optional)
- Sample data mode: load pre-seeded demo data so users can explore
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/onboarding/
- 10 steps wired (Welcome, Tenant, Providers, Repos, Detect, Agents, Runtimes, Connectors, First Intel, Review)
- forge-pi integration for AI-powered stack detection + first intel
- Welcome tour overlay (post-onboarding)
- Sample data mode
- Step persistence in localStorage
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep the URL pattern /project-onboarding?step=N, keep the existing step content (just enhanced), keep the "What is happening" panel concept