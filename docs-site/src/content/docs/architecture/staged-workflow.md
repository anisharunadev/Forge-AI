---
title: Staged workflow
description: The seven stages, the gates between them, the artefacts they produce, and the SLA per stage.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

The staged workflow is the **spine of Forge AI**. It is the product pipeline, not the CI pipeline. The seven stages are the gates a work item crosses; the CI pipeline in [`memory/devops.md` §2](https://github.com/fora-platform/fora/blob/main/workspace/memory/devops.md) is what runs *inside* the Dev stage.

## The seven stages

```
Ideation → Architect → Dev → QA → Security → DevOps → Docs
   │         │         │      │       │          │        │
   ▼         ▼         ▼      ▼       ▼          ▼        ▼
 PRD    ADR + plan  PR    Tests   Findings  Pipeline  Confluence
                                                  runbook
```

| # | Stage | Owner | Artefact | SLA (p99) |
| --- | --- | --- | --- | --- |
| 1 | **Ideation** | BA agent | PRD + Jira Epic | 90 s |
| 2 | **Architect** | Architect agent | ADR + plan | 120 s |
| 3 | **Dev** | Developer agent | PR + tests | 900 s |
| 4 | **QA** | QA agent | Test plan + eval cases | 600 s |
| 5 | **Security** | Security agent | OWASP report + safety eval | 300 s |
| 6 | **DevOps** | DevOps agent | Pipeline + deploy + release notes | 1800 s |
| 7 | **Docs** | Documentation agent | Confluence page + audit row | 60 s |

The full pipeline (all seven stages) is **≤ 30 min at p99** for a typical work item.

## The gates

A stage is **gated**, not aspirational. The next stage does not start until the current stage's artefact is approved by its owner.

| From → To | Gate | Owner |
| --- | --- | --- |
| Ideation → Architect | PRD accepted | Product / CEO |
| Architect → Dev | ADR merged, plan in Jira | CTO / Architect |
| Dev → QA | PR merged, CI green | Dev owner |
| QA → Security | Tests pass, eval cases pass | QA owner |
| Security → DevOps | No high/critical findings open | Security owner |
| DevOps → Docs | Pipeline green, deploy verified | DevOps owner |
| Docs → Done | Confluence page published | Doc owner |

A gate that fails pauses the run. The Forge console shows the run state and the next required action.

## The handoff contract

Every handoff between agents has three artefacts (per [`memory/architecture.md` §4](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md)):

1. **`input.schema.json`** — what the upstream stage must produce. Versioned. Breaking changes are a major version bump.
2. **`output.schema.json`** — what the downstream stage will receive. Same rules.
3. **`example.json`** — a worked, redacted example. The example is the spec; the schema is the validator.

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

## The `StageEngine` port

The `StageEngine` is the typed runtime port that loads the handoff contract, enforces the gate, and invokes the stage handler. Two implementations ship:

- **`InMemoryStageEngine`** (dev, tests) — in-process, no network.
- **gRPC adapter** (prod target) — remote, scales horizontally.

Wired in [FORA-173](/FORA/issues/FORA-173). The handoff contract is the schema; the `StageEngine` is the runtime. A change to either side without updating the other is a **contract drift bug**.

## Idempotency

A stage is **safe to re-run** with the same input and produce the same observable side effects. Stages that violate this are wrapped, not allowed to leak. The handoff contract includes a `run_id` and an `idempotency_key` per stage call.

## Failure modes

| Failure | Behaviour |
| --- | --- |
| Stage times out | Checkpoint; resume from the last successful stage |
| Stage tool fails | Retry with exponential backoff; max 3 retries |
| Stage budget hit | Halt; surface "human-approval-required" |
| Gate rejected | Return to the previous stage with the reviewer's notes |
| LLM provider outage | Circuit-breaker to backup; run is paused with ETA |
| MCP server failure | Tool removed from allow-list; degraded plan continues |

## When to add a stage

**Don't.** Adding a stage is a **one-way door**; the cost of every PR goes up. The standing rule: at most one new stage per year, decided at the quarterly offsite.

## Where to next

- **[Knowledge Layer →](/architecture/knowledge-layer/)** — the storage contract.
- **[Multi-tenancy →](/architecture/multi-tenancy/)** — how isolation works.
- **[Agents overview →](/agents/)** — meet the team.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code> §3</dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
