# UI Patterns & Principles

> Rules R12-R17 plus the UI-first principle and the Pattern Library.
> See `CLAUDE.md` for the canonical 18 rules.

## UI-first principle

```text
Forge is a web platform.

The UI is mandatory.

All capabilities must be visualized.

No feature is considered complete
unless it is accessible through
the Forge UI.
```

## The Pattern Library

Every screen uses one (or more) of these patterns. New patterns require an ADR.

| # | Pattern | Where |
|---|---|---|
| 1 | FLOATING FAB (Co-pilot) | Persistent bottom-right, ⌘J |
| 2 | COLLAPSIBLE RAILS | Complex screens (Workflows, Terminal, Knowledge) |
| 3 | BENTO GRID | Dashboard, Overview tabs (mixed-size tiles) |
| 4 | MASTER-DETAIL | Agents, Stories, Architecture, Knowledge |
| 5 | KANBAN | Stories, Ideation (drag-drop with @dnd-kit) |
| 6 | TIMELINE | Runs, Workflow execution, Ideation roadmap |
| 7 | EMPTY STATE WITH VALUE | Every empty state (Rule 15) |
| 8 | KNOWLEDGE GRAPH | Knowledge Center (react-force-graph-2d, planned) |
| 9 | COMMAND PALETTE | ⌘K, `forge-*` skills, navigation |
| 10 | NOTIFICATION POPOVER | Bell icon in top bar |
| 11 | CONTEXT INJECTION | Terminal sessions get story context |
| 12 | DUAL-PANE | Terminal (sessions + context preview) |

## Required visualizations

Every one of these must be visual:

```text
Knowledge Graph (Obsidian-style, with backlinks)        — R14
Repository Graph
Dependency Graph
Workflow Graph (React Flow visual builder)
Agent Execution Graph
Audit Timeline
Approval Timeline
Architecture Diagrams (C4 + custom)
Connector Sync Graph
Spec-Driven Pipeline (Ticket → Run)                      — R17
```

## Project Intelligence First

```text
Project Intelligence precedes automation.

Forge must understand
the project before attempting
to generate architecture,
code, tests, or deployments.
```

This is powered by `forge-pi` (Rule 10).
