---
title: P4 — Expansion
description: Steady state — sustain TTTD reduction across waves and additional teams.
---

> **Phase.** P4 — Expansion (steady state)
> **Duration.** Ongoing
> **Owner.** Pilot Owner transitions to Dev Lead
> **Exit gate.** Sustained ≥25% TTTD reduction across multiple waves.
> **Status.** No end date — this is the production steady state.

## Goal

Sustain the TTTD improvement from P3 across:

1. **Waves** — additional repos onboarded within the same tenant.
2. **Teams** — additional teams participating.
3. **Artifact types** — additional artifact types exercised.
4. **Connectors** — additional external systems integrated.

By the end of each wave:

- TTTD remains ≥25% below the original baseline.
- Acceptance rate stable at ≥85%.
- Cost per cycle within budget envelope ±10%.
- Approval latency p90 ≤ 24h.
- Developer NPS ≥ 30.

## Audience

| Audience | Read this section |
|---|---|
| Dev Lead | All of P4 (steady-state owner) |
| Pilot Owner | Transition plan |
| Architect (L3) | Architecture gate throughput as scale grows |
| Security Reviewer | Security gate throughput as scope grows |
| Platform Engineer | Platform capacity, cost trends |
| Pilot Sponsor | Quarterly business review |

## Wave planning

Each wave is a focused onboarding of a new repo, team, or artifact type.

| Wave | Scope | Duration |
|---|---|---|
| Wave 1 | Second repo in tenant; same team | 4 weeks |
| Wave 2 | Second team; first repo from team 2 | 6 weeks |
| Wave 3 | New artifact type (e.g., Deployment Plan) | 4 weeks |
| Wave 4 | New connector (e.g., Figma) | 6 weeks |

Each wave has its own charter and exit gate.

## Steady-state KPIs

The full seven KPIs are tracked continuously. See [Success metrics](/operations/success-metrics/).

| # | KPI | Steady-state target |
|---|---|---|
| 1 | TTTD | ≥25% reduction vs baseline (sustained) |
| 2 | Acceptance Rate | ≥85% |
| 3 | Cycle Time | Per-team baseline established |
| 4 | Cost per Cycle | Within budget ±10% |
| 5 | Approval Latency | p90 ≤ 24h |
| 6 | Developer NPS | ≥30 |
| 7 | Knowledge Reuse | ≥25% of artifacts |

## Quarterly business review

Each quarter, the Pilot Sponsor and the Dev Lead review:

- KPI dashboard
- Incident summary
- Cost summary
- Lessons promoted this quarter
- Roadmap input

## Scaling concerns

As scale grows, monitor:

| Concern | Mitigation |
|---|---|
| Architecture gate bottleneck | Tiered approval (deputy architect for low-risk ADRs) |
| Security gate bottleneck | Parallel reviewers; clear rubric |
| Cost growth | Per-team budgets; right-size models |
| Audit ledger size | Archive older rows per retention policy |
| Connector load | Rate-limit and quota per connector |

## Long-term roadmap

P4 is the steady state, but the platform evolves:

- **Quarterly platform releases** — new `forge-*` commands, new connectors.
- **Annual ADR review** — validate or supersede the eight locked ADRs.
- **Tenant feedback loop** — `forge-learn-search` informs roadmap.

## When P4 ends

P4 ends when the tenant chooses a successor model (e.g., dedicated tenant with custom ADRs) or exits the platform. Exits are graceful — the audit ledger and the milestone archive are exported; the per-tenant CMK is revoked; data is purged per retention policy.

## Related

- [P3 — Evaluation](/operations/pilot-p3/)
- [Success metrics](/operations/success-metrics/)
- [forge-learn-promote](/commands/learning/)
- [forge-sec-audit-export](/commands/security/)
