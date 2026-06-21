# P3 — Evaluation Runbook

> **Phase.** P3 — Evaluation
> **Duration.** 2 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** Go/no-go decision recorded; metric targets formalized; final report approved.
> **Prerequisite.** [P2 — Execution](pilot-p2-execution.md) exit gate signed; ≥12 cycles completed; mid-pilot review held.

## Goal

Turn the P0-P2 data into a recommendation the pilot sponsor can act on: **continue, expand, pivot, or stop**. By the end of P3 we have:

1. A formal evaluation of TTTD delta, acceptance rate, cycle count, cost per cycle, and developer NPS.
2. A pre-pilot vs pilot comparison with statistical reasoning.
3. A 2x2 impact × confidence decision matrix.
4. A written recommendation with explicit metric targets for P4 (if expanding).
5. A stakeholder review meeting and a final report.

P3 is the gate that authorizes [P4 — Expansion](pilot-p4-expansion.md). If P3 says `stop` or `pivot`, P4 does not begin.

## Audience and Prerequisites

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P3 |
| Pilot sponsor (customer exec) | Recommendation, decision matrix |
| Architect (L3) | Statistical methodology, recommendation |
| Security Reviewer | Security incident roll-up, recommendation |
| Dev Lead | Developer NPS roll-up, recommendation |
| CISO delegate (L4) | Security incident roll-up (if any) |

### Prerequisites

