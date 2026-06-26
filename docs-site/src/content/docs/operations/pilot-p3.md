---
draft: false
title: P3 — Evaluation
description: 2-week evaluation phase — statistical measurement of TTTD improvement.
---

> **Phase.** P3 — Evaluation
> **Duration.** 2 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** ≥25% TTTD reduction vs baseline with statistical reasoning.
> **Next phase.** [P4 — Expansion](/operations/pilot-p4/)

## Goal

Produce the **statistical evidence** that Forge reduces TTTD. By the end of P3:

1. ≥25% TTTD reduction vs the P0 baseline, with statistical reasoning.
2. Acceptance rate stable at ≥80%.
3. All other KPIs measured and reported.
4. A pilot closeout report drafted.

## Statistical reasoning

A directional improvement is not enough. P3 requires:

| Item | What |
|---|---|
| **Effect size** | At least 25% reduction in mean TTTD per primary type |
| **Significance** | p < 0.05 (or equivalent) on the relevant test |
| **Confidence interval** | Reported with the reduction estimate |
| **Sample size** | At least 20 artifacts per primary type |
| **Power** | At least 0.8 on the test used |

If the sample is too small, P3 is extended or a different statistical framing is used (e.g., Bayesian).

## Recommended test

| Comparison | Test |
|---|---|
| TTTD baseline vs P3 | Welch's t-test (unequal variances) |
| Acceptance rate baseline vs P3 | Two-proportion z-test |
| Latency p90 baseline vs P3 | Bootstrap CI on quantile |

The Platform Engineer prepares the data extraction from the audit ledger.

## Reporting

The pilot closeout report includes:

| Section | Content |
|---|---|
| Executive summary | One page: what we did, what we measured, what we concluded |
| Methodology | Baseline measurement protocol, pilot workflow, statistical tests |
| Results | Per-KPI tables with confidence intervals |
| Lessons | Captured lessons, promoted rules |
| Recommendations | Adopt / extend / halt |
| Appendix | Raw data export (anonymized), test code |

## Exit gate

The P3 exit gate is signed when:

- ≥25% TTTD reduction vs baseline with statistical reasoning for ≥2 of 3 primary types.
- Acceptance rate ≥ 80%.
- Closeout report drafted and reviewed.
- Pilot Sponsor accepts the conclusions.

A failed gate halts P4. The PO, the Pilot Sponsor, and the Architect (L3) decide whether to extend P3, narrow scope, or halt the pilot.

## Promotion of lessons

Lessons captured in P0-P3 are reviewed for promotion. `forge-learn-promote` (admin) promotes durable rules to Organization Knowledge.

Targets:

| Lesson type | Promotion target |
|---|---|
| Recurring workflow pattern | `template` |
| Org-wide rule | `org_policy` |
| Per-team rule | `standard` |

## Closeout

After P3 sign-off:

- The closeout report is published.
- The lessons are promoted.
- The pilot charter is archived.
- The tenant transitions to P4 (steady state) or the engagement ends.

## Related

- [P2 — Execution](/operations/pilot-p2/)
- [P4 — Expansion](/operations/pilot-p4/)
- [Success metrics](/operations/success-metrics/)
- [forge-learn-promote](/commands/learning/)
