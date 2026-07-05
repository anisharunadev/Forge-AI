# step-48

> **Status:** completed
> **Last classified:** 2026-07-05

/goal

Finalize `packages/forge-pi/` and `packages/forge-browser/` to match the same level of polish, branding, and integration as `packages/forge-core/`. Both packages exist in the monorepo but need the full rename pass + wiring. Read .claude/design-system/ first.

REFERENCE: Look at `packages/forge-core/` as the gold standard — match that level of completion.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "monorepo package workspace publish private dependency" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "package rename refactor find replace across all files" --domain ux-guideline -f markdown

Adopt every rule. Then implement:

==========================================================
ZONE 1 — AUDIT + COMPLETE RENAME (both packages)
==========================================================

For EACH package (forge-pi, forge-browser):

1. Search for ALL occurrences of "gsd" (case-insensitive) across the entire package directory:
   ```bash
   grep -r -i "gsd" packages/forge-pi/ --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" --include="*.js" --include="*.mjs"
   grep -r -i "gsd" packages/forge-browser/ --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" --include="*.js" --include="*.mjs"


   Replace EVERY occurrence (file by file, careful with case):
"gsd-pi" → "forge-pi"
"gsd_pi" → "forge_pi"
"GSD-PI" → "FORGE-PI"
"GSD Pi" → "Forge Product Intelligence"
"GSD-PI" / "GSD_PI" → "FORGE-PI"
"gsd-browser" → "forge-browser"
"gsd_browser" → "forge_browser"
"GSD-BROWSER" → "FORGE-BROWSER"
"GSD Browser" → "Forge Browser"
"gsd" (standalone) → "forge" (where it refers to the package)
LEAVE "GSD" alone where it refers to the methodology reference (e.g., README "Based on the open-gsd spec-driven methodology")
2.
Specific files to check and update in BOTH packages:
package.json (name, description, keywords, repository, homepage)
README.md (full rebrand to Forge)
forge-pi.catalog.json / forge-browser.catalog.json (catalog name)
Any .claude-plugin/* files (agent definitions, settings, etc.)
Any bin/* scripts
Any src/* code (imports, comments, file headers)
Any docs/* markdown
Any .github/* workflows
CHANGELOG.md (reset to "1.0.0 — Initial release under Forge AI")


========================================================== ZONE 2 — UPDATE package.json (both packages)
For each package, ensure package.json matches the forge-core pattern:

json

Copy
{

  "name": "@forge-ai/forge-pi",

  "version": "1.0.0",

  "description": "Forge Product Intelligence — codebase scanning, knowledge graph building, idea scoring, PRD generation",

  "type": "module",

  "main": "./src/index.ts",

  "types": "./src/index.ts",

  "exports": {

    ".": "./src/index.ts",

    "./agents": "./agents/index.ts",

    "./commands": "./commands/index.ts",

    "./skills": "./skills/index.ts",

    "./capabilities": "./capabilities/index.ts"

  },

  "scripts": {

    "build": "tsc",

    "dev": "tsc --watch",

    "test": "vitest",

    "lint": "eslint .",

    "typecheck": "tsc --noEmit"

  },

  "keywords": [

    "forge-ai",

    "forge",

    "product-intelligence",

    "knowledge-graph",

    "ideation",

    "ai-agents"

  ],

  "author": "Forge AI Team",

  "license": "UNLICENSED",

  "repository": {

    "type": "git",

    "url": "https://github.com/forge-ai/forge-ai",

    "directory": "packages/forge-pi"

  },

  "engines": {

    "node": ">=20.0.0"

  },

  "dependencies": {

    "@forge-ai/forge-core": "workspace:*"

  },

  "devDependencies": {

    "typescript": "^5.0.0",

    "vitest": "^1.0.0"

  }

}
(forge-browser similar with its own description: "Forge Browser — AI browser automation, visual testing, UI review, accessibility audits")

========================================================== ZONE 3 — UPDATE README.md (both packages)
Match the forge-core README structure (you already did this, but verify):

markdown

Copy
# @forge-ai/forge-pi

> **Status:** completed
> **Last classified:** 2026-07-05


> Product Intelligence for Forge AI


Based on the open-gsd spec-driven methodology, branded and extended for the Forge AI platform.


## What it does


[3-4 paragraphs explaining the package's purpose]


## Skills included


[List all skills in the skills/ directory with 1-line descriptions]


## Agents included


[List all agents in the agents/ directory]


## Commands included


[List all commands in the commands/ directory]


## Usage


[Code example showing how to use the package]


## Architecture


[How this package relates to forge-core and forge-browser]


## License


UNLICENSED — Forge AI internal package
========================================================== ZONE 4 — ADD TO ROOT WORKSPACE
Update root package.json workspaces array to include all 3 packages:

json

Copy
{

  "workspaces": [

    "packages/forge-core",

    "packages/forge-pi",

    "packages/forge-browser",

    "apps/forge",

    "apps/docs-site"

  ]

}
Run pnpm install from root to link all packages.

Verify all 3 packages are linked:

bash

Copy
ls -la node_modules/@forge-ai/

# Should show: forge-core, forge-pi, forge-browser
========================================================== ZONE 5 — INSTALL IN apps/forge
Add to apps/forge/package.json dependencies:

json

Copy
{

  "dependencies": {

    "@forge-ai/forge-core": "workspace:*",

    "@forge-ai/forge-pi": "workspace:*",

    "@forge-ai/forge-browser": "workspace:*"

  }

}
Run pnpm install from root.

========================================================== ZONE 6 — WIRE INTO THE UI (Command Center + skill registry)
The Command Center (Step 34) reads skills from packages/forge-core/skills/. Now also read from:

packages/forge-pi/skills/
packages/forge-browser/skills/
UPDATE: src/lib/forge-skills/manifest-reader.ts to scan all 3 packages.

Each skill/agent/command should have metadata indicating which package it came from:

ts

Copy
{

  id: "forge-capture",

  name: "Capture idea",

  description: "...",

  package: "forge-core",  // NEW: which package

  type: "skill",         // skill | agent | command

  phase: "capture",      // which phase it belongs to

  // ... rest of metadata

}
UPDATE: Command Center skill picker to GROUP by package:

Section 1: "Core Workflow" (forge-core)
Section 2: "Product Intelligence" (forge-pi)
Section 3: "Browser Automation" (forge-browser)
Section 4: "Custom Commands" (any local)
Each section has its own icon + color:

forge-core: indigo, lucide Workflow
forge-pi: violet, lucide Brain
forge-browser: cyan, lucide Globe
========================================================== ZONE 7 — DEEP UI INTEGRATIONS
Where each package shines (already started in Step 45, complete the work):

A. IDEATION CENTER (Step 28) + forge-pi:

"Daily ingest" cron job uses forge-pi forge-cluster-tickets skill
"Customer Voice" tab uses forge-pi forge-cluster-feedback skill
"Market Signals" tab uses forge-pi forge-mine-signals skill
"AI reasoning" panel shows the chain from forge-pi forge-score-idea skill
B. PROJECT INTELLIGENCE (Step 38) + forge-pi:

"Artifact tree" uses forge-pi forge-scan-codebase skill
"Knowledge graph" (Step 27) seeded by forge-pi forge-build-graph skill
"Project at a glance" metrics from forge-pi forge-analyze-project skill
C. VERIFY PHASE + forge-browser:

forge-eval-review skill can invoke forge-browser forge-visual-check skill
"Visual regression test" button on PRs uses forge-browser forge-screenshot-compare
Post-deploy smoke test uses forge-browser forge-smoke-test
D. forge-audit-uat + forge-browser:

UAT (User Acceptance Testing) becomes visual — forge-browser opens the app, navigates flows, captures screenshots, verifies
AI agent reviews screenshots for visual regressions
Accessibility audit (WCAG) automated via forge-browser forge-a11y-audit
E. ARCHITECTURE CENTER + forge-pi:

"Diagrams" tab auto-generates system diagrams from forge-pi forge-map-services
API contracts auto-discovered from forge-pi forge-extract-apis
F. CO-PILOT CONTEXT + forge-pi:

Co-pilot uses forge-pi to understand the codebase when @mentioning files/entities
G. COMMAND CENTER (Step 34) + forge-pi + forge-browser:

"Run pi scan" → uses forge-pi forge-scan-codebase
"Visual review" → uses forge-browser forge-visual-check
========================================================== ZONE 8 — REGISTER NEW AGENTS
Register 3 new agents in the Agents Center (Step 43):

1. PM Agent (powered by forge-pi)

Description: "AI product manager that scans customer feedback, market signals, and existing PRDs to generate quarterly roadmaps. Outputs: ranked list of features with predicted impact."
Used in: Ideation Center, Command Center, Co-pilot
2. QA Agent (powered by forge-browser)

Description: "AI quality assurance agent that opens preview, navigates changed screens, takes screenshots, compares to baseline. Outputs: visual diff report + accessibility check."
Used in: Stories (PR linked), Code Review, Deploy phase
3. Canary Agent (powered by forge-browser)

Description: "AI canary watcher that opens production URL post-deploy, takes screenshot, compares to pre-deploy. Alerts on visual regressions."
Used in: Deploy workflow, Analytics
========================================================== ZONE 9 — DOCUMENTATION UPDATE
Update the docs site (Step 40):

NEW SECTION: "The Forge Spec-Driven Stack"

Overview: "Forge is built on a 3-package spec-driven architecture"
forge-core: workflow methodology + skills + agents + commands
forge-pi: product intelligence (codebase, knowledge graph, ideation)
forge-browser: browser automation (visual testing, UI review)
Architecture diagram showing how the 3 packages relate
New pages:
/docs/packages/forge-core — already exists
/docs/packages/forge-pi — NEW
/docs/packages/forge-browser — NEW
/docs/architecture/spec-driven-stack — NEW (high-level overview)
========================================================== ZONE 10 — VERIFICATION
Run these checks to ensure everything is wired correctly:

bash

Copy
# 1. All packages build

pnpm --filter @forge-ai/forge-core build

pnpm --filter @forge-ai/forge-pi build

pnpm --filter @forge-ai/forge-browser build


# 2. All packages have no "gsd" references (except in "Based on open-gsd" attribution)

grep -r -i "gsd" packages/forge-pi/ packages/forge-browser/ --exclude-dir=node_modules | grep -v "open-gsd" | grep -v "open_gsd"


# 3. All packages are linked

pnpm list --depth=0 --filter "@forge-ai/*"


# 4. All packages are installed in apps/forge

grep -E "forge-(core|pi|browser)" apps/forge/package.json


# 5. UI loads skills from all 3 packages

# (test in browser, navigate to Command Center skill picker)


# 6. New agents are registered

# (test in browser, navigate to Agents Center, search for "PM Agent" etc.)


# 7. Documentation updated

# (test in browser, navigate to docs site, verify new pages exist)
========================================================== CONSTRAINTS
The 3 packages are independent — each can be installed/used separately
forge-pi is optional (degrades gracefully if not installed)
forge-browser is optional (degrades gracefully if not installed)
Don't break the existing forge-core integration
All commands/skills are invokable from the Command Center
Skill categorization in the UI is automatic (based on which package they come from)
All animations respect prefers-reduced-motion
Dark mode only
Lucide icons only
NEVER mention "GSD" in UI, documentation, or user-facing text
Only mention "open-gsd" in attribution credits (e.g., "Based on open-gsd spec-driven methodology")
========================================================== DELIVERABLE
Both packages fully renamed (no "gsd" references except attribution)
Both packages have proper package.json, README, CHANGELOG
Both packages added to root workspace + apps/forge
All skills/agents/commands from all 3 packages discoverable in Command Center
3 new agents registered (PM Agent, QA Agent, Canary Agent)
Deep UI integrations complete (Ideation, Project Intelligence, Verify, UAT, Architecture, Co-pilot, Command Center)
Documentation updated with 3-package architecture
All verification checks pass
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the existing forge-core integration, keep the monorepo structure, keep the existing skill/agent/command contracts
Build order: Zone 1-2 (rename + package.json) → Zone 3-4 (README + workspace) → Zone 5 (install) → Zone 6-7 (UI + deep integrations) → Zone 8 (new agents) → Zone 9 (docs) → Zone 10 (verification)
