---
title: "The 3-Package Spec-Driven Stack"
description: "How forge-core, forge-pi, and forge-browser compose into the Forge AI Agent OS."
---

# The 3-Package Spec-Driven Stack

Forge is built from three independently installable workspace packages.
Each package ships its own typed catalog, skills, agents, and commands.
The Command Center reads all three and groups them by package tab.

## The three packages

| Package | Purpose | Where it shines |
|---|---|---|
| [`@forge-ai/forge-core`](/forge/packages/forge-core/) | Workflow methodology — capture, explore, execute, verify | Every workflow, the 7 GSD phases, ticket → execute → deploy |
| [`@forge-ai/forge-pi`](/forge/packages/forge-pi/) | Product intelligence — codebase scanning, knowledge graph, idea scoring, PRD generation | Ideation Center, Customer Voice, Market Signals, Project Intelligence |
| [`@forge-ai/forge-browser`](/forge/packages/forge-browser/) | AI browser automation — visual testing, UI review, screenshot analysis, accessibility audits | Verify phase, UI review, deployment verification, QA audit |

## Architecture diagram

```text
                          ┌───────────────────────────────────────┐
                          │          Forge Command Center         │
                          │  (packages tabs: core / pi / browser) │
                          └───────────────┬───────────────────────┘
                                          │ invokes
                ┌─────────────────────────┼──────────────────────────┐
                │                         │                          │
        ┌───────▼──────┐         ┌────────▼─────────┐        ┌───────▼──────────┐
        │  forge-core  │         │    forge-pi      │        │  forge-browser   │
        │  (workflow)  │         │  (intelligence)  │        │  (visual auto)   │
        └──────┬───────┘         └────────┬─────────┘        └────────┬─────────┘
               │                          │                           │
   ┌───────────▼──────────┐    ┌───────────▼──────────────┐   ┌────────▼──────────┐
   │ skills/commands/     │    │ scanner / knowledge-graph│   │ browser agent /   │
   │ agents (vendored     │    │ idea-scorer / customer-  │   │ visual-test / ui- │
   │ from open-gsd/gsd)   │    │ voice / market-signals / │   │ review / a11y /   │
   │                      │    │ prd-generator            │   │ deploy-verify     │
   └──────────────────────┘    └──────────────────────────┘   └───────────────────┘
               │                          │                           │
               └──────────────────────────┼───────────────────────────┘
                                          │
                              ┌───────────▼────────────┐
                              │   Forge surface apps   │
                              │  Ideation / PI / Co-   │
                              │  pilot / Architecture  │
                              │  / Audit / UAT / Deploy│
                              └────────────────────────┘
```

## The pipeline

```text
Ticket (Jira)
   ↓  forge-pi  (score, cluster, draft PRD)
   ↓  forge-core (capture → explore → execute)
   ↓  forge-browser (visual verify, UI review)
Deploy
```

## Installability

Each package is **optional by design**:

- `forge-core` is always wired (it carries the methodology).
- `forge-pi` is optional — when missing, the Ideation Center degrades to its
  in-memory stub data.
- `forge-browser` is optional — when missing, the Verify phase falls back to
  manual review.

Each package ships its own typed catalog (`{package}.catalog.json`). The
Forge Command Center imports each one at build time and merges them into a
single command list. Tabs in the picker dim to "not installed" when their
backing package is absent.

## New agents (Step 45)

Three cross-cutting agents register in the Agent Center and are invokable
from multiple surfaces:

| Agent | Backing package | Invokable from |
|---|---|---|
| **PM Agent** | `forge-pi` | Ideation Center, Command Center, Co-pilot |
| **QA Agent** | `forge-browser` | Stories (PR linked), Code Review, Deploy phase |
| **Canary Agent** | `forge-browser` | Deploy workflow, Analytics Center |

These are first-class agents, not features. They carry the `package` badge
so the Agent Center can group them under the right 3-package tab.

## Cross-references

- [`@forge-ai/forge-core`](/forge-core/) — workflow methodology
- [`@forge-ai/forge-pi`](/forge-pi/) — product intelligence
- [`@forge-ai/forge-browser`](/forge-browser/) — browser automation
- [Layer isolation](/architecture/layer-isolation/) — Organization vs Project Intelligence
- [Components](/architecture/components/) — every Forge subsystem
- [Data flow](/architecture/data-flow/) — how a request moves through the stack