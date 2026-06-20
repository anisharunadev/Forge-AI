---
id: architecture
title: "Architecture Memory"
type: architecture
scope: memory
audience: [Architect, Developer]
version: 1.0.0
status: accepted
owner: "CTO + Architect"
related: [coding, security, devops, qa, prd, tech-stack, conventions]
content_hash: sha256:820cc1e8a88735e803a2c67dacdbb9c71a6160b54b2a355b689b830e4db41bce
pii_markers: []
---
# Architecture Memory

**Scope:** Architecture principles, ADR conventions, and the agent-of-agents contract.
**Audience:** Every sub-agent and every engineer making a non-trivial design call.
**Stage injection:** Inject into **Architect**, **Developer**, and **Refactor** sub-agents. Inject into **CTO** reviews for any one-way-door decision.

---

## 0. Quick start

- **Read [README §9](../README.md#9-quick-start-for-a-new-sub-agent) first.** This file is the design bar; the README is how you walk in.
- **The staged workflow in §3 is the product pipeline, not the CI pipeline.** The seven stages here (Ideation → Architect → Dev → QA → Security → DevOps → Docs) are the gates a work item crosses. The CI pipeline in [devops.md §2](./devops.md#2-cicd-pipeline) is what runs *inside* the Dev stage. Do not conflate them.
- **One-way doors get an ADR and the CTO's signature** (see §5). A two-way door can be merged by the relevant sub-team lead. If you are unsure which one it is, treat it as a one-way door and file the ADR.

---

## 1. The shape we are building

Forge AI is an **agent-of-agents platform**. There is one Master Orchestrator; under it sit SDLC Agents; under each SDLC Agent sit specialist sub-agents (BA, Architect, Developer, QA, Security, DevOps, Documentation, Refactor, Cost, Audit, Evaluation, Memory). The org chart and the runtime topology are the same diagram. If a box exists in one, it exists in the other.

```
                       Master Orchestrator
                              │
        ┌────────────┬────────┴───────┬────────────┐
        │            │                │            │
   Ideation     Architect           Dev          ...   (one SDLC Agent per project)
   Agent        Agent             Agent
        │            │                │
   ┌────┴───┐   ┌────┴───┐      ┌────┴───┐
   BA  Cost  Refactor  Arch  ...   Dev QA Sec DevOps Docs
```

## 2. Architecture principles (in order of weight)

1. **Orchestrate, do not rebuild.** A capability that AWS Transform, GitHub, SonarQube, Figma, or any other integrated tool already does well is integrated, not rewritten. The only reason to rebuild is a missing primitive in the integrated tool.
2. **The contract is the product.** Every agent handoff has a versioned, machine-readable contract (JSON Schema + a worked example). The contract is the only thing the next agent needs to read.
3. **Idempotent stages.** A stage is safe to re-run with the same input and produce the same observable side effects. Stages that violate this are wrapped, not allowed to leak.
4. **The Knowledge Layer is the source of truth.** A future sub-agent, woken cold with only the relevant files in context, must be able to do its job. Anything tribal stays in `workspace/`; nothing tribal stays in prompts.
5. **Reversibility rules pace.** Two-way doors ship fast. One-way doors get an ADR and the CTO's signature.
6. **Boundaries are physical, not aspirational.** Sub-agents run in separate processes. MCP servers live behind a per-tenant proxy. The DB, the secrets store, and the audit log are in separate accounts.
7. **Cost is a first-class output.** Every stage reports tokens in, tokens out, and dollars spent. A stage that cannot justify its cost is cut.

## 3. The staged workflow (the spine)

The default path for a new feature request:

```
Ideation → Architect → Dev → QA → Security → DevOps → Docs
   │         │         │      │       │          │        │
   ▼         ▼         ▼      ▼       ▼          ▼        ▼
 PRD    ADR + plan  PR    Tests   Findings  Pipeline  Confluence
                                                  runbook
```

A stage is **gated**, not aspirational. The next stage does not start until the current stage's artefact is approved by its owner (human or agent). The gates are:

| From → To | Gate | Owner |
| --- | --- | --- |
| Ideation → Architect | PRD accepted | Product / CEO |
| Architect → Dev | ADR merged, plan in Jira | CTO / Architect |
| Dev → QA | PR merged, CI green | Dev owner |
| QA → Security | Tests pass, eval cases pass | QA owner |
| Security → DevOps | No high/critical findings open | Security owner |
| DevOps → Docs | Pipeline green, deploy verified | DevOps owner |
| Docs → Done | Confluence page published | Doc owner |

We do not add stages lightly. Adding a stage is a one-way door; the cost of every PR goes up.

## 4. The agent handoff contract

Every handoff between agents has three artefacts:

1. **`input.schema.json`** — what the upstream stage must produce. Versioned. Breaking changes are a major version bump.
2. **`output.schema.json`** — what the downstream stage will receive. Same rules.
3. **`example.json`** — a worked, redacted example. The example is the spec; the schema is the validator.

```typescript
// packages/contracts/src/agent-handoff.ts
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

## 5. ADRs (Architecture Decision Records)

- **Location:** `docs/adr/`, file name `NNNN-short-slug.md` (zero-padded, four digits).
- **Status values:** `proposed`, `accepted`, `superseded`, `deprecated`.
- **Template:**

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

- **One ADR per decision.** If you are writing more than one decision per ADR, split it.
- **The CTO signs every one-way door ADR.** A two-way door ADR can be merged by the relevant sub-team lead.
- **An ADR is immutable once accepted.** If we change our mind, we write a new ADR that supersedes it. We never edit history.

## 6. Data model discipline

- **One source of truth per fact.** If a fact appears in two places, one of them is wrong.
- **Tenant ID on every row.** No exceptions. A query that does not filter by `tenant_id` is a bug, not a feature.
- **Soft delete by default for user data; hard delete only on legal request.** Soft-deleted rows are excluded from all default queries.
- **PII gets its own column with a `pii: true` marker.** The DB schema is the inventory; the marker drives the export/redact pipeline.
- **Migrations are forward-only.** A rollback script accompanies every migration. If we cannot roll back, we cannot ship it.

## 7. API design

- **REST for the public surface.** JSON over HTTPS, OpenAPI 3.1 published from the same source of truth as the validator.
- **gRPC or in-process typed calls for internal service-to-service.** No JSON over HTTP inside the platform.
- **Versioned in the URL (`/v1/`, `/v2/`) for breaking changes.** Additive changes are unversioned.
- **Idempotency keys on every mutating call.** A retry must be a no-op.
- **Errors are typed, not strings.** `{ "error": { "code": "TENANT_NOT_FOUND", "message": "...", "request_id": "..." } }`. Codes are stable; messages are not.

## 8. Performance and scale budgets

Every service declares three numbers in its README:

- **p50 latency** for the happy path.
- **p99 latency** for the happy path.
- **RPS the service can sustain at p99 < 2× p50.**

A service that misses its budget has a P2 bug. We do not "scale out" our way out of a missing budget; we fix the hot path.

## 9. Failure modes we design for

- **LLM provider outage** — circuit-breaker to a backup provider; queued runs resume when the primary returns; user-visible state is "paused, ETA 5 min."
- **MCP server failure** — the failing tool is removed from the agent's allow-list for the rest of the run; the run continues with a degraded plan; the user is told.
- **Run timeout** — the run is checkpointed; a new run resumes from the last successful stage.
- **Tenant quota exceeded** — the run is paused with a clear "quota exceeded" state; an admin can extend or cancel.
- **Budget exceeded** — see [security.md §5](./security.md). The run halts; no silent overrun.

## 10. Architecture anti-patterns (auto-flag in review)

- A service that talks to the DB of another service directly. (Use the owning service's API.)
- A shared mutable module imported by more than one service. (Extract to a package or replicate.)
- A "temporary" feature flag still in `main` six months after the experiment.
- A "temporary" data backfill script still referenced in the deploy pipeline.
- A new service that has no `README.md` and no `runbook.md`.
- A change to the staged workflow, the contract schema, or the audit-log shape without an ADR.

## 11. Related

- The standards this builds on: see [coding.md](./coding.md) and [security.md](./security.md)
- How this runs in production: see [devops.md](./devops.md)
- The QA stage's playbook (the four test tiers, the Security handoff, Phase 4 self-healing, and the v2 cost budget): see [qa.md](./qa.md)
- The product these decisions serve: see [project/PRD.md](../project/PRD.md)
- The tech that implements this: see [project/tech-stack.md](../project/tech-stack.md)
- Customer-specific overrides: see [customer/conventions.md](../customer/conventions.md)

---

**Versioning:** this file ships through the normal release train (see [README §5](../README.md#5-versioning)). A change is a major version bump if it adds, removes, or reorders a stage in the staged workflow, changes the agent handoff contract schema, or changes the ADR template. A change that loosens a one-way door rule is rejected. The CTO owns merges to this file.
