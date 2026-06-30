# Forge AI Agent OS — Documentation Index

> **The canonical entry point for AI agents, contributors, and reviewers.**
> This index is a connector — every section links to a focused document.
> **Read this first. Always.**

> **🪜 CLAUDE.md chain (read in this order):**
>
> 1. [`../../CLAUDE.md`](../../CLAUDE.md) — root entry (you are wiring from this)
> 2. [`../../.claude/CLAUDE.md`](../../.claude/CLAUDE.md) — canonical 18 rules + tech stack (938 lines)
> 3. [`../../apps/forge/CLAUDE.md`](../../apps/forge/CLAUDE.md) — frontend conventions
> 4. [`../../backend/CLAUDE.md`](../../backend/CLAUDE.md) — backend conventions
>
> Then come here to `/docs/index.md` and follow the doc tree.

---

## What is Forge AI?

Forge AI is the **operating system for enterprise software delivery**. It orchestrates agents, knowledge, governance, and delivery workflows — taking a product idea from a one-line prompt to a deployed, audited change across the customer's repositories, ticketing systems, documentation, and design tools.

**Forge is NOT an AI agent.** Forge is the governed control plane that agents run on.

---

## How to use this index

This documentation is organized into four sections:

| Section | Purpose | Path | Doc count |
|---|---|---|---|
| **Product** | What Forge does, who it serves, why it matters | [`/docs/product/`](./product/) | 4 |
| **Standards** | How Forge is built — tech stack, design system, coding conventions | [`/docs/standards/`](./standards/) | 8 |
| **Features** | One file per feature — purpose, routes, contracts, edge cases | [`/docs/features/`](./features/) | 26 |
| **Reference** | Canonical specs, ADRs, runbooks | [`/docs/reference/`](./reference/) | 7 |
| **Master index** | This file — the connector | `/docs/index.md` | 1 |

**For AI agents:** When asked to modify or extend Forge, you **MUST** read:
1. The CLAUDE.md chain (above) — the rules + conventions
2. This `index.md` (you are here) — pick the right doc
3. The relevant feature file(s) under `features/`
4. The relevant standard file(s) under `standards/` (especially `coding-standards.md` and `design-system.md`)
5. The relevant reference doc(s) under `reference/` (when you need route/table inventory)
6. **NEVER invent routes, components, or data shapes** — link to existing specs

---

## 1. Product Documentation

| File | Description |
|---|---|
| [`product/vision.md`](./product/vision.md) | What Forge is, what it isn't, the 8 immutable constitutional rules |
| [`product/personas.md`](./product/personas.md) | 6 personas (PM, eng-lead, CTO, vp-eng, security, customer) with job-to-be-done |
| [`product/glossary.md`](./product/glossary.md) | Domain terms — artifact, run, approval gate, LiteLLM proxy, forge-core, etc. |
| [`product/architecture-summary.md`](./product/architecture-summary.md) | High-level system diagram + 3-package split (forge-core / forge-pi / forge-browser) |

---

## 2. Standards Documentation

These apply to **every feature**. Read before writing any code.

| File | Description |
|---|---|
| [`standards/coding-standards.md`](./standards/coding-standards.md) | TypeScript + Python conventions, naming, file organization |
| [`standards/design-system.md`](./standards/design-system.md) | Visual language — colors, typography, spacing, motion, components |
| [`standards/architecture-rules.md`](./standards/architecture-rules.md) | The 8 immutable rules — multi-tenancy, approval gates, audit, etc. |
| [`standards/api-conventions.md`](./standards/api-conventions.md) | FastAPI route conventions, schema patterns, error handling |
| [`standards/data-model.md`](./standards/data-model.md) | SQLAlchemy patterns, RLS, tenant scoping, soft deletes |
| [`standards/testing.md`](./standards/testing.md) | Unit + integration + E2E test patterns, coverage targets |
| [`standards/git-workflow.md`](./standards/git-workflow.md) | Branching, PR review, commit conventions |
| [`standards/litellm-integration.md`](./standards/litellm-integration.md) | How Forge talks to LiteLLM proxy — Rule 1 enforcement |

---

## 3. Feature Documentation

One file per major feature. Each describes **what the feature does**, **routes it owns**, **data it touches**, **edge cases**, and **forbidden patterns**.

### Workspace + Setup

