---
title: Pilot Program
description: How to run a Forge AI pilot — phases, gates, KPIs, exit criteria.
---

A Forge AI pilot is a 12-week structured engagement that takes a tenant from "blank slate" to "sustained improvement on TTTD". This guide describes the phases, gates, and KPIs. The detailed runbooks are in [Operations → Pilot](/operations/pilot-overview/).

## What is a pilot?

A pilot is a structured adoption of Forge by a single tenant over a fixed window. The tenant commits:

- A pilot sponsor (CTO or VP Eng).
- 3+ projects to onboard.
- 3+ developers to participate in baseline measurement.
- A security reviewer and a release manager for the approval gates.

Forge commits:

- A Pilot Owner (PO) to drive the engagement.
- A Dev Lead, Architect (L3), Platform Engineer, Security Reviewer.
- The platform, deployed in the tenant's AWS account (or a Forge-hosted account with isolation).

## Phases

| Phase | Duration | Goal | Exit gate |
|---|---|---|---|
| **P0 — Pre-pilot** | 4 weeks | Stand up the platform, measure baseline TTTD | Baseline recorded, tenant provisioned |
| **P1 — Kickoff** | 2 weeks | First Aha Time — first typed artifact from a real workflow | One artifact reviewed and accepted |
| **P1.5 — Validation** | 2 weeks | 15+ artifacts across 3+ artifact types | ≥80% acceptance rate |
| **P2 — Execution** | 4 weeks | Directional improvement on TTTD | ≥2 of 3 artifact types show improvement |
| **P3 — Evaluation** | 2 weeks | Statistical measurement | ≥25% TTTD reduction with reasoning |
| **P4 — Expansion** | ongoing | Sustained reduction across waves | Sustain ≥25% reduction across waves |

Full details per phase:

- [P0 — Pre-pilot](/operations/pilot-p0/)
- [P1 — Kickoff](/operations/pilot-p1/)
- [P1.5 — Validation](/operations/pilot-p15/)
- [P2 — Execution](/operations/pilot-p2/)
- [P3 — Evaluation](/operations/pilot-p3/)
- [P4 — Expansion](/operations/pilot-p4/)

## KPIs

The pilot tracks seven KPIs. Full definitions: [Success metrics](/operations/success-metrics/).

| # | KPI | Pilot target | Steady-state target |
|---|---|---|---|
| 1 | TTTD (Time To Typed Draft) | Directional improvement vs baseline | ≥25% reduction vs baseline |
| 2 | Acceptance Rate | ≥80% (P1.5 gate) | ≥85% |
| 3 | Cycle Time | TBD at P3 | TBD at P3 |
| 4 | Cost per Cycle | Within budget envelope | Within budget ±10% |
| 5 | Approval Latency | TBD at P3 | ≤24h p90 |
| 6 | Developer NPS | ≥0 | ≥30 |
| 7 | Knowledge Reuse | ≥10% of artifacts | ≥25% of artifacts |

## Baseline measurement

P0 measures baseline TTTD. Three developers, three artifact types (ADR, Task Breakdown, Risk Register), three measurements each. Manual workflow, no Forge.

The baseline is the comparison floor. Improvement is `baseline - measured`.

## Gates and exit criteria

Each phase has a gate:

- **P0 gate** — baseline recorded, tenant provisioned, sample repos selected, Keycloak imported.
- **P1 gate** — first Aha Time, first accepted typed artifact.
- **P1.5 gate** — ≥80% acceptance rate, 15+ artifacts.
- **P2 gate** — directional improvement on ≥2 artifact types.
- **P3 gate** — ≥25% TTTD reduction with statistical reasoning.
- **P4 gate** — sustained reduction across waves.

A failed gate halts the pilot. The PO, the pilot sponsor, and the Architect (L3) decide whether to extend the phase, narrow scope, or halt.

## Risks

Common pilot risks:

- **Baseline too aggressive** — if the baseline was measured with shortcuts, improvement looks fake. P0 mitigates with three independent measurements per artifact.
- **Reviewer bottleneck** — if the Security Reviewer is unavailable, the security gate stalls. P1 mitigates by naming a backup.
- **Tenant change freeze** — the tenant freezes changes during the pilot. If the freeze is too tight, the pilot is unrepresentative.
- **Cost overrun** — LLM costs grow with usage. The LiteLLM budget envelope is set per tenant per day; alerts fire at 80%.

## When to use this guide

Use this guide when:

- Your organization is considering adopting Forge.
- You're scoping a pilot engagement.
- You're a stakeholder evaluating Forge for your team.

For phase-specific runbooks, see [Pilot operations](/operations/pilot-overview/).

## Related

- [Pilot overview](/operations/pilot-overview/)
- [Success metrics](/operations/success-metrics/)
- [Architecture overview](/architecture/overview/)
