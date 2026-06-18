# ADR-0008: Paperclip Issue-Thread Interactions as the Approval Primitive

| Field             | Value                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------|
| **Status**        | **Accepted**                                                                                   |
| **Date**          | 2026-06-17                                                                                     |
| **Author**        | CTO (f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)                                                     |
| **Reviewer**      | CTO (one-way door; per architecture.md §5) — CEO informational                                |
| **Issue**         | [FORA-50](/FORA/issues/FORA-50) Sub-goal 0.1 (Master Orchestrator)                            |
| **Sub-task**      | [FORA-137](/FORA/issues/FORA-137) (0.1.4 — Human-approval router)                             |
| **Parent ADR**    | [ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md)                               |
| **Supersedes**    | none                                                                                           |
| **Superseded by** | none                                                                                           |

---

## 1. Context

[ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md) §3.1 makes approvals one of the Master Orchestrator's seven responsibilities: when a stage hands back an artifact that requires a human decision, the Orchestrator pauses, surfaces a request to the CEO (or board), and resumes only on acceptance. [FORA-50 spec §6](/FORA/issues/FORA-50#document-spec) defines the eight gates (seven stage transitions + the customer-facing launch gate) and requires a router that wires the gates to the right human/board, persists pending approvals, expires stale ones, and handles "stale target" recoveries.

The router is a thin layer over an existing primitive. The platform already runs Paperclip; Paperclip already ships the **issue-thread interaction** primitive with three shapes the router needs:

1. **`request_confirmation`** — single yes/no bound to a target document; wakes the assignee on accept (`wake_assignee_on_accept`).
2. **`request_checkbox_confirmation`** — board picks a subset of options, then confirms; wakes the assignee on resolution.
3. **`request_board_approval`** — a board-level approval; wakes the assignee on accept.

Picking a primitive is a one-way door per architecture.md §5: every gate, every TTL, every escalation policy pins to it. A custom approval queue would re-implement what Paperclip already provides, and would lose the audit trail that Paperclip's interaction log gives us for free.

This ADR decides the primitive, the per-gate mapping, the TTL policy, the stale-target recovery, and the role-of-record per gate.

## 2. Decision

We adopt **Paperclip issue-thread interactions** as the **only** approval primitive for the eight Orchestrator gates. The router is a thin layer that:

1. Persists a row in `agent_run_approvals` **first** (durable, queryable, soft-deletable).
2. Issues the appropriate Paperclip interaction (`request_confirmation` for per-stage, `request_board_approval` for board).
3. Sets the correct `continuationPolicy` so the Orchestrator resumes when the human acts.
4. Enforces the TTL on the `agent_run_approvals` row, not in the Paperclip interaction.

### 2.1 One-line summary

> "Use Paperclip's `request_confirmation` and `request_board_approval` as the approval primitive. Persist first, interact second. Resume on `wake_assignee`. TTL on the row, not the interaction. Stale target = re-issue."

## 3. The eight gates and the Paperclip mapping

