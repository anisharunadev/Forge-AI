---
id: prd
title: Product Requirements Document
type: project-prd
scope: project
audience: ba
version: 1.0.0
status: current
owner: CEO + BA
related:
  - roadmap.md
  - tech-stack.md
  - architecture.md
  - conventions.md
  - glossary.md
content_hash: sha256:b1fa28e3248ff00d671ef74fa7ae48eb1d23ebad0bb411c6233840a6c8d99759
pii_markers:
  - none
---
# FORA — Product Requirements Document (PRD)

**Status:** v1.0 (production bar, 2026-06-17) — meets the Knowledge Layer bar in [README §3](../README.md#3-the-acceptance-bar)
**Owner:** CEO owns §1, §2, §3, §4, §6.1, §8, §10. CTO owns §5, §6.2–6.3, §7, §9. Both sign §10. CTO is the merge gate.
**Stage gate:** This PRD is the input contract for the [Architect stage](../memory/architecture.md#3-the-staged-workflow-the-spine). It must be accepted before the Architect sub-agent picks it up.
**Glossary:** Every acronym below (MCP, OIDC, SSO, MFA, MTTR, SOC 2, OWASP, WCAG, FedRAMP, HIPAA, PCI-DSS, pgvector, LLM01–LLM10, BMAD, PII, DPIA, etc.) is defined in [customer/glossary.md](../customer/glossary.md). If you find a term used here that is not in the glossary, file a glossary PR; do not redefine it in this file.
**Linked Paperclip issues:**
- Parent Epic: [FORA-26](/FORA/issues/FORA-26) — Epic 10 — Knowledge Layer
- Sub-goal: [FORA-100](/FORA/issues/FORA-100) — 10.3 Project folder hardening
- Plan of record: [FORA-15](/FORA/issues/FORA-15#document-plan) — BMAD → Paperclip Hierarchy Plan
**Related:** [roadmap.md](./roadmap.md), [tech-stack.md](./tech-stack.md), [memory/architecture.md](../memory/architecture.md)

---

## 1. Vision

FORA is the **Enterprise AI SDLC Operating System**: a single platform that takes a product idea from a one-line prompt to a deployed, documented, audited change in a customer's SDLC. It runs on top of Paperclip (the agent runtime) and BMAD (the staged workflow), and it orchestrates the tools the customer's engineering org already uses — Jira, GitHub, Confluence, SonarQube, Figma, AWS, Slack — without replacing them.

The customer does not get a new tool to log into. The customer gets a team of sub-agents that work the way a founding engineering team would: one PRD, one ADR, one PR, one deploy, one Confluence page, one audit row per action.

## 2. Problem

Enterprise engineering orgs pay a compounding tax on every change:

- **Coordination cost** between PM, BA, architect, developer, QA, security, DevOps, and docs.
- **Context loss** between hand-offs (the PRD says one thing, the PR does another, the runbook is out of date).
- **Compliance friction** that scales linearly with headcount and slows every change.
- **Tool sprawl** — the average enterprise uses 8+ SDLC tools, none of which talk to each other in a way the audit can verify.

Existing solutions fragment the problem: code-review bots that do not see the PRD; AI pair programmers that do not see the ADR; project-management AI that does not see the PR. None of them closes the loop.

## 3. Target customer

### Primary ICP (initial design partners)

- Series-B-to-Series-D SaaS companies with 50–500 engineers.
- An engineering org that has outgrown Slack-and-spreadsheets but is not yet ready for a Platform Engineering team.
- A CISO who has mandated "every change must be auditable" but does not have the headcount to enforce it.
- A CTO who has bought one AI coding tool and is already tired of the "where is the audit" question.

### Out of scope (v1)

- **Pre-Series-A startups.** They do not have the SDLC pain yet.
- **Fortune 500 with bespoke compliance regimes** (FedRAMP, HIPAA, PCI-DSS). They are roadmap, not v1.
- **Non-software engineering orgs** (civil engineering, biotech lab work). The model is wrong.

## 4. Core value propositions

| Value prop | What it replaces | How FORA delivers |
| --- | --- | --- |
| **One source of truth per fact** | Spreadsheet of spreadsheets | Knowledge Layer (the workspace) + agent reads, not writes (v1) |
| **Auditable AI actions** | "What did the bot do?" | Audit log, append-only, cross-account |
| **Staged workflow with real gates** | Jira status fields nobody updates | Master Orchestrator enforces the gates, not the humans |
| **MCP-native integration** | Custom one-off integrations | First-class MCP server per tool, per tenant |
| **Cost transparency per run** | A surprise AWS bill | Token + cost ceiling, per-tenant, per-run, per-stage |

## 5. Product surface (v1)

### 5.1 The Forge console (web)

The customer-facing surface. Three personas, three views.

- **Product Manager view** — PRDs, roadmaps, capacity, status. Read-mostly.
- **Engineering Lead view** — runs in flight, stage gate approvals, blocked work, cost. Read + approve.
- **CTO / VP Eng view** — throughput, MTTR, audit, cost by team. Read-only.

The console is the **observation** surface, not the **action** surface. Customers do not edit PRDs in the console; they edit them in their IDE / wiki / chat, and the platform syncs.

### 5.2 The Runtime (the agent execution layer)

- Multi-tenant. Each run carries a tenant context; the runtime refuses to cross.
- Stage-gated. The next stage does not start until the current stage's artefact is approved.
- Plan-then-act. The agent emits a plan; the runtime validates it against the allow-list; only then are tools called.
- Auditable. Every action is logged, every log is shipped to the audit account, every log is queryable by `tenant_id`, `run_id`, `stage`, `tool`, `actor`.

### 5.3 The Knowledge Layer (the workspace)

- The customer-owned folder of memory, customer, and project files.
- A future sub-agent, woken cold with only the relevant files, can do its job. That is the acceptance bar.
- v1: humans write; agents read. Writes from agents are a separate ticket and out of scope for v1.

### 5.4 The MCP surface (integrations)

Priority 1 (v1 GA): **Jira, GitHub, Confluence, SonarQube, Figma, AWS, Slack/Teams.**
Priority 2 (v1.1): Zendesk, Databricks, Azure DevOps.
Priority 3 (backlog): GitLab, Bitbucket, Linear, Notion, Asana, ClickUp.

Each MCP server lives in a per-tenant namespace. A bug in the router that crosses tenants is a P0.

## 6. Key user journeys (v1)

### 6.1 The "feature from a Slack message" journey

1. PM drops a one-paragraph feature idea in a Slack channel.
2. The Master Orchestrator wakes the Ideation sub-agent. It produces a draft PRD and a draft Epic in Jira.
3. The CTO approves the PRD in the Forge console. Status: `accepted`.
4. The Architect sub-agent picks up the PRD, produces an ADR and a plan. CTO approves.
5. The Dev sub-agent creates a feature branch, scaffolds the code, opens a PR. CI green. CTO reviews the PR.
6. QA runs the eval set, the integration tests, the e2e tests. The PR is ready to merge.
7. Security runs the safety evals, the OWASP scan, the threat model check. Findings filed; severity ≥ high blocks the merge.
8. DevOps merges, deploys through the release train, verifies the deploy.
9. Docs sub-agent publishes the Confluence page, the ADR is linked, the audit log is closed.

Every step has an owner, a gate, a budget, and a log line.

### 6.2 The "incident" journey

1. PagerDuty (or our on-call) pages the on-call.
2. The on-call opens the runbook in the platform. The DevOps sub-agent drafts a mitigation plan against the runbook.
3. The on-call approves the mitigation. The agent executes against the allow-list (restart pod, rollback deploy, scale out). Every action is logged.
4. The post-incident review is auto-drafted by the Refactor and Documentation sub-agents. The CTO edits and accepts.

### 6.3 The "audit" journey

1. The customer CISO opens the audit view in the Forge console.
2. Filters by `tenant_id = their-org`, `date_range`, `actor = agent`.
3. Sees every agent action, every tool call, every secret read, every config change.
4. Exports the filtered view as a SOC 2-friendly artefact.

## 7. Non-goals (v1)

- **A new code editor / IDE.** We integrate with what the customer has.
- **A new project-management tool.** We integrate with Jira (priority 1) and add others.
- **A new CI/CD product.** We orchestrate GitHub Actions, ArgoCD, and the customer's existing pipeline.
- **A new model provider.** We are model-agnostic; the customer can pick the provider per tenant.
- **A new secret store.** We integrate with AWS Secrets Manager, HashiCorp Vault, and Doppler.
- **A new vector DB.** We use pgvector (in the customer DB) for v1; a managed vector DB is a v2 conversation.

## 8. Success metrics (north-star and guardrails)

### North star

**Weekly active runs per design-partner tenant, growing 20 % MoM for 6 months post-launch.**

A "weekly active run" is a run that completed at least one stage in the week. This is the proxy for "we are part of how the customer ships."

### Guardrails (we ship faster by not breaking these)

- **Tenant isolation:** zero cross-tenant data leaks. P0 incident if it ever happens.
- **MTTR (mean time to recovery) on customer-impacting incidents:** ≤ 60 min.
- **Audit-log completeness:** 100 % of agent actions logged. Verified by a daily sample audit.
- **Cost per run:** ≤ $5 at the median, ≤ $20 at p99, with a hard ceiling of $50/run before a human approval is required.
- **Eval regression:** ≤ 5 % drift in safety and quality eval scores, measured weekly.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Prompt injection drives a tool misuse | High | High | Plan-then-act, allow-list, egress proxy, safety evals, [memory/security.md §5](../memory/security.md) |
| Cross-tenant data leak | Low | Critical | Per-tenant namespaces, IAM boundary, daily audit sample, [memory/security.md §4](../memory/security.md) |
| Vendor (MCP) outage blocks a customer | Medium | Medium | Per-tool circuit-breaker, degraded-mode plans, runbook |
| LLM cost explosion | Medium | High | Per-run budget, per-tenant cap, FinOps review, [memory/devops.md §9](../memory/devops.md) |
| Hallucinated ADR or PR | Medium | Medium | Eval set, human-in-the-loop gate, structured output schema |
| Customer churn on first incident | Medium | High | Pre-mortem: 24-h response, blameless review, postmortem shared with customer |

## 10. Open questions (must answer before v1 GA)

1. **Pricing model.** Per-seat, per-run, or per-tenant flat? CEO owns; target answer by 2026-07-15.
2. **First design partner.** Who, when, what is the contract shape? CEO owns; target answer by 2026-07-01.
3. **MCP server packaging.** Open-source the reference servers, or proprietary? CEO + CTO; target answer by 2026-07-15.
4. **On-prem option.** Roadmap question, not v1. CTO owns the "no, unless…" stance.
5. **Model provider defaults.** Anthropic primary, with a customer-overridable fallback. CTO owns.

## 11. Related

- The roadmap that takes this PRD to GA: [roadmap.md](./roadmap.md)
- The tech that implements it: [tech-stack.md](./tech-stack.md)
- The engineering defaults every team inherits: [memory/](../memory/)
- The customer-facing standards and conventions: [customer/](../customer/)
- The hiring plan that grows the team that builds it: see `HIRING_PLAN.md`

---

## 12. Change log

| Rev | Date | Author | What changed |
| --- | --- | --- | --- |
| v1.0 | 2026-06-17 | CTO (this hardening pass) | Status bump to v1.0 production bar; added owner split, stage-gate note, glossary cross-reference, linked Paperclip issues, change log. No scope changes. |
| v0.1 | 2026-06-16 | CEO | Initial proposed draft. |
