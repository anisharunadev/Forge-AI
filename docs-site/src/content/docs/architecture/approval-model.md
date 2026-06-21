---
title: Approval Model
description: How HITL gates work — three mandatory gates, optional gates, decision types, audit.
---

The Forge approval model is the enforcement mechanism for Rule 3: mandatory human approval gates at Architecture, Security, and Deployment boundaries.

## What is this?

The model that decides **when** a workflow pauses, **who** can resume it, **what** they decide, and **where** the decision is recorded.

## The three mandatory gates

| Gate | Boundary | Pause condition | Resume role |
|---|---|---|---|
| **Architecture gate** | After arch artifact produced, before dev | `requires_approval=True` flag on the artifact | Architect, Tech Lead |
| **Security gate** | After security artifact produced, before deploy | `requires_approval=True` flag on the artifact | Security Reviewer, Steward |
| **Deployment gate** | After deploy plan produced, before deploy | `requires_approval=True` flag on the artifact | Release Manager, Eng Lead |

Additional gates can be added per workflow or per tenant policy. Removing the three mandatory gates is not permitted.

## How a gate works

```text
Workflow run
    |
    | Node produces a typed artifact with requires_approval=True
    v
+-------------------+
| Orchestrator      |
|  - mark state =   |
|    awaiting_gate  |
|  - emit audit row |
|    "gate opened"  |
+-------------------+
    |
    | Approver opens Command Center → Approvals
    | Decision: approve | approve_with_changes | reject
    |
    v
+-------------------+
| Orchestrator      |
|  - validate       |
|    decision       |
|  - apply changes  |
|    if approve_    |
|    with_changes   |
|  - emit audit row |
|    "gate decided" |
+-------------------+
    |
    | If approve / approve_with_changes → resume
    | If reject → branch to abort
    v
Workflow continues
```

## Decision types

| Decision | Meaning | Effect |
|---|---|---|
| `approve` | Artifact is accepted as-is | Workflow resumes; artifact marked `accepted` |
| `approve_with_changes` | Artifact is accepted with follow-up notes | Workflow resumes; artifact marked `accepted_after_minor_edits`; notes attached |
| `reject` | Artifact is rejected | Workflow aborts; artifact marked `rejected`; orchestrator routes to abort handler |

Free-text "looks good" is not a decision. The decision is typed.

## Approver validation

The orchestrator validates:

1. The approver has the required role.
2. The approver is not the same actor who produced the artifact.
3. The decision is one of `approve | approve_with_changes | reject`.
4. The artifact is at the expected state.

Validation failures emit an audit row and refuse to advance.

## Audit row

Every gate event produces two audit rows:

```text
gate_opened:
  forge_command:    forge-arch-adr
  artifact_id:      adr-001
  artifact_type:    ADR
  state:            awaiting_gate
  opened_by:        system:agent:architect
  opened_at:        2026-06-21T14:32:11Z

gate_decided:
  forge_command:    forge-arch-adr
  artifact_id:      adr-001
  decision:         approve
  decided_by:       alice@acme.com
  decided_at:       2026-06-21T15:14:03Z
  notes:            (optional)
```

The chain hash anchors both rows.

## Optional gates

Per workflow or per tenant policy, additional gates can be configured:

| Optional gate | Use case |
|---|---|
| Ideation → Architecture | Review proposed approaches before an ADR is drafted |
| Development → Testing | Review code structure before tests are written |
| Review → Merge | Additional sign-off beyond the standard PR review |

Optional gates follow the same shape as the mandatory gates.

## Approval latency

Approval latency (time between `gate_opened` and `gate_decided`) is a pilot KPI — see [Success metrics](/operations/success-metrics/). Steady-state target is p90 ≤ 24h.

## Anti-patterns

- **Don't use free text as a decision.** Use the typed form.
- **Don't auto-approve in production.** Even with a service account, the audit row shows the auto-approval — auditors flag it.
- **Don't bypass the orchestrator.** A direct CLI invocation does not bypass the gate; the orchestrator still checks for a valid approval record.
- **Don't grant the approval role to the agent's owner.** Two-person rule.

## Related

- [Approval gates](/concepts/approval-gates/)
- [Constitutional rules](/concepts/constitutional-rules/) — R3
- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
