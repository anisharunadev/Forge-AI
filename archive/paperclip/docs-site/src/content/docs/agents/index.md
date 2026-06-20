---
title: Agents overview
description: Every sub-agent that ships in Forge AI v1 — the Master Orchestrator, the stage agents, and the cross-cutting agents.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

Forge AI is an **agent-of-agents platform**. There is one **Master Orchestrator**; under it sit the **SDLC Agents**; under each SDLC Agent sit the **specialist sub-agents**. The org chart and the runtime topology are the same diagram.

## The team at a glance

| Stage | Sub-agent | Role | Owner |
| --- | --- | --- | --- |
| **Cross-cutting** | [Master Orchestrator](/agents/master-orchestrator/) | Run lifecycle, stage gates, audit log | CTO |
| **Cross-cutting** | [Memory](/agents/memory/) | Knowledge Layer read/write | DocAgent |
| **Ideation** | [BA](/agents/ba/) | Draft PRDs, draft Jira epics | BA agent |
| **Architect** | [Architect](/agents/architect/) | ADRs, plans, threat models | Architect agent |
| **Dev** | [Developer](/agents/developer/) | Code, tests, PRs | Dev agent |
| **QA** | [QA](/agents/qa/) | Test plans, eval cases, integration tests | QA agent |
| **Security** | [Security](/agents/security/) | OWASP scan, safety evals, threat models | Security agent |
| **DevOps** | [DevOps](/agents/devops/) | Pipelines, deploys, release notes | DevOps agent |
| **Docs** | [Documentation](/agents/documentation/) | Confluence pages, ADRs, audit-row | DocAgent |
| **Refactor** | Refactor | Postmortem drafts, ADR maintenance | Refactor agent |
| **Cost** | Cost | Token/dollar tracking per run | Cost agent |
| **Audit** | Audit | Append-only audit log writer | Audit agent |

## The handoff contract

Every handoff between agents has three artefacts (per [`memory/architecture.md` §4](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md)):

1. **`input.schema.json`** — what the upstream stage must produce.
2. **`output.schema.json`** — what the downstream stage will receive.
3. **`example.json`** — a worked, redacted example.

```typescript
export interface AgentHandoff<TIn, TOut> {
  readonly version: `${number}.${number}.${number}`;
  readonly fromStage: StageName;
  readonly toStage: StageName;
  readonly inputSchema: JSONSchema<TIn>;
  readonly outputSchema: JSONSchema<TOut>;
  readonly example: { input: TIn; output: TOut };
  readonly sla: { p50_ms: number; p99_ms: number; max_retries: number };
}
```

A handoff with no `version`, no `example`, or no `sla` is rejected at PR review.

## The agent loop

Every agent follows the same loop:

```text
1. Read the relevant Knowledge Layer files
2. Receive a handoff (input.contract)
3. Emit a plan (allowed tools + ordering)
4. Runtime validates the plan against the allow-list
5. Tools execute (each call is audit-logged)
6. Agent emits the output.contract
7. Next stage picks it up
```

The runtime enforces **plan-then-act** — the agent cannot call a tool that wasn't in the plan. Tool output is **sanitised** before being passed back to the model.

## Where to next

- **[Master Orchestrator →](/agents/master-orchestrator/)** — the brain.
- **[BA →](/agents/ba/)** — the first stage.
- **[Architect →](/agents/architect/)** — the second stage.
- Or jump to [Architecture → Staged workflow](/architecture/staged-workflow/) for the full contract.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
