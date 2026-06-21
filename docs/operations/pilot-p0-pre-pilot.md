# P0 — Pre-Pilot Runbook

> **Phase.** P0 — Pre-pilot
> **Duration.** 4 weeks
> **Owner.** Pilot Owner (PO)
> **Exit gate.** Baseline TTTD recorded; pilot scope confirmed; pilot tenant onboarded; Keycloak realm imported; first tenant provisioned; sample repos selected.
> **Next phase.** [P1 — Kickoff](pilot-p1-kickoff.md)

## Goal

Stand up everything Forge needs to start generating real artifacts, **without** running any `forge-*` workflow against production work yet. By the end of P0 we have:

1. A reproducible baseline measurement of how long it takes a developer to produce an ADR + Task Breakdown + Risk Register by hand. This is the baseline against which TTTD improvement is judged.
2. A confirmed scope for the pilot (which repos, which teams, which artifact types).
3. A pilot tenant onboarded with Keycloak, project intelligence, and connectors wired up.
4. Stakeholders identified, RACI complete, risk register seeded.
5. A signed exit gate that authorizes P1 to begin.

## Audience and Prerequisites

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P0 |
| Architect (L3) | Stakeholder plan, exit gate |
| Security Reviewer | Risk register template, exit gate |
| Dev Lead | Baseline TTTD measurement, week-by-week plan |
| Platform Engineer | Pre-requisites, week-2 platform readiness |
| On-call (L1) | Week-2 platform readiness, escalation paths |

### Pre-requisites (must be true before P0 starts)

| # | Pre-requisite | Owner | Verified by |
|---|---|---|---|
| PR-1 | Paperclip code archived to `archive/paperclip/` per the [Implementation Plan §Phase 0](../../implementation_plan.md) | Platform Engineer | `ls archive/paperclip/` shows expected dirs |
| PR-2 | M1 substrate primitives built (event bus, LiteLLM, cost ledger, freshness ledger, RLS, append-only artifacts, connector failure states, policy engine) per [Implementation Plan §Phase 3](../../implementation_plan.md) | Platform Engineer | Smoke test checklist in `infra/` |
| PR-3 | GSD Core + GSD Pi installed and white-labeled as `forge-*` per [ADR-004](../architecture/decisions/0004-gsd-white-labeling.md) | Platform Engineer | `forge --help` shows ≥60 commands |
| PR-4 | LiteLLM Proxy deployed and reachable per [ADR-005](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md) | Platform Engineer | `/health/liveliness` returns 200 with virtual keys |
| PR-5 | PostgreSQL 17 + Apache AGE + pgvector deployed per [ADR-002](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md) | Platform Engineer | `SELECT extname FROM pg_extension` lists `age`, `vector` |
| PR-6 | Keycloak realm import script reviewed and tested in staging | Platform Engineer | Realm export + dry-run import in staging |
| PR-7 | Pilot customer (CMC) signs pilot charter with explicit scope, repos, and reviewers | Pilot Owner | Signed charter in `docs/pilot/charter.md` |

If any pre-requisite is not met at P0 kickoff, halt and resolve before starting week-1.

## Week-by-Week Plan

| Week | Theme | Outcomes |
|---|---|---|
| **W1** | Scope and baseline design | Pilot charter signed (pre-req); scope confirmed; baseline measurement protocol approved; stakeholders named |
| **W2** | Tenant and platform readiness | Pilot tenant provisioned; Keycloak realm imported; sample repos cloned and indexed; health checks green |
| **W3** | Baseline TTTD measurement | 3 baseline measurements per developer; numbers recorded; risk register seeded |
| **W4** | Trial run and exit gate | Forge generates a sample artifact in a sandbox; exit gate signed; P1 kickoff scheduled |

### Week 1 — Scope and Baseline Design

| Day | Activity | Owner |
|---|---|---|
| Mon | Pilot kickoff meeting; review charter; confirm scope | PO |
| Tue | Identify pilot repos with the customer (start with 3-5 repos that have existing ADRs) | PO + Dev Lead |
| Wed | Draft baseline TTTD protocol (see below); circulate to reviewers | PO |
| Thu | Identify reviewers per artifact type (architect, security, dev lead) | PO |
| Fri | Stakeholder map complete; RACI circulated | PO |

