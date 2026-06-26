---
draft: false
title: The Agent Operating System
description: How Forge plays the role of an operating system for AI agents.
---

An "agent operating system" treats agents the way a kernel treats processes: scheduled, isolated, observable, and accountable. This page explains how Forge plays that role.

## What is this?

Forge is the runtime underneath one or more AI agents. The agent doesn't manage its own memory, I/O, scheduling, or audit — Forge does. The agent gets a typed prompt, returns a typed output, and the runtime handles everything in between.

Concretely:

| Kernel role | Forge role |
|---|---|
| Process table | `SDLCState` registry per workflow run |
| Scheduler | LangGraph orchestrator decides next node |
| Memory | Project intelligence knowledge graph |
| Filesystem | Append-only artifact registry |
| Syscall | `forge-*` command invocation |
| Signals | HITL gate, retry, cancellation |
| /proc | Audit ledger + OpenTelemetry spans |

## Why does it exist?

Single agents have three structural problems:

1. **No shared state.** Each call is stateless. Two agents cannot reason about each other's outputs.
2. **No isolation.** A buggy tool call can corrupt the underlying data store with no rollback.
3. **No audit.** The user sees the answer, not the reasoning, the prompt, the cost, or the tool calls.

An agent operating system fixes all three:

- **Shared state** through a typed artifact registry and a knowledge graph.
- **Isolation** through per-tenant RLS, per-workflow checkpoints, and an approval gate at boundaries.
- **Audit** through the append-only ledger, with prompt hash, result hash, cost, and chain hash on every row.

## What problem does it solve?

| Without an OS | With Forge as the OS |
|---|---|
| Agent A writes to disk; Agent B reads stale state | Both read and write through the knowledge graph with optimistic concurrency |
| Cost is unknown until the bill arrives | Every LLM call is attributed in real time to a tenant, project, and workflow |
| Approval happens in chat | Approval is a typed event in the audit ledger |
| Resume requires starting over | LangGraph checkpoints let a workflow resume from the last successful node |
| The agent hallucinates a contract | The HITL gate between architecture and development catches it |

## How does it work?

Forge's runtime has three runtime layers:

```text
+-------------------------------------------------------------+
|  1. Orchestrator (LangGraph)                                 |
|     - SDLCState (Pydantic v2) per workflow run              |
|     - Checkpointing to PostgreSQL (resumable)               |
|     - HITL gate nodes                                       |
+-------------------------------------------------------------+
|  2. Tool layer (forge-* commands)                           |
|     - 63 commands across 13 categories                      |
|     - White-labeled via FORGE_COMMAND_MAP                   |
|     - Tiered: user / admin / system                         |
+-------------------------------------------------------------+
|  3. Connector layer (MCP servers)                           |
|     - 13 first-party connectors                             |
|     - Failure states: pending / live / degraded / down      |
|     - Each connector audited                               |
+-------------------------------------------------------------+
```

The orchestrator uses LangGraph's `StateGraph` to compose nodes. Each node is either an LLM call, a tool call (`forge-*`), or a human approval. Conditional edges route the workflow based on approval decisions and tool outputs.

## How do I use it?

Most users don't write orchestrator code. They invoke a `forge-*` command and the runtime handles composition. Two cases where you touch the OS directly:

1. **Adding a custom agent.** See [Custom agents](/guides/custom-agents/).
2. **Extending the command map.** See [forge-* commands](/reference/forge-commands/) → "How to extend".

If you are a platform engineer tuning the runtime, the canonical reference is [ADR-007](/architecture/adr-007-langgraph/).

## When should I use this concept?

Use the agent OS framing when:

- Explaining why Forge is more than an agent.
- Designing a custom agent that needs to compose with existing ones.
- Diagnosing why a workflow paused, retried, or failed — the OS gives you the trace.

## Related

- [What is an SDLC OS?](/concepts/what-is-sdlc-os/)
- [Approval gates](/concepts/approval-gates/)
- [Knowledge graph](/concepts/knowledge-graph/)
- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
