---
# TODO(Phase 3): widen `DEFAULT_PATTERNS` in
# `backend/app/services/steering_rules.py:76-81` from
# `**/steering/*.md` (single-segment) to `**/steering/**/*.md` so the
# engine auto-discovers this file plus the other KnackForge guardrails
# under `steering/knackforge/` and `steering/personas/`. Today's
# `**/steering/*.md` glob does NOT match this path.
rule_id: jira-bridge-v1
scope: project
applies_to_stages:
  - pre_plan
  - pre_code
  - pre_deploy
---

# Jira Bridge — Event Consumer Contract (Forge AI-440 / Pillar 1 Phase 1)

> **Status (2026-06-22):** informational only. The Phase 3 widening
> of `DEFAULT_PATTERNS` in `backend/app/services/steering_rules.py`
> is what makes this file engine-discovered. Until then, this file is
> reference documentation for the connector ingestion team.

## Purpose

Forge's ideation pipeline and SDLC stages both depend on a single
Jira event spine. The bridge defines the **closed set** of events
the system ingests, the **idempotency contract** for those events,
and the **target rows** every consumer must write to. The MCP tool
contract itself lives in `mcp-servers/jira/src/tools.ts`; this file
is the policy layer above it.

## Triggering events (closed set)

The consumer subscribes only to the two events below — every other
Jira event is ignored at the bus layer. Both come from the canonical
`packages/connector-events/src/families/jira.ts` vocabulary (do not
extend without a Board gate).

| Event | Source | When it fires |
|---|---|---|
| `jira.issue.observed` | `JIRA_FAMILY.OBSERVED` | A Jira issue first lands in Forge's field of view (ingest, push, or manual sync). |
| `jira.transition.applied` | `JIRA_FAMILY.TRANSITION` | A Jira issue moves between workflow states (e.g. `To Do → In Progress`). |

## Idempotency

The natural key for every Jira event is `issue.key` (e.g. `FORA-1234`).
The bridge MUST treat a second emission of the same `issue.key` as a
no-op:

1. The first emission creates/upserts the target row.
2. Subsequent emissions re-read the row, confirm the existing state
   matches the event payload, and return without writing.
3. A divergent second emission (e.g. status flipped since first
   observation) is logged via `AuditService.record(...)` but does
   NOT overwrite the existing row. Divergence is escalated to the
   PM-facing review queue, not auto-merged.

This is the same idempotency posture as `mcp-servers/jira/src/tools.ts`
so the tool layer and the consumer layer never double-write.

## Target rows

The consumer writes to exactly three rows per event. Other fields
must NOT be touched by the bridge.

| Target | Field populated | Source |
|---|---|---|
| `ideas.external_key` | `external_key = issue.key` | `app/db/models/ideation.py` (added in migration `0002_ideation_external_key`) |
| `ideas.status` (mapped) | Derived from the Jira workflow state via `JIRA_STATUS_MAP` | `backend/app/services/connector_ingestion/jira_consumer.py` |
| `push_records.jira_epic_key` | `jira_epic_key = issue.key` | `app/db/models/ideation.py::PushRecord` (added in migration `0002_ideation_external_key`) |

Every row carries `tenant_id` + `project_id` per Rule 2. No row is
written without both columns populated.

## Audit chain

Every consumer action — `ingest`, `transition`, `noop`, `divergence` —
calls `AuditService.record(...)` with:

```
action:        jira.consumer.<verb>
target_type:   idea | push_record
target_id:     <idea.id or push_record.id>
payload:       { issue_key, jira_event, idempotency_outcome }
```

The bridge never logs the raw payload body — only the metadata above.

## MCP tool contract reference

The tool vocabulary (`create_issue`, `transition_issue`,
`add_comment`, `get_issue`, `list_transitions`, etc.) is owned by
`mcp-servers/jira/src/tools.ts`. The consumer MUST call tools via
the MCP router (`McpRouter.invoke(...)`) — never via direct Jira
HTTP. This is the Rule 8 enforcement point.

## Phase 3 follow-up

The engine currently globs `**/steering/*.md` (single segment). To
make this file discoverable, widen the glob to `**/steering/**/*.md`
in `backend/app/services/steering_rules.py:76-81`. After that
change, restart the FastAPI process; the watchdog re-indexes.

This file pairs with:

- `steering/knackforge/coding-standards.md`
- `steering/knackforge/security-standards.md`
- `steering/knackforge/architecture-standards.md`
- `steering/knackforge/best-practices.md`
- `steering/knackforge/agent-behavior.md`
- `steering/personas/developer.md`
- `steering/personas/product_manager.md`

— all of which are equally invisible to the engine until Phase 3
lands.