**W1 exit checklist:**

- [ ] Pilot charter signed and stored at `docs/pilot/charter.md`.
- [ ] Pilot scope (repos, teams, artifact types) documented and approved.
- [ ] Stakeholder map + RACI circulated.
- [ ] Baseline TTTD protocol approved by L3 architect.

### Week 2 — Tenant and Platform Readiness

| Day | Activity | Owner |
|---|---|---|
| Mon | Provision pilot tenant in Keycloak (see Keycloak realm import below) | Platform Engineer |
| Tue | Run tenant provisioning wizard (F-021) against the sample repos | Platform Engineer |
| Wed | Wire up connectors: GitHub, Jira, Confluence (per pilot scope) | Platform Engineer |
| Thu | Smoke test LiteLLM, RDS, Redis, audit log topology | Platform Engineer |
| Fri | Health checks green; baseline TTTD session scheduled | PO + Platform Engineer |

**W2 exit checklist:**

- [ ] Keycloak realm imported and verified.
- [ ] Pilot tenant provisioned with `tenant_id` and project records.
- [ ] Sample repos cloned, indexed by F-101, and visible in Project Intelligence.
- [ ] Connectors (GitHub, Jira, Confluence) report `healthy` per the connector failure states in the [Implementation Plan](../../implementation_plan.md).
- [ ] Audit log topology reachable; append-only WORM per [ADR-008](../architecture/decisions/0008-append-only-worm-audit-priority.md).
- [ ] Health-check endpoints return 200 per [oncall-runbook.md](oncall-runbook.md).

### Week 3 — Baseline TTTD Measurement

This is the most data-critical week of P0. The numbers we record here are what P3 compares against.

#### Baseline TTTD Protocol

**Definition.** Time To Typed Draft (TTTD) for a hand-written artifact is the wall-clock time from the moment the developer is told *"produce a typed draft of an ADR + Task Breakdown + Risk Register for this decision"* to the moment all three artifacts are at the same level of fidelity Forge would produce.

**Inputs.**

| Input | Source |
|---|---|
| Decision prompt | A real, recent architectural decision from the pilot repo's history |
| Organization knowledge | The pilot tenant's existing ADR template + risk register template |
| Time tracker | Stopwatch app + spreadsheet with `start_at`, `end_at` per artifact |
| Reviewer | Architect on-call scores the artifact on the same rubric used in P1.5 |

**Procedure.**

| Step | Action | Recorded |
|---|---|---|
| 1 | Developer opens a blank document for each artifact type | `start_at` |
| 2 | Developer reads existing related artifacts in the repo | (no time recorded — this is "research") |
| 3 | Developer writes the ADR | `adr_end_at` |
| 4 | Developer writes the Task Breakdown | `tasks_end_at` |
| 5 | Developer writes the Risk Register | `risks_end_at` |
| 6 | Architect scores each artifact on the P1.5 rubric | `score_adr`, `score_tasks`, `score_risks` (each 0-100) |

**Exclusions.** Time spent asking colleagues, time spent in meetings, and time spent waiting for reviews are *not* counted. Only the writing time is recorded.

**Sample size.** Minimum 3 baseline measurements per developer, across 3 developers, on 3 different decision prompts from the pilot repo. That gives us at least 9 baseline data points before P1 begins.

**Recording template.**

| Decision ID | Developer | Artifact | start_at | end_at | elapsed (min) | reviewer_score |
|---|---|---|---|---|---|---|
| DEC-001 | alice | ADR | 2026-06-23T09:00Z | 2026-06-23T10:30Z | 90 | 78 |
| DEC-001 | alice | Tasks | 2026-06-23T10:30Z | 2026-06-23T11:45Z | 75 | 72 |
| DEC-001 | alice | Risks | 2026-06-23T11:45Z | 2026-06-23T12:30Z | 45 | 81 |
| ... | ... | ... | ... | ... | ... | ... |

