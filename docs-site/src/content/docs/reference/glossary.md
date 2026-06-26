---
draft: false
title: Glossary
description: Terminology across Forge, the stack, and the constitutional rules.
---

This page is the canonical glossary for Forge AI terminology. When a term has multiple meanings across the stack, we pick one and note the alternative.

## A

**ADR (Architecture Decision Record)**
A typed artifact (`ADR`) that records a binding architectural decision. Has a fixed schema (context, decision, consequences, alternatives) and a review rubric.

**approval gate**
A checkpoint in a workflow where the orchestrator pauses and waits for a human decision. See [Approval gates](/concepts/approval-gates/).

**artifact**
A typed output of a `forge-*` workflow. There are six typed artifacts: ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan.

**audit ledger**
The append-only PostgreSQL table that records every action. See [Auditability](/concepts/auditability/) and [ADR-008](/architecture/adr-008-worm-audit/).

## C

**CMK (Customer-Managed Key)**
A per-tenant KMS key used for encryption at rest. Required for SOC2-controls posture.

**connector**
An MCP server that wraps an external system. There are 13 first-party connectors. See [MCP servers](/reference/mcp-servers/).

**constitutional rule**
One of eight binding constraints (R1-R8) on the platform. See [Constitutional rules](/concepts/constitutional-rules/).

**cycle time**
The wall-clock time from the start of a workflow run to its completion. A pilot KPI.

## D

**data model change**
A typed artifact (`Data Model Change`) describing a proposed schema change, accompanied by a migration preview.

**deploy plan**
A typed artifact (`DeploymentPlan`) describing a proposed deployment. Pauses at the Deployment gate.

**DL-*** (design lever)
A binding design lever in the PRD. Numbered DL-001, DL-002, etc.

## E

**env (environment)**
A runtime substrate where builds are deployed. The standard progression: dev → staging → prod.

**epic**
A large unit of work spanning multiple workflows. Forge doesn't have an "epic" command; epics are tracked in the source system (Jira, etc.).

## F

**F-*** (functional requirement)
A binding functional requirement in the PRD. Numbered F-001, F-002, etc.

**flag (feature flag)**
A runtime toggle for a feature. Managed per environment.

**flow (workflow)**
A multi-step run composed of multiple `forge-*` commands. Coordinated by `forge-flow-*`.

**forge-* command**
The user-facing name of an internal action. The map is the single source of truth.

## G

**gate**
See approval gate.

**GSDWrapper**
The internal bridge that resolves a `forge-*` name to an internal action and invokes it. **The internal name is never user-facing.**

## H

**hash chain**
The cryptographic chain linking each audit row to the previous. See [ADR-008](/architecture/adr-008-worm-audit/).

**HITL (Human-In-The-Loop)**
The approval gate mechanism. See [Approval gates](/concepts/approval-gates/).

## I

**IDE**
The user's editor (VS Code, Cursor, etc.). The Terminal Center streams CLI tools to the browser, not the IDE.

**incremental ingest**
The default ingest mode where the scanner re-merges rather than replaces.

**isolation**
The property that one tenant's data cannot be read or written by another. Enforced by RLS at the database.

## K

**KPI (Key Performance Indicator)**
A measurable metric used in the pilot. There are seven. See [Success metrics](/operations/success-metrics/).

**knowledge graph**
The Apache AGE + pgvector substrate that fuses code, tickets, docs, and chat. See [Knowledge graph](/concepts/knowledge-graph/).

## L

**layer**
One of two knowledge scopes: Organization Knowledge (tenant-wide) or Project Intelligence (per-project). See [Layer isolation](/architecture/layer-isolation/).

**LLM (Large Language Model)**
The model family called by agents. All LLM calls go through the LiteLLM Proxy.

**LiteLLM Proxy**
The choke point for all LLM traffic. See [ADR-005](/architecture/adr-005-litellm/).

## M

**MCP (Model Context Protocol)**
The protocol used by connectors. See [MCP servers](/reference/mcp-servers/).

**milestone**
A release-tagged bundle of artifacts. See [Milestones commands](/commands/milestones/).

## N

**NFR-*** (non-functional requirement)
A binding non-functional requirement in the PRD. Numbered NFR-001, NFR-002, etc.

## O

**observability**
The discipline of traces, metrics, and logs. Mandatory (R7). See [Observability](/concepts/observability/).

**Organization Knowledge**
The tenant-wide knowledge layer (standards, templates, policies, glossary).

**orchestrator**
The LangGraph runtime that composes agents into workflows. See [ADR-007](/architecture/adr-007-langgraph/).

## P

**PG (PostgreSQL)**
The primary database. PostgreSQL 17 + Apache AGE + pgvector.

**pilot**
A structured 12-week engagement that takes a tenant from blank slate to sustained TTTD improvement. See [Pilot program](/guides/pilot-program/).

**Project Intelligence**
The per-project knowledge layer (services, APIs, DBs, dependencies, ADRs, tasks).

## R

**R1-R8**
The eight constitutional rules. See [Constitutional rules](/concepts/constitutional-rules/).

**requires_approval**
A flag on a command that pauses execution at the HITL gate.

**Risk Register**
A typed artifact scoring change risk across axes (blast radius, data integrity, security, perf, compliance).

**RLS (Row-Level Security)**
PostgreSQL feature used to enforce tenant isolation at the database level.

**rubric**
The scoring template for a typed artifact. Per-section weights + composite threshold.

## S

**SDLC (Software Development Lifecycle)**
The end-to-end process of building software. Forge is an SDLC OS.

**SDLCState**
The Pydantic state object held by the orchestrator for a workflow run.

**Security Report**
A typed artifact with security findings and policy check results. Finalized only by a human.

**Steward**
A role responsible for resolving knowledge conflicts and promoting durable rules.

## T

**Task Breakdown**
A typed artifact listing the tasks required to implement a feature.

**tenant**
A single customer organization. Multi-tenancy is enforced by RLS.

**Terminal Center**
The browser-based terminal UI powered by xterm.js and native PTY. See [ADR-006](/architecture/adr-006-terminal-pty/).

**tier**
One of `user`, `admin`, `system`. Determines who can invoke a command.

**TTTD (Time To Typed Draft)**
The wall-clock time from "I need an X" to "X is at the level of fidelity required for human review". The pilot north star.

**typed artifact**
A structured output of a `forge-*` workflow. There are six.

## V

**virtual key**
A per-tenant key used by the LiteLLM Proxy to authenticate calls. Maps to one or more real provider keys.

## W

**white-labeling**
The rule that internal implementation names never appear in user-facing surfaces. Enforced by the `forge-*` namespace and runtime regex. See [ADR-004](/architecture/adr-004-white-label/).

**workflow**
A multi-step run composed of multiple `forge-*` commands. Coordinated by `forge-flow-*`.

## Related

- [What is Forge?](/start-here/what-is-forge/)
- [Constitutional rules](/concepts/constitutional-rules/)
- [Architecture overview](/architecture/overview/)