| Feature | Description | Doc |
|---|---|---|
| **Workspaces** | Multi-tenancy — tenants, members, switching | [`features/workspaces.md`](./features/workspaces.md) |
| **Onboarding** | Project setup wizard (10 steps) | [`features/onboarding.md`](./features/onboarding.md) |
| **Settings** | 21-tab workspace configuration | [`features/settings.md`](./features/settings.md) |
| **Auth (OIDC)** | Keycloak realm + JWT flow | [`features/auth.md`](./features/auth.md) |

### Centers (top-level navigation)

| Feature | Description | Doc |
|---|---|---|
| **Dashboard** | Landing page — KPIs, recent activity, persona-aware | [`features/dashboard.md`](./features/dashboard.md) |
| **Agent Center** | Agent registry + providers + runtimes | [`features/agent-center.md`](./features/agent-center.md) |
| **Connector Center** | External system integrations (GitHub, Jira, etc.) | [`features/connector-center.md`](./features/connector-center.md) |
| **Knowledge Center** | Knowledge graph + vector search | [`features/knowledge-center.md`](./features/knowledge-center.md) |
| **Ideation Center** | Ideas → PRDs → Roadmap (9 tabs) | [`features/ideation-center.md`](./features/ideation-center.md) |
| **Architecture Center** | ADRs + contracts + risks (9 tabs) | [`features/architecture-center.md`](./features/architecture-center.md) |
| **Organization Knowledge** | Standards + templates + policies | [`features/organization-knowledge.md`](./features/organization-knowledge.md) |
| **Co-pilot** | Conversational AI assistant (Cmd+J) | [`features/copilot.md`](./features/copilot.md) |

### Lifecycle

| Feature | Description | Doc |
|---|---|---|
| **Projects** | Multi-project workspace | [`features/projects.md`](./features/projects.md) |
| **Stories** | Kanban + lifecycle + linked Jira | [`features/stories.md`](./features/stories.md) |
| **Workflows** | DAG-based orchestration + run executor | [`features/workflows.md`](./features/workflows.md) |
| **Runs** | Live + replay run center | [`features/runs.md`](./features/runs.md) |
| **Audit** | Forge audit log + LLM traffic | [`features/audit.md`](./features/audit.md) |
| **Analytics** | Cost + usage dashboards | [`features/analytics.md`](./features/analytics.md) |
| **Governance** | Policies + guardrails + LiteLLM bridge | [`features/governance.md`](./features/governance.md) |
| **Terminal** | xterm.js + native PTY | [`features/terminal.md`](./features/terminal.md) |
| **Command Center** | forge-* command palette (Cmd+K) | [`features/command-center.md`](./features/command-center.md) |

### Tools

| Feature | Description | Doc |
|---|---|---|
| **Project Intelligence** | KG + repos + ingestion | [`features/project-intelligence.md`](./features/project-intelligence.md) |
| **Refactor** | Migration plans + ADR compiler | [`features/refactor.md`](./features/refactor.md) |
| **Validator** | Code validation reports | [`features/validator.md`](./features/validator.md) |

### Admin

| Feature | Description | Doc |
|---|---|---|
| **Admin Hub** | LLM Gateway + tenants + keys + MCP | [`features/admin-hub.md`](./features/admin-hub.md) |
| **Seeds Admin** | Seed framework management | [`features/seeds-admin.md`](./features/seeds-admin.md) |

### Personas

| Feature | Description | Doc |
|---|---|---|
| **Persona Dashboards** | PM / eng-lead / CTO persona-specific views | [`features/personas-dashboards.md`](./features/personas-dashboards.md) |

---

## 4. Reference

| File | Description |
|---|---|
| [`reference/8-rules.md`](./reference/8-rules.md) | The 8 immutable constitutional rules (R1-R8) |
| [`reference/forge-core.md`](./reference/forge-core.md) | The canonical skills/agents/commands package |
| [`reference/litellm-bridge.md`](./reference/litellm-bridge.md) | How Forge proxies to LiteLLM — endpoint map |
| [`reference/api-catalog.md`](./reference/api-catalog.md) | All 320+ backend REST routes |
| [`reference/db-schema.md`](./reference/db-schema.md) | All 60+ SQLAlchemy models + relationships |
| [`reference/seed-scripts.md`](./reference/seed-scripts.md) | How to seed and reset the demo tenant |
| [`reference/test-scripts.md`](./reference/test-scripts.md) | Backend API smoke tests |

---

## 5. Canonical Files in the Codebase

These files inside `../../` are **authoritative**:

