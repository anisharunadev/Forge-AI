---
draft: false
title: P1 — Kickoff
description: 2-week kickoff phase — first Aha Time, first accepted typed artifact.
---

> **Phase.** P1 — Kickoff
> **Duration.** 2 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** One typed artifact reviewed and accepted; first Aha Time recorded.
> **Next phase.** [P1.5 — Validation](/operations/pilot-p15/)

## Goal

Drive the **first end-to-end `forge-*` workflow** through the platform. By the end of P1 we have:

1. A real workflow run on a real repo, producing a real typed artifact.
2. The artifact reviewed and accepted (or accepted_after_minor_edits).
3. First Aha Time recorded — the moment a participant said "this is faster than my manual workflow".
4. At least one lesson captured and one policy clarification raised.

## Audience

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P1 |
| Architect (L3) | First workflow selection, exit gate |
| Dev Lead | Workflow preparation, lesson capture |
| Platform Engineer | Workflow support, telemetry |
| Pilot Sponsor | First Aha Time |

## Workflow selection

Pick **one** workflow for P1. Don't try to cover everything at once.

Recommended starter workflows:

| Workflow | Why |
|---|---|
| New small feature | Clearest path: ideation → architecture → dev → test → sec → deploy |
| ADR + Task Breakdown only | Smallest viable workflow; proves the architecture gate |
| Documentation refresh | Low-risk; produces Org Knowledge updates |
| Dependency upgrade | Bounded; high value |

The selected workflow becomes the **canonical example** for the rest of the pilot. Document it; reuse it in P2.

## Week-by-week plan

| Week | Theme | Outcomes |
|---|---|---|
| **W1** | Workflow preparation | Repo ingested; connectors live; first `forge-intel-summarize` run |
| **W2** | First workflow run | Full SDLC loop; artifact accepted; first Aha Time; lesson captured |

## First workflow checklist

The Dev Lead runs through this checklist in W1:

- [ ] Sample repo is ingested (`forge-intel-scan-repo`).
- [ ] Dependencies are inventoried (`forge-intel-scan-deps`).
- [ ] Services are mapped (`forge-intel-scan-services`).
- [ ] Secrets scan is green (`forge-intel-scan-secrets`).
- [ ] Project intelligence summary is reviewed (`forge-intel-summarize`).
- [ ] At least one connector (GitHub or Jira) is `live`.

## First artifact

The P1 artifact is the first thing Forge produces that the tenant accepts. Steps:

1. Ideation: `forge-ideate-brainstorm` → refined → crystallized.
2. Architecture: `forge-arch-adr` (admin + approval).
3. Architecture gate: Architect (L3) reviews and approves.
4. Development: `forge-dev-implement`.
5. Testing: `forge-test-plan` + `forge-test-unit`.
6. Review: `forge-review-diff` + `forge-review-approve` (admin).
7. Security: `forge-sec-scan` + `forge-sec-policy-check` (admin).
8. Security gate: Security Reviewer marks Security Report `final`.
9. Deploy: `forge-deploy-plan` + `forge-deploy-stage` + (optional) `forge-deploy-prod` (admin).
10. Milestone: `forge-milestone-changelog` + `forge-milestone-archive` (admin).

If P1 runs only through the architecture gate (steps 1-3), that's still a successful P1.

## First Aha Time

Aha Time is the moment a participant experiences the platform's value. The Pilot Owner should:

- Be present during the first workflow run.
- Watch for the "this is faster" moment.
- Record it (timestamp, participant, what triggered it).

Aha Times are aggregated across participants and reported in the weekly status.

## Lessons captured

At least one lesson must be captured in P1 (`forge-learn-capture`). Suggested topics:

- What the participant didn't expect.
- What was harder than expected.
- What was easier than expected.

## Exit gate

The P1 exit gate is signed when:

- One typed artifact is in `accepted` or `accepted_after_minor_edits` status.
- First Aha Time is recorded.
- At least one lesson is captured.
- Pilot Sponsor is satisfied with the demonstrated value.

A failed gate halts P1.5. The PO, the Pilot Sponsor, and the Architect (L3) decide whether to extend P1, choose a different workflow, or halt.

## Common pitfalls

- **Trying to do too much in W1.** The first workflow is a learning experience, not a benchmark.
- **Skipping the security scan.** Even in a friendly pilot, the Security Report must be reviewed.
- **Not capturing the Aha Time.** If the PO isn't present, the moment passes unrecorded.
- **Forcing the architecture gate to approve.** If the architect doesn't approve, that's a real signal — record it.

## Related

- [P0 — Pre-pilot](/operations/pilot-p0/)
- [P1.5 — Validation](/operations/pilot-p15/)
- [Success metrics](/operations/success-metrics/)
- [Approval model](/architecture/approval-model/)
