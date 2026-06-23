---
project_name: 'forge-ai'
user_name: 'Arunachalam.v@knackforge.com'
date: '2026-06-20'
sections_completed: ['technology_stack', 'critical_implementation_rules']
existing_patterns_found: 0
status: 'complete'
rule_count: 12
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Mission Statement

> **Forge is not an AI agent.**
> **Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

This single statement must influence every architecture decision that follows.

---

## Technology Stack & Versions

### Frontend

```text
Next.js 15
React 19
TypeScript 5.x
Shadcn/UI
Tailwind CSS 3.4.x
TanStack Query
Zustand
React Flow
Recharts
```

> Note: Tailwind 4 migration is deferred to post-pilot (see REQUIREMENTS.md "Out of Scope" — Tailwind 4 migration). Pinned at 3.4.14 in apps/forge/package.json.

### Backend

```text
FastAPI
Python 3.13
Pydantic v2
SQLAlchemy 2.x
Alembic
```

### Agent Runtime

```text
LangGraph
LangChain
LiteLLM
OpenTelemetry
```

### Database

```text
PostgreSQL 17
pgvector
Redis
```

### Realtime

```text
WebSocket
Redis Pub/Sub
```

### Authentication

```text
Keycloak
OIDC
SAML
RBAC
```

### Infrastructure

```text
Docker
Docker Compose
Terraform
GitHub Actions
AWS
```

---

## MCP Tooling — Next.js Devtools

A project-local `.mcp.json` is configured at the repo root with the **`next-devtools-mcp`** server. It exposes live application state to coding agents when the Next.js dev server is running.

```json
// .mcp.json (project root — NOT global)
{
  "mcpServers": {
    "next-devtools": {
      "command": "npx",
      "args": ["-y", "next-devtools-mcp@latest"]
    }
  }
}
```

### When debugging is required

Before falling back to filesystem greps or manual reproduction for any `apps/forge` issue, prefer the MCP tools. They query the running dev server directly.

| Tool                       | Use it for                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `get_errors`               | Current build errors, runtime errors, and TypeScript type errors from the dev server        |
| `get_logs`                 | Path to the dev log file (browser console + server output)                                  |
| `get_page_metadata`        | Routes, components, and rendering details for a specific page                              |
| `get_project_metadata`     | Project structure, configuration, and running dev server URL                                |
| `get_routes`               | All entry-point routes grouped by `appRouter` / `pagesRouter` (dynamic segments preserved)  |
| `get_server_action_by_id`  | Resolve a Server Action ID back to its source file and function name                       |

### Workflow

1. Confirm the Next.js dev server is running (`pnpm --filter forge-dashboard dev` or the `pnpm dev` root script).
2. Call `get_errors` first when investigating a reported bug — live errors beat grep.
3. Use `get_routes` + `get_page_metadata` to confirm where a page or layout actually renders before editing.
4. Cross-check static analysis (`pnpm typecheck`) against `get_errors` — they surface different classes of issues.
5. Only fall back to `Read`/`Grep`/`Bash` when the MCP query returns nothing useful.

### Compatibility note (2026-06-24)

`next-devtools-mcp` officially requires **Next.js 16+**. `apps/forge` is currently on **Next.js 15.0.3**, so MCP capabilities may be partial or non-functional until the Next.js 16 upgrade lands. The `.mcp.json` file is in place regardless; revisit it as part of the Next.js 16 migration plan.

### Scope rules

- This MCP server is **project-local only** (`.mcp.json` at repo root). Do not register it in user-global MCP config.
- Do not add additional MCP servers to `.mcp.json` without an explicit ADR — every server broadens the agent's attack surface and must be justified.

---

## Critical Implementation Rules

These rules are **constitutional**. They precede language, framework, and tooling choices. An AI agent must not generate code that violates any of them.

### Rule 1 — Model-Provider Agnosticism

```text
Forge is model-provider agnostic.

No service may directly depend on:
- OpenAI SDK
- Anthropic SDK
- Gemini SDK

All LLM traffic must flow through
the Forge Provider Abstraction Layer.
```

### Rule 2 — Multi-Tenancy by Default

```text
Forge is multi-tenant by default.

Every query, artifact,
workflow, knowledge graph node,
and audit record must contain:

tenant_id
project_id

Never optional.
```

### Rule 3 — Mandatory Human Approval Gates

```text
Human approval gates are mandatory.

No workflow may cross

Architecture
Security
Deployment

boundaries automatically.
```

### Rule 4 — Typed Artifacts Only

```text
All outputs are typed artifacts.

Agents do not produce free-form data.

Everything becomes:

ADR
API Contract
Task Breakdown
Risk Register
Security Report
Deployment Plan
```

### Rule 5 — Layer Isolation

```text
Organization Knowledge
is shared.

Project Intelligence
is isolated.
```

This is one of Forge's core principles.

### Rule 6 — Mandatory Auditability

```text
All agent activity
must be auditable.
```

Capture:

```text
agent
model
prompt
tool
cost
artifact
timestamp
result
```

### Rule 7 — Mandatory Observability

```text
All agent execution
must be observable.
```

Support:

```text
OpenTelemetry

Tracing

Metrics

Logs
```

from day one.

### Rule 8 — Configurable Everything

```text
Everything configurable.
```

Forge must never assume:

```text
GitHub
Claude
OpenAI
AWS
Jira
```

Users can swap:

```text
GitHub ↔ Bitbucket
Claude ↔ Codex
OpenAI ↔ Bedrock
Jira ↔ Linear
```

without code changes.

---

## Product Architecture Principles

