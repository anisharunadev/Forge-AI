# P1.5 — Validation Runbook

> **Phase.** P1.5 — Validation
> **Duration.** 1-2 weeks (target 1 week if P1 review feedback was clean; up to 2 weeks otherwise)
> **Owner.** Pilot Owner (PO)
> **Exit gate.** ≥80% acceptance across ≥15 artifacts; statistical readiness for P2.
> **Prerequisite.** [P1 — Kickoff](pilot-p1-kickoff.md) exit gate signed; first artifact reviewed and accepted; reviewer rotations active.

## Goal

Prove — with numbers, not anecdotes — that Forge can produce artifacts the pilot reviewers accept at a rate high enough to justify running P2. By the end of P1.5:

1. We have ≥15 artifacts spanning all six typed-artifact categories defined in the [Forge AI Charter §Principle 3](../CHARTER.md).
2. Each artifact is scored by 3 reviewers (architect, security, dev lead) on a per-artifact-type rubric.
3. **Acceptance rate ≥80%** across the artifact set.
4. We have a per-artifact metadata set sufficient to support P2's directional TTTD analysis.
5. A stop/continue decision is recorded.

If acceptance is below 80%, we do not enter P2. We either extend P1.5, re-scope P0/P1, or stop the pilot.

## Audience and Prerequisites

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P1.5 |
| Architect (L3) | Acceptance rubric, disagreement resolution |
| Security Reviewer | Security artifact rubric, disagreement resolution |
| Dev Lead | Task Breakdown + Deployment Plan rubric |
| Steward | Knowledge Reuse metric |

### Prerequisites

