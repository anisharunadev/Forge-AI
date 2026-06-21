---
title: Approval Gates (HITL)
description: Where human approval is required, how the gate is enforced, and how decisions are audited.
---

Approval gates (HITL — Human-In-The-Loop) are the constitutional enforcement mechanism for the boundary between machine-generated work and externally-visible state changes. Forge enforces them at the orchestrator, not at the CLI.

## What is this?

An **approval gate** is a checkpoint in a workflow where the orchestrator pauses and waits for a human decision before proceeding. The decision is typed (`approve`, `approve_with_changes`, `reject`) and is recorded in the audit ledger with the approver's identity, timestamp, prompt hash, and any reviewer notes.

Three gates are mandatory in every SDLC workflow:

| Gate | Boundary | Typical approver |
|---|---|---|
| **Architecture gate** | Before any typed artifact moves from Architecture to Development | Architect, Tech Lead |
| **Security gate** | Before any Security Report is marked final | Security Reviewer, Steward |
| **Deployment gate** | Before any deployment action | Release Manager, Eng Lead |

Additional gates can be added per workflow or per tenant policy.

## Why does it exist?

The most common AI failure mode in production is **silent scope drift** — an agent produces a contract that wasn't reviewed, deploys a service that wasn't authorized, or marks a security report as final when it wasn't.

Approval gates prevent silent drift. They are not a UI convention; they are a **runtime invariant**. A `requires_approval=True` command will not execute — at the orchestrator — without a valid approval record.

## What problem does it solve?

| Problem | Without HITL gates | With HITL gates |
|---|---|---|
| Agent deploys without review | Possible — the CLI runs it | Blocked at the orchestrator |
| Architecture drifts from requirements | Undetected until post-deploy review | Detected at the gate, before development starts |
| Security report marked final by the agent | Possible | Blocked — only a human can mark final |
| Approver identity lost | Lost in chat history | Typed event in the audit ledger |
| "We didn't know who approved this" | True | Trivial — query the ledger |

## How does it work?

```text
Workflow run
    |
    | forge-arch-adr (admin, requires_approval=True)
    v
+-------------------+
| Orchestrator      |
|  - pause at HITL  |
|  - emit audit     |
|    row with       |
|    pending state  |
+-------------------+
    |
    | approver opens Command Center → Approvals
    | picks: approve | approve_with_changes | reject
    |
    v
+-------------------+
| Orchestrator      |
|  - resume         |
|  - emit audit     |
|    row with       |
|    decision       |
+-------------------+
    |
    v
Workflow continues
```

Three properties make the gate tamper-resistant:

1. **The orchestrator enforces it.** A user with the CLI cannot bypass the gate by running the command directly — the orchestrator's `GSDWrapper.execute()` checks for a valid approval record.
2. **The decision is typed.** `approve | approve_with_changes | reject`. No "looks good" free text as a decision.
3. **The decision is audited.** `prompt_hash`, `result_hash`, `cost_usd`, and the chain hash are recorded with the decision row.

## How do I use it?

As a developer, you will encounter approval gates as pauses in your workflow runs. The Command Center shows pending approvals in the dashboard. You can:

- Approve
- Approve with changes (the changes are attached as a follow-up artifact)
- Reject with rationale

As an architect or security reviewer, you can configure which gates apply to which workflows in the policy engine.

## When should I use it?

**Always**, for the three mandatory gates. The question is **whether to add more**:

- Add a gate at the **ideation → architecture** boundary if your team needs to review proposed approaches before an ADR is drafted.
- Add a gate at the **development → testing** boundary if your team needs to review code structure before tests are written.
- Add a gate at the **review → merge** boundary if your team needs additional sign-off beyond the standard PR review.

The default is the three constitutional gates. Adding more is fine; removing them is not.

## Related

- [Auditability](/concepts/auditability/) — how the decision is recorded
- [Constitutional rules](/concepts/constitutional-rules/) — R3
- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
- [Forge approval commands](/commands/code-review/) — `forge-review-approve`, `forge-review-request-changes`
