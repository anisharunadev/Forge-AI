---
title: Key features
description: Every feature Forge AI ships in v1 — the staged workflow, Knowledge Layer, audit log, MCP integrations, and the agent team.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/PRD.md
generator: readme
approval_required: false
---

A tour of every feature that ships in **Forge AI v1.0**. The PRD is the source of truth — see [`workspace/project/PRD.md`](https://github.com/fora-platform/fora/blob/main/workspace/project/PRD.md).

## The four surfaces

### 1. The Forge console

The customer-facing surface. Three personas, three views:

- **Product Manager view** — PRDs, roadmaps, capacity, status. Read-mostly.
- **Engineering Lead view** — runs in flight, stage gate approvals, blocked work, cost. Read + approve.
- **CTO / VP Eng view** — throughput, MTTR, audit, cost by team. Read-only.

The console is the **observation** surface, not the **action** surface. Customers don't edit PRDs in the console; they edit them in their IDE / wiki / chat, and the platform syncs.

### 2. The Runtime (the agent execution layer)

- **Multi-tenant.** Each run carries a tenant context; the runtime refuses to cross.
- **Stage-gated.** The next stage doesn't start until the current stage's artefact is approved.
- **Plan-then-act.** The agent emits a plan; the runtime validates it against the allow-list; only then are tools called.
- **Auditable.** Every action is logged, every log is shipped to the audit account, every log is queryable by `tenant_id`, `run_id`, `stage`, `tool`, `actor`.

### 3. The Knowledge Layer (the workspace)

- The customer-owned folder of memory, customer, and project files.
- A future sub-agent, woken cold with only the relevant files, can do its job. **That is the acceptance bar.**
- v1: humans write; agents read. Writes from agents are a separate ticket and out of scope for v1.

### 4. The MCP surface (integrations)

| Tool | Status | MCP server | Auth flow | R/W |
| --- | --- | --- | --- | --- |
| **Jira** | <span class="badge done">shipped</span> | In-house (TS) | OAuth 2.0 (3LO) | R/W |
| **GitHub** | <span class="badge beta">beta</span> | In-house (TS) | GitHub App (per-tenant) | R/W |
| **Confluence** | <span class="badge beta">beta</span> | In-house (TS) | OAuth 2.0 (3LO) | R/W |
| **SonarQube** | <span class="badge beta">beta</span> | In-house (TS) | Token per tenant | R |
| **Figma** | <span class="badge beta">beta</span> | In-house (TS) | OAuth 2.0 | R |
| **AWS** | <span class="badge beta">beta</span> | In-house (Py) | Cross-account IAM role | R (scoped) |
| **Slack / Teams** | <span class="badge beta">beta</span> | In-house (TS) | OAuth 2.0 | R/W |

Each MCP server lives in a per-tenant namespace. **A bug in the router that crosses tenants is a P0.**

Priority 2 (v1.1): Zendesk, Databricks, Azure DevOps. Backlog: GitLab, Bitbucket, Linear, Notion, Asana, ClickUp.

## The staged workflow

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

We do not add stages lightly. **Adding a stage is a one-way door;** the cost of every PR goes up.

## The agent team

Every stage has specialist sub-agents. See the full list on [Agents →](/agents/).

| Stage | Sub-agent | What it produces |
| --- | --- | --- |
| **Ideation** | BA | PRD draft, epic in Jira |
| **Architect** | Architect | ADR, plan in Jira |
| **Dev** | Developer | Feature branch, code diff, PR |
| **QA** | QA | Test plan, eval cases, integration tests |
| **Security** | Security | Threat model, OWASP scan, safety eval results |
| **DevOps** | DevOps | Pipeline config, deploy, release notes |
| **Docs** | Documentation | Confluence page, ADR links, audit-row |

Cross-cutting: **Memory** (Knowledge Layer), **Audit** (audit-log writer), **Cost** (per-stage token/dollar tracking).

## Compliance posture (v1.0)

Inherited defaults, audited floor (see [Standards →](/reference/glossary/)):

- ✅ **SOC 2 Type I** — ready (Type II window opens Q1 2027)
- ✅ **ISO 27001** — kickoff Q1 2027
- ✅ **OWASP ASVS 4.0** — self-attested Level 2 for the public API
- ✅ **OWASP Top 10 for LLM Apps** — LLM01–LLM10 covered by the safety eval set
- ✅ **NIST SSDF (SP 800-218)** — staged workflow + threat models + SBOMs
- ✅ **WCAG 2.2 AA** — Forge console is AA-conformant (axe-core in CI)

Roadmap: **SOC 2 Type II** Q1 2027, **HIPAA / FedRAMP** gated on having a federal design partner.

## Cost transparency

Every run reports:

- `tokens_in` (prompt tokens)
- `tokens_out` (completion tokens)
- `usd` (dollars spent)
- `duration_ms`
- `model` (Anthropic Claude Opus 4.8 / Sonnet 4.6 / Haiku 4.5)
- `fallback_used` (when a backup provider kicked in)

**Cost ceiling per run: $50 hard stop.** Above that, a human approval is required to continue.

## Where to next

- **[Quickstart →](/quickstart/)** — Run Forge AI locally in 5 minutes.
- **[Architecture →](/architecture/)** — How the pieces fit.
- **[Security →](/security/)** — Threat model, IAM, secrets, compliance.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/PRD.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
