> **Status:** completed
My take: 3-package spec-driven stack
Package	What it does	What it powers in Forge
forge-core (already done)	Methodology + skills + agents + commands	Every workflow, the 7 GSD phases, ticket → execute → deploy
forge-pi (new fork)	Product intelligence — codebase scanning, knowledge graph building, idea scoring, PRD generation	Ideation Center, Customer Voice, Market Signals, Project Intelligence
forge-browser (new fork)	AI browser automation — visual testing, UI review, screenshot analysis, accessibility audits	Verify phase, UI review, deployment verification, QA audit
The full pipeline becomes:


Ticket (Jira) → forge-pi (score, cluster, draft PRD) 

              → forge-core (forge-capture → forge-explore → forge-execute-phase) 

              → forge-browser (visual verify, UI review) 

              → deploy
forge-pi deep dive (powers the Ideation + Intelligence layer)
What it brings to Forge:

Codebase scanner — automatically maps services, dependencies, secrets
Knowledge graph builder — fuses code + tickets + docs into one graph
Idea scorer — RAG + LLM reasoning, chain-of-thought (the "Why this score?" from Step 28)
Customer voice clustering — auto-groups Zendesk/Jira tickets by theme
Market signal processor — surfaces competitor moves, industry trends
PRD generator — from idea/ticket to typed artifact
Where it lives in the app:

Ideation Center (Source ingestion, Customer Voice, Market Signals)
Project Intelligence (knowledge graph, artifact tree)
Co-pilot context (auto-inject codebase understanding)
Command Center (ticket mode → IDE workspace + project context)
forge-browser deep dive (powers the Visual Verify layer)
What it brings to Forge:

AI browser agent — opens URLs, navigates, takes actions
Visual testing — screenshot comparison, regression detection
UI review — design quality checks, accessibility audits (WCAG), responsive checks
Deployment verification — post-deploy smoke tests
Customer journey testing — automated end-to-end flow validation
Where it lives in the app:

forge-eval-review skill (UI review portion)
forge-audit-uat skill (visual UAT)
Verify phase in ticket workflow
Deployment verification (post-deploy auto-check)
Architecture Center (visual review of generated diagrams)
How to integrate (the 3-phase rollout)
Phase 1: Install + wire (this step)

Create packages/forge-pi/ (fork + rename)
Create packages/forge-browser/ (fork + rename)
Install in forge-ai root + apps/forge/
Wire them into the existing forge-core skill registry
Update Command Center skill picker to show all forge-* skills across all 3 packages
Phase 2: Deep integrations

Ideation Center: use forge-pi for idea scoring, customer voice clustering, market signals
Project Intelligence: use forge-pi for codebase scanning + knowledge graph
Verify phase: use forge-browser for visual testing
Phase 3: New features powered by them

AI Product Manager (forge-pi) — auto-generates roadmaps from customer feedback
Visual QA agent (forge-browser) — reviews every PR's UI changes before merge
Deployment canary watcher (forge-browser) — visual diffs before/after deploys
Step 45 — Wire forge-pi + forge-browser
text

/goal


Fork and integrate `forge-pi` and `forge-browser` packages into Forge AI Agent OS. The `forge-core` package is already integrated — now complete the spec-driven stack with product intelligence and browser automation. Read .claude/design-system/ first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "monorepo package workspace integration dependency structure" --domain style -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "AI browser automation visual testing screenshot review" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "product intelligence knowledge graph codebase scanning" --domain ux-guideline -f markdown


Adopt every rule. Then implement:


==========================================================

ZONE 1 — FORK + INSTALL forge-pi

==========================================================


1. Clone https://github.com/open-gsd/gsd-pi (or whatever the actual repo URL is)

2. Rename to packages/forge-pi

3. Find/replace in all files:

   - "gsd-pi" → "forge-pi"

   - "gsd_pi" → "forge_pi"  

   - "GSD-PI" → "FORGE-PI"

   - "GSD Pi" / "GSD-PI" → "Forge Product Intelligence"

4. Update package.json: name, description, repository, homepage

5. Update README.md with Forge branding

6. Verify all CLI commands still work: forge-pi --version, etc.

7. Build the package: pnpm build in packages/forge-pi/

8. Add to root package.json workspaces

9. Install in apps/forge/: pnpm add @forge-ai/forge-pi@workspace:*


==========================================================

ZONE 2 — FORK + INSTALL forge-browser

==========================================================


Same as Zone 1 but for forge-browser:

1. Clone the open-gsd browser package

2. Rename to packages/forge-browser

3. Find/replace all references

4. Update package.json

5. Build + add to workspaces

6. Install in apps/forge/


==========================================================

ZONE 3 — WIRE INTO FORGE-CORE SKILL REGISTRY

==========================================================


The existing Command Center (Step 34) reads skills from packages/forge-core/skills/. Now also read from:

- packages/forge-pi/skills/ (if any)

- packages/forge-browser/skills/ (if any)


Update src/lib/forge-skills/manifest-reader.ts to scan all 3 packages.


Display in Command Center as categorized:

- "Core workflow" (forge-core)

- "Product intelligence" (forge-pi)

