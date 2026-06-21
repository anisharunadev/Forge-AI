# P2 — Execution Runbook

> **Phase.** P2 — Execution
> **Duration.** 8-12 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** Directional TTTD improvement; ≥12 full SDLC cycles; cost per cycle within budget; mid-pilot review passed.
> **Prerequisite.** [P1.5 — Validation](pilot-p15-validation.md) exit gate signed; acceptance rate ≥80% across ≥15 artifacts.

## Goal

Run Forge as the **delivery operating system** for the pilot team across the pilot scope, with the same cadence the team would use in steady-state. By the end of P2 we have:

1. **≥12 full SDLC cycles** completed (each cycle: discover → plan → build → test → review → deploy).
2. **Directional TTTD improvement** versus the P0 baseline.
3. Cost per cycle within the budget envelope set at P2 start.
4. A mid-pilot review at week 4 with documented adjustment actions.
5. A complete cycle-tracking dataset for P3 evaluation.

P2 is the largest, longest phase. It is also the phase where the platform's day-2 operations matter most: alerts, cost attribution, approval latency, and rollback all need to be exercised.

## Audience and Prerequisites

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P2 |
| Architect (L3) | Cycle definition, mid-pilot review |
| Security Reviewer | Security gates per cycle |
| Dev Lead | Cycle cadence, task review |
| Platform Engineer | Cost tracking, alerts |
| On-call (L1) | Common alerts during cycles |

### Prerequisites