| # | Prerequisite | Source |
|---|---|---|
| P3-PR-1 | P2 exit gate signed | [pilot-p2-execution.md §Exit Gate](pilot-p2-execution.md#exit-gate-template) |
| P3-PR-2 | Cycle tracking spreadsheet complete | [pilot-p2-execution.md §Cycle Tracking](pilot-p2-execution.md#cycle-tracking-spreadsheet-template) |
| P3-PR-3 | Baseline TTTD data available | [pilot-p0-pre-pilot.md §Baseline TTTD](pilot-p0-pre-pilot.md#baseline-tttd-measurement) |
| P3-PR-4 | Developer NPS survey distributed | PO |
| P3-PR-5 | Cost ledger frozen for the pilot window | Platform Engineer |

## Metrics to Evaluate

Five primary metrics drive the recommendation. The full KPI definitions live in [success-metrics.md](success-metrics.md). This runbook is concerned with measurement and interpretation.

| Metric | Direction desired | Source |
|---|---|---|
| **TTTD delta** | Decrease vs P0 baseline | Cycle tracking + baseline-tttd.md |
| **Acceptance rate** | ≥80% | Artifact Registry (P1.5 + P2) |
| **Cycle count** | ≥12 | Cycle tracking spreadsheet |
| **Cost per cycle** | Within budget envelope | Cost ledger |
| **Developer NPS** | Positive | Survey |

A sixth metric — **Knowledge Reuse** — is tracked but not gating in P3.

## Comparison Methodology

P3 compares P0 baseline measurements against P2 pilot measurements. The comparison is per-artifact-type where the data supports it.

### Per-Artifact-Type Comparison

| Artifact type | P0 baseline (mean min) | P2 pilot (mean min) | Δ (min) | Δ (%) |
|---|---|---|---|---|
| ADR | — | — | — | — |
| API Contract | — | — | — | — |
| Task Breakdown | — | — | — | — |
| Risk Register | — | — | — | — |
| Security Report | — | — | — | — |
| Deployment Plan | — | — | — | — |

### Cycle-Level Comparison

In addition to per-artifact TTTD, P3 reports:

| Cycle metric | P0 (estimated manual) | P2 (Forge) |
|---|---|---|
| Mean cycle time (hours) | — | — |
| Median cycle time (hours) | — | — |
| p90 cycle time (hours) | — | — |
| Mean approval latency (hours) | — | — |
| Mean cost per cycle (USD) | $0 (manual) | — |

P0 has no automated cycle baseline; we use the per-artifact TTTD summed across the cycle as a proxy.

### Acceptance Rate Comparison

| Phase | Sample size | Acceptance rate |
|---|---|---|
| P1.5 | ≥15 | — |
| P2 (per cycle) | ≥12 | — |
| P2 (per artifact within cycle) | ≥36 | — |

If P2 acceptance rate drops below P1.5 rate by >10 percentage points, that is a regression signal that must be investigated before the recommendation.

## Statistical Significance

P3 reports statistical reasoning, not just point estimates.

### Minimum Sample Sizes

| Metric | Min sample for 95% CI ±20pp | Min sample for 95% CI ±10pp |
|---|---|---|
| Binary (accept/reject) | n=15 | n=50 |
| Continuous (TTTD, cost) | n=15 (rough) | n=30 |

The P1.5 sample (≥15) supports a rough go/no-go on acceptance rate. P2 cycles (≥12) support a rough go/no-go on cycle time. For tighter confidence intervals, we need more cycles in P4.

### Tests Used

| Comparison | Test |
|---|---|
| TTTD baseline vs pilot | Two-sample t-test (continuous, ~normal) or Wilcoxon rank-sum (non-parametric) |
| Acceptance rate P1.5 vs P2 | Two-proportion z-test |
| Approval latency by reviewer | ANOVA or Kruskal-Wallis |
| Cost per cycle | Bootstrap CI on the median |

P3 reports the test, the test statistic, the p-value, and the effect size (Cohen's d for continuous, Cohen's h for proportions). We do **not** gate on p-values alone — we gate on **direction + magnitude + statistical confidence**.

### Confidence Levels

| Confidence | Definition | Implication |
|---|---|---|
| **High** | p < 0.05 and effect size medium or larger | Treat the result as stable; safe to commit in P4 targets |
| **Medium** | p < 0.10 or small effect size | Treat as directional; require more cycles in P4 |
| **Low** | p ≥ 0.10 | Treat as exploratory; do not commit in P4 targets |

## Decision Matrix

The P3 recommendation uses a 2x2 matrix on **Impact** (how much value Forge delivered in P2) and **Confidence** (how statistically sure we are of the impact).

```text
                      CONFIDENCE
                  Low            High
              +-------------+-------------+
        High   | EXPAND      | EXPAND      |
              | (validate   | (commit)    |
IMPACT        | in P4)     |             |
              +-------------+-------------+
        Low    | PIVOT or    | STOP or     |
              | CONTINUE    | PIVOT       |
              | (need more  | (clear      |
              | data)       | signal)     |
              +-------------+-------------+
```

### Impact Assessment

| Impact | Definition |
|---|---|
| **High** | TTTD delta shows ≥30% improvement in ≥2 primary artifact types, **and** acceptance rate ≥80%, **and** cost per cycle within budget |
| **Medium** | TTTD delta shows 10-30% improvement in ≥2 primary artifact types, **and** acceptance rate ≥75% |
| **Low** | TTTD delta shows <10% improvement, or acceptance rate <75%, or cost overrun |

### Confidence Assessment

Confidence is the statistical assessment above. The full mapping:

| Impact \ Confidence | Low | Medium | High |
|---|---|---|---|
| High | Continue with explicit measurement plan in P4 | Expand with milestones | Expand |
| Medium | Pivot (find what didn't work) | Continue with adjustments | Expand with milestones |
| Low | Stop or pivot | Stop or continue narrow | Stop |

## Recommendation Template

The P3 recommendation follows a fixed template so sponsor decision-making is consistent.

```text
# Forge AI Pilot — P3 Recommendation

## Decision
<continue | expand | pivot | stop>

## Headline
<One-sentence headline: "Forge reduced TTTD by X% across Y artifacts at Z USD/cycle.">

## Impact Summary
- TTTD delta: <value> (confidence: <low|medium|high>)
- Acceptance rate: <value> (P1.5: <value>, P2: <value>)
- Cycle count: <value> (target ≥12)
- Cost per cycle: <USD> (budget <USD>)
- Developer NPS: <value>

## Confidence Summary
- TTTD: <statistical test and result>
- Acceptance: <statistical test and result>
- Cost: <statistical test and result>

## What worked
- <bullet>

## What didn't work
- <bullet>

## Risks for P4
- <bullet>

## P4 Targets (if expand)
- TTTD: <target>
- Acceptance rate: <target>
- Cycle count: <target>
- Cost per cycle: <target>
- Developer NPS: <target>

## Sign-off
- Pilot Owner (PO): ____________________  Date: __________
- Architect (L3):   ____________________  Date: __________
- Sponsor:          ____________________  Date: __________
```

## Stakeholder Review Meeting Agenda

The P3 stakeholder review is a 90-minute meeting.

| Time | Topic | Owner |
|---|---|---|
| 0:00 | Welcome + decision matrix framing | PO |
| 0:10 | TTTD delta report | PO |
| 0:25 | Acceptance rate report | PO |
| 0:40 | Cost report | Platform Engineer |
| 0:55 | Developer NPS report | Dev Lead |
| 1:10 | Security + incident roll-up | Security Reviewer |
| 1:20 | Discussion + decision | All |
| 1:30 | P4 targets (if expanding) | PO |
| 1:40 | Action items | PO |

The meeting is recorded and the recommendation is read aloud for the record.

## Final Report Template

The final report is stored at `docs/pilot/final-report.md` and shared with all stakeholders. Sections:

| # | Section | Owner |
|---|---|---|
| 1 | Executive summary | PO |
| 2 | Pilot scope + methodology | PO |
| 3 | TTTD delta report | PO |
| 4 | Acceptance rate report | PO |
| 5 | Cycle count + cycle time | PO |
| 6 | Cost report | Platform Engineer |
| 7 | Developer NPS report | Dev Lead |
| 8 | Security + incident report | Security Reviewer |
| 9 | Decision matrix + recommendation | PO |
| 10 | P4 targets (if expanding) | PO |
| 11 | Appendices: raw data, statistical tests, reviewer comments | PO |

The final report is approved by PO + L3 architect + sponsor at the stakeholder review meeting.

## Success Criteria Checklist

| # | Criterion | Target |
|---|---|---|
| 1 | All five primary metrics evaluated | 5/5 |
| 2 | Statistical tests documented per metric | Yes |
| 3 | Decision matrix populated | Yes |
| 4 | Recommendation template completed | Yes |
| 5 | Stakeholder review meeting held | Yes |
| 6 | Final report approved | Yes |
| 7 | P4 targets formalized (if expanding) | Yes |
| 8 | P0-P3 archive sealed (read-only) | Yes |

## P0-P3 Archive Seal

At the end of P3, the entire pilot record (charter, baseline, decisions, cycles, weekly summaries, disagreements, final report) is sealed at `docs/pilot/archive/p0-p3/`. The seal is a git tag.

```text
git tag -a pilot-p3-end-<date> -m "P3 exit: <decision>"
```

The archive is read-only after the tag. P4 begins from the archive.

## Cross-References

- **Previous phase.** [P2 — Execution](pilot-p2-execution.md) supplies cycle tracking and per-cycle metadata.
- **Next phase.** [P4 — Expansion](pilot-p4-expansion.md) is conditional on a green P3.
- **Metrics.** [success-metrics.md](success-metrics.md) is the authoritative KPI definition.
- **Decision authority.** [README.md §Decision Authority](README.md#decision-authority) for sign-off chain.
- **Architecture.** [Forge AI Charter](../CHARTER.md), [Architecture Overview](../architecture/overview.md).