The total TTTD baseline is the sum of the three `elapsed` rows for each decision. The pilot target is *directional reduction* in this total; P3 records the actual delta and statistical significance.

**W3 exit checklist:**

- [ ] ≥9 baseline data points recorded (3 decisions × 3 developers).
- [ ] Mean and median per artifact type recorded.
- [ ] Reviewer scores recorded on the P1.5 rubric.
- [ ] Baseline numbers stored at `docs/pilot/baseline-tttd.md`.

### Week 4 — Trial Run and Exit Gate

| Day | Activity | Owner |
|---|---|---|
| Mon | Generate one sample artifact in a sandbox tenant (no real pilot decision) | Platform Engineer |
| Tue | Reviewer scores the sandbox artifact on the P1.5 rubric | Architect |
| Wed | Risk register reviewed and signed by Security Reviewer | Security Reviewer |
| Thu | Pilot Owner drafts the exit gate document | PO |
| Fri | Exit gate meeting; sign; schedule P1 kickoff | PO + L3 |

**W4 exit checklist:**

- [ ] Sandbox artifact generated and reviewed (no regressions in M1 substrate).
- [ ] Risk register template populated and reviewed.
- [ ] Exit gate document signed by PO and counter-signed by L3 architect.
- [ ] P1 kickoff date scheduled; daily standup template ready.

## Baseline TTTD Measurement (Detailed)

This section is a self-contained guide for the W3 baseline session. It can be lifted into a runbook for the W3 facilitator.

### Setup

1. Reserve a quiet room with one developer at a time.
2. Provide the decision prompt in writing (printed). Do not allow verbal clarifications.
3. Provide the ADR, Task Breakdown, and Risk Register templates from Organization Knowledge.
4. Start the stopwatch when the developer opens the first blank document.
5. Stop the stopwatch for each artifact only when the developer says *"draft complete, ready for review."*
6. Record `start_at`, `end_at`, and `elapsed_min` per row.

### Decision Prompt Selection

Pick three decisions that meet these criteria:

| Criterion | Why |
|---|---|
| Decision is from the last 90 days | Avoids stale context |
| Decision was actually implemented | Avoids decisions that were abandoned |
| Decision involves at least one cross-service change | Exercises the cross-cutting parts of the templates |
| Decision has an existing partial ADR or notes | Reflects realistic starting conditions |

### Reviewer Scoring

