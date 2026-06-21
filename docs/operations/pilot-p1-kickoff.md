# P1 — Kickoff Runbook

> **Phase.** P1 — Kickoff
> **Duration.** 1 week (5 business days)
> **Owner.** Pilot Owner (PO)
> **Exit gate.** First artifact created in Forge from a real architectural decision and reviewed/accepted by the architect.
> **Prerequisite.** [P0 — Pre-pilot](pilot-p0-pre-pilot.md) exit gate signed; baseline TTTD recorded; reviewer rotations assigned.

## Goal

Generate the **first real artifact** in Forge from a real architectural decision in the pilot repo, and have it reviewed and accepted by the architect on rotation.

By the end of P1 we have:

1. The pilot team onboarded through the Forge Onboarding Wizard (F-021).
2. A real architectural decision ingested via `forge-arch-new`.
3. A first usable artifact (an ADR, plus at minimum an outline of the API Contract and Task Breakdown per [ADR-007](../architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md)).
4. **First Aha Time** recorded: time from `forge-arch-new` invocation to first usable artifact.
5. Daily standups running; reviewer feedback loop working.
6. Exit gate signed to proceed to [P1.5 — Validation](pilot-p15-validation.md).

P1 is intentionally short. The point is *first artifact in hand*, not full coverage. P1.5 expands to ≥15 artifacts.

## Audience and Prerequisites

| Audience | Read this section |
|---|---|
| Pilot Owner | All of P1 |
| Architect (L3) | First artifact review, exit gate |
| Pilot team (developers) | Kickoff agenda, daily standup |
| Platform Engineer | Onboarding wizard walkthrough |

### Prerequisites

