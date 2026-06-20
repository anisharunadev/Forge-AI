---
title: Architecture Decision Records
description: Every ADR — the one-way-door decisions that shape the platform.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/adr-registry.md
generator: adr
approval_required: false
---

The **ADR index** — every Architecture Decision Record that has shaped Forge AI. The full list lives in [`workspace/project/adr-registry.md`](https://github.com/fora-platform/fora/blob/main/workspace/project/adr-registry.md) and the docs in `docs/adr/`.

## What is an ADR

An ADR is **one decision, one doc, immutable once accepted**. The format (per [`memory/architecture.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md)):

```markdown
# NNNN — <Title>

- **Status:** proposed | accepted | superseded | deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <names or agent-ids>
- **Supersedes:** NNNN (if applicable)
- **Superseded by:** NNNN (if applicable)

## Context
<the situation, the forces in play, the constraint>

## Decision
<the choice we are making, in one sentence>

## Consequences
<what becomes easier, what becomes harder, what we accept>

## Alternatives considered
<the other options we rejected and why>
```

## The v1 ADR candidates

From [`workspace/project/tech-stack.md` §16](https://github.com/fora-platform/fora/blob/main/workspace/project/tech-stack.md), the only stack ADRs permitted to land during the v1 window:

| ADR | Title | Status | Why it is a one-way door |
| --- | --- | --- | --- |
| **ADR-0001** | Anthropic as primary model provider, OpenAI as backup | proposed | Vendor concentration; changing it later rewrites every prompt contract |
| **ADR-0002** | Anthropic SDK + OpenAI SDK (no LangChain) | proposed | Lock-in to a framework that has churned historically |
| **ADR-0003** | AWS-only in v1; Azure/GCP deferred | proposed | IAM + secrets + observability story is materially different per cloud |
| **ADR-0004** | pgvector in v1; no managed vector DB | proposed | One less service; revisit at Q2 2027 if corpus outgrows pgvector |
| **ADR-0005** | Fastify + Next.js + Python (no Go/Rust/Java) | proposed | Org learning curve; three languages is the max |
| **ADR-0006** | BullMQ + Argo Workflows (no Temporal) in v1 | proposed | Operational lift; revisit at Q1 2027 if limits bite |
| **ADR-0007** | OIDC + custom RBAC (not Auth0/Clerk) | proposed | Stage-gate enforcement needs fine-grained roles those products do not model |

The CTO opens these; the relevant sub-team lead co-signs.

## The acceptance criteria

- **One ADR per decision.** If you are writing more than one decision per ADR, split it.
- **The CTO signs every one-way door ADR.** A two-way door ADR can be merged by the relevant sub-team lead.
- **An ADR is immutable once accepted.** If we change our mind, we write a new ADR that supersedes it. We never edit history.
- **A handoff with no `version`, no `example`, or no `sla` is rejected at PR review.**

## The current ADRs

| # | Title | Status | Date |
| --- | --- | --- | --- |
| 0001 | Knowledge layer storage contract for the Documentation Agent | accepted | 2026-06-17 |
| 0002 | Stage engine port + gRPC adapter | accepted | 2026-06-17 |

The full list is in `docs/adr/`.

## When to open an ADR

Open an ADR when the change touches:

- The data model
- The auth or tenancy model
- The audit log schema
- The agent handoff contract
- The staged workflow (add/remove/reorder a stage)
- A new managed service
- A new language

A change that doesn't touch any of the above is a **two-way door** — ships fast, no ADR required.

## Where to next

- **[Glossary →](/reference/glossary/)** — every term defined.
- **[Architecture overview →](/architecture/)** — the design bar.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/adr-registry.md</code> + <code>docs/adr/</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>adr</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
