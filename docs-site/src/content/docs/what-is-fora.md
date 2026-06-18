---
title: What is Forge AI?
description: Forge AI explained in one page — what it does, who it's for, and what it isn't.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/PRD.md
generator: readme
approval_required: false
---

## In one sentence

**Forge AI is the Enterprise AI SDLC Operating System** — a single platform that takes a product idea from a one-line prompt to a deployed, documented, audited change in your SDLC.

## The problem

Enterprise engineering orgs pay a compounding tax on every change:

- **Coordination cost** between PM, BA, architect, developer, QA, security, DevOps, and docs.
- **Context loss** between hand-offs (the PRD says one thing, the PR does another, the runbook is out of date).
- **Compliance friction** that scales linearly with headcount and slows every change.
- **Tool sprawl** — the average enterprise uses 8+ SDLC tools, none of which talk to each other in a way the audit can verify.

Existing solutions fragment the problem: code-review bots that don't see the PRD; AI pair programmers that don't see the ADR; project-management AI that doesn't see the PR. **None of them closes the loop.**

## The Forge AI shape

```
                       Master Orchestrator
                              │
        ┌────────────┬────────┴───────┬────────────┐
        │            │                │            │
   Ideation     Architect           Dev          ...
   Agent        Agent             Agent
        │            │                │
   ┌────┴───┐   ┌────┴───┐      ┌────┴───┐
   BA  Cost  Refactor  Arch  ...   Dev QA Sec DevOps Docs
```

The **Master Orchestrator** sits at the top. It owns run lifecycle, tenant context, and budget enforcement. Under it sit the SDLC Agents — one per project — and under each sit the specialist sub-agents.

**The org chart and the runtime topology are the same diagram.** If a box exists in one, it exists in the other. See [`workspace/memory/architecture.md`](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md) for the full architecture contract.

## What Forge AI delivers

| Value prop | What it replaces | How Forge AI delivers |
| --- | --- | --- |
| **One source of truth per fact** | Spreadsheet of spreadsheets | Knowledge Layer (`workspace/`) + agent reads, not writes (v1) |
| **Auditable AI actions** | "What did the bot do?" | Append-only audit log, cross-account, per `tenant_id` / `run_id` / `stage` / `tool` / `actor` |
| **Staged workflow with real gates** | Jira status fields nobody updates | Master Orchestrator enforces the gates, not the humans |
| **MCP-native integration** | Custom one-off integrations | First-class MCP server per tool, per tenant |
| **Cost transparency per run** | A surprise AWS bill | Token + cost ceiling, per-tenant, per-run, per-stage |

## What Forge AI is **not**

- ❌ **Not a new code editor / IDE.** We integrate with what you have.
- ❌ **Not a new project-management tool.** We integrate with Jira (priority 1) and add others.
- ❌ **Not a new CI/CD product.** We orchestrate GitHub Actions, ArgoCD, and your existing pipeline.
- ❌ **Not a new model provider.** We are model-agnostic; the customer can pick the provider per tenant.
- ❌ **Not a new secret store.** We integrate with AWS Secrets Manager, HashiCorp Vault, and Doppler.
- ❌ **Not a new vector DB.** We use pgvector (in your DB) for v1; a managed vector DB is a v2 conversation.

## Who it's for

### Primary ICP (initial design partners)

- Series-B-to-Series-D SaaS companies with 50–500 engineers.
- An engineering org that has outgrown Slack-and-spreadsheets but isn't yet ready for a Platform Engineering team.
- A CISO who has mandated "every change must be auditable" but doesn't have the headcount to enforce it.
- A CTO who has bought one AI coding tool and is already tired of the "where is the audit" question.

### Out of scope (v1)

- **Pre-Series-A startups.** They don't have the SDLC pain yet.
- **Fortune 500 with bespoke compliance regimes** (FedRAMP, HIPAA, PCI-DSS). They are roadmap, not v1.
- **Non-software engineering orgs** (civil engineering, biotech lab work). The model is wrong.

## Next steps

- [Quickstart →](/quickstart/) — Run Forge AI in dev mode in under 5 minutes.
- [Self-host on AWS →](/self-host/aws/) — Stand up your own tenant on EKS.
- [Agents →](/agents/) — Meet the team.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/PRD.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