| # | Prerequisite | Source |
|---|---|---|
| P15-PR-1 | P1 exit gate signed | [pilot-p1-kickoff.md §Exit Gate](pilot-p1-kickoff.md#exit-gate-template) |
| P15-PR-2 | Reviewer rotations active and committed | [pilot-p0-pre-pilot.md §Stakeholder Identification](pilot-p0-pre-pilot.md#stakeholder-identification) |
| P15-PR-3 | Artifact Registry populated for the pilot tenant | F-010 from the [Implementation Plan §Package 1](../../implementation_plan.md) |
| P15-PR-4 | Acceptance rubric circulated and reviewed | This runbook, §Acceptance Criteria |
| P15-PR-5 | ≥15 architectural decisions queued across the pilot repos | Customer + Dev Lead |

## Artifact Counting Methodology

An **artifact** in P1.5 scope is a typed artifact as defined by the [Forge AI Charter §Principle 3](../CHARTER.md) and the [Implementation Plan §Package 4](../../implementation_plan.md). Six types count toward the 15-artifact minimum:

| Type | Code | What it is | Example command |
|---|---|---|---|
| **ADR** | `adr` | Architecture decision record | `forge-arch-new` |
| **API Contract** | `api_contract` | API definition (OpenAPI, GraphQL schema, AsyncAPI) | `forge-arch-api` |
| **Task Breakdown** | `tasks` | Work breakdown with estimates + dependencies | `forge-arch-tasks` |
| **Risk Register** | `risk_register` | Identified risks + mitigations | `forge-arch-risks` |
| **Security Report** | `security_report` | Threat model + mitigations for an architecture | `forge-sec-report` |
| **Deployment Plan** | `deployment_plan` | Release plan with HITL gates | `forge-deploy-plan` |

### What counts

| Counts | Does not count |
|---|---|
| An ADR draft produced by Forge and reviewed by ≥1 reviewer | Free-text notes from the team |
| An API Contract schema produced by Forge and reviewed | Repo-level summaries |
| A Task Breakdown produced by Forge and reviewed | TODOs or sprint planning artifacts |
| A Risk Register produced by Forge and reviewed | Ad-hoc threat models in chat |
| A Security Report produced by Forge and reviewed | Manual pen-test reports |
| A Deployment Plan produced by Forge and reviewed | Wiki pages describing deployment |

### Counting rules

- An artifact that goes through **major revision** (architect requests structural changes, not just wording) is counted as **one** artifact with `revisions=N`. It does not count twice.
- An artifact that the reviewer **rejects outright** counts once toward the 15-artifact total but does **not** count toward acceptance.
- An artifact that is later **superseded** by a newer artifact counts toward the 15-artifact total at the time it was first reviewed.

## Acceptance Criteria (Per-Artifact-Type Rubric)

Every artifact is scored on a 0-100 composite from a per-type rubric. Each rubric has 5 criteria weighted to total 100. The composite ≥70 is required to count as accepted for the ≥80% gate. (We use ≥70 as the per-artifact bar to leave headroom for the 80% pilot gate.)

### ADR Rubric (100 points)

| # | Criterion | Weight | What "good" looks like |
|---|---|---|---|
| 1 | Context accurately captures the problem and forces | 20 | Reader can restate the problem without rereading the source |
| 2 | Considered options are complete and distinct | 20 | At least 2 alternatives with pros/cons |
| 3 | Decision is unambiguous | 20 | A reader can tell what was decided and what was deferred |
| 4 | Consequences (positive + negative) are honest | 20 | Trade-offs are explicit; no silent costs |
| 5 | Cross-references to existing ADRs and standards are present | 20 | At least one link to existing tenant knowledge |

### API Contract Rubric (100 points)

| # | Criterion | Weight | What "good" looks like |
|---|---|---|---|
| 1 | Schema validates (OpenAPI/GraphQL/AsyncAPI) | 25 | Validator passes without errors |
| 2 | Endpoint/resource coverage matches the decision | 20 | All resources implied by the ADR are present |
| 3 | Error responses are documented | 15 | ≥4xx and ≥5xx documented with examples |
| 4 | Auth and rate-limit policies are explicit | 20 | Per [ADR-005](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md) policy layer |
| 5 | Cross-references to service catalog and standards | 20 | Links to service catalog entries and tenant standards |

### Task Breakdown Rubric (100 points)

| # | Criterion | Weight | What "good" looks like |
|---|---|---|---|
| 1 | Tasks are sized (≤2 days each) | 20 | No task > 16 hours of estimated work |
| 2 | Dependencies between tasks are explicit | 20 | DAG is reviewable in the UI |
| 3 | Estimates include confidence (low/med/high) | 15 | Each task has an estimate + confidence |
| 4 | Acceptance criteria per task | 25 | Each task has a verifiable outcome |
| 5 | Cross-references to standards and existing tasks | 20 | Links to relevant tenant standards |

### Risk Register Rubric (100 points)

| # | Criterion | Weight | What "good" looks like |
|---|---|---|---|
| 1 | Risks are categorized (security, ops, business, technical) | 20 | Each risk has a category |
| 2 | Probability × impact is explicit | 20 | Numeric scoring per risk |
| 3 | Mitigation owners are named | 20 | Every risk has a named owner |
| 4 | Mitigation steps are concrete and dated | 20 | Each step has a date or trigger |
| 5 | Cross-references to existing risk library | 20 | Links to existing tenant risk register |

### Security Report Rubric (100 points)

| # | Criterion | Weight | What "good" looks like |
|---|---|---|---|
| 1 | Threat model covers STRIDE categories | 25 | All 6 STRIDE categories addressed |
| 2 | Mitigations map to specific controls | 25 | Each mitigation cites a control ID or standard |
| 3 | Severity is justified with reasoning | 20 | Each finding has a written justification |
| 4 | Test/verification steps are included | 15 | Each mitigation has a verification step |
| 5 | Cross-references to security standards | 15 | Links to tenant security policies |

### Deployment Plan Rubric (100 points)

| # | Criterion | Weight | What "good" looks like |
|---|---|---|---|
| 1 | Pre-deploy checklist is complete | 20 | All gates enumerated |
| 2 | Rollback plan is explicit | 25 | Each step has a verified rollback |
| 3 | HITL approval points are listed | 20 | Per Rule 3 in the [Forge AI Charter](../CHARTER.md) |
| 4 | Observability + alerting included | 20 | Dashboards and alerts named |
| 5 | Cross-references to runbooks | 15 | Links to ops runbooks |

### Acceptance Decision

| Composite score | Decision |
|---|---|
| ≥85 | Accept (no changes) |
| 70-84 | Accept after minor edits |
| 50-69 | Major revision required (counts as one artifact with `revisions++`) |
| <50 | Reject (counts as one artifact toward 15 but does not count toward acceptance) |

The **80% acceptance gate** counts artifacts where the final composite is ≥70. Major revisions and rejections count toward the 15-artifact total but not the acceptance percentage.

## Sample Size

| Threshold | Why |
|---|---|
| **≥15 artifacts** | Statistically meaningful minimum for a binary accept/reject metric at 80% target. At n=15 and 12 acceptances (80%), the 95% confidence interval on the true acceptance rate is roughly ±20%. P3 will tighten this. |
| **All 6 artifact types represented** | A pilot that only generates ADRs is not validating the architecture pipeline |
| **≥3 artifacts per primary type (ADR, API Contract, Task Breakdown)** | These are the three types with the highest P2 cycle volume |
| **≥1 artifact of each secondary type (Risk Register, Security Report, Deployment Plan)** | These are the gates that block P2 cycles from completing |

If the sample size target cannot be met in 1 week, extend to 2 weeks. If still not met after 2 weeks, return to P0 with a `pivot` recommendation.

## Review Process

Each artifact is reviewed by 3 reviewers:

| Reviewer | Reviews | Why |
|---|---|---|
| **Architect** | ADR, API Contract, Deployment Plan | Owns architecture decisions per Rule 3 |
| **Security Reviewer** | Risk Register, Security Report | Owns security artifact sign-off per Rule 3 |
| **Dev Lead** | Task Breakdown, Deployment Plan | Owns implementation estimates and deploy readiness |

Some artifact types get two reviewers (e.g., Deployment Plan gets Architect + Dev Lead). For consistency, every artifact also gets a **third reviewer from outside the pilot team** for a sanity check — typically a Steward or another architect on rotation.

### Review Workflow

| Step | Action | SLA |
|---|---|---|
| 1 | Forge writes the artifact draft | — |
| 2 | Pilot Owner assigns the 3 reviewers | Same day |
| 3 | Each reviewer scores independently on the rubric | 24 hours per reviewer |
| 4 | Pilot Owner aggregates scores | Same day |
| 5 | If scores agree (within 10 points), composite is the average | — |
| 6 | If scores disagree (>10 points), run disagreement resolution | Same day |

### Reviewer Output

Each reviewer records their output in the artifact's metadata:

```yaml
artifact_id: ADR-009
type: adr
reviewers:
  - role: architect
    score: 82
    comments: "Context is solid; option 3 should be elaborated."
    accepted: true
  - role: dev-lead
    score: 78
    comments: "Decision is clear but task list cross-ref is missing."
    accepted: true
  - role: steward
    score: 80
    comments: "Cross-ref to standard SEC-007 is good."
    accepted: true
composite: 80
decision: accept_after_minor_edits
revisions: 0
```

## Disagreement Resolution

When reviewer scores diverge by more than 10 points, the pilot owner convenes a 30-minute resolution meeting.

### Resolution Procedure

| Step | Action |
|---|---|
| 1 | Each reviewer states their score and one-sentence rationale |
| 2 | Pilot Owner facilitates; identifies the source of disagreement |
| 3 | Reviewers may revise scores after discussion (revised scores recorded) |
| 4 | If still unresolved, the Architect on duty (L3) arbitrates; arbitration score becomes final |
| 5 | Disagreement and resolution are recorded in the artifact metadata |

### Disagreement Categories

| Category | Resolution |
|---|---|
| **Factual** (reviewer missed an existing standard) | Pilot Owner points to the standard; reviewer revises |
| **Interpretive** (reviewers read the rubric differently) | L3 architect arbitrates the rubric interpretation; recorded as a rubric clarification |
| **Judgment** (reviewers weigh trade-offs differently) | L3 architect arbitrates; recorded as a precedent for future reviews |
| **Procedural** (wrong reviewer type, missing context) | Pilot Owner re-runs review with the correct reviewer |

Disagreements are tracked in `docs/pilot/disagreements.md` and fed back into the rubric at P3.

## Data Collection

For each of the ≥15 artifacts we record:

| Field | Description | Source |
|---|---|---|
| `artifact_id` | Unique identifier | Artifact Registry |
| `type` | One of the 6 artifact types | This runbook |
| `complexity` | Low / medium / high (reviewer-rated) | Reviewer |
| `time_to_produce_seconds` | Forge agent wall-clock time from command invocation to draft | Forge audit log |
| `tokens_input` | Input tokens consumed | LiteLLM Proxy |
| `tokens_output` | Output tokens consumed | LiteLLM Proxy |
| `cost_usd` | Cost in USD | Cost ledger |
| `reviewer_scores` | Per-reviewer composite + comments | Reviewers |
| `composite_score` | Average composite | Aggregator |
| `decision` | accept / accept_after_minor_edits / major_revision / reject | Aggregator |
| `revisions` | Revision count | Forge artifact metadata |
| `knowledge_reuse_count` | Number of cross-references to existing tenant knowledge | Artifact content scan |
| `generated_at` | Timestamp | Forge audit log |
| `first_aha_seconds` | Time from command invocation to first visible draft in UI | UI event log |

### Storage

Artifact metadata is stored in the Artifact Registry (F-010) and exported weekly to `docs/pilot/validation-data-<week>.csv` for analysis in P3.

## Stop / Continue Gates

| Trigger | Action |
|---|---|
| After 7 artifacts, acceptance rate <50% | Halt. Re-scope P0/P1 with L3 architect. |
| After 10 artifacts, acceptance rate <70% | Halt. Escalate to L3 architect; recommend extending P1.5 by 1 week. |
| After 15 artifacts, acceptance rate ≥80% | Proceed to P2. |
| After 15 artifacts, acceptance rate 70-79% | Extend P1.5 by 1 week. Add 5 more artifacts. Re-evaluate. |
| After 20 artifacts, acceptance rate <80% | Halt. Recommend `pivot` or `stop` at P3. |
| Any artifact rejected for security reasons (Security Reviewer veto) | Halt immediately; escalate to L4. |

## Success Criteria Checklist

| # | Criterion | Target |
|---|---|---|
| 1 | Total artifacts reviewed | ≥15 |
| 2 | Artifact types represented | All 6 |
| 3 | Acceptance rate (composite ≥70) | ≥80% |
| 4 | Per-type acceptance rate | No type below 60% |
| 5 | Reviewer agreement (within 10 points) | ≥70% of reviews |
| 6 | Sample size for P3 statistical analysis | ≥15 |
| 7 | Metadata completeness | 100% of required fields populated |
| 8 | Cost per artifact recorded | 100% |

If any criterion is not met, do not sign the P1.5 exit gate.

## Exit Gate Template

```text
+----------------------------------------------------------------+
| FORGE AI PILOT — P1.5 EXIT GATE                                |
+----------------------------------------------------------------+
| Phase:    P1.5 — Validation                                    |
| Window:   <start_date> .. <end_date>                           |
| Pilot Owner: <name>                                            |
+----------------------------------------------------------------+
| 1. ARTIFACT SAMPLE                                             |
|    [ ] Total artifacts reviewed: ___ (target ≥15)              |
|    [ ] All 6 artifact types represented                       |
|    [ ] Per-type counts:                                        |
|        ADR: ___     API Contract: ___                          |
|        Tasks: ___   Risk Register: ___                         |
|        Security Report: ___  Deployment Plan: ___             |
+----------------------------------------------------------------+
| 2. ACCEPTANCE                                                  |
|    [ ] Overall acceptance rate: ___% (target ≥80%)            |
|    [ ] No type below 60%                                       |
|    [ ] Reviewer agreement (within 10 pts) ≥70% of reviews      |
+----------------------------------------------------------------+
| 3. METADATA                                                    |
|    [ ] Per-artifact metadata recorded                          |
|    [ ] Cost per artifact recorded                              |
|    [ ] Knowledge Reuse counts recorded                         |
+----------------------------------------------------------------+
| 4. RISKS                                                       |
|    [ ] No unresolved security vetoes                           |
|    [ ] Open disagreements documented                           |
+----------------------------------------------------------------+
| 5. RECOMMENDATION                                              |
|    [ ] PROCEED to P2                                           |
|    [ ] EXTEND P1.5 by 1 week (if acceptance 70-79%)            |
|    [ ] HALT and re-scope P0/P1                                 |
|    [ ] STOP pilot                                              |
+----------------------------------------------------------------+
| Signatures                                                     |
| Pilot Owner (PO):     ____________________  Date: __________   |
| Architect (L3):       ____________________  Date: __________   |
| Security Reviewer:    ____________________  Date: __________   |
+----------------------------------------------------------------+
```

## Cross-References

- **Previous phase.** [P1 — Kickoff](pilot-p1-kickoff.md) supplies the first artifact and the review cadence.
- **Next phase.** [P2 — Execution](pilot-p2-execution.md) uses the per-artifact metadata and acceptance data for cycle tracking.
- **Acceptance metric.** [success-metrics.md §Acceptance Rate](success-metrics.md#acceptance-rate) defines the formula.
- **Rollback.** [rollback-procedures.md](rollback-procedures.md) covers the path if P1.5 reveals a platform regression.
- **Architecture.** [Forge AI Charter §Principle 3](../CHARTER.md), [Architecture Overview §Data Flow](../architecture/overview.md).
