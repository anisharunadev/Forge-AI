# Architecture Overview

> Forge is an Agent Operating System, not a single SDLC agent.

## Layers

```text
Forge consists of:

1. Organization Knowledge Layer   (shared, Org-scoped)
2. Project Intelligence Layer     (isolated, Project-scoped)
3. Agent Orchestration Layer      (forge-core + forge-pi + forge-browser)
4. Delivery Accelerators
5. Visualization Layer
```

The 5 layers **must not be collapsed**. Rules R2 (multi-tenancy) and R5 (layer isolation) bind here.

## The 3-Package Spec-Driven Architecture

```text
┌─────────────────────────────────────────────────┐
│                  Forge UI (Next.js)             │
│         Dashboard, Co-pilot, Command Center     │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
   │ forge-  │  │ forge-  │  │ forge-  │
   │  core   │  │   pi    │  │ browser │
   │Workflow │  │ Product │  │ Visual  │
   │ methods │  │ Intel   │  │  Auto   │
   └─────────┘  └─────────┘  └─────────┘
        │            │            │
        └────────────┼────────────┘
                     │
            ┌────────▼────────┐
            │   Forge Backend │
            │     (FastAPI)   │
            │   + LiteLLM     │
            └─────────────────┘
```

| Package | Role |
|---|---|
| `forge-core` | Workflow methodology. Skills, agents, commands for the SDLC. |
| `forge-pi` | Product intelligence. Codebase scanning, knowledge graph, ideation. |
| `forge-browser` | Visual automation. UI review, visual testing, accessibility. |

Naming convention (3-package naming): see `docs/naming-conventions.md`.

## Stable top-level structure

The top-level navigation surface (Dashboard, Co-pilot, etc.) is the **public** structure. Internal packages and infra may change; this list does not.

```text
Forge
├── Dashboard (mission control)
├── Co-pilot (floating AI assistant, ⌘J)
├── Agent Center
├── Project Intelligence
├── Stories (kanban)
├── Workflows (visual builder)
├── Knowledge Center (Obsidian-style graph)
├── Artifacts (Organization Knowledge — F-001 to F-005)
├── Ideation (continuous context orchestration)
├── Architecture Center (ADRs, APIs, tasks, risks, traceability)
├── Connectors (marketplace + credentials)
├── Onboarding (AI-powered wizard)
├── Governance (policies, guardrails, LiteLLM, standards)
├── Audit (tamper-evident ledger)
├── Analytics
├── Terminal (multi-CLI xterm.js)
├── Runs
├── Command Center (GSD conductor)
└── Settings
```

If you add a new top-level surface, propose it in `docs/goals/` first and link from `docs/features/`.