| Path | What it is |
|---|---|
| `CLAUDE.md` | Constitutional rules (must read first) |
| `README.md` | Project positioning + quick links |
| `CHANGELOG.md` | What shipped in each step |
| `forge-design-system.md` | Design language reference |
| `forge-theme-system.md` | Token architecture |
| `docs/ARCHITECTURE.md` | System architecture |
| `docs/openapi.json` | Full REST API spec |
| `apps/forge/lib/design-system/` | Token source of truth (TS) |
| `apps/forge/app/globals.css` | CSS layer |
| `apps/forge/tailwind.config.ts` | Tailwind binding |
| `backend/app/api/v1/` | All REST routes |
| `backend/app/db/models/` | All SQLAlchemy models |
| `backend/scripts/seed_*.py` | Seed scripts (one per domain) |
| `backend/scripts/test_*.py` | API smoke tests (one per phase) |

---

## 6. Naming Conventions (so AI agents don't get confused)

See [`../naming-conventions.md`](../naming-conventions.md) and the Glossary ([`product/glossary.md`](./product/glossary.md)). Quick terms:

| Term | Meaning |
|---|---|
| **Tenant** | An organization in Forge (e.g., `acme-corp`) |
| **Project** | A workspace under a tenant (e.g., `acme-platform`) |
| **Agent** | A registered AI worker (e.g., Claude Code, Codex) |
| **Connector** | An integration with an external system (e.g., Jira, GitHub) |
| **Provider** | An LLM vendor (e.g., Anthropic, OpenAI) — managed via LiteLLM |
| **Workflow** | A DAG of nodes (trigger / command / approval / script) |
| **Run** | An execution instance of a workflow |
| **Artifact** | A typed Forge document (ADR, PRD, contract, risk register, etc.) |
| **Center** | A top-level navigation destination (Agent, Connector, Knowledge, etc.) |

---

## 7. Quick Start for AI Agents

If you are an AI agent (Claude Code, Codex, etc.) asked to modify Forge:

1. **Read** `CLAUDE.md` and `/workspace/docs/index.md` (this file)
2. **Read** the relevant feature file under `/workspace/docs/features/`
3. **Read** `/workspace/docs/standards/coding-standards.md`
4. **Read** `/workspace/docs/standards/design-system.md`
5. **Verify** existing code in `../../` before writing
6. **NEVER invent** routes, components, or data shapes
7. **ALWAYS** link to existing specs and files via markdown links
8. **RUN** `docker compose up -d` if the backend is not running, then test with the seed scripts

If asked to add a new feature:
- Check `docs/features/` for related existing features
- Check `docs/reference/api-catalog.md` for existing routes — don't duplicate
- Check `docs/standards/` for the rules you must honor
- Create or update the relevant `features/<feature>.md` doc as you go

If asked to fix a bug:
- Check the feature file for the **forbidden patterns** section
- Check the verification checklist at the bottom of the file
- Look at recent git history: `git log --oneline -20`

---

## 8. Documentation Conventions

Every file in this docs tree follows these rules:

- **One feature per file** — never mix two features in one doc
- **Always include**: Purpose, Routes (frontend + backend), Data touched, Edge cases, Forbidden patterns, Verification checklist
- **Always link** to canonical sources (CLAUDE.md, design-system.md, etc.) — never duplicate
- **Keep it focused** — if a doc exceeds 500 lines, split into sub-files
- **Update the index** when adding/removing files in `/workspace/docs/`

---

## 9. Status

This documentation is **being built incrementally**. As of today:

- ✅ `index.md` (this file) — DONE
- ⏳ Per-feature docs — see `/workspace/docs/features/_TODO.md`
- ⏳ Per-standard docs — see `/workspace/docs/standards/_TODO.md`
- ⏳ Per-reference docs — see `/workspace/docs/reference/_TODO.md`

When asked to work on a specific feature, check the corresponding feature file under `/workspace/docs/features/`. If it doesn't exist yet, scaffold it from this template:

```markdown
# Feature: <Name>

> **Status:** Stub — being filled in
> **File path:** `apps/forge/app/<route>/page.tsx`
> **Backend:** `backend/app/api/v1/<file>.py`

## Purpose
One paragraph — what this feature does and why it exists.

## Routes
### Frontend
- `<path>` — one-line description

### Backend
- `METHOD /api/v1/<path>` — one-line description

## Data touched
- Tables: `table_name`
- Schemas: `schema_name`

## Edge cases
- Bulleted list

## Forbidden patterns
- Bulleted list of things AI agents should NOT do

## Verification checklist
- [ ] Check 1
- [ ] Check 2

## Related docs
- [Standard link]
- [Feature link]
```