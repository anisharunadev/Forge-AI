---
title: Workflow Commands
description: The 4 workflow commands — plan, run, cancel, status.
---

The workflow category has 4 commands that compose multiple `forge-*` invocations into a single multi-agent run.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-flow-plan` | user | no | Plan a multi-agent workflow run |
| `forge-flow-run` | user | no | Execute a workflow |
| `forge-flow-cancel` | admin | yes | Cancel a running workflow |
| `forge-flow-status` | user | no | Inspect a running or completed workflow |

## What is this category for?

Workflows are how the orchestrator composes individual `forge-*` commands into a pipeline. A typical workflow chains ideation → architecture → development → testing → security → deployment, pausing at each approval gate.

## How to use

### Plan

```bash
pnpm forge:exec forge-flow-plan \
  --args '{"template":"new_feature","args":{"feature":"orders idempotency"},"dry_run":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com
```

Plans a workflow run from a template. `dry_run=true` produces a plan without scheduling. Output lists every node, gate, and expected cost.

### Run

```bash
pnpm forge:exec forge-flow-run \
  --args '{"plan_id":"plan-001","async":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com
```

Executes the planned workflow. `async=true` returns immediately and tracks the run in `forge-flow-status`. Synchronous mode blocks until the workflow pauses at a gate.

### Cancel (admin, requires approval)

```bash
pnpm forge:exec forge-flow-cancel \
  --args '{"workflow_id":"wf-001","reason":"design changed"}' \
  --tenant-id acme-corp --project-id acme-api --user-id admin@acme.com
```

Cancels a running workflow. Admin + approval because cancellation may leave downstream artifacts in inconsistent states.

### Status

```bash
pnpm forge:exec forge-flow-status \
  --args '{"workflow_id":"wf-001","include_history":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com
```

Inspects a workflow. Returns: current node, next node, gate status (if paused), history of completed nodes with timestamps and costs.

## Workflow templates

Built-in templates:

| Template | Stages | Use case |
|---|---|---|
| `new_feature` | ideate → arch → dev → test → sec → deploy | Greenfield feature |
| `incident_fix` | sec → dev → test → deploy | Production incident response |
| `compliance_refresh` | scan → policy_check → adr | Quarterly compliance cycle |
| `dependency_upgrade` | scan → arch → dev → test → deploy | Major dependency bump |

Custom templates are defined in the tenant policy file.

## Output

- `forge-flow-plan` → Workflow plan (with cost estimate)
- `forge-flow-run` → Workflow run id
- `forge-flow-cancel` → Cancellation event
- `forge-flow-status` → Live state

## When to use

| Scenario | Command |
|---|---|
| Start a new feature cycle | `forge-flow-plan` + `forge-flow-run` |
| Stop a running workflow | `forge-flow-cancel` (admin) |
| Watch a workflow | `forge-flow-status` |

## Related

- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
- [Approval gates](/concepts/approval-gates/)
- [Constitutional rules](/concepts/constitutional-rules/) — R3