```text
Forge is an Agent Operating System,
not a single SDLC agent.

Forge consists of:

1. Organization Knowledge Layer

2. Project Intelligence Layer

3. Agent Orchestration Layer

4. Delivery Accelerators
   - Ideation
   - Architecture
   - Development
   - Security
   - Testing
   - Deployment

5. Visualization Layer
```

### Stable Top-Level Structure

```text
Forge
├── Organization Knowledge
├── Project Intelligence
├── Agent Center
├── Connector Center
├── Ideation
├── Architecture
├── Development
├── Security
├── Testing
├── Deployment
├── Audit
└── Visualization
```

---

## UI First Principle

```text
Forge is a web platform.

The UI is mandatory.

All capabilities must be visualized.

No feature is considered complete
unless it is accessible through
the Forge UI.
```

Every one of these must be visual:

```text
Knowledge Graph

Repository Graph

Dependency Graph

Workflow Graph

Agent Execution Graph

Audit Timeline

Approval Timeline
```

---

## Project Intelligence First

```text
Project Intelligence precedes automation.

Forge must understand
the project before attempting
to generate architecture,
code, tests, or deployments.
```

This aligns with the Phase 0 decision in the PRD: brownfield ingestion → queryable knowledge graph → automation.

---

## Visualization Requirements

```text
React Flow is the default
visualization framework.

Knowledge relationships
must be explorable as nodes
and edges.

Users should be able to trace:

Requirement
 → ADR
 → Task
 → Code
 → Test
 → Deployment
```

end-to-end.

---

## Pending Categories (to be defined once code lands)

The following step-02 categories remain unfilled because the repository is greenfield. They will be populated by `bmad-generate-project-context` once the codebase establishes conventions, OR by an explicit follow-up session before architecture finalization.

- **Language-Specific Rules** (TypeScript strict mode, Python async patterns, import conventions)
- **Framework-Specific Rules** (Next.js App Router patterns, FastAPI middleware conventions, LangGraph node contracts)
- **Testing Rules** (pytest + Vitest structure, mock conventions, coverage expectations, integration vs. unit boundaries)
- **Code Quality & Style Rules** (ESLint/Prettier/Ruff configs, file/folder layout, naming conventions, doc-comment requirements)
- **Development Workflow Rules** (branch naming, commit message format, PR checklist, deployment gating)
- **Critical Don't-Miss Rules** — _substantively captured by Rules 1–8 above and the constitutional principles; concrete anti-patterns will be added with the first code drop_

---

## Cross-References to Upstream Artifacts

- PRD: `_bmad-output/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` (constitutional NFRs: NFR-001..033, DL-001..011)
- Brief: `_bmad-output/planning-artifacts/briefs/brief-forge-ai-2026-06-18/brief.md`
- Brief→PRD reconciliation: `_bmad-output/planning-artifacts/prds/prd-forge-ai-2026-06-19/reconcile-brief.md`
- PRD architecture-lens review: `_bmad-output/planning-artifacts/prds/prd-forge-ai-2026-06-19/review-architecture.md`
- Open PRD blockers (must resolve before architecture commits): **OQ-005** (deployment topology), **OQ-006** (knowledge graph substrate), **OQ-007** (source-of-truth conflict policy)

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented — Rules 1–8 are constitutional and precede any framework/library defaults
- All LLM traffic must flow through the Forge Provider Abstraction Layer (Rule 1) — never import a provider SDK directly
- Every query, artifact, workflow, knowledge graph node, and audit record must carry `tenant_id` and `project_id` (Rule 2) — never optional, never nullable
- No workflow may cross Architecture, Security, or Deployment boundaries without an explicit human approval gate (Rule 3) — never auto-advance
- Outputs are typed artifacts (Rule 4) — ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan — never free-form blobs
- Organization Knowledge is shared; Project Intelligence is isolated (Rule 5) — never collapse these layers
- Auditability (Rule 6) and observability (Rule 7) are day-one requirements — never defer
- Hardcoded assumptions about GitHub / Claude / OpenAI / AWS / Jira are forbidden (Rule 8) — always use the connector/provider abstraction
- Project Intelligence precedes automation — never generate artifacts before ingestion has built the knowledge graph
- The UI is mandatory — every capability must be visual; React Flow is the default visualization framework
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time
- The 5 pending categories (Language, Framework, Testing, Code Quality, Workflow, Don't-Miss) should be filled in before architecture finalization — but architecture can proceed with constitutional Rules 1–8 already locked
- Resolve OQ-005, OQ-006, OQ-007 before architecture commits decisions that depend on them

Last Updated: 2026-06-24 (added MCP Tooling — Next.js Devtools section)
---

## v2.0 Naming Convention (LOCKED)

**Rule: NO `@fora/*` scope in v2.0 code.**

The `@fora/*` scope indicates Paperclip-era code. The v2.0 platform uses:
- App names: `forge-dashboard` (apps/forge) — no scope
- New packages: `forge-<name>` or `@forge-ai/<name>` (no `@fora/*`)
- Backend (Python): no scope needed

If you encounter `@fora/*` references in active code, you MUST:
1. Archive the code to `archive/paperclip/`
2. Or rename to v2.0 conventions
3. Or remove the reference entirely

Allowed in v2.0: `archive/paperclip/**` (history preservation only).
Forbidden in v2.0: `apps/`, `backend/`, `packages/`, `mcp-servers/`, `scripts/`, `docs/`, `infra/`, root configs.

When in doubt: archive. When certain v2.0 use case: rename. When comment-only: replace with descriptive text.
