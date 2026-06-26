---
draft: false
title: Data Flow
description: Sequence diagrams for the canonical SDLC flows — discovery, ideation, deploy, rollback.
---

This page walks the canonical data flows through the Forge architecture. Use it to understand what happens when a `forge-*` command runs and which components are involved.

## What is this?

A sequence-diagram-oriented reference. Each flow shows the components, the messages, and the audit row. Use it to debug, plan capacity, or design a new agent.

## Flow 1 — Discovery (forge-intel-scan-repo)

```text
User          Browser       Backend       Orchestrator   Intel Agent   Postgres    Audit Ledger
 |               |             |               |              |             |             |
 |--submit------>|             |               |              |             |             |
 |               |--POST------>|               |              |             |             |
 |               |             |--spawn------>|              |             |             |
 |               |             |               |--invoke----->|             |             |
 |               |             |               |              |--read------>|             |
 |               |             |               |              |<--rows------|             |
 |               |             |               |              |--write-------------------------->|
 |               |             |               |              |--write---->|             |
 |               |             |               |              |             |--write-------------------->|
 |               |             |               |<--result-----|             |             |
 |               |             |<--artifact----|              |             |             |
 |               |<--JSON------|               |              |             |             |
 |<--render------|             |               |              |             |             |
```

What happens:

1. The user submits a `forge-intel-scan-repo` command from the Command Center.
2. The backend validates the JWT, sets `app.tenant_id`, and spawns an orchestrator run.
3. The orchestrator instantiates the Intel agent with the SDLCState.
4. The agent reads from the project intelligence tables and writes new graph nodes.
5. Every read and write produces an audit row.
6. The artifact (a graph diff) returns to the user.

## Flow 2 — Architecture with approval gate

```text
User        Browser    Backend    Orchestrator    Arch Agent    LiteLLM     Postgres     HITL
 |             |          |            |              |             |            |          |
 |--submit---->|          |            |              |             |            |          |
 |             |--POST--->|            |              |             |            |          |
 |             |          |--spawn--->|              |             |            |          |
 |             |          |           |--invoke----->|             |            |          |
 |             |          |           |              |--prompt--->|            |          |
 |             |          |           |              |<--result----|            |          |
 |             |          |           |              |--write-->|            |          |
 |             |          |           |              |--write-->|            |          | (audit)
 |             |          |           |              |--write------------------------------------>|
 |             |          |           |              |--hitl gate-|            |          |
 |             |          |           |              |             |            |          |
 |<--paused----|          |           |              |             |            |          |
 |             |          |           |              |             |            |          |
 |  ... human reviewer logs in, opens the Command Center ...        |            |          |
 |             |          |           |              |             |            |          |
 |             |--approve>|          |              |             |            |          |
 |             |          |--resume->|              |             |            |          |
 |             |          |           |--emit---->|            |          |          |
 |<--done------|<---------|          |              |             |            |          |
```

What happens:

1. The user submits `forge-arch-adr`.
2. The orchestrator runs the Arch agent, which calls the LiteLLM Proxy and writes the typed artifact.
3. The orchestrator hits the HITL gate and pauses.
4. The artifact is marked `in_review`.
5. A human reviewer opens the Command Center and approves.
6. The orchestrator resumes and emits the audit row.

## Flow 3 — Deployment with canary

```text
Release Mgr    Browser    Backend    Orchestrator   Deploy Agent   LiteLLM   ECS / RDS    Audit
    |             |          |            |              |            |          |            |
    |--forge-deploy-prod--->|            |              |            |          |            |
    |             |          |--spawn--->|              |            |          |            |
    |             |          |           |--plan------>|            |          |            |
    |             |          |           |<--plan-------|            |          |            |
    |             |          |           |--hitl gate----------------------------------|         |
    |             |          |           |              |            |          |            |
    |--approve---->|          |          |              |            |          |            |
    |             |          |--resume->|              |            |          |            |
    |             |          |           |--canary 5%->|            |          |            |
    |             |          |           |              |            |          |--rollout-->|
    |             |          |           |              |            |          |--health-->|
    |             |          |           |<--ok---------|            |          |            |
    |             |          |           |--canary 50%------------->|          |            |
    |             |          |           |--canary 100%------------>|          |            |
    |             |          |           |--emit final plan ---------------------------->|        |
    |<--done-------|<---------|          |              |            |          |            |
```

What happens:

1. The release manager invokes `forge-deploy-prod` with canary settings.
2. The orchestrator produces a Deployment Plan typed artifact.
3. The HITL gate pauses for approval.
4. After approval, the orchestrator drives the canary: 5% → 50% → 100%.
5. Each stage emits health checks and audit rows.
6. The final state is recorded in the ledger.

## Flow 4 — Rollback

```text
On-call    Browser    Backend    Orchestrator   Rollback Agent    ECS / RDS    Audit
   |          |          |            |                |              |            |
   |--forge-deploy-rollback->|        |                |              |            |
   |          |          |--spawn--->|                |              |            |
   |          |          |           |--resolve-->|              |            |
   |          |          |           |            target = last good |            |
   |          |          |           |--hitl gate---------------------------|         |
   |          |          |           |                |              |            |
   |--approve>|          |          |                |              |            |
   |          |          |--resume->|                |              |            |
   |          |          |           |--promote previous build------>|            |
   |          |          |           |<--ok----------|              |            |
   |          |          |           |--emit rollback event-------------------->|       |
   |<--done---|<---------|          |                |              |            |
```

What happens:

1. The on-call invokes `forge-deploy-rollback` with a reason and the target build.
2. The orchestrator resolves the target build and pauses at the gate.
3. After approval, the orchestrator promotes the previous build.
4. The rollback event is audited.

## Flow 5 — Knowledge graph conflict

```text
Steward       Browser   Backend   Orchestrator   Conflict Agent   Postgres   Audit
   |             |         |           |                |            |          |
   |<--alert-----|         |           |                |            |          | (KG flagged a conflict)
   |             |         |           |                |            |          |
   |--open Steward queue-->|           |                |            |          |
   |             |         |           |                |            |          |
   |--inspect node------->|           |                |            |          |
   |             |         |--fetch-->|                |            |          |
   |             |         |         |--read--------->|            |          |
   |             |         |         |                |--read---->|          |
   |             |         |         |                |<--both----|          |
   |             |         |         |<--node, both sides--|       |          |
   |<--render side-by-side--|         |                |            |          |
   |             |         |           |                |            |          |
   |--accept side A-------->|         |                |            |          |
   |             |         |--resolve>|                |            |          |
   |             |         |         |--write----------|            |          |
   |             |         |         |--emit---------------------------->|      |
   |<--done-------|         |           |                |            |          |
```

What happens:

1. The KG surfaces a conflict (e.g., code says port 8080, Confluence says 9090).
2. The Steward opens the queue.
3. The orchestrator fetches both sides of the conflict.
4. The Steward picks a winner.
5. The orchestrator writes the resolution and audits it.

## Related

- [Architecture overview](/architecture/overview/)
- [Components](/architecture/components/)
- [Layer isolation](/architecture/layer-isolation/)
- [Approval model](/architecture/approval-model/)
