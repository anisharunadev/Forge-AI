> **Status:** completed
/goal

Complete redesign of the Forge AI documentation site (currently Astro.js + Starlight, light theme) into an enterprise-grade dark-themed documentation site that aligns with the Forge AI app design language. Read .claude/design-system/ first + explore docs-site/src/content/docs/ for existing content.

USER INTENT (clear):
- Modernize the docs site to be eye-catchy and enterprise-grade
- Switch from light theme to dark theme matching the app
- Use indigo/cyan accent palette (matching the app)
- Cover ALL features from the 40+ design steps we built
- Restructure content to match the new app navigation
- Add premium doc components (cards, callouts, tabs, diagrams)
- Make it feel like Linear / Vercel / Stripe docs quality

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "documentation site enterprise dark theme indigo linear vercel stripe" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Astro Starlight custom theme override CSS variables dark mode" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "documentation IA navigation sidebar table of contents structure" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "feature card callout component MDX custom documentation component" --domain style -f markdown

Adopt every rule. Then build:

==========================================================
ZONE 1 — CUSTOM DARK THEME (overrides Starlight defaults)
==========================================================

Override Starlight's CSS variables to match Forge AI's design system. In `src/styles/custom.css`:

```css
:root {
  /* Forge AI brand palette */
  --sl-color-accent-low: #1e1b4b;          /* indigo-950 */
  --sl-color-accent: #6366f1;              /* indigo-500 — brand primary */
  --sl-color-accent-high: #a5b4fc;         /* indigo-300 */
  
  /* Dark theme surface system */
  --sl-color-bg: #09090B;                  /* bg-base */
  --sl-color-bg-nav: #0E0E11;              /* bg-inset */
  --sl-color-bg-sidebar: #0E0E11;          /* bg-inset */
  --sl-color-bg-inline-code: #131316;      /* bg-surface */
  --sl-color-bg-accent: #6366f1;
  
  /* Text */
  --sl-color-white: #FAFAFA;               /* fg-primary */
  --sl-color-gray-1: #A1A1AA;              /* fg-secondary */
  --sl-color-gray-2: #71717A;              /* fg-tertiary */
  --sl-color-gray-3: #52525B;              /* fg-muted */
  --sl-color-gray-5: #1A1A1F;              /* bg-elevated */
  --sl-color-gray-6: #131316;              /* bg-surface */
  --sl-color-gray-7: rgba(255,255,255,0.06);
  
  /* Borders */
  --sl-color-hairline: rgba(255,255,255,0.10);
  --sl-color-hairline-light: rgba(255,255,255,0.06);
  --sl-color-hairline-shade: rgba(255,255,255,0.16);
  
  /* Typography */
  --sl-font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --sl-font-mono: 'JetBrains Mono', ui-monospace, monospace;
}


TYPOGRAPHY ENHANCEMENTS (custom CSS):

h1: --text-4xl font-700 with gradient text (indigo to cyan, like the app)
h2: --text-2xl font-700, border-b --border-subtle, padding-bottom 12px, margin-top 48px
h3: --text-xl font-600, margin-top 32px
Inline code: bg --bg-elevated, --text-sm, --radius-sm, padding 2px 6px
Code blocks: shiki dark theme matching app palette, --radius-md, --border-subtle
Links: --accent-primary with subtle underline on hover


========================================================== ZONE 2 — CUSTOM LANDING PAGE
Replace Starlight's default hero with a custom Forge-branded landing page in src/content/docs/index.md:

LAYOUT (vertical sections):

SECTION 1: HERO (h-screen minus header):

Background: --bg-base with subtle aurora gradient (3 radial gradients, very low opacity)
Eyebrow: "ENTERPRISE SDLC AGENT OPERATING SYSTEM" --text-xs uppercase tracking-widest
h1: "Forge AI — Enterprise SDLC Agent Operating System" with gradient text (indigo → violet → cyan)
Subtitle: "Orchestrate agents, knowledge, governance, and delivery workflows across every stage of the software development lifecycle."
PRIMARY CTA: "Quickstart →" (large, --accent-primary bg, glowing)
SECONDARY CTAs: "Architecture" + "Command reference" (outlined)
Bottom: 4 feature pills floating: "63 forge-* commands" · "13 categories" · "HITL gates" · "Multi-tenant" · "Append-only audit"
SECTION 2: "WHAT FORGE GIVES YOU" (3-col feature grid):

6-8 feature cards with: lucide icon + title + 2-line description
Cards: bg --bg-elevated, --radius-lg, p-24px, hover lift
Features:
1.
Project Intelligence (indigo Layers) — Scan repos, deps, services, and secrets. Build a tenant-scoped knowledge graph
2.
Typed Artifacts (cyan FileText) — Every workflow produces one of six typed artifacts: ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan
3.
Approval Gates (HITL) (rose ShieldCheck) — Architecture, security, and deployment boundaries pause for human review. Enforced by the orchestrator
4.
White-labeled Commands (amber Terminal) — Every internal action is exposed as a forge-* command. The implementation is hidden — only the brand shows
5.
Multi-Tenant by Default (violet Users) — Row-level security on every table. Per-tenant KMS keys. Isolated audit log topology
6.
Append-Only Audit (emerald History) — Every action lands in a tamper-evident ledger with daily hash chain anchors
7.
Model-Provider Agnostic (cyan Cpu) — All LLM traffic flows through a single proxy with virtual keys, audit logs, and budget guardrails
8.
Knowledge Reuse (violet BookMarked) — Capture lessons from sessions, summarize across the org, promote durable rules
SECTION 3: "SDLC PHASES" (horizontal pipeline visualization):

5 phases: Ideation → Architecture → Development → Testing → Deployment
Each phase: lucide icon + name + 2-line description + "forge-* commands" count
Animated dashed lines between phases
Hover phase: shows example commands
SECTION 4: "WHY FORGE AI" (if you have... vs Forge gives you... table):

Comparison table: 4 rows
"A single AI agent that hallucinates contracts and skips review" → "A typed-artifact pipeline with HITL gates at architecture, security, and deployment boundaries"
"Point tools that don't share context" → "A project intelligence knowledge graph that fuses repos, tickets, docs, and chat into one source of truth"
"A do-it-yourself stack of scripts and SaaS" → "63 production-grade forge-* commands across 13 categories, audited end to end"
"A vendor lock-in to one model provider" → "Provider-agnostic proxy — swap Claude, GPT, Gemini, or any OpenAI-compatible endpoint without code changes"
========================================================== ZONE 3 — RESTRUCTURED SIDEBAR (matches the app navigation)
Replace current sidebar (Start Here / Concepts / Forge Commands / Architecture / Operations / Reference) with the structure that matches the app's actual navigation:

START HERE
  - Quickstart
  - What is Forge AI?
  - Why Forge AI?

WORKSPACE
  - Dashboard
  - Co-pilot (NEW)

CENTERS
  - Agents
  - Projects
  - Stories
  - Workflows (Visual Builder) (NEW)
  - Knowledge
  - Artifacts (NEW — Organization Knowledge)
  - Ideation
  - Architecture
  - Connectors (NEW)

LIFECYCLE
  - Onboarding
  - Governance & Compliance (NEW)
  - Audit
  - Analytics
  - Terminal
  - Runs
  - Command Center (GSD) (NEW)
  - Settings

GUIDES
  - Ticket-Driven Development (NEW)
  - Spec → Execute → Deploy (NEW)
  - Building a Workflow (NEW)
  - Setting up Guardrails (NEW)
  - Multi-tenant Setup
  - Self-hosting

CONCEPTS
  - Agent Operating System
  - Typed Artifacts
  - Approval Gates (HITL)
  - Knowledge Graph
  - White-label Commands
  - Multi-tenancy
  - Append-only Audit
  - Observability

REFERENCE
  - HTTP API
  - Audit Codes
  - forge-* Commands Reference
  - Glossary
  - MCP Servers
  - OpenAPI Reference


  Each top-level section gets a COLLAPSIBLE accordion (current behavior, but with better icons and labels).

========================================================== ZONE 4 — CUSTOM COMPONENTS (MDX)
Create reusable doc components in src/components/:

A. — for feature highlights Props: icon, title, description, color Style: bg --bg-elevated, --radius-lg, p-24px, icon in colored circle, title --text-lg font-600, description --text-sm --fg-secondary

B. — wrapper for grid of FeatureCards Props: cols (2/3/4) Style: grid grid-cols-{cols} gap-16px

C. — for important notes (info, warning, success, danger, tip) Props: type ("info" | "warning" | "success" | "danger" | "tip"), title Style: bg colored by type, --radius-md, p-16px, icon + title + children Examples:

Info: blue accent, lucide Info icon, "Note"
Warning: amber accent, lucide AlertTriangle, "Warning"
Success: emerald accent, lucide CheckCircle, "Success"
Danger: rose accent, lucide AlertOctagon, "Danger"
Tip: cyan accent, lucide Sparkles, "Tip"
D. — for forge-* command examples Props: command, description Style: bg --bg-elevated, --radius-md, p-12px, command in mono font + description below

E. — for property/parameter tables (alternative to markdown tables) Props: key, value, type Style: two-column with key in muted text, value in primary

F. — for image placeholders during dev Props: caption, alt Style: bg --bg-elevated, --radius-md, image with subtle border, caption below

G. — for ASCII or Mermaid diagrams Props: type ("ascii" | "mermaid") Style: depending on type

H. — for lists of forge-* commands Props: category Style: grouped list with command name + description

I. — for API documentation Props: method, path, description, params Style: METHOD badge (GET cyan, POST emerald, PUT amber, DELETE rose) + path mono + description

J. — for numbered step-by-step guides Style: numbered list with custom styling, connects steps with lines

K. — for if-you-have vs Forge-gives-you comparisons Style: two-column with rose left ("problem") and emerald right ("solution")

========================================================== ZONE 5 — NEW PAGE CONTENT (for all the features)
For each new page in the restructured sidebar, write comprehensive MDX content using the new components:

WORKSPACE > Co-pilot (new):

Overview of the AI assistant
How to use (slash commands, context injection, multi-modal capture)
Configuration (model picker, modes, settings)
Cross-module integration (everywhere the panel can be invoked)
Code examples of using @ mentions, / commands
Screenshots of the floating FAB and panel
CENTERS > Workflows (Visual Builder) (new):

Overview (n8n-style builder)
Node types reference (9 types)
Building your first workflow
Using templates
Cross-module orchestration (how phases trigger other modules)
Versioning + execution
CENTERS > Artifacts (new):

Overview (org-level knowledge)
Standards (F-001), Templates (F-002), Policies (F-003), Runbooks (F-004), Best Practices (F-005)
Using Obsidian-style backlinks
Compliance + adoption metrics
AI suggestions
CENTERS > Connectors (new):

Overview
Marketplace
Credentials vault
Webhooks
Cross-app usage (used in Ideation, Workflows, Co-pilot)
LiteLLM integration
LIFECYCLE > Governance & Compliance (new):

Policies as guardrails
LiteLLM control
Standards library (ISO 27001, SOC2, GDPR, etc.)
Policy testing playground
Audit trail
LIFECYCLE > Command Center (GSD) (new):

Overview (GSD methodology)
Ticket-driven entry
Spec mode
Phase pipeline (Spike → Plan → Execute → Verify → Validate → Audit → Deploy)
Cross-module orchestration
GUIDES > Ticket-Driven Development (new):

Walkthrough: from Jira ticket to PR
Screenshots of each phase
Best practices
Customization
GUIDES > Spec → Execute → Deploy (new):

Walkthrough: from idea to production
Each phase explained
Customization
GUIDES > Building a Workflow (new):

Drag-and-drop builder
All node types
Templates
Testing + execution
GUIDES > Setting up Guardrails (new):

PII detection
Secret scanning
Rate limits
Spend caps
Testing policies
========================================================== ZONE 6 — VISUAL ENHANCEMENTS
A. CODE BLOCKS:

shiki theme matching the app palette (custom theme: forge-dark)
Copy button (already in Starlight)
Line numbers (when needed)
File name header (when applicable)
Language label
Diff highlighting (red/green for +/-)
B. TABS (Starlight already has this):

Use them for OS-specific instructions (macOS / Linux / Windows)
Use them for package manager (pnpm / npm / yarn)
C. TABLES:

Alternating row backgrounds (--bg-base / --bg-elevated)
Sticky headers
Hover highlight on rows
Code in cells: mono font, --text-sm
D. CALLOUTS (defined in Zone 4):

Use generously for warnings, tips, important notes
Each page should have at least one Callout
E. DIAGRAMS:

Use Mermaid for architecture diagrams
Use ASCII for simple flow diagrams
Include in: Architecture overview, Workflow examples, SDLC phases
========================================================== ZONE 7 — GLOBAL IMPROVEMENTS
A. SEARCH:

Algolia DocSearch integration (or Pagefind for self-hosted)
Custom search ranking
Search results show: title, breadcrumb, snippet, category
B. NAVIGATION:

"On this page" right sidebar with scroll-spy
"Edit this page" link (GitHub)
"Was this helpful?" feedback widget at bottom
Previous / Next page navigation at bottom
C. ANNOUNCEMENT BAR:

Optional dismissible banner at top: "🎉 Forge v2.0 is here — see what's new"
Dismissable, persists in localStorage
D. FOOTER:

Links to: Quickstart, Reference, Community, GitHub, Discord
Version selector (dropdown: v2.0, v1.x, edge)
Theme toggle (already in Starlight)
E. PERFORMANCE:

Static generation for all pages
Lazy load images
Minimal JS (Starlight is mostly server-rendered)
Fast page transitions (View Transitions API)
========================================================== ZONE 8 — MIGRATE EXISTING CONTENT
Take all existing content and:

Wrap key sections in the new components
Add Callouts where warnings/notes exist
Add diagrams where flow descriptions exist
Update any mentions of "agent" to be consistent
Update to reflect the actual built product (40+ features)
Add cross-references between related pages
Ensure all forge-* command references are accurate
========================================================== CONSTRAINTS
Keep Starlight as the base framework (don't migrate to a different doc tool)
Keep the existing folder structure: src/content/docs/{sections}/
All existing pages must be migrated (don't lose content)
Dark theme is DEFAULT — no light theme toggle (matches the app)
Indigo/cyan accent matches the app palette
All custom components must be MDX-compatible
Mobile-responsive (Starlight is by default)
No emojis as UI icons (use lucide)
All animations respect prefers-reduced-motion
Static build (no server-side requirements)
Deploys via existing docker compose (docs-site service)
========================================================== DELIVERABLE
files modified, new files in:

src/styles/custom.css (theme overrides)
src/components/*.astro (custom MDX components)
src/content/docs/index.md (new landing page)
src/content/docs/workspace/co-pilot.md (new)
src/content/docs/centers/workflows.md (new)
src/content/docs/centers/artifacts.md (new)
src/content/docs/centers/connectors.md (new)
src/content/docs/lifecycle/governance.md (new)
src/content/docs/lifecycle/command-center.md (new)
src/content/docs/guides/ticket-driven.md (new)
src/content/docs/guides/spec-execute-deploy.md (new)
src/content/docs/guides/building-workflow.md (new)
src/content/docs/guides/guardrails.md (new)
All existing pages updated with new components + content
Restructured sidebar in astro.config.mjs
Custom shiki theme matching app palette
Before/after screenshots of the landing page + a sample content page
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep Starlight framework, keep existing folder structure, keep all existing pages (just modernize)
