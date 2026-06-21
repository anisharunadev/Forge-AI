---
title: Success Metrics
description: The seven KPIs that define Forge AI success — definitions, measurement, targets, owners.
---

This page is the authoritative definition of every KPI used in the Forge AI pilot and steady-state operations. Every runbook that measures, targets, or reports a KPI links here.

## Scope

KPIs cover the Forge AI Charter north star — **Time To Trusted Delivery** — and its operational decomposition.

## Constitutional anchor

Every KPI must be measurable under the eight constitutional rules. R6 (mandatory auditability) is the binding constraint: if a KPI cannot be derived from the audit log + cost ledger + artifact registry, it is not a KPI.

## KPI summary

| # | KPI | Direction | Pilot target | Steady-state target | Owner |
|---|---|---|---|---|---|
| 1 | [TTTD](#tttd-time-to-typed-draft) | Decrease | Directional improvement vs P0 baseline | ≥25% reduction vs baseline | Pilot Owner |
| 2 | [Acceptance Rate](#acceptance-rate) | Increase | ≥80% (P1.5 gate) | ≥85% | Pilot Owner |
| 3 | [Cycle Time](#cycle-time) | Decrease | TBD at P3 | TBD at P3 | Dev Lead |
| 4 | [Cost per Cycle](#cost-per-cycle) | Decrease | Within budget envelope | Within budget ±10% | Platform Engineer |
| 5 | [Approval Latency](#approval-latency) | Decrease | TBD at P3 | ≤24h p90 | Pilot Owner |
| 6 | [Developer NPS](#developer-nps) | Increase | ≥0 (neutral or positive) | ≥30 | Dev Lead |
| 7 | [Knowledge Reuse](#knowledge-reuse) | Increase | ≥10% of artifacts | ≥25% of artifacts | Steward |

Each KPI below has the same shape: definition, measurement, target, current value, owner.

---

## TTTD (Time To Typed Draft)

### Definition

Time To Typed Draft (TTTD) is the wall-clock time from the moment a developer (or agent acting on a developer's behalf) says *"I need an X"* to the moment X is at the level of fidelity required for human review.

| Symbol | Meaning |
|---|---|
| `t_need` | The moment the developer requests an artifact type (via `forge-*` command or explicit assignment) |
| `t_review_ready` | The moment the artifact is visible in the UI and meets the per-type rubric's "ready for review" threshold (composite ≥50) |
| `TTTD = t_review_ready - t_need` | Measured in seconds |

### What "ready for review" means

The artifact is rendered in the UI with all required sections per the per-type template. It is not necessarily *accepted* — only ready for the reviewer to score it.

### Measurement

| Source | Captured in |
|---|---|
| `t_need` | `forge-*` command invocation timestamp (audit log) |
| `t_review_ready` | Artifact `status=draft` event timestamp (audit log) + first UI render event (UI event log) |
| Aggregation | Per artifact type, per cycle, per tenant |

### Target

| Phase | Target |
|---|---|
| P0 baseline | Recorded manually — see [P0 §Baseline TTTD measurement](/operations/pilot-p0/#baseline-tttd-measurement) |
| P1 | First Aha Time recorded per [P1](/operations/pilot-p1/) |
| P1.5 | Per-artifact TTTD recorded for ≥15 artifacts |
| P2 | Directional improvement in ≥2 of 3 primary artifact types |
| P3 | ≥25% reduction vs P0 baseline with statistical reasoning |
| P4 | Sustained ≥25% reduction across waves |

### Current value

Updated at every phase exit gate. See the corresponding runbook's exit gate document.

### Owner

Pilot Owner (during pilot); Dev Lead (steady state).

---

## Acceptance Rate

### Definition

Acceptance Rate is the percentage of generated artifacts that pass review without requiring major revision.

| Symbol | Meaning |
|---|---|
| `n_accepted` | Artifacts with final composite ≥70 (i.e., `accept` or `accept_after_minor_edits`) |
| `n_total` | Total artifacts reviewed |
| `Acceptance Rate = n_accepted / n_total` | Reported as a percentage |

### Measurement

| Source | Captured in |
|---|---|
| `n_accepted` | `artifacts` table where `final_status IN ('accepted', 'accepted_after_minor_edits')` |
| `n_total` | `artifacts` table where `final_status IS NOT NULL` |
| Aggregation | Per artifact type, per cycle, per tenant |

### Target

| Phase | Target |
|---|---|
| P1 | First accepted artifact recorded |
| P1.5 | ≥80% (gate) |
| Steady state | ≥85% |

### Owner

Pilot Owner (during pilot); Pilot Owner (steady state).

---

## Cycle Time

### Definition

Cycle Time is the wall-clock time from the start of a workflow run to its completion (deploy or terminal reject).

### Measurement

| Source | Captured in |
|---|---|
| `t_start` | `workflows.started_at` |
| `t_end` | `workflows.ended_at` (success or terminal failure) |
| Aggregation | Per cycle, per tenant |

### Target

| Phase | Target |
|---|---|
| P3 | TBD at P3 — depends on per-tenant baseline |
| Steady state | TBD — depends on per-tenant baseline |

### Owner

Dev Lead.

---

## Cost per Cycle

### Definition

Cost per Cycle is the total LLM cost (in USD) attributed to a single workflow run.

| Source | Captured in |
|---|---|
| LLM cost | LiteLLM Proxy metrics, attributed by `workflow.id` |
| Aggregation | Sum per workflow run |

### Measurement

LiteLLM emits `litellm_cost_usd_total{tenant, model, command}`. The orchestrator attributes each call to a `workflow.id` via OTel attributes. Sum by workflow.id gives cost per cycle.

### Target

| Phase | Target |
|---|---|
| Pilot | Within budget envelope |
| Steady state | Within budget ±10% |

### Owner

Platform Engineer.

---

## Approval Latency

### Definition

Approval Latency is the wall-clock time between `gate_opened` and `gate_decided` for each HITL gate.

### Measurement

| Source | Captured in |
|---|---|
| `gate_opened` | Audit ledger row with `event = 'gate_opened'` |
| `gate_decided` | Audit ledger row with `event = 'gate_decided'` |
| Aggregation | p50, p90, p99 per gate type |

### Target

| Phase | Target |
|---|---|
| P2 | Architecture ≤ 8h p90, Security ≤ 12h p90, Deploy ≤ 4h p90 |
| Steady state | All gates ≤ 24h p90 |

### Owner

Pilot Owner.

---

## Developer NPS

### Definition

Developer NPS is the standard NPS question asked of developers who participate in the workflow:

> "On a scale of 0-10, how likely are you to recommend Forge AI to a peer developer?"

| Symbol | Meaning |
|---|---|
| `promoters` | Score 9-10 |
| `passives` | Score 7-8 |
| `detractors` | Score 0-6 |
| `NPS = %promoters - %detractors` | Reported as -100 to +100 |

### Measurement

Quarterly survey of all developers who have participated in ≥3 workflows in the last quarter.

### Target

| Phase | Target |
|---|---|
| Pilot | ≥0 |
| Steady state | ≥30 |

### Owner

Dev Lead.

---

## Knowledge Reuse

### Definition

Knowledge Reuse is the percentage of artifacts that derive from a prior lesson, template, or promoted rule.

| Source | Captured in |
|---|---|
| Artifact `source_ref` | Pointer to the lesson/template/policy that informed the artifact |
| Aggregation | Count of artifacts with non-null `source_ref` divided by total |

### Measurement

Each artifact carries a `source_ref` field that points to a `Lesson`, `Template`, or `OrgPolicy` that informed it. The Steward can query the count.

### Target

| Phase | Target |
|---|---|
| Pilot | ≥10% |
| Steady state | ≥25% |

### Owner

Steward.

---

## Reporting cadence

| KPI | Cadence | Audience |
|---|---|---|
| TTTD | Weekly | Pilot team, sponsor |
| Acceptance Rate | Weekly | Pilot team, sponsor |
| Cycle Time | Weekly | Pilot team |
| Cost per Cycle | Weekly | Platform Engineer, sponsor |
| Approval Latency | Weekly | Pilot team |
| Developer NPS | Quarterly | Pilot team, sponsor |
| Knowledge Reuse | Monthly | Steward, sponsor |

## Related

- [Pilot overview](/operations/pilot-overview/)
- [P0 — Pre-pilot](/operations/pilot-p0/)
- [P3 — Evaluation](/operations/pilot-p3/)
- [Architecture overview](/architecture/overview/)
