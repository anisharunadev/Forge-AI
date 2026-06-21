---
title: P0 — Pre-Pilot
description: 4-week pre-pilot phase — stand up the platform, measure baseline TTTD.
---

> **Phase.** P0 — Pre-pilot
> **Duration.** 4 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** Baseline TTTD recorded; pilot scope confirmed; pilot tenant onboarded; Keycloak realm imported; first tenant provisioned; sample repos selected.
> **Next phase.** [P1 — Kickoff](/operations/pilot-p1/)

## Goal

Stand up everything Forge needs to start generating real artifacts, **without** running any `forge-*` workflow against production work yet. By the end of P0 we have:

1. A reproducible baseline measurement of how long it takes a developer to produce an ADR + Task Breakdown + Risk Register by hand. This is the baseline against which TTTD improvement is judged.
2. A confirmed scope for the pilot (which repos, which teams, which artifact types).
3. A pilot tenant onboarded with Keycloak, project intelligence, and connectors wired up.
4. Stakeholders identified, RACI complete, risk register seeded.
5. A signed exit gate that authorizes P1 to begin.

## Audience

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P0 |
| Architect (L3) | Stakeholder plan, exit gate |
| Security Reviewer | Risk register template, exit gate |
| Dev Lead | Baseline TTTD measurement, week-by-week plan |
| Platform Engineer | Pre-requisites, week-2 platform readiness |
| On-call (L1) | Week-2 platform readiness, escalation paths |

## Pre-requisites

| # | Pre-requisite | Owner | Verified by |
|---|---|---|---|
| PR-1 | M1 substrate primitives built (event bus, LiteLLM, cost ledger, freshness ledger, RLS, append-only artifacts, connector failure states, policy engine) | Platform Engineer | Smoke test checklist in `infra/` |
| PR-2 | Substrate white-labeled as `forge-*` per [ADR-004](/architecture/adr-004-white-label/) | Platform Engineer | `forge --help` shows ≥60 commands |
| PR-3 | LiteLLM Proxy deployed and reachable per [ADR-005](/architecture/adr-005-litellm/) | Platform Engineer | `/health/liveliness` returns 200 with virtual keys |
| PR-4 | PostgreSQL 17 + Apache AGE + pgvector deployed per [ADR-002](/architecture/adr-002-postgres-age/) | Platform Engineer | `SELECT extname FROM pg_extension` lists `age`, `vector` |
| PR-5 | Keycloak realm import script reviewed and tested in staging | Platform Engineer | Realm export + dry-run import in staging |
| PR-6 | Pilot customer signs pilot charter with explicit scope, repos, and reviewers | Pilot Owner | Signed charter |

If any pre-requisite is not met at P0 kickoff, halt and resolve before starting week-1.

## Week-by-week plan

| Week | Theme | Outcomes |
|---|---|---|
| **W1** | Scope and baseline design | Pilot charter signed; scope confirmed; baseline measurement protocol approved; stakeholders named |
| **W2** | Tenant and platform readiness | Pilot tenant provisioned; Keycloak realm imported; sample repos cloned and indexed; health checks green |
| **W3** | Baseline TTTD measurement | 3 baseline measurements per developer; numbers recorded; risk register seeded |
| **W4** | Stakeholder alignment + exit gate | Pilot charter reviewed by all stakeholders; baseline presented; exit gate signed |

## Baseline TTTD measurement

The baseline is the comparison floor for everything that follows.

### What is measured

Three artifact types: **ADR**, **Task Breakdown**, **Risk Register**.

### How

Three developers, each producing one of each artifact type, manually, in their normal environment. The timer starts when the developer says "I need an X" and stops when the artifact reaches the rubric's "ready for review" threshold.

### Output

A table per artifact type with three rows (one per developer) and three columns (start, stop, duration). Mean and standard deviation are computed.

### Caveats

- The manual workflow is the team's **current** workflow, not an idealized one. We measure what is, not what should be.
- The same rubric is used for baseline and pilot phases. No moving goalposts.
- Outliers (>2σ from the mean) are flagged but not discarded.

## Pilot scope

| Item | Decision |
|---|---|
| Repos | List of repos, with owners and tier |
| Teams | Teams participating, with leads |
| Artifact types | Which of the six typed artifacts are in scope |
| Reviewers | Named individuals for each approval role |
| Change freeze | Start, end, exceptions process |

## Platform readiness

The Platform Engineer must demonstrate:

- The LiteLLM Proxy is reachable from the tenant's network with a virtual key.
- The `forge-*` command surface is exposed (Command Center URL + CLI).
- The audit ledger is writing rows (verified by `SELECT COUNT(*) FROM audit_log`).
- The append-only grant is in place (verified by attempting an UPDATE).
- The hash chain anchor Lambda ran successfully at least once.
- CloudWatch dashboards show the standard panels.
- Alarms are configured and tested.

## Risk register seed

The risk register is a typed artifact. P0 seeds it with:

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Reviewer unavailable | High | Backup named in W1 | Pilot Owner |
| Tenant change freeze too tight | Medium | Negotiate exceptions for security | Dev Lead |
| LLM cost overrun | Medium | Per-tenant budget envelope | Platform Engineer |
| Connector failure on critical source | Medium | Fallback to manual ingest | Dev Lead |

## Exit gate

The P0 exit gate is signed when:

- Baseline TTTD is recorded and approved by the Pilot Sponsor.
- Pilot scope is confirmed and signed by all named participants.
- Platform readiness checks all green.
- Risk register is seeded with named mitigations.
- Pilot charter is signed and stored.

A failed gate halts P1. The PO, the Pilot Sponsor, and the Architect (L3) decide whether to extend P0, narrow scope, or halt.

## Related

- [P1 — Kickoff](/operations/pilot-p1/)
- [Success metrics](/operations/success-metrics/)
- [Pilot overview](/operations/pilot-overview/)
- [Rollback procedures](/operations/rollback/)
