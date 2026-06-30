---
project_name: 'forge-ai'
status: 'FROZEN — enforced by scripts/check-claude-md.sh'
rule_count: 18
last_canonical_review: '2026-06-30'
optimized_for_llm: true
---

<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

> **This file is FROZEN.** New conventions go in `docs/standards/`. PRs that grow it past the budget fail `scripts/check-claude-md.sh`.

## Mission

> **Forge is not an AI agent. Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

## Read order

1. `CLAUDE.md` (this file — constitutional rules)
2. `docs/index.md` (navigator)
3. `/docs/standards/<topic>.md` (e.g. `architecture-rules.md`, `tech-stack.md`)
4. `/docs/features/<feature>.md`
5. `/docs/reference/<api-catalog|db-schema>.md` when you need route/table inventory
6. **Verify against the actual code.** Never invent routes, components, or schemas.

## The 18 Constitutional Rules

> All rules are **MUST**-grade. Violations are bugs. Full prose at `docs/standards/architecture-rules.md`.

### Model & tenancy

1. **R1 — Provider-agnostic.** All LLM traffic → LiteLLM Proxy. Forbidden imports: `openai`, `anthropic`, `google.generativeai`, `langchain_openai`, `cohere`, `ollama`.
2. **R2 — Multi-tenancy by default.** Every record, query, artifact, KG node, audit row carries `tenant_id` + `project_id`. Never optional.

### Approval & artifacts

3. **R3 — Human approval gates.** No autonomous crossing of Architecture / Security / Deployment boundaries.
4. **R4 — Typed artifacts only.** Agents emit ADR / API Contract / Task Breakdown / Risk Register / Security Report / Deployment Plan — never free-form blobs.

### Layers

5. **R5 — Layer isolation.** Org Knowledge is shared. Project Intelligence is isolated.
6. **R6 — Mandatory auditability.** Every agent action captures: agent, model, prompt, tool, cost, artifact, timestamp, result.
7. **R7 — Mandatory observability.** OpenTelemetry tracing + metrics + logs from day one.
8. **R8 — Configurable everything.** No hardcoded GitHub / Claude / OpenAI / AWS / Jira.

### Package sourcing

9. **R9 — `forge-core` is canonical.** Skill / agent / command lists come from `packages/forge-core/` — never hardcoded.
10. **R10 — `forge-pi` powers product intelligence.** Codebase scan, KG, ideation, PRD gen, API contracts — via `forge-pi`.
11. **R11 — `forge-browser` powers visual automation.** UI review, visual regression, UAT, a11y — via `forge-browser`.

### UI

12. **R12 — Cross-cutting concerns are NOT siloed.** ConnectorPicker, Co-pilot FAB (⌘J), Command Center (⌘K) must work from every page.
13. **R13 — Canvas-first.** Complex screens (Workflows, Terminal, KG) use collapsible rails — default collapsed, main canvas is hero.
14. **R14 — Knowledge is bidirectional.** Every artifact has outgoing refs AND incoming backlinks.
15. **R15 — Empty states explain.** Icon + value prop + primary action + secondary action — never bare "No data".
16. **R16 — Onboarding is a wizard.** Skippable, resumable, ends with a tour, offers sample data.
17. **R17 — Lifecycle is one workflow.** Ticket → Idea → PRD → Story → Run → Deploy, with status triggers.

### Documentation

18. **R18 — Documentation is part of the product.** Every Built Feature gets a page under `docs-site/`. Docs are versioned. Stale docs are bugs. Enforced by `scripts/check-feature-docs.sh`.

## Locked pins

| Pin | Value | Doc |
|---|---|---|
| Next.js | 16.2.x | `docs/standards/tech-stack.md` |
| React | 19 | same |
| Tailwind | 3.4.14 | same |
| Python | 3.13 | same |
| Backend dir | `backend/` | `docs/naming-conventions.md` |
| Frontend dir | `apps/forge/` | same |
| Package dir | `packages/forge-{core,pi,browser}/` | same |
| Docs system | `/docs/` is canonical for agents; `docs-site/` for human readers | `docs/index.md` |

## Reading shortcuts

| Need | Read first |
|---|---|
| Run the app locally | `docs/getting-started.md` |
| Pick a library | `docs/standards/tech-stack.md` |
| Add a new API route | `docs/standards/api-conventions.md` |
| Add a new SQLAlchemy model | `docs/standards/data-model.md` |
| Add a feature | `docs/standards/architecture-rules.md` + `docs/features/` |
| Use the GSD workflow | `docs/workflows/gsd.md` |
| Find an existing route | `docs/reference/api-catalog.md` |
| Find an existing model | `docs/reference/db-schema.md` |
| MCP debugging | `docs/standards/mcp-tooling.md` |
| Add a UI pattern | `docs/standards/ui-patterns.md` |
| Pick a viz library | `docs/standards/visualization.md` |
| Apply package naming | `docs/naming-conventions.md` |
| Integration-phase status | `docs/integration/phases.md` |

## Contributing

Before opening a PR, see `scripts/check-claude-md.sh` for the budget rules this file is held to. Routine patterns go in `docs/standards/<topic>.md`; new constitutional rules promote from `docs/standards/architecture-rules.md` after 2 weeks of use.