The reviewer scores each artifact on the P1.5 rubric (see [pilot-p15-validation.md §Acceptance Criteria](pilot-p15-validation.md#acceptance-criteria-per-artifact-type)). Record the per-criterion score and a single 0-100 composite.

### Output

The W3 deliverable is `docs/pilot/baseline-tttd.md` with:

- Per-developer raw rows.
- Mean, median, and 90th percentile per artifact type.
- Mean reviewer score per artifact type.
- A summary table suitable for the P3 evaluation report.

## Stakeholder Identification

| Stakeholder | Role | Engagement |
|---|---|---|
| Pilot customer sponsor (CMC exec) | Decision authority for scope changes | Weekly status; bi-weekly steering |
| Pilot customer tech lead | Day-to-day technical contact | Daily during P1; weekly thereafter |
| Pilot Owner (PO) | Forge pilot owner | Daily |
| Architect (L3) | Architecture reviewer + escalation | Twice-weekly review + on-call |
| Security Reviewer | Security artifact reviewer + L4 escalation | Weekly review + on-call |
| Dev Lead | Task Breakdown + Deployment Plan reviewer | Weekly review + on-call |
| Steward | Org Knowledge owner | Bi-weekly |
| Platform Engineer | Tenant + connector operations | Daily during W2; on-call thereafter |
| CISO delegate (L4) | Security incident authority | As-needed; required for exit gates |

RACI for each pilot phase is captured in the per-phase runbooks. P0 RACI lives in this runbook.

### P0 RACI

| Activity | PO | Architect | Security | Dev Lead | Platform Eng | Steward |
|---|---|---|---|---|---|---|
| Charter signature | A/R | C | C | C | I | I |
| Scope confirmation | A/R | C | C | C | C | I |
| Stakeholder map | A/R | I | I | I | I | I |
| Tenant provisioning | A | I | I | I | R | I |
| Keycloak realm import | A | I | I | I | R | I |
| Sample repo selection | A | C | I | C | R | I |
| Baseline TTTD measurement | A | C (reviewer) | I | C (facilitator) | I | I |
| Risk register seed | A | C | R | C | I | C |
| Exit gate | A/R | R | C | C | C | I |

*A = Accountable, R = Responsible, C = Consulted, I = Informed.*

## Risk Register Template

This template is populated during W3 and reviewed weekly thereafter. It feeds the P1.5 and P2 phase reviews.

| Risk ID | Description | Probability | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| P0-R-01 | Keycloak realm import fails on staging | Medium | High | Run import on staging first; document rollback | Platform Eng | Open |
| P0-R-02 | Sample repos too large for W2 indexing | Low | Medium | Cap indexing to top-3 services per repo | Platform Eng | Open |
| P0-R-03 | Baseline reviewers disagree on rubric scoring | Medium | Medium | Architect arbitrates; resolution recorded in baseline-tttd.md | Architect | Open |
| P0-R-04 | Customer changes pilot scope mid-P0 | Low | High | Charter amendment clause + change board | PO | Open |
| P0-R-05 | Pilot team lacks time for baseline measurement | Medium | High | PO negotiates dedicated W3 time with customer | PO | Open |

**Probability × Impact matrix.** High × High = block; High × Medium = escalate to L3; Medium × Medium = track in weekly review; Low × anything = log and move on.

## Keycloak Realm Import (Detail)

The pilot tenant needs an isolated Keycloak realm with the roles described in [Implementation Plan §Package 1 F-004](../../implementation_plan.md).

### Steps

1. Export the realm template from staging.
2. Rename the realm to the pilot tenant slug (e.g., `forge-pilot-cmc`).
3. Verify that the following roles exist:
   - `pilot-owner`
   - `architect`
   - `security-reviewer`
   - `dev-lead`
   - `steward`
   - `developer`
   - `viewer`
4. Bind pilot users to roles per the stakeholder map.
5. Enable MFA per NFR-004a.
6. Run the smoke test in [oncall-runbook.md](oncall-runbook.md) to confirm OIDC handshake.

### Verification

- `GET /realms/forge-pilot-cmc/.well-known/openid-configuration` returns 200.
- A test login with a pilot-owner role returns a token containing the expected `realm_access.roles`.
- The audit log records the realm import as an admin action.

## First Tenant Provisioning (Detail)

The first tenant is provisioned through the Onboarding Wizard (F-021) per the [Implementation Plan §Step 5](../../implementation_plan.md). The wizard creates:

- A `tenant_id` (UUID).
- One or more `project_id` rows (one per pilot repo).
- A default Organization Knowledge seed (templates, policies).
- Initial audit log anchor.

### Verification

- `SELECT count(*) FROM tenants WHERE slug = '<pilot-tenant>';` returns ≥1.
- `SELECT count(*) FROM projects WHERE tenant_id = '<id>';` matches the number of pilot repos.
- The wizard records an audit log row of type `tenant.provisioned`.

## Sample Repo Selection

Pick 3-5 repos that cover the breadth of the pilot team's work.

| Criterion | Why |
|---|---|
| Repo has at least 10 existing ADRs | Gives us baseline material |
| Repo spans at least one cross-service integration | Exercises the cross-cutting templates |
| Repo has an active Jira project | Lets us wire Jira connector |
| Repo has a CI/CD pipeline | Lets us wire Deployment Plan |
| Repo is small enough to ingest in <30 min | Keeps W2 timeline realistic |

Document the chosen repos in `docs/pilot/sample-repos.md` with the rationale.

## Success Criteria Checklist

This is the complete P0 success checklist. Every item must be true to exit P0.

### Scope and Baseline

- [ ] Pilot charter signed and stored.
- [ ] Pilot scope (repos, teams, artifact types) approved.
- [ ] ≥9 baseline TTTD data points recorded and stored.
- [ ] Baseline numbers reviewed by L3 architect.

### Platform Readiness

- [ ] Keycloak realm imported; smoke test passes.
- [ ] Pilot tenant provisioned via F-021.
- [ ] Sample repos cloned and indexed; visible in Project Intelligence.
- [ ] Connectors (GitHub, Jira, Confluence) report `healthy`.
- [ ] LiteLLM Proxy reachable; virtual keys issued.
- [ ] Audit log topology reachable; append-only WORM verified.
- [ ] Health-check endpoints return 200.

### Governance

- [ ] Stakeholder map + RACI circulated.
- [ ] Risk register seeded with at least 5 risks.
- [ ] Reviewer rotations assigned for P1.
- [ ] Daily standup template ready.
- [ ] P1 kickoff scheduled.

### Documentation

- [ ] `docs/pilot/charter.md` exists.
- [ ] `docs/pilot/baseline-tttd.md` exists.
- [ ] `docs/pilot/sample-repos.md` exists.
- [ ] `docs/pilot/risk-register.md` exists (seed of the master risk register).

## Exit Gate Template

```text
+----------------------------------------------------------------+
| FORGE AI PILOT — P0 EXIT GATE                                   |
+----------------------------------------------------------------+
| Phase:    P0 — Pre-pilot                                       |
| Window:   <start_date> .. <end_date>                           |
| Pilot Owner: <name>                                            |
+----------------------------------------------------------------+
| 1. SCOPE AND BASELINE                                          |
|    [ ] Pilot charter signed                                    |
|    [ ] Scope (repos, teams, artifact types) approved           |
|    [ ] ≥9 baseline TTTD data points recorded                   |
|    [ ] Baseline numbers reviewed by L3 architect               |
+----------------------------------------------------------------+
| 2. PLATFORM READINESS                                          |
|    [ ] Keycloak realm imported and verified                    |
|    [ ] Pilot tenant provisioned                                |
|    [ ] Sample repos indexed                                    |
|    [ ] Connectors healthy                                      |
|    [ ] LiteLLM reachable                                       |
|    [ ] Audit log reachable                                     |
|    [ ] Health checks green                                     |
+----------------------------------------------------------------+
| 3. GOVERNANCE                                                  |
|    [ ] Stakeholder map + RACI circulated                       |
|    [ ] Risk register seeded                                    |
|    [ ] Reviewer rotations assigned                             |
|    [ ] P1 kickoff scheduled                                    |
+----------------------------------------------------------------+
| 4. RECOMMENDATION                                              |
|    [ ] PROCEED to P1                                           |
|    [ ] DELAY P1 until: <reason>                                |
|    [ ] STOP pilot: <reason>                                    |
+----------------------------------------------------------------+
| Signatures                                                     |
| Pilot Owner (PO):  ____________________  Date: __________      |
| Architect (L3):    ____________________  Date: __________      |
| Security Reviewer: ____________________  Date: __________      |
+----------------------------------------------------------------+
```

If the recommendation is anything other than `PROCEED to P1`, halt the pilot, capture the reason in `docs/pilot/exit-decisions.md`, and escalate to L4.

## Cross-References

- **Next phase.** [P1 — Kickoff](pilot-p1-kickoff.md) (uses the baseline, reviewer rotations, and tenant provisioned here).
- **Success metrics.** [success-metrics.md §TTTD](success-metrics.md#tttd-time-to-typed-draft) defines how the P0 baseline is used.
- **On-call.** [oncall-runbook.md](oncall-runbook.md) covers the health checks run in W2.
- **Rollback.** [rollback-procedures.md §Tier-3](rollback-procedures.md#tier-3-rollback-tenant-revert) covers reverting the pilot tenant if W4 trial fails.
- **Charter and architecture.** [Forge AI Charter](../CHARTER.md), [Architecture Overview](../architecture/overview.md).
- **ADRs.** [ADR-002 PostgreSQL substrate](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md), [ADR-004 GSD white-label](../architecture/decisions/0004-gsd-white-labeling.md), [ADR-005 LiteLLM](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md), [ADR-008 audit log](../architecture/decisions/0008-append-only-worm-audit-trail.md).
