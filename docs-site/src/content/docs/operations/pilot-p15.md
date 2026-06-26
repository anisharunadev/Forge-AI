---
draft: false
title: P1.5 — Validation
description: 2-week validation phase — 15+ artifacts across 3+ types; ≥80% acceptance rate.
---

> **Phase.** P1.5 — Validation
> **Duration.** 2 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** ≥15 artifacts produced; ≥3 artifact types exercised; ≥80% acceptance rate.
> **Next phase.** [P2 — Execution](/operations/pilot-p2/)

## Goal

Demonstrate that the P1 workflow generalizes. By the end of P1.5:

1. ≥15 typed artifacts produced across ≥3 artifact types.
2. ≥80% acceptance rate (accepted or accepted_after_minor_edits).
3. At least 3 distinct developers have participated as authors.
4. At least 2 distinct reviewers have participated as approvers.
5. TTTD measured for each artifact and compared to the P0 baseline (directional).

## Audience

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P1.5 |
| Architect (L3) | Architecture gate throughput |
| Security Reviewer | Security gate throughput |
| Dev Lead | Developer participation, TTTD per developer |
| Pilot Sponsor | Acceptance rate |

## Artifact spread

The 15 artifacts must span **at least 3 of the 6 typed artifact types**:

| Artifact type | Recommended count |
|---|---|
| ADR | 3-4 |
| API Contract | 2-3 |
| Task Breakdown | 4-5 |
| Risk Register | 1-2 |
| Security Report | 1-2 |
| Deployment Plan | 2-3 |

The Dev Lead assigns each developer a mix. The mix should cover each developer's typical work.

## Acceptance criteria

For an artifact to count toward the 15, it must be in one of:

- `accepted` — composite score ≥70, no changes requested
- `accepted_after_minor_edits` — composite score 50-69, with follow-up notes

Artifacts in `rejected` (composite < 50) or `draft` do not count.

## Measurement

For each artifact, the audit ledger records:

- `t_need` — command invocation timestamp
- `t_review_ready` — first time the artifact is at `in_review` status
- TTTD = `t_review_ready - t_need`

Aggregate:

- Mean TTTD per artifact type.
- Median TTTD per artifact type.
- Comparison to P0 baseline.

Directional improvement (lower than baseline) is the P1.5 gate. Statistical significance is not required at P1.5.

## Common issues

| Issue | Mitigation |
|---|---|
| Architecture gate bottleneck | Backup reviewer; cap concurrent workflows |
| Security gate bottleneck | Pre-review with security reviewer; clear rubric |
| Devs not participating | Schedule dedicated time; rotate on-call |
| Reviewer comments too vague | Use typed rubric; reject vague comments |
| Artifact quality low | Steward reviews the rubric; tighten thresholds |

## Exit gate

The P1.5 exit gate is signed when:

- ≥15 artifacts produced.
- ≥3 artifact types exercised.
- ≥80% acceptance rate.
- Directional improvement on TTTD vs baseline.
- At least one new lesson captured.

A failed gate halts P2. The PO, the Pilot Sponsor, and the Architect (L3) decide whether to extend P1.5, narrow scope, or halt.

## Reporting

Weekly status includes:

| Field | Value |
|---|---|
| Artifacts produced (cumulative) | count |
| Artifact types exercised | set |
| Acceptance rate | percentage |
| Mean TTTD per type | seconds |
| Comparison to baseline | delta |

## Related

- [P1 — Kickoff](/operations/pilot-p1/)
- [P2 — Execution](/operations/pilot-p2/)
- [Success metrics](/operations/success-metrics/)
- [Approval model](/architecture/approval-model/)
