---
title: Architecture overview
description: The agent-of-agents shape, the staged workflow, the Knowledge Layer, the audit log, and the runtime ports.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

The Forge AI architecture in five diagrams. The full design bar lives in [`workspace/memory/architecture.md`](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md).

## 1. The shape

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

The **org chart and the runtime topology are the same diagram.** If a box exists in one, it exists in the other.

## 2. The staged workflow

<div class="stage-pipeline">
  <span class="stage">Ideation</span><span class="arrow">→</span>
  <span class="stage">Architect</span><span class="arrow">→</span>
  <span class="stage">Dev</span><span class="arrow">→</span>
  <span class="stage">QA</span><span class="arrow">→</span>
  <span class="stage">Security</span><span class="arrow">→</span>
  <span class="stage">DevOps</span><span class="arrow">→</span>
  <span class="stage">Docs</span>
</div>

| From → To | Gate | Owner |
| --- | --- | --- |
| Ideation → Architect | PRD accepted | Product / CEO |
| Architect → Dev | ADR merged, plan in Jira | CTO / Architect |
| Dev → QA | PR merged, CI green | Dev owner |
| QA → Security | Tests pass, eval cases pass | QA owner |
| Security → DevOps | No high/critical findings open | Security owner |
| DevOps → Docs | Pipeline green, deploy verified | DevOps owner |
| Docs → Done | Confluence page published | Doc owner |

## 3. The Knowledge Layer

```
workspace/
├── memory/             # engineering defaults (injected per agent)
│   ├── architecture.md
│   ├── coding.md
│   ├── devops.md
│   ├── qa.md
│   └── security.md
├── customer/           # customer-facing baseline
│   ├── conventions.md
│   ├── glossary.md
│   └── standards.md
├── project/            # product facts
│   ├── PRD.md
│   ├── roadmap.md
│   ├── tech-stack.md
│   ├── docs.md          # the doc index (storage contract)
│   └── adr-registry.md
└── engagements/        # per-tenant overrides
    └── <customer-slug>/
        └── conventions.md
```

The **Knowledge Layer bar**: *a future sub-agent, woken cold with only the relevant files, can do its job.* Anything tribal stays in `workspace/`; nothing tribal stays in prompts.

## 4. The runtime ports

| Port | Two implementations |
| --- | --- |
| **`StageEngine`** | `InMemoryStageEngine` (dev, tests) and a gRPC adapter (prod target). Loads the handoff contract, enforces the gate, invokes the stage handler. |
| **`MCPRouter`** | In-process (dev) and per-tenant proxy (prod). Routes MCP calls to the right namespace. |
| **`AuditShipper`** | Stdout (dev) and SQS (prod, cross-account). The audit account is **read-only from Forge AI**. |
| **`SecretStore`** | Doppler (dev) and AWS Secrets Manager via the Secrets Store CSI Driver (prod). |

## 5. The principles (in order of weight)

1. **Orchestrate, do not rebuild.**
2. **The contract is the product.**
3. **Idempotent stages.**
4. **The Knowledge Layer is the source of truth.**
5. **Reversibility rules pace.**
6. **Boundaries are physical, not aspirational.**
7. **Cost is a first-class output.**

See [`memory/architecture.md` §2](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md) for the full text.

## Where to next

- **[Staged workflow →](/architecture/staged-workflow/)** — the seven stages in detail.
- **[Knowledge Layer →](/architecture/knowledge-layer/)** — the storage contract.
- **[Multi-tenancy →](/architecture/multi-tenancy/)** — how isolation works.
- **[Audit log →](/architecture/audit/)** — the audit schema.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
