---
draft: false
title: What is an SDLC Operating System?
description: The category of software Forge belongs to, and why "operating system" is the right frame.
---

"Operating system" is a strong claim. This page explains what we mean by it, what an SDLC OS does that a tool or a single agent doesn't, and how Forge fits the category.

## What is this?

An **SDLC Operating System** is software that orchestrates the *processes* of software delivery — discovery, ideation, architecture, development, testing, security, deployment, learning — the way a traditional OS orchestrates processes, memory, I/O, and the network.

| Layer | Traditional OS | SDLC OS |
|---|---|---|
| Process | A binary running on a CPU | A multi-agent workflow run |
| Memory | RAM pages with addresses | A project intelligence knowledge graph |
| I/O | Files, sockets, devices | Connectors to GitHub, Jira, Confluence, etc. |
| Scheduler | Kernel scheduler | LangGraph orchestrator |
| Security model | Permissions, ACLs | RBAC + RLS + per-tenant KMS CMK |
| Audit | Syslog, auditd | Append-only ledger with hash chain |
| User-facing shell | bash, zsh | The Forge Command Center |

The metaphor is not decorative. It implies specific properties:

- **Process isolation** — one tenant's work cannot touch another tenant's.
- **Resource accounting** — every process (workflow run) has a measurable cost.
- **State persistence** — workflows survive crashes and resume from checkpoints.
- **Privileged operations** — destructive actions require a gate.

## Why does it exist?

Most "AI for software" products are **single agents** — a chatbot in an IDE, a code completion box, a "what should I deploy?" assistant. Single agents don't compose. They don't share context. They don't enforce governance.

An SDLC OS is the missing layer underneath. It composes agents, captures context once, and enforces governance by construction.

## What problem does it solve?

| Problem | Single-agent answer | SDLC OS answer |
|---|---|---|
| "Two agents disagree on the contract" | Whichever ran last wins | A typed-artifact pipeline with an approval gate between them |
| "Who approved this deploy?" | Nobody — the agent did | A HITL gate with an audit row attached to the approval |
| "How much did this workflow cost?" | Unknown | Per-tenant cost ledger, attributed by workflow |
| "What does this service do?" | The LLM will guess | The knowledge graph has the authoritative answer |
| "Where is our audit trail?" | It isn't | Append-only ledger with daily hash chain anchors |

## How does it work?

Forge is one specific SDLC OS. It is built on the eight constitutional rules — see [Constitutional rules](/concepts/constitutional-rules/). It composes:

- A **knowledge graph** (PostgreSQL 17 + Apache AGE + pgvector) — see [Knowledge graph](/concepts/knowledge-graph/).
- An **agent runtime** (LangGraph) — see [Agent operating system](/concepts/agent-operating-system/).
- A **typed-artifact pipeline** (six typed outputs) — see [Typed artifacts](/concepts/typed-artifacts/).
- **HITL approval gates** — see [Approval gates](/concepts/approval-gates/).
- A **white-labeled command surface** — see [White-label commands](/concepts/white-label-commands/).
- An **append-only audit ledger** — see [Auditability](/concepts/auditability/).
- **Multi-tenancy** by default — see [Multi-tenancy](/concepts/multi-tenancy/).
- **OpenTelemetry** observability — see [Observability](/concepts/observability/).

## When should I use this concept?

Use the SDLC OS framing when:

- You're evaluating Forge against a single-agent product and need a category frame.
- You're designing a competing or adjacent platform and want to reason about scope.
- You're explaining Forge to a stakeholder who has not seen an AI-orchestration product before.

Don't use the SDLC OS framing if you want to discuss one specific component — go straight to the relevant concept page.

## Related

- [What is Forge?](/start-here/what-is-forge/)
- [Agent operating system](/concepts/agent-operating-system/)
- [Constitutional rules](/concepts/constitutional-rules/)
- [Architecture overview](/architecture/overview/)
