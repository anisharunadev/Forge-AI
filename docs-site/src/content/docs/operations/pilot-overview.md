---
draft: false
title: Pilot Operations Overview
description: The 12-week pilot engagement — phases, KPIs, RACI, exit gates.
---

A Forge AI pilot is a structured 12-week engagement that takes a tenant from "blank slate" to "sustained improvement on TTTD". This page is the entry point for the operations runbooks.

## What is this?

The pilot engagement model. For each phase's runbook, see the linked page.

## Phases

| Phase | Duration | Goal | Exit gate | Runbook |
|---|---|---|---|---|
| **P0 — Pre-pilot** | 4 weeks | Stand up the platform, measure baseline TTTD | Baseline recorded, tenant provisioned | [P0](/operations/pilot-p0/) |
| **P1 — Kickoff** | 2 weeks | First Aha Time | One artifact reviewed and accepted | [P1](/operations/pilot-p1/) |
| **P1.5 — Validation** | 2 weeks | 15+ artifacts across 3+ types | ≥80% acceptance rate | [P1.5](/operations/pilot-p15/) |
| **P2 — Execution** | 4 weeks | Directional improvement on TTTD | ≥2 of 3 artifact types show improvement | [P2](/operations/pilot-p2/) |
| **P3 — Evaluation** | 2 weeks | Statistical measurement | ≥25% TTTD reduction with reasoning | [P3](/operations/pilot-p3/) |
| **P4 — Expansion** | ongoing | Sustained reduction across waves | Sustain ≥25% reduction across waves | [P4](/operations/pilot-p4/) |

## RACI

| Role | Responsibility |
|---|---|
| **Pilot Owner (PO)** | Drives the engagement; runs phase exit gates |
| **Architect (L3)** | Architecture gate approvals; ADR quality |
| **Security Reviewer** | Security gate approvals; Security Report quality |
| **Release Manager** | Deployment gate approvals; canary oversight |
| **Dev Lead** | Engineering team coordination; cycle time and Dev NPS |
| **Platform Engineer** | Platform availability; cost guardrails; on-call |
| **Steward** | Conflict resolution; policy enforcement |
| **Pilot Sponsor** | Tenant-side executive sponsor; sign-off |

## KPIs

The pilot tracks seven KPIs. Full definitions: [Success metrics](/operations/success-metrics/).

| # | KPI | Direction | Pilot target | Steady-state target |
|---|---|---|---|---|
| 1 | TTTD | Decrease | Directional improvement | ≥25% reduction vs baseline |
| 2 | Acceptance Rate | Increase | ≥80% (P1.5 gate) | ≥85% |
| 3 | Cycle Time | Decrease | TBD at P3 | TBD at P3 |
| 4 | Cost per Cycle | Decrease | Within budget envelope | Within budget ±10% |
| 5 | Approval Latency | Decrease | TBD at P3 | ≤24h p90 |
| 6 | Developer NPS | Increase | ≥0 | ≥30 |
| 7 | Knowledge Reuse | Increase | ≥10% | ≥25% |

## Pre-requisites (must hold before P0)

| # | Pre-requisite | Owner | Verified by |
|---|---|---|---|
| PR-1 | Substrate white-labeled as `forge-*` | Platform Engineer | `forge --help` shows ≥60 commands |
| PR-2 | M1 substrate primitives built | Platform Engineer | Smoke test checklist |
| PR-3 | LiteLLM Proxy deployed and reachable | Platform Engineer | `/health/liveliness` returns 200 |
| PR-4 | PostgreSQL 17 + Apache AGE + pgvector deployed | Platform Engineer | Extensions present |
| PR-5 | Keycloak realm import reviewed and tested | Platform Engineer | Realm export + dry-run import |
| PR-6 | Pilot customer signs pilot charter | Pilot Owner | Signed charter |

## Risk register

The pilot maintains a typed Risk Register (one of the six typed artifacts). Common risks:

- Baseline measurement invalid.
- Reviewer bottleneck at the approval gate.
- Tenant change freeze too tight or too loose.
- Cost overrun on LLM usage.
- Substrate mismatch with tenant tooling.

Each risk has a Steward-priority resolution path.

## Communications

| Cadence | Audience | Content |
|---|---|---|
| Daily standup | Pilot team | Status, blockers |
| Weekly status | Sponsor + Dev Lead | KPI progress, risks, decisions |
| Phase exit | Sponsor + Architect (L3) | Gate evidence, sign-off |
| Pilot closeout | All | TTTD results, lessons captured |

## When to use

Use this overview when:

- Starting a pilot engagement.
- Onboarding a new Pilot Owner.
- Auditing pilot progress.

For phase-specific runbooks, follow the links above.

## Related

- [P0 — Pre-pilot](/operations/pilot-p0/)
- [P1 — Kickoff](/operations/pilot-p1/)
- [P1.5 — Validation](/operations/pilot-p15/)
- [P2 — Execution](/operations/pilot-p2/)
- [P3 — Evaluation](/operations/pilot-p3/)
- [P4 — Expansion](/operations/pilot-p4/)
- [Success metrics](/operations/success-metrics/)
