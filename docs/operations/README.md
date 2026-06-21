# Forge AI — Operations Runbooks

This directory contains the operational runbooks that govern the Forge AI pilot program (P0 through P4) and day-2 operations. It is the single entry point for on-call engineers, pilot owners, security responders, and stakeholder reviewers.

> **Mission.** Forge is the Delivery Operating System that orchestrates agents, knowledge, governance, and delivery workflows. Operations exists to keep that orchestration trustworthy, auditable, and continuously improving.
>
> See [Forge AI Charter](../CHARTER.md) and [Architecture Overview](../architecture/overview.md) for the platform definition. Every runbook in this directory is consistent with the eight constitutional rules (R1..R8) and the locked ADRs in [`docs/architecture/decisions/`](../architecture/decisions/README.md).

## Pilot Phases Overview

The Forge AI rebuild ships behind a six-phase pilot that validates the platform against real delivery work before expansion. Each phase has its own runbook.

| Phase | Name | Duration | Primary Goal | Runbook |
|---|---|---|---|---|
| **P0** | Pre-pilot | 4 weeks | Baseline TTTD recorded; pilot scope confirmed; pilot tenant onboarded | [pilot-p0-pre-pilot.md](pilot-p0-pre-pilot.md) |
| **P1** | Kickoff | 1 week | First artifact created in Forge from a real architectural decision | [pilot-p1-kickoff.md](pilot-p1-kickoff.md) |
| **P1.5** | Validation | 1-2 weeks | ≥80% acceptance across ≥15 artifacts; statistical readiness for P2 | [pilot-p15-validation.md](pilot-p15-validation.md) |
| **P2** | Execution | 8-12 weeks | Directional TTTD improvement; ≥12 full SDLC cycles | [pilot-p2-execution.md](pilot-p2-execution.md) |
| **P3** | Evaluation | 2 weeks | Go/no-go decision recorded; metric targets formalized | [pilot-p3-evaluation.md](pilot-p3-evaluation.md) |
| **P4** | Expansion | TBD | Conditional on P3 green — expand to additional teams/repos | [pilot-p4-expansion.md](pilot-p4-expansion.md) |

**Pilot success gate (gate to P4):**

1. Validation acceptance ≥80% across ≥15 artifacts (P1.5).
2. ≥12 full SDLC cycles completed in P2.
3. Directional improvement in Time To Typed Draft (TTTD) versus the P0 baseline.
4. Cost per cycle within the budget envelope defined in P2.
5. No unresolved Tier-2+ incidents at the P3 review.

If any gate fails, P3 records a `continue`, `pivot`, or `stop` recommendation; P4 does not begin.

## Roles and Responsibilities

| Role | Who | Primary Responsibility |
|---|---|---|
| **Pilot Owner (PO)** | Designated engineering manager | Owns pilot outcomes; signs exit gates; chairs P3 review |
| **Architect** | Senior architect on rotation | Reviews architecture artifacts (ADR, API Contract); first responder for design escalations |
| **Security Reviewer** | AppSec engineer on rotation | Reviews security artifacts (Security Report, Risk Register); first responder for security incidents |
| **Dev Lead** | Tech lead of the pilot team | Reviews code-impacting artifacts (Task Breakdown, Deployment Plan); first responder for build/test escalations |
| **Steward** | Tenant org-knowledge owner | Owns Organization Knowledge layer; resolves knowledge conflicts per [ADR-003](../architecture/decisions/0003-hybrid-mdm-steward-priority.md) |
| **Platform Engineer** | Backend / infra on-call (L2) | Owns LiteLLM, RDS, Redis, ECS, audit log topology |
| **On-call (L1)** | Rotating engineer | First responder for alerts; runs health checks per [oncall-runbook.md](oncall-runbook.md) |
| **Architect (L3)** | Designated architect | Escalation point for systemic issues and cross-cutting changes |
| **CISO delegate (L4)** | CISO or designee | Security incident authority; signs off on Tier-3 rollbacks and breach notifications |

Roles in the validation, execution, and evaluation phases are defined per-runbook (see the relevant phase). Role ownership and rotation live in the Steward repository.

## Escalation Paths

Escalation follows the L1 → L2 → L3 → L4 model. Every runbook cross-references the same chain.

```text
+--------------------------------------------------------------+
| L1 — On-call engineer (rotating)                             |
|     - Pages first; runs health checks; triages alerts        |
|     - Owns: oncall-runbook.md, Tier-1 rollback               |
+--------------------------------------------------------------+
                          |
                          v
+--------------------------------------------------------------+
| L2 — Platform engineer (L2)                                 |
|     - RDS, Redis, ECS, LiteLLM, audit log topology           |
|     - Owns: rollback-procedures.md Tier-1/2, oncall-runbook  |
+--------------------------------------------------------------+
                          |
                          v
+--------------------------------------------------------------+
| L3 — Architect (L3)                                         |
|     - Cross-cutting change, schema migration, design calls   |
|     - Owns: rollback-procedures.md Tier-3 (with PO)         |
+--------------------------------------------------------------+
                          |
                          v
+--------------------------------------------------------------+
| L4 — CISO delegate                                          |
|     - Security incidents, breach notification, audit escrow |
|     - Owns: incident-response.md containment/eradication     |
+--------------------------------------------------------------+
```