| # | Prerequisite | Source |
|---|---|---|
| P2-PR-1 | P1.5 exit gate signed | [pilot-p15-validation.md §Exit Gate](pilot-p15-validation.md#exit-gate-template) |
| P2-PR-2 | Per-tenant budget envelope set | PO + Platform Engineer |
| P2-PR-3 | Cycle tracking spreadsheet ready | PO |
| P2-PR-4 | Reviewer rotations extended for 8-12 weeks | PO |
| P2-PR-5 | Customer committed to running real work through Forge | Customer + PO |

## Weekly Cadence

Each week follows the same shape:

| Day | Theme | Activities |
|---|---|---|
| Mon | **Kickoff** | Pick the cycle(s) for the week; assign owners; confirm reviewers |
| Tue-Wed | **Build** | Run `forge-arch-new`, `forge-arch-tasks`, `forge-dev-build`, etc. |
| Thu | **Review** | Reviewer rubric walkthrough; revise; promote to `accepted` |
| Fri | **Demo** | Cycle demo to the pilot team + sponsor; cost + audit one-liner; retrospective notes |

The cadence repeats every week. Cycles are not required to finish within one week; a cycle can span multiple weeks if its scope demands it. The cycle-tracking spreadsheet tracks per-cycle state regardless of calendar week.

## Cycle Definition

A **cycle** is one full loop through the SDLC. Forge supports the LangGraph-orchestrated loop per [ADR-007](../architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md).

```text
+----------+     +-------+     +-------+     +------+     +---------+     +----------+
| discover | --> | plan  | --> | build | --> | test | --> | review  | --> |  deploy  |
+----------+     +-------+     +-------+     +------+     +---------+     +----------+
     |               |             |            |             |               |
     v               v             v            v             v               v
  ingest          ADR, API       code       test report    reviewer       deployment
  repos,         contract,      patches,   + security     approval       plan,
  services,      task           agents     report         gate           HITL
  APIs, deps     breakdown,     run                                                  
                 risks
```

### Phase Mapping to Forge Commands

| Phase | Primary `forge-*` commands | Output artifact |
|---|---|---|
| discover | `forge-onboard-repo` (re-run if fresh), `forge-intel-ask` | Updated knowledge graph |
| plan | `forge-arch-new`, `forge-arch-api`, `forge-arch-tasks`, `forge-arch-risks` | ADR, API Contract, Task Breakdown, Risk Register |
| build | `forge-dev-build`, `forge-terminal` (Claude Code/Codex/Gemini in browser) | Code patches + terminal session log |
| test | `forge-test-run`, `forge-qa-report` | Test Report |
| review | `forge-review-pr`, `forge-sec-report` | Review comments + Security Report |
| deploy | `forge-deploy-plan`, manual HITL approval | Deployment Plan + production deploy |

### Cycle Start Conditions

A cycle is considered **started** when:

1. A decision or requirement is captured (e.g., a Jira ticket or an `forge-arch-new` invocation).
2. The Pilot Owner or Dev Lead assigns an owner.
3. The cycle has a unique `cycle_id` in the tracking spreadsheet.

### Cycle End Conditions

A cycle is considered **completed** when:

1. All six phases have produced their artifacts.
2. All HITL gates (architect, security, deployment) have approved.
3. The Deployment Plan is executed or scheduled for execution.
4. The cycle has a `status=completed` row in the tracking spreadsheet.

A cycle that ends prematurely (e.g., pivot, abandonment) is recorded with `status=abandoned` and `reason`.

## Cycle Tracking Spreadsheet Template

The tracking spreadsheet lives at `docs/pilot/cycles.csv` (or a Forge-native equivalent). It is the source of truth for P3 evaluation.

### Schema

| Column | Type | Description |
|---|---|---|
| `cycle_id` | string | Unique cycle identifier (e.g., `CYC-001`) |
| `title` | string | Short description |
| `owner` | string | Pilot team member responsible |
| `started_at` | ISO 8601 | Cycle start timestamp |
| `discover_end_at` | ISO 8601 | Discover phase complete |
| `plan_end_at` | ISO 8601 | Plan phase complete |
| `build_end_at` | ISO 8601 | Build phase complete |
| `test_end_at` | ISO 8601 | Test phase complete |
| `review_end_at` | ISO 8601 | Review phase complete |
| `deploy_end_at` | ISO 8601 | Deploy phase complete |
| `status` | enum | `in_progress`, `completed`, `abandoned`, `blocked` |
| `tttd_seconds` | int | TTTD for this cycle's primary artifact |
| `cost_usd` | decimal | Total LLM cost for this cycle |
| `approval_latency_seconds` | int | Time spent in HITL approval queues |
| `acceptance` | enum | `accept`, `accept_after_minor`, `major_revision`, `reject` |
| `complexity` | enum | `low`, `medium`, `high` |
| `notes` | string | Free-form notes |

### Example Rows

| cycle_id | title | owner | status | tttd_seconds | cost_usd | approval_latency_seconds | acceptance |
|---|---|---|---|---|---|---|---|
| CYC-001 | Move checkout to async events | alice | completed | 1840 | 12.40 | 3600 | accept |
| CYC-002 | Add idempotency keys to payments | bob | in_progress | — | 4.10 | 1200 | accept_after_minor |
| CYC-003 | Migrate users table to new schema | carol | blocked | — | 2.30 | 7200 | — |

### Weekly Roll-up

Every Friday, the Pilot Owner rolls up the spreadsheet into a weekly summary at `docs/pilot/weekly-summary-<week>.md` with:

- Total cycles started, completed, blocked, abandoned.
- Mean TTTD for the week.
- Total cost for the week.
- Top blocker (if any).
- Mid-pilot adjustment notes (week 4 only).

## Cost Tracking

Cost tracking is non-negotiable in P2. Every cycle has a cost row in the ledger per [Forge AI Charter §Principle 4](../CHARTER.md).

### Per-Cycle Cost

| Source | Captured in |
|---|---|
| LLM input tokens | LiteLLM Proxy → cost ledger |
| LLM output tokens | LiteLLM Proxy → cost ledger |
| Embedding tokens (pgvector) | Embedding service → cost ledger |
| MCP server calls | Cost ledger (treat as $0 unless metered) |
| Human review time | Tracked separately as `approval_latency_seconds` |

### Per-Tenant Budget Alerts

| Threshold | Action |
|---|---|
| 50% of weekly budget consumed | Log warning; PO reviews |
| 80% of weekly budget consumed | Alert L2 platform; PO reviews |
| 100% of weekly budget consumed | Alert L3 architect; consider Tier-1 rollback per [rollback-procedures.md §Cost Overrun](rollback-procedures.md#trigger-conditions) |
| 120% of weekly budget consumed | Tier-1 rollback to manual for non-critical phases |

The per-tenant budget is set at P2 start and revised at the mid-pilot review.

## Tool Usage by Phase

| Phase | Primary tools | Optional tools |
|---|---|---|
| discover | `forge-onboard-repo`, `forge-intel-ask`, MCP GitHub/Jira/Confluence | `repomix`, `gsd-graphify` |
| plan | `forge-arch-new`, `forge-arch-api`, `forge-arch-tasks`, `forge-arch-risks` | `forge-arch-preview` (preview before commit) |
| build | `forge-dev-build`, Forge Terminal Center with Claude Code/Codex/Gemini | `forge-dev-patch`, custom agent selection |
| test | `forge-test-run`, `forge-qa-report`, MCP SonarQube | `forge-test-gen` |
| review | `forge-review-pr`, `forge-sec-report` | `forge-arch-trace` (traceability matrix) |
| deploy | `forge-deploy-plan`, manual HITL approval, AWS deploy | `forge-deploy-rollback` |

The Terminal Center ([ADR-006](../architecture/decisions/0006-terminal-center-xterm-native-pty.md)) is used heavily in the build phase. Workspace isolation per F-408 ensures each agent runs in its own PTY with cwd = session workspace.

## Approval Gate Metrics

Approval gates per Rule 3 ([Forge AI Charter](../CHARTER.md)) are HITL pauses. The time spent in each gate is a P2 KPI.

### Gates and Owners

| Gate | Owner | Trigger |
|---|---|---|
| Architecture | Architect | Before ADR / API Contract is promoted to `accepted` |
| Security | Security Reviewer | Before Security Report is marked final |
| Deployment | Dev Lead + Architect | Before any production deploy |

### Approval Latency

`approval_latency_seconds` is the wall-clock time from when the artifact enters the queue to when the reviewer approves (or rejects). The pilot tracks:

- Mean approval latency per gate.
- p90 approval latency per gate.
- Approval latency as a percentage of total cycle time.

Targets are set at P2 start and revised at the mid-pilot review.

## Issue Escalation Paths

| Issue | Escalation |
|---|---|
| Approval gate stuck (>24h) | Pilot Owner → Architect on duty |
| Cost anomaly (single cycle >2x median) | Platform Engineer → L2 → L3 if pattern |
| Agent produces nonsense output | Dev Lead → Pilot Owner → L3 if systemic |
| Connector goes `failed` or `quarantined` | On-call (L1) → Platform Engineer (L2) per [oncall-runbook.md](oncall-runbook.md) |
| Security finding in generated artifact | Security Reviewer → L4 CISO delegate per [incident-response.md](incident-response.md) |
| Cycle blocked on dependency | Pilot Owner → Customer sponsor |
| Repeated reviewer disagreement (≥3 in a week) | Pilot Owner → L3 architect for rubric arbitration |

## Mid-Pilot Review (Week 4)

The mid-pilot review is the most important governance event in P2. It is a 2-hour meeting with all reviewers + the pilot sponsor.

### Inputs

| Input | Source |
|---|---|
| Cycle tracking spreadsheet roll-up | PO |
| Cost ledger roll-up | Platform Engineer |
| Per-cycle TTTD vs P0 baseline | PO |
| Approval latency report | PO |
| Open risk register | PO |
| Reviewer feedback summary | Each reviewer |

### Agenda (2 hours)

| Time | Topic | Owner |
|---|---|---|
| 0:00 | Status: cycles started, completed, blocked, abandoned | PO |
| 0:15 | TTTD directional review | PO |
| 0:30 | Cost review | Platform Engineer |
| 0:45 | Approval latency review | PO |
| 1:00 | Open risks | PO |
| 1:15 | Adjustment protocol proposals | Each reviewer |
| 1:45 | Decision: continue / adjust / halt | PO + L3 architect |
| 1:55 | Action items and owners | PO |

### Decision Outcomes

| Outcome | Trigger |
|---|---|
| **Continue** | Directional TTTD improvement observed; cost within budget; no systemic issues |
| **Adjust** | One or two specific adjustments proposed (rubric tweak, cost reallocation, reviewer rotation change) |
| **Halt** | Cost overrun, security incident, or systemic quality regression |

The mid-pilot decision is recorded at `docs/pilot/mid-pilot-decision-<week>.md`.

## Adjustment Protocol

When the mid-pilot review (or weekly review) identifies an adjustment, the PO follows this protocol.

### Adjustment Categories

| Category | Examples | Authority |
|---|---|---|
| **Rubric tweak** | Add/remove a criterion, change a weight | L3 architect |
| **Cost reallocation** | Raise per-tenant budget, reduce non-essential calls | PO + L3 architect |
| **Reviewer rotation** | Add a reviewer, swap a reviewer | PO |
| **Scope narrowing** | Pause a cycle type, focus on one artifact type | PO + L3 architect + sponsor |
| **Scope expansion** | Add a cycle type, add a repo | PO + sponsor |
| **Tier-1 rollback** | Pause a `forge-*` command | L2 platform engineer |

### Adjustment Procedure

| Step | Action |
|---|---|
| 1 | PO documents the adjustment in `docs/pilot/adjustments.md` |
| 2 | Authority approves per the table above |
| 3 | Adjustment is communicated at the next standup |
| 4 | Effect is measured in the next weekly review |
| 5 | Adjustment is logged in the P3 final report |

## Success Criteria

| # | Criterion | Target |
|---|---|---|
| 1 | Full SDLC cycles completed | ≥12 |
| 2 | TTTD improvement vs P0 baseline | Directional (see below) |
| 3 | Cost per cycle | Within budget envelope |
| 4 | Mid-pilot review held at week 4 | Yes |
| 5 | Mid-pilot decision recorded | Continue / Adjust / Halt |
| 6 | Cycle tracking spreadsheet maintained weekly | 100% of weeks |
| 7 | Per-cycle artifact metadata complete | ≥90% of cycles |
| 8 | No unresolved Tier-2+ incidents at P2 exit | Yes |
| 9 | Reviewer rotation covered every week | 100% |

### Directional TTTD

| Outcome | Definition |
|---|---|
| **Improvement** | Mean cycle TTTD is lower than the corresponding P0 baseline artifact TTTD for at least 2 of the 3 primary artifact types (ADR, API Contract, Task Breakdown) |
| **No change** | Mean cycle TTTD is within ±10% of baseline |
| **Regression** | Mean cycle TTTD is >10% above baseline |

Statistical significance is computed in P3, not P2. P2 only establishes direction.

## Exit Gate Template

```text
+----------------------------------------------------------------+
| FORGE AI PILOT — P2 EXIT GATE                                   |
+----------------------------------------------------------------+
| Phase:    P2 — Execution                                       |
| Window:   <start_date> .. <end_date>                           |
| Pilot Owner: <name>                                            |
+----------------------------------------------------------------+
| 1. CYCLE VOLUME                                                 |
|    [ ] Total cycles started: ___                               |
|    [ ] Total cycles completed: ___ (target ≥12)                 |
|    [ ] Cycles blocked at exit: ___                             |
|    [ ] Cycles abandoned: ___                                   |
+----------------------------------------------------------------+
| 2. TTTD                                                         |
|    [ ] Mean TTTD for ADR: ___ min (baseline: ___ min)           |
|    [ ] Mean TTTD for API Contract: ___ min (baseline: ___ min) |
|    [ ] Mean TTTD for Task Breakdown: ___ min (baseline: ___ min)|
|    [ ] Directional improvement in ≥2 of 3 primary types         |
+----------------------------------------------------------------+
| 3. COST                                                         |
|    [ ] Total spend: $___ (budget: $___)                        |
|    [ ] Mean cost per cycle: $___                               |
|    [ ] No uncontrolled overrun                                 |
+----------------------------------------------------------------+
| 4. GOVERNANCE                                                   |
|    [ ] Mid-pilot review held at week 4                          |
|    [ ] Mid-pilot decision recorded                             |
|    [ ] Adjustments tracked                                     |
+----------------------------------------------------------------+
| 5. INCIDENTS                                                    |
|    [ ] No unresolved Tier-2+ incidents                          |
|    [ ] Open disagreements documented                           |
+----------------------------------------------------------------+
| 6. RECOMMENDATION                                              |
|    [ ] PROCEED to P3                                           |
|    [ ] EXTEND P2 by 2 weeks (if cycles <12)                    |
|    [ ] HALT and re-scope                                       |
+----------------------------------------------------------------+
| Signatures                                                     |
| Pilot Owner (PO):     ____________________  Date: __________   |
| Architect (L3):       ____________________  Date: __________   |
| Security Reviewer:    ____________________  Date: __________   |
| Platform Engineer:    ____________________  Date: __________   |
+----------------------------------------------------------------+
```

## Cross-References

- **Previous phase.** [P1.5 — Validation](pilot-p15-validation.md) supplies the per-artifact metadata baseline.
- **Next phase.** [P3 — Evaluation](pilot-p3-evaluation.md) consumes the cycle tracking spreadsheet.
- **Metrics.** [success-metrics.md](success-metrics.md) defines TTTD, Cycle Time, Cost per Cycle, and Approval Latency.
- **On-call.** [oncall-runbook.md](oncall-runbook.md) covers the alerts P2 will exercise.
- **Rollback.** [rollback-procedures.md](rollback-procedures.md) covers the Tier-1/2/3 paths if P2 reveals regressions.
- **Incident response.** [incident-response.md](incident-response.md) for any security findings.
- **Architecture.** [ADR-007 LangGraph orchestrator](../architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md), [ADR-006 Terminal Center](../architecture/decisions/0006-terminal-center-xterm-native-pty.md).