| # | Prerequisite | Source |
|---|---|---|
| P1-PR-1 | P0 exit gate signed | [pilot-p0-pre-pilot.md §Exit Gate](pilot-p0-pre-pilot.md#exit-gate-template) |
| P1-PR-2 | Pilot tenant provisioned, connectors healthy | [pilot-p0-pre-pilot.md §W2](pilot-p0-pre-pilot.md#week-2--tenant-and-platform-readiness) |
| P1-PR-3 | Sample repos indexed and visible in Project Intelligence | [pilot-p0-pre-pilot.md §Sample Repo Selection](pilot-p0-pre-pilot.md#sample-repo-selection) |
| P1-PR-4 | Reviewer rotations assigned | [pilot-p0-pre-pilot.md §Stakeholder Identification](pilot-p0-pre-pilot.md#stakeholder-identification) |
| P1-PR-5 | A real architectural decision queued for the pilot team | Customer + Dev Lead |

## Kickoff Agenda (Day 1, 90 minutes)

| Time | Topic | Owner |
|---|---|---|
| 0:00 | Welcome + pilot mission reminder | PO |
| 0:10 | Recap of P0 baseline TTTD numbers | PO |
| 0:20 | Walk through the pilot roadmap (P1 → P4) | PO |
| 0:35 | Onboarding wizard demo (F-021) | Platform Engineer |
| 0:55 | First command: `forge-onboard-repo` for the pilot repo | Dev Lead |
| 1:15 | Reviewer rubric walkthrough (preview of P1.5 acceptance criteria) | Architect |
| 1:25 | Q&A and assignment of the first architectural decision | PO |

The kickoff is recorded and posted to the pilot channel for absent team members.

## Onboarding Wizard Walkthrough (F-021)

The Onboarding Wizard (F-021) is the entry point for a new pilot team. It walks the team through:

1. **Tenant confirmation.** Verifies the `tenant_id` and project list.
2. **Connector selection.** Picks which connectors to enable (GitHub, Jira, Confluence at minimum).
3. **Role assignment.** Maps pilot team members to Keycloak roles.
4. **Repository selection.** Picks which repos to ingest.
5. **Ingestion run.** Kicks off F-101 (Repo Ingestion) and F-103 (Architecture Discovery) per the [Implementation Plan §Package 2](../../implementation_plan.md).
6. **First artifact preview.** Shows the team what an ADR will look like once generated.

### Wizard Acceptance Checklist

| # | Step | Verified by | Expected outcome |
|---|---|---|---|
| 1 | Tenant loads | Developer | Tenant name and project list visible |
| 2 | Connectors enabled | Developer | Each connector reports `healthy` per [oncall-runbook.md](oncall-runbook.md) |
| 3 | Roles assigned | Developer | User profile shows correct role |
| 4 | Repos ingested | Architect | Repos appear in Project Intelligence |
| 5 | Ingestion complete | Architect | No `failed` or `quarantined` connector state |
| 6 | Preview rendered | Developer | ADR preview is recognizable |

If any step fails, do not proceed to the first command. Resolve the failure first; it almost always indicates a connector or RLS issue.

## First Command: `forge-onboard-repo`

The first command the pilot team runs against their repo is `forge-onboard-repo`. This wraps the GSD `init` workflow per [ADR-004](../architecture/decisions/0004-gsd-white-labeling.md) and creates the per-repo context Forge needs to generate architecture artifacts.

### Command

```text
forge-onboard-repo --tenant <pilot-tenant> --repo <repo-slug>
```

### Expected Behavior

1. Validates the user has `pilot-owner` or `developer` role.
2. Reads the existing repo from the GitHub connector.
3. Runs repomix + graphify + map-codebase per [Implementation Plan §Step 7](../../implementation_plan.md).
4. Stores the resulting knowledge graph nodes in PostgreSQL with `tenant_id` + `project_id` (RLS enforced per [ADR-002](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md)).
5. Records every ingestion event to the append-only audit log per [ADR-008](../architecture/decisions/0008-append-only-worm-audit-trail.md).
6. Returns a summary including the count of services, APIs, and dependencies discovered.

### Verification

| Check | Expected |
|---|---|
| Command exit code | 0 |
| Output | Counts of services, APIs, dependencies |
| Audit log | At least one row per ingestion event with hash chain anchor |
| Project Intelligence UI | Repo visible in React Flow graph |
| Cost ledger | Cost row created and tied to the user + workflow |

If the command returns non-zero, escalate to L2 platform engineer. Do not proceed to the first architecture artifact until the repo is onboarded.

## First Architecture Decision Intake: `forge-arch-new`

Once the repo is onboarded, the pilot team kicks off the first architecture decision via `forge-arch-new`. This is the moment we measure **First Aha Time**.

### Command

```text
forge-arch-new --tenant <pilot-tenant> --repo <repo-slug> --decision "<one-line decision>"
```

### Sample Input

```text
forge-arch-new \
  --tenant forge-pilot-cmc \
  --repo checkout-svc \
  --decision "Switch checkout service from synchronous REST to async event-driven via SNS/SQS to absorb Black Friday load"
```

### Sample Output (ADR draft)

```markdown
# ADR-009: Async event-driven checkout for Black Friday load

- Status: Draft
- Date: 2026-06-30
- Deciders: Forge SDLC agent (architect)
- Context: ...

## Context and Problem Statement

The checkout-svc currently serves ~1.2k orders/min on a steady-state basis and
~6k orders/min during Black Friday peaks (2025: 2025-11-28 19:00-23:00 UTC).
Synchronous REST + RDS read replicas absorbs the steady state but degrades
above ~2.5k orders/min, leading to a 7% cart abandonment at peak.

We need to choose a load-shedding and back-pressure strategy that:
- Preserves the existing API contract for clients that cannot migrate.
- Decouples write-path latency from downstream processing latency.
- Maintains idempotency under retries.

## Considered Options

1. Vertical RDS scale-up (no architectural change).
2. Async event-driven via SNS/SQS with a worker fleet.
3. Async event-driven via Kafka with a stream-processing layer.

## Decision

Option 2: SNS topic `checkout.orders.placed` + SQS queue + worker fleet
sized for ~2x peak load. RDS retained as the system of record.

## Consequences

Positive:
- p99 write-path latency decoupled from downstream processing.
- Worker fleet scales horizontally per SQS backlog.
- Idempotency via order-id dedup in workers.

Negative:
- Operational cost of SQS + worker fleet at baseline (~+$2.4k/mo).
- Client teams need to consume the new event for any downstream effects.
- Observability needs distributed tracing across SNS/SQS.

## Pros and Cons of the Options

... (full pros/cons per ADR template)
```

The output is a **draft** — Rule 3 (mandatory human approval) requires architect review before promotion to `Accepted`. P1's exit gate requires that draft to be reviewed and accepted.

### Verification

| Check | Expected |
|---|---|
| Command exit code | 0 |
| Output | Markdown ADR draft |
| Artifact Registry | One `adr` artifact stored with `status=draft` |
| Audit log | One row per agent step + one row per LLM call (prompt hash, model, cost) |
| Cost ledger | Cost row with prompt + completion token counts and USD |
| Architect notification | Architect receives a review notification |

## First Aha Time Measurement

**First Aha Time** is the time from `forge-arch-new` invocation to the moment the architect sees a usable ADR draft in the UI. It is the first measurable signal of value.

### How to Measure

| Step | Record |
|---|---|
| 1. Pilot team runs `forge-arch-new` (record `t0`) | `t0` |
| 2. Forge streams progress over WebSocket (architecture discovery, prompt build, LLM call, draft write) | streamed |
| 3. Architect opens the draft in the UI (record `t1`) | `t1` |
| 4. First Aha Time = `t1 - t0` | `first_aha_time_seconds` |

### Targets

| Outcome | First Aha Time |
|---|---|
| Strong success | < 5 minutes |
| Acceptable | 5-15 minutes |
| Needs investigation | 15-30 minutes |
| Block | > 30 minutes |

### Recording

First Aha Time is recorded in `docs/pilot/first-aha-time.md` along with the breakdown (which phase consumed the most time). The breakdown feeds [P3 — Evaluation](pilot-p3-evaluation.md).

## Daily Standup Template

Standups run daily at the same time, 15 minutes, in the pilot channel. The template is intentionally short.

### Standup Agenda (15 minutes)

| Time | Topic | Owner |
|---|---|---|
| 0:00 | Round-robin: yesterday / today / blockers | Pilot team |
| 0:10 | Reviewer feedback recap | Architect on duty |
| 0:13 | Cost + audit log status (one-liner) | Platform Engineer |

### Standup Note Template

```text
## Standup — <date>

**Yesterday**
- <bullet>

**Today**
- <bullet>

**Blockers**
- <bullet> (or "none")

**Reviewer feedback**
- <bullet> (or "none")

**Cost / audit status**
- Cycle cost: $<x>
- Audit chain: <green/yellow/red>
```

### Standup Note Storage

Standup notes are posted to the pilot channel and archived in `docs/pilot/standups/<date>.md`.

## Success Criteria

P1 success is a single artifact reviewed and accepted. Nothing more.

| # | Criterion | Owner |
|---|---|---|
| 1 | Onboarding wizard completed by every pilot team member | PO |
| 2 | `forge-onboard-repo` run successfully against the pilot repo | Platform Engineer |
| 3 | `forge-arch-new` produced a draft ADR for a real decision | Dev Lead |
| 4 | Architect reviewed the draft and accepted it (or accepted after one revision) | Architect |
| 5 | First Aha Time recorded | PO |
| 6 | Daily standups held every business day | PO |
| 7 | P1 exit gate signed | PO + Architect |

If criterion 4 fails after two revisions, do not sign the exit gate. Escalate to L3 architect and consider returning to P0 with a `pivot` recommendation.

## Exit Gate Template

```text
+----------------------------------------------------------------+
| FORGE AI PILOT — P1 EXIT GATE                                   |
+----------------------------------------------------------------+
| Phase:    P1 — Kickoff                                         |
| Window:   <start_date> .. <end_date>                           |
| Pilot Owner: <name>                                            |
+----------------------------------------------------------------+
| 1. ONBOARDING                                                  |
|    [ ] All pilot team members completed wizard                 |
|    [ ] `forge-onboard-repo` succeeded for the pilot repo       |
+----------------------------------------------------------------+
| 2. FIRST ARTIFACT                                              |
|    [ ] `forge-arch-new` produced a draft ADR                   |
|    [ ] Architect reviewed the draft                            |
|    [ ] Architect accepted (or accepted after one revision)     |
|    [ ] First Aha Time recorded: <minutes>                      |
+----------------------------------------------------------------+
| 3. CADENCE                                                     |
|    [ ] Daily standups held every business day                  |
|    [ ] Reviewer feedback loop working                          |
+----------------------------------------------------------------+
| 4. RECOMMENDATION                                              |
|    [ ] PROCEED to P1.5                                         |
|    [ ] DELAY P1.5 until: <reason>                              |
|    [ ] PIVOT to re-scope P0: <reason>                          |
+----------------------------------------------------------------+
| Signatures                                                     |
| Pilot Owner (PO):  ____________________  Date: __________      |
| Architect (L3):    ____________________  Date: __________      |
+----------------------------------------------------------------+
```

## Cross-References

- **Previous phase.** [P0 — Pre-pilot](pilot-p0-pre-pilot.md) supplies baseline TTTD, reviewer rotations, and the tenant.
- **Next phase.** [P1.5 — Validation](pilot-p15-validation.md) expands the artifact count to ≥15.
- **Acceptance criteria.** [success-metrics.md §Acceptance Rate](success-metrics.md#acceptance-rate) and the per-artifact rubric in P1.5.
- **Architecture.** [ADR-004 GSD white-label](../architecture/decisions/0004-gsd-white-labeling.md), [ADR-007 LangGraph orchestrator](../architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md).
- **Charter and overview.** [Forge AI Charter](../CHARTER.md), [Architecture Overview](../architecture/overview.md).