- "Browser automation" (forge-browser)

- "Agent definitions" (forge-core/agents)

- "Custom commands" (forge-core/commands)


==========================================================

ZONE 4 — DEEP INTEGRATIONS (where each package shines)

==========================================================


A. IDEATION CENTER (Step 28) + forge-pi:

- "Daily ingest" cron now uses forge-pi to:

  - Pull from Zendesk/Jira Service Desk

  - Cluster tickets by theme

  - Score each cluster

  - Generate ideas from top themes

- Customer Voice tab uses forge-pi to:

  - Cluster customer feedback

  - Surface top pain points

  - Link to codebase

- Market Signals tab uses forge-pi to:

  - Pull from configured sources

  - Extract signals

  - Match to current projects


B. PROJECT INTELLIGENCE (Step 38) + forge-pi:

- "Artifact tree" powered by forge-pi's codebase scanner

- Knowledge graph (Step 27) seeded by forge-pi

- "Project at a glance" uses forge-pi metrics


C. VERIFY PHASE + forge-browser:

- forge-eval-review skill can invoke forge-browser for visual checks

- "Visual regression test" button on PRs (in ticket workflow)

- Post-deploy smoke test runs via forge-browser

- "Open browser preview" button in story detail when implementing UI


D. forge-audit-uat + forge-browser:

- UAT (User Acceptance Testing) becomes visual — forge-browser opens the app, navigates flows, captures screenshots, verifies

- AI agent reviews screenshots for visual regressions

- Accessibility audit (WCAG) automated


E. ARCHITECTURE CENTER + forge-pi:

- "Diagrams" tab (Step 30) auto-generates system diagrams from forge-pi codebase scan

- API contracts auto-discovered from forge-pi code analysis


F. CO-PILOT CONTEXT + forge-pi:

- Co-pilot now has full codebase understanding via forge-pi

- When you @mention an entity, it auto-resolves to the right code


G. COMMAND CENTER + forge-pi:

- "Run pi scan" → triggers codebase scan, populates project knowledge

- "Cluster feedback" → uses forge-pi to cluster tickets


==========================================================

ZONE 5 — NEW FEATURES POWERED BY THE 3-PACKAGE STACK

==========================================================


A. AI PRODUCT MANAGER (forge-pi):

- "PM Agent" registered in Agents Center

- When invoked: scans all customer feedback, market signals, existing PRDs → generates a quarterly roadmap

- Outputs: ranked list of features with predicted impact

- Can be invoked from: Ideation Center, Command Center, Co-pilot


B. VISUAL QA AGENT (forge-browser):

- "QA Agent" registered in Agents Center

- When invoked on a PR: opens preview, navigates changed screens, takes screenshots, compares to baseline

- Outputs: visual diff report + accessibility check

- Can be invoked from: Stories (PR linked), Code Review, Deploy phase


C. DEPLOYMENT CANARY WATCHER (forge-browser):

- "Canary Agent" registered in Agents Center

- Post-deploy: opens production URL, takes screenshot, compares to pre-deploy

- Alerts on visual regressions

- Can be invoked from: Deploy workflow, Analytics


==========================================================

ZONE 6 — DOCUMENTATION UPDATE

==========================================================


Update the docs site (Step 40):

- New section: "The 3-Package Spec-Driven Stack"

  - forge-core: workflow methodology

  - forge-pi: product intelligence

  - forge-browser: visual automation

- Architecture diagram showing how the 3 packages relate

- New pages: forge-pi docs, forge-browser docs


==========================================================

CONSTRAINTS

==========================================================


- Don't break the existing forge-core integration

- The 3 packages are independent — each can be installed/used separately

- forge-pi is optional (degrades gracefully if not installed)

- forge-browser is optional (degrades gracefully if not installed)

- All commands/skills are invokable from the Command Center

- Skill categorization in the UI is automatic (based on which package they come from)

- All animations respect prefers-reduced-motion

- Dark mode only

- Lucide icons only


==========================================================

DELIVERABLE

==========================================================


- packages/forge-pi/ created + installed

- packages/forge-browser/ created + installed

- Skill manifest reader updated to scan all 3 packages

- Command Center shows skills from all packages

- Ideation Center uses forge-pi for ingest/clustering/scoring

- Project Intelligence uses forge-pi for codebase scan

- Verify phase uses forge-browser

- forge-audit-uat uses forge-browser

- 3 new agents registered: PM Agent, QA Agent, Canary Agent

- Docs site updated with new architecture

- 1-paragraph rationale citing skill rules

- "What we deliberately did NOT change" — keep forge-core package structure, keep existing skills/agents/commands, keep monorepo layout
The forge-pi is the most impactful — it powers the "intelligence" layer (Ideation, Project Intelligence, knowledge graph) which is what makes Forge feel smart rather than just a workflow tool.

The forge-browser is the visual wow — the moment an AI agent can open a browser, take screenshots, and review UI changes automatically, the verify phase becomes truly automated.

The 3-agent addition (PM Agent, QA Agent, Canary Agent) is the cross-cutting value — these aren't just features, they're first-class agents that use the 3 packages to do real work.
