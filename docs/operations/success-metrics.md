# Forge AI — Success Metrics (KPI Definitions)

> **Purpose.** This document is the authoritative definition of every KPI used in the Forge AI pilot and steady-state operations. Every runbook that measures, targets, or reports a KPI links here.
>
> **Scope.** KPIs cover the [Forge AI Charter](../CHARTER.md) north star (Time To Trusted Delivery) and its operational decomposition.
>
> **Constitutional anchor.** Every KPI must be measurable under the eight constitutional rules. R6 (mandatory auditability) is the binding constraint: if a KPI cannot be derived from the audit log + cost ledger + artifact registry, it is not a KPI.

## KPI Summary

| # | KPI | Direction desired | Pilot target | Steady-state target | Owner |
|---|---|---|---|---|---|
| 1 | [TTTD](#tttd-time-to-typed-draft) | Decrease | Directional improvement vs P0 baseline | ≥25% reduction vs baseline | Pilot Owner |
| 2 | [Acceptance Rate](#acceptance-rate) | Increase | ≥80% (P1.5 gate) | ≥85% | Pilot Owner |
| 3 | [Cycle Time](#cycle-time) | Decrease | TBD at P3 | TBD at P3 | Dev Lead |
| 4 | [Cost per Cycle](#cost-per-cycle) | Decrease | Within budget envelope | Within budget ±10% | Platform Engineer |
| 5 | [Approval Latency](#approval-latency) | Decrease | TBD at P3 | ≤24h p90 | Pilot Owner |
| 6 | [Developer NPS](#developer-nps) | Increase | ≥0 (neutral or positive) | ≥30 | Dev Lead |
| 7 | [Knowledge Reuse](#knowledge-reuse) | Increase | ≥10% of artifacts | ≥25% of artifacts | Steward |

Each KPI below has the same shape: **definition, measurement, target, current value, owner**.

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
| P0 baseline | (recorded manually — see [pilot-p0-pre-pilot.md §Baseline TTTD](pilot-p0-pre-pilot.md#baseline-tttd-measurement)) |
| P1 | First Aha Time recorded per [pilot-p1-kickoff.md](pilot-p1-kickoff.md) |
| P1.5 | Per-artifact TTTD recorded for ≥15 artifacts |
| P2 | Directional improvement in ≥2 of 3 primary artifact types |
| P3 | ≥25% reduction vs P0 baseline with statistical reasoning |
| P4 | Sustained ≥25% reduction across waves |

### Current Value

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

### Per-type acceptance rate

The same formula is computed per artifact type (ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan). Per-type rates are tracked separately to avoid masking type-specific weaknesses.

### Measurement

| Source | Captured in |
|---|---|
| Per-artifact reviewer scores | Artifact Registry (F-010) |
| Per-artifact decision (`accept` / `accept_after_minor` / `major_revision` / `reject`) | Artifact Registry |
| Aggregation | Per phase, per cycle, per tenant |

### Target

| Phase | Target |
|---|---|
| P1.5 | ≥80% (gate to P2) |
| P2 | ≥80% sustained |
| P3 | Sustained; reported in final report |
| P4 | ≥85% across waves |

### Current Value

Updated weekly during P2 from the cycle tracking spreadsheet.

### Owner

Pilot Owner (during pilot); Architect (L3) (steady state).

---

## Cycle Time

### Definition

Cycle Time is the wall-clock time from the start of a feature request to the moment the feature is in production (deployed and reachable by users).

| Symbol | Meaning |
|---|---|
| `t_request` | The moment the feature request is captured (Jira ticket created, requirement artifact accepted) |
| `t_production` | The moment the deployment completes successfully |
| `Cycle Time = t_production - t_request` | Measured in hours |

### Cycle vs TTTD

Cycle Time includes everything: discovery, planning, building, testing, review, deployment, **and** all approval latency. TTTD is the subset that covers the "produce the artifact" portion. Cycle Time is the superset.

### Measurement

| Source | Captured in |
|---|---|
| `t_request` | Jira ticket creation timestamp (MCP Jira connector) |
| `t_production` | Deployment event timestamp (audit log) |
| Aggregation | Per cycle; per tenant |

### Target

| Phase | Target |
|---|---|
| P2 | Baseline recorded; directional improvement |
| P3 | Specific target set based on P2 data |
| P4 | Sustained target |

### Current Value

Updated weekly during P2 from the cycle tracking spreadsheet.

### Owner

Dev Lead.

---

## Cost per Cycle

### Definition

Cost per Cycle is the total LLM (and related) cost in USD attributed to a single SDLC cycle, from `t_request` to `t_production`.

| Symbol | Meaning |
|---|---|
| `cost_cycle` | Sum of all `cost_ledger` rows where `cycle_id = <cycle>` |
| Includes | LLM tokens, embedding tokens, MCP server costs (if metered) |
| Excludes | Human review time (tracked separately as `approval_latency_seconds`) |

### Measurement

| Source | Captured in |
|---|---|
| Per-call token counts | LiteLLM Proxy → cost ledger |
| Per-row cost attribution | `cost_ledger` table (per [Forge AI Charter §Principle 4](../CHARTER.md)) |
| Aggregation | Per cycle; per tenant; per model |

### Target

| Phase | Target |
|---|---|
| P0 | Budget envelope not yet set |
| P1 | Recorded but not gated |
| P2 | Within budget envelope (set at P2 start) |
| P3 | Reported in final report |
| P4 | Within budget ±10% |

### Current Value

Updated weekly from the cost ledger.

### Owner

Platform Engineer.

---

## Approval Latency

### Definition

Approval Latency is the wall-clock time an artifact spends in a human approval queue (HITL gate per Rule 3).

| Symbol | Meaning |
|---|---|
| `t_queued` | The moment the artifact enters the approval queue |
| `t_decided` | The moment the reviewer approves (or rejects) |
| `Approval Latency = t_decided - t_queued` | Measured in seconds, per gate |

### Gates tracked

| Gate | Reviewer | Trigger |
|---|---|---|
| Architecture | Architect | Before ADR / API Contract is `accepted` |
| Security | Security Reviewer | Before Security Report is final |
| Deployment | Dev Lead + Architect | Before production deploy |

### Measurement

| Source | Captured in |
|---|---|
| `t_queued` | Artifact event `entered_review_queue` (audit log) |
| `t_decided` | Artifact event `review_decision` (audit log) |
| Aggregation | Per gate, per reviewer, per cycle |

### Target

| Phase | Target |
|---|---|
| P2 | Recorded; specific target set at P3 |
| P3 | Target ≤24h p90 |
| P4 | Sustained |

### Current Value

Updated weekly from the audit log.

### Owner

Pilot Owner (during pilot); Dev Lead (steady state).

---

## Developer NPS

### Definition

Developer NPS (Net Promoter Score) is a measure of developer satisfaction with Forge, on a -100 to +100 scale.

| Symbol | Meaning |
|---|---|
| `% promoters` | % of developers who rate Forge 9-10 |
| `% detractors` | % of developers who rate Forge 0-6 |
| `NPS = % promoters - % detractors` | Range: -100 to +100 |

### Survey

A quarterly survey is sent to all developers who have used Forge in the prior quarter. The survey contains:

1. *"On a scale of 0-10, how likely are you to recommend Forge to another developer?"*
2. *"What is the primary reason for your score?"*
3. *"What is the single change that would most improve Forge for you?"*

### Measurement

| Source | Captured in |
|---|---|
| Survey responses | Quarterly survey tool |
| Aggregation | Quarterly; per tenant |

### Target

| Phase | Target |
|---|---|
| P2 | ≥0 (neutral or positive) |
| P3 | ≥30 |
| P4 | Sustained ≥30 |

### Current Value

Updated quarterly after each survey.

### Owner

Dev Lead.

---

## Knowledge Reuse

### Definition

Knowledge Reuse is the percentage of newly generated artifacts that reference existing organizational or project knowledge.

| Symbol | Meaning |
|---|---|
| `n_referenced` | Artifacts with ≥1 cross-reference to existing tenant knowledge |
| `n_total` | Total artifacts generated |
| `Knowledge Reuse = n_referenced / n_total` | Reported as a percentage |

### What counts as a cross-reference

A cross-reference is any link (markdown link, ADR reference, standard citation, etc.) to:

| Type | Example |
|---|---|
| Existing ADR | `[ADR-007](../architecture/decisions/0007-...)` |
| Tenant standard | `Standard SEC-007` |
| Existing risk | `Risk REG-042 in tenant risk register` |
| Existing service in catalog | `Service catalog entry svc-checkout` |
| Tenant-approved template | Used a tenant-approved ADR template |

### Measurement

| Source | Captured in |
|---|---|
| Artifact content | Artifact Registry |
| Existing knowledge graph | `org_knowledge_*` tables (Organization Knowledge layer) + `project_intel_*` tables (Project Intelligence layer) |
| Aggregation | Per artifact; per cycle; per tenant |

### Target

| Phase | Target |
|---|---|
| P1.5 | Recorded but not gated |
| P2 | ≥10% |
| P3 | Reported in final report |
| P4 | ≥25% across waves |

### Current Value

Updated weekly during P2 from the artifact metadata.

### Owner

Steward.

---

## Cross-References

- **Pilot phases.** [P0](pilot-p0-pre-pilot.md), [P1](pilot-p1-kickoff.md), [P1.5](pilot-p15-validation.md), [P2](pilot-p2-execution.md), [P3](pilot-p3-evaluation.md), [P4](pilot-p4-expansion.md).
- **Architecture.** [Forge AI Charter](../CHARTER.md) defines the north-star TTTD; [Architecture Overview](../architecture/overview.md) ties each KPI to an ADR.
- **Operational anchors.** [oncall-runbook.md](oncall-runbook.md) for monitoring data sources; [incident-response.md](incident-response.md) for when a KPI degrades due to an incident; [rollback-procedures.md](rollback-procedures.md) for trigger conditions.
