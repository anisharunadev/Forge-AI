---
title: Master Orchestrator
description: The brain of Forge AI — owns run lifecycle, tenant context, stage gates, budget enforcement, and the audit log.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

The **Master Orchestrator** is the top of the agent-of-agents tree. It owns:

- **Run lifecycle** — wake, heartbeat, exit, retry, checkpoint, resume.
- **Tenant context** — every run carries a tenant; the orchestrator refuses to cross.
- **Stage gates** — the next stage does not start until the current stage's artefact is approved.
- **Budget enforcement** — token, cost, and time ceilings per run.
- **Audit log** — every tool call, every secret read, every config change is shipped to the audit account.
- **MCP registry** — discover, health-check, and route to per-tenant MCP servers.

## The runtime

The orchestrator is a TypeScript service (`apps/orchestrator`) running on Node 20 LTS, Fastify for HTTP, BullMQ for queueing, and the `StageEngine` port for stage transitions.

| Component | Choice | Why |
| --- | --- | --- |
| HTTP framework | Fastify 4 | Fast, TypeScript-first, OpenAPI generation |
| Queue | BullMQ on Redis | Native to Node, exactly-once semantics |
| Long-running jobs | Argo Workflows | Suspend/resume, artefact passing |
| Stage engine | `StageEngine` port | Two implementations: in-process (dev) and gRPC (prod) |

## The run lifecycle

```text
1. New run (Slack message / Forge / CLI / API)
   ↓
2. Ideation stage: BA agent
   - Reads: tenant context, customer conventions
   - Emits: PRD draft + Epic in Jira
   - Audit: every tool call
   ↓
3. CTO approves PRD in Forge
   ↓
4. Architect stage: Architect agent
   - Reads: PRD, customer conventions, project tech stack
   - Emits: ADR + plan
   ↓
5. (loop through Dev, QA, Security, DevOps, Docs)
   ↓
6. Done
```

Each stage transition is **gated**. The orchestrator enforces:

- The current stage's `output.contract` is valid.
- The current stage's owner has approved.
- The next stage's budget is not exhausted.
- The audit log has caught up to the current stage.

## Tenant isolation

The orchestrator's `TENANT_ISOLATION_MODE` env (default `strict`) refuses to:

- Pass a `tenant_id` that the caller is not authorised for.
- Read or write to another tenant's data.
- Cross-tenant MCP calls.
- Cross-tenant audit log entries.

A query that does not filter by `tenant_id` is a **bug, not a feature**.

## Budget enforcement

| Budget | Default | Override |
| --- | --- | --- |
| `COST_CEILING_USD` | 50 | Per-tenant override in `engagements/<slug>/conventions.md` |
| `COST_WARN_USD` | 20 | Same |
| `TOKEN_BUDGET` | 2,000,000 | Same |
| `RUN_TIMEOUT_S` | 1800 (30 min) | Per-stage override |

A run that hits the cost ceiling is **paused** and surfaces a "human approval required" state in the Forge console. A run that hits the token budget is **halted**.

## Audit shipping

Every tool call is buffered and flushed to the audit-account SQS every 1 s (configurable via `AUDIT_FLUSH_MS`). The audit-account SQS feeds a Lambda that writes to an S3 bucket with **object lock** (compliance mode). Forge AI cannot read the audit-account S3 — the boundary is one-way.

```typescript
{
  "id": "01HXYZ...",
  "tenant_id": "acme-corp",
  "run_id": "01HXYZ...",
  "stage": "dev",
  "tool": "github.create_pr",
  "actor": "agent:developer",
  "input_sha": "sha256:...",
  "output_sha": "sha256:...",
  "args_hash": "sha256:...",
  "started_at": "2026-06-18T00:00:00Z",
  "ended_at": "2026-06-18T00:00:01Z",
  "tokens_in": 1234,
  "tokens_out": 567,
  "usd": 0.04,
  "result": "ok"
}
```

See [Audit log →](/architecture/audit/) for the full schema.

## Where to next

- **[Architecture → Staged workflow](/architecture/staged-workflow/)** — what the orchestrator enforces.
- **[Multi-tenancy →](/architecture/multi-tenancy/)** — how tenant isolation works.
- **[Audit log →](/architecture/audit/)** — the audit schema.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
