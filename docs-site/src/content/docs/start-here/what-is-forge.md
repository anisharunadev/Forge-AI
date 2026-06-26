---
draft: false
title: What is Forge AI?
description: A high-level introduction to Forge AI — the enterprise SDLC Agent Operating System.
---

Forge AI is an enterprise SDLC Agent Operating System. It ingests your repositories, documentation, and ticketing systems into a project intelligence knowledge graph, then orchestrates agents, governance, and delivery workflows on top of that graph.

## What is this?

Forge is **not** an AI agent. Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.

The platform exposes **63 production-grade commands** under a single `forge-<area>-<verb>` namespace, grouped into 13 categories. Every command produces a **typed artifact** (ADR, API Contract, Task Breakdown, Risk Register, Security Report, or Deployment Plan) and lands in a tamper-evident **audit ledger**.

Forge runs against a tenant-scoped data plane (PostgreSQL 17 with Apache AGE for the knowledge graph and pgvector for embeddings) and a separate **audit account** in AWS. Every action — agent invocation, model call, prompt, tool, cost, timestamp, result — is captured under a daily hash chain.

## Why does it exist?

Modern software delivery is fragmented across dozens of tools that don't share context. AI agents accelerate individual tasks but don't compose into a governed pipeline. The result: hallucinated contracts, skipped reviews, opaque cost, and untraceable decisions.

Forge solves this by treating software delivery as a **first-class operating-system problem**:

- A shared knowledge layer that fuses code, tickets, docs, and chat.
- A typed-artifact pipeline that makes every deliverable reviewable.
- Mandatory human approval gates at architecture, security, and deployment boundaries.
- An append-only audit trail that satisfies SOC2-controls posture and pen-test readiness.

The north star is **Time To Trusted Delivery** — the wall-clock time from "I need an X" to "X is at the level of fidelity required for human review".

## How does it work?

Forge is anchored by eight constitutional rules:

| # | Rule | What it means |
|---|---|---|
| R1 | Model-provider agnostic | All LLM traffic through the LiteLLM Proxy — no vendor lock-in |
| R2 | Multi-tenancy by default | `tenant_id` + `project_id` + RLS on every record |
| R3 | Mandatory approval gates | HITL at architecture, security, deployment boundaries |
| R4 | Typed artifacts only | ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan |
| R5 | Layer isolation | Org Knowledge shared, Project Intelligence isolated |
| R6 | Mandatory auditability | Every action lands in the append-only ledger |
| R7 | Mandatory observability | OpenTelemetry traces, metrics, logs from day one |
| R8 | Configurable everything | No hardcoded GitHub/Claude/AWS/Jira assumptions |

The user-facing surface is a Next.js 15 console with three primary workspaces: **Command Center**, **Terminal Center**, and **Knowledge Center**. Underneath, a FastAPI backend hosts a LangGraph SDLC orchestrator that drives multi-agent workflows with checkpointing for resumability.

## How do I use it?

The fastest path is the [Quickstart](/start-here/quickstart/). The longer path is:

1. Read the [architecture tour](/start-here/architecture-tour/) to map concepts onto the system.
2. Skim the [Concepts](/concepts/what-is-sdlc-os/) section for the vocabulary.
3. Browse the [Command reference](/commands/) to see what's runnable.
4. Stand up the stack locally and run `forge-onboard-detect-stack`.

## When should I use it?

Use Forge when:

- You ship software continuously and need traceability from idea to deploy.
- You operate multi-tenant SaaS and need per-tenant cost attribution, isolation, and audit.
- You want AI agents in your delivery loop without losing human review.
- Your customers ask for SOC2-controls posture, pen-test readiness, and per-tenant encryption key custody.

Don't use Forge when:

- You ship a single monolith with one team and one cloud — the overhead exceeds the value.
- You need a single AI agent with no governance, observability, or multi-tenant boundary — a CLI tool will do.

## Related

- [Why Forge?](/start-here/why-forge/) — the motivation in depth
- [Quickstart](/start-here/quickstart/) — from clone to running in 15 minutes
- [Architecture tour](/start-here/architecture-tour/) — concepts mapped onto components
- [Concepts → What is an SDLC OS?](/concepts/what-is-sdlc-os/)