Per [FORA-50 spec §6.1](/FORA/issues/FORA-50#document-spec):

| Gate (transition) | Role of record | Approver | TTL | Escalation | Paperclip primitive | Continuation policy |
|---|---|---|---|---|---|---|
| `ideation → architect` | `product` | CEO or Product | 24 h | Board | `request_confirmation` | `wake_assignee` |
| `architect → dev` | `cto` | CTO | 4 h | Board | `request_confirmation` | `wake_assignee` |
| `dev → qa` | `qa` | Dev owner (CODEOWNERS) | 4 h | CTO | `request_confirmation` | `wake_assignee` |
| `qa → security` | `security` | QA lead | 4 h | CTO | `request_confirmation` | `wake_assignee` |
| `security → devops` | `security` | Security lead | 4 h | CTO | `request_confirmation` | `wake_assignee` |
| `devops → docs` | `devops` | DevOps lead | 4 h | CTO | `request_confirmation` | `wake_assignee` |
| `docs → done` | `docs` | Doc lead | 4 h | CTO | `request_confirmation` | `wake_assignee` |
| **Customer-facing launch** | `board` | Board | 24 h | none (board is terminal) | `request_board_approval` | `wake_assignee_on_accept` |

The roles are the **role of record** — the role the approver must hold, not the specific person. A future CTO hire can satisfy the `cto` gate as long as Paperclip has them in that role.

## 4. The router's algorithm

For every gate:

```text
1. The Orchestrator has just emitted a `gate_passed`-precursor event
   (e.g. the dev stage's PR has merged and CI is green).

2. Router begins a DB transaction:
     a. INSERT INTO agent_run_approvals
          (run_id, stage, required_role, status='pending',
           expires_at = now() + role.ttl, artefact_refs, reason)
        RETURNING id;
     b. SELECT FOR UPDATE the agent_run_stages row; set status='waiting_approval';
     c. COMMIT.

3. Router issues the Paperclip interaction:
     POST /api/issues/{orchestrator_issue_id}/interactions
     {
       kind: "request_confirmation" | "request_board_approval",
       idempotencyKey: "approval:{run_id}:{stage}",
       target: { type: "issue_document", issueId, key: "plan", revisionId: <latest> },
       continuationPolicy: "wake_assignee" | "wake_assignee_on_accept",
       payload: { /* the typed question, the artefact refs, the role */ }
     }

4. Router stores the interaction id on agent_run_approvals.paperclip_interaction_id.

5. The Orchestrator emits `approval_requested` to the bus (per ADR-0006).

6. The Orchestrator pauses the run. The run is recoverable from the DB row.

7. A background sweeper runs every minute and:
     a. For every agent_run_approvals row where status='pending' AND expires_at <= now():
          - UPDATE status='expired';
          - Emit `approval_expired` to the bus.
          - Page the operator (PagerDuty service: `orchestrator-approvals`).
          - Do NOT auto-cancel; the operator can extend or cancel.
     b. For every row at >= 50% TTL: page the approver once (one page per row, not per minute).
```

When the human acts on the Paperclip interaction (accept, reject, request changes), Paperclip wakes the Orchestrator with a typed payload. The router then:

```text
8. On wake:
     a. Verify the Paperclip interaction id matches agent_run_approvals.paperclip_interaction_id.
        If not (stale target), see §5.
     b. UPDATE agent_run_approvals SET status=decision, decided_at=now(),
        decided_by={actor}.
     c. If accept: advance the run per the gate rule (FORA-50 spec §2.3);
        emit `gate_passed` and `approval_decided`.
     d. If reject: pause the run, emit `stage_rejected`; the operator can retry or cancel.
     e. If request changes ("return" primitive): emit `stage_returned` with the
        prior stage; the run loops back per the same routing.
```

## 5. Stale-target recovery

A `request_confirmation` is bound to a target document. If the document's revision bumps (e.g. the plan is revised while the approval is pending), the existing interaction expires with `outcome: "stale_target"`. The router handles this:

1. The wake payload includes `outcome: "stale_target"`.
2. The router re-issues a fresh `request_confirmation` against the **latest** revision, with the same `idempotencyKey` suffix `:rev{N}` where N is the new revision number.
3. The original `agent_run_approvals` row is updated to point at the new interaction id; the audit log carries the re-issue.
4. The run continues to wait; the human acts on the new card.

This is what makes the "send a stage back" primitive safe: the plan is re-issued, the prior approval expires, and the new approval carries the updated context.

## 6. The return primitive (send a stage back)

The `return` primitive (FORA-50 spec §2.3) reuses the rejection flow. A CTO who says "send Dev back to Architect" issues a typed action; the router:

1. Emits `stage_returned` with `from_stage=dev, to_stage=architect, reason, returned_by`.
2. The Architect stage is re-entered with the same `RunContext` (idempotent per ADR-0001 §2.3).
3. The Dev stage's row in `agent_run_stages` is set to `returned` (terminal for that stage).
4. The new approval flow starts at the `architect → dev` gate (CTO gate, 4 h TTL).

This is the same primitive as a rejection because the wire shape is the same: a decision, a reason, an actor. The only difference is which stage becomes `current_stage` next.

## 7. The eight gates and SLOs

Per [FORA-50 spec §6.3](/FORA/issues/FORA-50#document-spec):

- p50 decision latency: 1 h (median human response).
- p99 decision latency: 24 h (board).
- 50% TTL → page once.
- 100% TTL → run paused, `approval_expired` event.

The SLO is a metric, not a contract. A p99 > 24 h for any non-board gate opens a follow-up issue with the role owner. A p99 > 24 h for the board gate is a board-process problem, not a router problem.

## 8. Failure modes

| Failure                                  | Behavior                                                                                              |
|------------------------------------------|-------------------------------------------------------------------------------------------------------|
| Paperclip down                            | The Orchestrator pauses new approvals; existing approvals are persisted in `agent_run_approvals` and resume when Paperclip returns. New gates are queued; no events are lost. |
| Approver is unreachable                  | The 50% TTL page fires; the operator can extend or cancel. After 100% TTL the run pauses.             |
| Approver approves an out-of-date plan    | The `stale_target` recovery (§5) re-issues against the latest plan. The original approval is expired. |
| Two approvers race (board split)         | The first decision wins; the second is recorded as a `superseded_by_decision` row in the audit log.   |
| Operator cancels a pending approval       | `UPDATE agent_run_approvals SET status='rejected', decided_by=operator`; the run transitions to `aborted` per FORA-50 spec §2.2. |

## 9. Consequences

### Positive

- **No new queue to build.** The approval queue *is* the Paperclip interaction log. The router is ~300 LOC.
- **Audit trail for free.** Every accept, reject, request-changes, and stale-target event is in the Paperclip log; the router mirrors the row to `agent_run_approvals` for query speed.
- **Wake semantics are first-class.** `wake_assignee` and `wake_assignee_on_accept` are Paperclip primitives; the Orchestrator is woken exactly when the human acts.
- **Idempotent by construction.** The `idempotencyKey` on the interaction prevents duplicate cards on retry.

### Negative / risks

- **Paperclip is a vendor.** Mitigated by the fact that Paperclip is the platform's orchestrator (per ADR-0001); if we ever migrate off Paperclip, the router is a small service to port, and the durable row in `agent_run_approvals` survives.
- **The TTL is enforced on our side, not Paperclip's.** A future ADR may move the TTL into Paperclip as a first-class feature; for v1, the sweeper is the contract.
- **Stale target = re-issue.** A noisy plan-revision cadence causes many re-issues. Mitigated by the audit log and the `idempotencyKey` suffix; the operator sees the rate.

## 10. Alternatives considered

1. **Custom approval queue in Postgres.** Rejected: re-implements Paperclip's interaction log, loses the wake semantics, and adds a service to operate. The durable row in `agent_run_approvals` is the only piece we need on our side; the interaction itself is best left to Paperclip.
2. **Slack-native approvals.** Rejected: not all eight roles use Slack (e.g. CODEOWNERS on GitHub). The Paperclip primitive is the lowest common denominator.
3. **GitHub PR reviews as the approval primitive.** Rejected: works for the dev → qa gate only; does not model the board or the per-stage role-of-record.
4. **An external workflow engine (Temporal, Airflow).** Rejected: the approval is a single decision; Temporal is overkill, and the audit trail is weaker.
5. **No primitive; have the agent prompt the user.** Rejected: defeats audit, idempotency, and TTL. A human prompt cannot be paused and resumed deterministically.

## 11. Out of scope (future ADRs / follow-ups)

- **Multi-approver gates** (e.g. two CTOs must both approve). A v1.1 ADR with a `required_approver_count` field on `agent_run_approvals`.
- **Customer-facing approval queue** in the Forge console. Per the FORA-50 spec §9 deferred question, the default is console view only; a future ADR may expose the queue to customers.
- **TTL in Paperclip as a first-class feature.** A follow-up with the Paperclip team.
- **Audit of approver identity** beyond what Paperclip's interaction log captures. The broker JWT (ADR-0003) is the join key; a future ADR may add a stronger non-repudiation layer.

## 12. Reviewer sign-off

This ADR is a **one-way door** (per architecture.md §5). The CTO signs every one-way-door ADR; CEO sign-off is not required for this scoped decision because it is bounded to the approval primitive and the per-gate role mapping, and does not touch the cross-stage spine defined in ADR-0001.

- [x] **CTO — approved as proposed on 2026-06-17** (author: f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)
- [ ] CEO — informational copy; this ADR does not require CEO sign-off per architecture.md §5; CEO is also the named approver for the `ideation → architect` gate

### Follow-up issues (opened on acceptance)

- [FORA-137](/FORA/issues/FORA-137) — Implement the router per this ADR
- A future ADR will publish the typed `ApprovalDecision` schema and the `request_confirmation` payload template