Trigger conditions per tier are documented in [rollback-procedures.md](rollback-procedures.md) and [incident-response.md](incident-response.md). Page the next tier via the on-call rotation; do not wait for a defined shift window if the incident is severity 1 or 2.

## Decision Authority

| Decision | Authority |
|---|---|
| Approve an architecture artifact (ADR, API Contract) | Architect (L3) review; Pilot Owner counter-signs at P3 |
| Approve a security artifact (Security Report, Risk Register) | Security Reviewer; CISO delegate (L4) escalates |
| Approve a deployment artifact (Deployment Plan) | Dev Lead + Pilot Owner; L4 escalates for prod |
| Pause a `forge-*` command (Tier-1 rollback) | L2 platform engineer |
| Disable a specific agent (Tier-2 rollback) | L3 architect + Pilot Owner |
| Revert a tenant to pre-pilot state (Tier-3 rollback) | L3 architect + Pilot Owner + L4 delegate |
| Trigger a security incident (Tier-1+) | Any reviewer; L4 delegate owns containment |
| Sign a pilot phase exit gate | Pilot Owner (PO); L3 architect counter-signs |

Authority for command disable, agent disable, and tenant revert is documented in detail in [rollback-procedures.md](rollback-procedures.md). Authority for incident containment is in [incident-response.md](incident-response.md).

## Document Index

### Pilot Phase Runbooks

| File | Purpose |
|---|---|
| [pilot-p0-pre-pilot.md](pilot-p0-pre-pilot.md) | P0 — pre-pilot (4 weeks): baseline TTTD, scope confirmation, tenant onboarding |
| [pilot-p1-kickoff.md](pilot-p1-kickoff.md) | P1 — kickoff (1 week): first artifact created in Forge |
| [pilot-p15-validation.md](pilot-p15-validation.md) | P1.5 — validation (1-2 weeks): ≥80% acceptance across ≥15 artifacts |
| [pilot-p2-execution.md](pilot-p2-execution.md) | P2 — execution (8-12 weeks): directional TTTD improvement, ≥12 cycles |
| [pilot-p3-evaluation.md](pilot-p3-evaluation.md) | P3 — evaluation (2 weeks): go/no-go decision recorded |
| [pilot-p4-expansion.md](pilot-p4-expansion.md) | P4 — expansion (TBD): phased rollout to more teams/repos |

### Operational Standards

| File | Purpose |
|---|---|
| [success-metrics.md](success-metrics.md) | KPI definitions: TTTD, Acceptance Rate, Cycle Time, Cost per Cycle, Approval Latency, NPS, Knowledge Reuse |
| [rollback-procedures.md](rollback-procedures.md) | When things go wrong: trigger conditions, tier definitions, decision authority |
| [oncall-runbook.md](oncall-runbook.md) | Day-2 operations: health checks, common alerts, on-call rotation, escalation |
| [incident-response.md](incident-response.md) | Security incident handling: detection, triage, containment, eradication, recovery |

### Related Reference Material

| Path | Purpose |
|---|---|
| [Forge AI Charter](../CHARTER.md) | Mission, principles, architecture, success criteria |
| [Architecture Overview](../architecture/overview.md) | Single-page architecture summary with ADR cross-references |
| [ADR Index](../architecture/decisions/README.md) | Locked ADRs that govern these runbooks |
| [Implementation Plan](../../implementation_plan.md) | 75 FRs, 11 milestones, pilot phasing summary |
| [Project Context](../project-context.md) | Constitutional rules, NFRs, functional requirements |

## Reading Order

New team members should read these in order:

1. [Forge AI Charter](../CHARTER.md) — the *why*.
2. [Architecture Overview](../architecture/overview.md) — the *what*.
3. [Pilot P0 runbook](pilot-p0-pre-pilot.md) — the *how we start*.
4. [Pilot P1 runbook](pilot-p1-kickoff.md) — the *first artifact*.
5. [Success metrics](success-metrics.md) — the *what we measure*.
6. [On-call runbook](oncall-runbook.md) — the *how we keep it running*.
7. [Incident response](incident-response.md) — the *how we recover*.
8. [Rollback procedures](rollback-procedures.md) — the *how we step back when needed*.

The remaining runbooks (P1.5, P2, P3, P4) are read at the start of each phase.
