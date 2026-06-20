---
id: roadmap
title: Roadmap
type: project-roadmap
scope: project
audience: documentation
version: 1.0.0
status: current
owner: CEO + EpicGenerator
related:
  - PRD.md
  - tech-stack.md
  - conventions.md
  - glossary.md
content_hash: sha256:7a96fa722d542249ecd587aafbffc9af8728593b2620bb6a0fc3dc120281d273
pii_markers:
  - none
---
# FORA — Roadmap

**Status:** v1.0 (production bar, 2026-06-17) — meets the Knowledge Layer bar in [README §3](../README.md#3-the-acceptance-bar)
**Owner:** CTO owns sequencing (the order, the dependencies, the Q-to-Q plan). CEO owns prioritisation (the bet per quarter, the ICP, the go-to-market coupling). CTO merges; CEO co-signs on the bet-of-the-quarter call.
**Cadence:** Reviewed monthly; revised at every quarterly offsite. A slipped date is a P2 process bug (per §8) — re-plan, do not crunch.
**Glossary:** Every acronym below (MCP, ICP, MRR, GA, SLO, SOC 2, DPIA, MTTR, WCAG, OWASP, ASVS, pgvector, KPI, etc.) is defined in [customer/glossary.md](../customer/glossary.md).
**Linked Paperclip issues:**
- Parent Epic: [FORA-26](/FORA/issues/FORA-26) — Epic 10 — Knowledge Layer
- Sub-goal: [FORA-100](/FORA/issues/FORA-100) — 10.3 Project folder hardening
- Plan of record: [FORA-15](/FORA/issues/FORA-15#document-plan) — BMAD → Paperclip Hierarchy Plan
- Hiring plan: see `HIRING_PLAN.md`; the 5-hire sequence is on the CTO's board.
**Related:** [PRD.md](./PRD.md), [tech-stack.md](./tech-stack.md), `HIRING_PLAN.md`

---

## 1. Roadmap principles

1. **Ship a usable v1 in 12 weeks, not a perfect v0 in 12 months.** Every quarter we either have a design partner shipping with us, or we admit we don't.
2. **Foundation before features.** The Knowledge Layer, the audit log, and the tenant isolation come before any UX. A beautiful console on an insecure foundation is a liability.
3. **Each quarter has one bet.** Two bets is two teams we do not yet have; zero bets is a quarter we wasted.
4. **The roadmap is a sequence, not a list.** Items are ordered; later items depend on earlier ones; we do not promise dates for items past the current quarter.
5. **Reversible bets ship fast.** One-way doors get a one-quarter soak before they become a commitment.

## 2. The four-quarter view

```
Q3 2026  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  Foundation + First Design Partner
Q4 2026  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  v1 GA + MCP priority-1 set
Q1 2027  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  v1.1 + Priority-2 MCPs + SOC 2 Type II
Q2 2027  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  Scale to 10 design partners
```

## 3. Q3 2026 — Foundation + First Design Partner (current quarter)

**The bet:** we can stand up the agent runtime, the staged workflow, the audit log, and a single priority-1 MCP integration (Jira) well enough that one design partner runs a real feature through it end-to-end.

### 3.1 Engineering milestones

| # | Milestone | Owner | Status | Target |
| --- | --- | --- | --- | --- |
| 1 | Knowledge Layer workspace structure | CTO | **done** | Wk 1 (2026-06-20) |
| 2 | Hire Senior Software Engineer #1 | CEO + CTO | open | Wk 2 |
| 3 | Master Orchestrator MVP (run lifecycle, stage gates, audit log) | CTO | not started | Wk 4 |
| 4 | Staged workflow (Ideation → Architect → Dev → QA → Security → DevOps → Docs) with real handoff contracts | CTO | not started | Wk 6 |
| 5 | MCP server framework + Jira MCP server (per-tenant namespace) | CTO | not started | Wk 7 |
| 6 | Forge console v0 (read-only views for PM, Eng Lead, CTO) | CTO | not started | Wk 8 |
| 7 | First design partner runs a real feature end-to-end | CEO + CTO | not started | Wk 11 |
| 8 | Post-mortem on the design partner's first run | All | not started | Wk 12 |

### 3.2 Compliance / quality milestones

- [ ] Threat model written for the agent runtime (per [memory/security.md §1](../memory/security.md)).
- [ ] First pass at the safety eval set committed (LLM01–LLM10).
- [ ] First pass at the SOC 2 controls inventory written.
- [ ] First pass at the WCAG AA self-assessment for the Forge console.

### 3.3 What we will not do this quarter

- We will not onboard a second design partner. One, deeply.
- We will not add the priority-2 MCPs. Jira is enough to prove the framework.
- We will not build a vector DB. We use the customer's Postgres + pgvector.
- We will not open-source anything. The first 12 weeks are about closing the loop, not building community.

### 3.4 Definition of "done" for Q3

A design partner's CTO has run a real feature from Slack message to production through the platform, with a complete audit log, a published Confluence page, and a cost-per-run under $20. The design partner's CISO has signed off on the audit log.

## 4. Q4 2026 — v1 GA + MCP priority-1 set

**The bet:** the runtime is stable enough to onboard paying customers, and the priority-1 MCP set is wide enough to cover the average design partner's SDLC.

### 4.1 Engineering milestones

| # | Milestone | Owner | Target |
| --- | --- | --- | --- |
| 1 | GitHub MCP server (PR creation, review request, status sync) | Dev Eng #1 | Wk 13 |
| 2 | Confluence MCP server (page read/write, link to ADR) | Dev Eng #1 | Wk 14 |
| 3 | SonarQube MCP server (scan, findings, gate) | Dev Eng #1 | Wk 15 |
| 4 | Figma MCP server (design link, design-tokens extract) | Dev Eng #1 | Wk 16 |
| 5 | AWS MCP server (deploy, IAM, secrets read) | DevOps Eng | Wk 17 |
| 6 | Slack/Teams MCP server (notification, approval, status) | Dev Eng #1 | Wk 18 |
| 7 | Hire Product Engineer, DevOps Engineer | CEO + CTO | Wk 18 |
| 8 | v1 GA release | CTO | Wk 22 |
| 9 | First paying customer | CEO | Wk 24 |

### 4.2 Compliance / quality milestones

- [ ] SOC 2 Type I ready (Type II window opens at Wk 22).
- [ ] WCAG 2.2 AA self-attested for the Forge console.
- [ ] OWASP ASVS Level 2 self-attested for the public API.
- [ ] Penetration test by an independent firm; findings triaged.

### 4.3 Definition of "done" for Q4

Three paying customers, each running at least one feature per week through the platform, with a 99.9 % SLO on the runtime, and a SOC 2 Type I report available under NDA.

## 5. Q1 2027 — v1.1 + Priority-2 MCPs + SOC 2 Type II

**The bet:** the platform is feature-complete for the v1 ICP, the SOC 2 Type II window closes successfully, and we expand the integration surface to cover the next layer of customer requests.

### 5.1 Engineering milestones

- Zendesk MCP server (support context into the run).
- Databricks MCP server (data / notebook context).
- Azure DevOps MCP server (Microsoft-shop customers).
- Per-tenant cost dashboard in the Forge console.
- Self-serve onboarding for new tenants (no human-in-the-loop provisioning).
- Hire Security Engineer.

### 5.2 Compliance / quality milestones

- [ ] SOC 2 Type II report available.
- [ ] ISO 27001 certification kicked off.
- [ ] First DPIA on a special-category-data feature.

### 5.3 Definition of "done" for Q1

Ten active design partners, SOC 2 Type II report in hand, ISO 27001 cert in flight, the priority-2 MCP set shipped, and the security hire onboarded and running.

## 6. Q2 2027 — Scale to 10 design partners

**The bet:** the platform is operationally ready to be the system of record for ten enterprise engineering orgs. The bottleneck shifts from "does it work" to "do we have the team to support it."

### 6.1 Engineering milestones

- Multi-region deployment (US + EU).
- Customer-pinned release trains.
- A/B testing framework for agent prompts and tool schemas.
- Per-tenant model-provider routing (some customers want OpenAI, some want Anthropic, some want self-hosted).
- Hire Senior Engineer #2, Reviewer Engineer, and expand the Security team.

### 6.2 Compliance / quality milestones

- [ ] ISO 27001 cert received.
- [ ] Data-residency controls enforced (US data stays in `us-east-1`, EU data stays in `eu-west-1`).
- [ ] First external red-team exercise; findings triaged.

### 6.3 Definition of "done" for Q2

Ten active design partners, $X MRR (target set by CEO at the Q1 review), full multi-region, ISO 27001 in hand, and a 24/7 follow-the-sun support rotation.

## 7. Out-year bets (no dates, just the list)

These are roadmap candidates, not commitments. We pick one per quarter at the quarterly offsite.

- **Open-source the MCP server framework** — the framework becomes the network-effect flywheel.
- **Agent-of-agents marketplace** — third parties can publish a specialist sub-agent that lives in a customer's Workspace.
- **Knowledge Layer writes from agents** — the current "humans write, agents read" model flips; agents can update the workspace, with versioned, auditable writes.
- **A vertical template** — a pre-built workspace for a specific industry (FinServ, HealthTech) that a customer can clone.
- **An on-prem option** — for customers who cannot use a multi-tenant SaaS. Roadmap question, not v1.
- **HIPAA / FedRAMP** — gated on having a federal design partner.

## 8. Roadmap anti-patterns (we will not do these)

- **"Add a feature because a customer asked."** The customer has to be a design partner, the feature has to be on the ICP roadmap, and the feature has to pass the staging-gate review.
- **"Ship the roadmap, ignore the runs."** A roadmap is a sequence of runs, not a doc. Every milestone above is a child issue (or a set of child issues) in the issue tracker.
- **"Quarter-end crunch to make the dates."** A slipped date is a P2 process bug. We re-plan, we do not crunch.
- **"Add a stage to the workflow to fix a one-off."** A new stage is a one-way door. We add it once per year at most, at the quarterly offsite.

## 9. Related

- The product this roadmap delivers: [PRD.md](./PRD.md)
- The tech that builds it: [tech-stack.md](./tech-stack.md)
- The hiring plan that grows the team: see `HIRING_PLAN.md`
- The engineering defaults every milestone inherits: [memory/](../memory/)
- The customer-facing baseline every milestone must honour: [customer/](../customer/)

---

## 10. Change log

| Rev | Date | Author | What changed |
| --- | --- | --- | --- |
| v1.0 | 2026-06-17 | CTO (this hardening pass) | Status bump to v1.0 production bar; added owner split, cadence note, glossary cross-reference, linked Paperclip issues, dependency note, change log. Q3 milestone #1 status updated from "in progress" to "done" (the workspace structure now exists under `workspace/`). No sequencing changes. |
| v0.1 | 2026-06-16 | CEO | Initial proposed draft. |
