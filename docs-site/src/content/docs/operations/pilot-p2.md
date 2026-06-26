---
draft: false
title: P2 — Execution
description: 4-week execution phase — directional improvement on ≥2 of 3 artifact types.
---

> **Phase.** P2 — Execution
> **Duration.** 4 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** Directional improvement on TTTD for ≥2 of 3 primary artifact types; all gates operating at sustainable latency.
> **Next phase.** [P3 — Evaluation](/operations/pilot-p3/)

## Goal

Sustain the artifact production rate from P1.5 and demonstrate **directional improvement** on TTTD. By the end of P2:

1. ≥30 additional artifacts produced (P1.5 total ≥ 45).
2. TTTD is **directionally lower** than baseline for ≥2 of 3 primary artifact types (ADR, Task Breakdown, Risk Register).
3. All three mandatory approval gates operate at sustainable latency (approval p90 < 24h).
4. No Sev1 or Sev2 incidents attributable to the platform.

## Audience

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P2 |
| Architect (L3) | Architecture gate latency |
| Security Reviewer | Security gate latency, false positive rate |
| Release Manager | Deployment gate latency |
| Dev Lead | Cycle time, developer load |
| Platform Engineer | Stability, cost, on-call load |
| Pilot Sponsor | TTTD directional improvement |

## The three primary artifact types

| Type | Why primary |
|---|---|
| **ADR** | Most frequent; clearest rubric; gates architecture |
| **Task Breakdown** | Highest volume; gates development |
| **Risk Register** | Highest review burden; gates deployment |

A directional improvement on ≥2 of these is the P2 gate. Statistical reasoning is not required at P2 — that's P3's job.

## Week-by-week plan

| Week | Theme | Outcomes |
|---|---|---|
| **W1** | Throughput ramp | 8-10 artifacts produced; gate latency measured |
| **W2** | Mid-pilot check | First TTTD aggregates; latency budgets adjusted |
| **W3** | Sustain | Continued production; cost under control |
| **W4** | Exit gate prep | Numbers ready; lessons captured; exit gate drafted |

## Gate latency budgets

| Gate | P2 budget (p90) |
|---|---|
| Architecture | ≤ 8h during business hours |
| Security | ≤ 12h |
| Deployment | ≤ 4h during release windows |

If a gate exceeds its budget, the gate is flagged and the PO convenes the gate's review owner to discuss mitigations.

## Cost discipline

The LiteLLM Proxy enforces a per-tenant daily budget envelope. P2 monitors:

| Metric | Target |
|---|---|
| Cost per cycle | Within budget envelope |
| Cost per artifact | Trending down as prompts are refined |
| Cost per tenant per day | ≤ 80% of envelope (alert at 80%) |

## Stability

The Platform Engineer monitors:

| Metric | Target |
|---|---|
| Service uptime | ≥ 99.5% during pilot |
| Audit ledger hash chain | No anchor failures |
| LiteLLM Proxy error rate | < 1% |

A Sev1 or Sev2 incident attributable to the platform halts the pilot until root cause is fixed.

## Reporting

Weekly status includes:

| Field | Value |
|---|---|
| Artifacts produced (weekly + cumulative) | counts |
| Mean TTTD per primary type | seconds |
| Comparison to baseline | delta + direction |
| Gate latency p50 / p90 | seconds |
| Cost per cycle | USD |
| Incidents | list (Sev1/Sev2 highlighted) |

## Exit gate

The P2 exit gate is signed when:

- ≥30 additional artifacts produced.
- TTTD is directionally lower than baseline for ≥2 of 3 primary types.
- All mandatory gates operate at sustainable latency.
- No Sev1 or Sev2 incidents attributable to the platform in the last 2 weeks.

A failed gate halts P3. The PO, the Pilot Sponsor, and the Architect (L3) decide whether to extend P2, narrow scope, or halt.

## Common pitfalls

- **Reviewer fatigue.** Three weeks of reviewing at high cadence burns reviewers out. Rotate.
- **Cost drift.** LLM usage grows as more workflows run. Watch the envelope.
- **Latency creep.** Gates slow down as the queue grows. Set explicit budgets.
- **Drift on the rubric.** If reviewers' standards diverge, the acceptance rate becomes meaningless.

## Related

- [P1.5 — Validation](/operations/pilot-p15/)
- [P3 — Evaluation](/operations/pilot-p3/)
- [Success metrics](/operations/success-metrics/)
- [Approval model](/architecture/approval-model/)
- [Oncall runbook](/operations/oncall/)
