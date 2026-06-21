---
title: Events
description: The event types emitted by Forge AI — audit, workflow, approval, connector.
---

This page catalogs the event types emitted by Forge AI. Events are emitted to:

- The append-only audit ledger (always).
- Redis Pub/Sub (for live tail and downstream consumers).
- WebSocket subscribers.
- OpenTelemetry spans.

## What is this?

The reference for any code that subscribes to Forge events. The audit ledger is the canonical store; Redis Pub/Sub is the live tail.

## Event envelope

Every event has:

```json
{
  "id": "uuid",
  "ts": "ISO-8601 timestamp",
  "type": "string",
  "tenant_id": "uuid",
  "project_id": "uuid or null",
  "actor": {
    "type": "user | system | agent",
    "id": "string"
  },
  "data": { ... }
}
```

## Event types

### Command events

| Type | When | Data |
|---|---|---|
| `command.invoked` | A `forge-*` command is invoked | `forge_command`, `args_hash`, `workflow_id` |
| `command.completed` | A `forge-*` command completes successfully | `forge_command`, `result_hash`, `cost_usd`, `duration_ms` |
| `command.failed` | A `forge-*` command fails | `forge_command`, `error_code`, `error_message` |

### Workflow events

| Type | When | Data |
|---|---|---|
| `workflow.started` | A workflow run begins | `workflow_id`, `template`, `args` |
| `workflow.node.started` | A node begins | `workflow_id`, `node_name`, `state_hash` |
| `workflow.node.completed` | A node completes | `workflow_id`, `node_name`, `state_hash`, `cost_usd` |
| `workflow.gate.opened` | A HITL gate opens | `workflow_id`, `gate_type`, `artifact_id` |
| `workflow.gate.decided` | A HITL gate is decided | `workflow_id`, `gate_type`, `decision`, `decided_by` |
| `workflow.completed` | A workflow run completes | `workflow_id`, `outcome` |
| `workflow.cancelled` | A workflow is cancelled | `workflow_id`, `cancelled_by`, `reason` |

### Artifact events

| Type | When | Data |
|---|---|---|
| `artifact.created` | A typed artifact is created | `artifact_id`, `artifact_type`, `parent_id` |
| `artifact.status_changed` | An artifact's status changes | `artifact_id`, `from_status`, `to_status` |
| `artifact.commented` | An artifact receives a comment | `artifact_id`, `comment_id`, `author` |
| `artifact.scored` | An artifact is scored | `artifact_id`, `composite_score`, `per_section_scores` |

### Connector events

| Type | When | Data |
|---|---|---|
| `connector.health.changed` | A connector's health state changes | `connector`, `from_state`, `to_state` |
| `connector.finding.created` | A connector surfaces a finding | `connector`, `severity`, `finding_id` |
| `connector.conflict.detected` | A conflict is detected | `connector`, `node_id`, `type` |

### Audit events

| Type | When | Data |
|---|---|---|
| `audit.anchor.created` | Daily anchor is written | `anchor_ref`, `chain_hash`, `date` |
| `audit.anchor.failed` | Anchor Lambda fails | `error_code`, `error_message` |

### Identity events

| Type | When | Data |
|---|---|---|
| `identity.user.created` | A user is created | `user_id`, `email`, `roles` |
| `identity.user.role_changed` | A user's roles change | `user_id`, `from_roles`, `to_roles` |

## Subscribing

### Redis Pub/Sub

```python
import redis
import json

r = redis.Redis.from_url("redis://localhost:6379/0")
pubsub = r.pubsub()
pubsub.subscribe("forge.events")

for message in pubsub.listen():
    event = json.loads(message["data"])
    handle(event)
```

Channel naming:

| Channel | Contents |
|---|---|
| `forge.events` | All events |
| `forge.events.<tenant_id>` | Per-tenant events |
| `forge.events.<type>` | Per-type events |

### WebSocket

```js
const ws = new WebSocket("wss://api.forge-ai.com/api/v1/audit/stream?token=<jwt>");
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handle(data);
};
```

### Audit ledger query

The audit ledger is the canonical store. Query via `/api/v1/audit`:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.forge-ai.com/api/v1/audit?type=workflow.gate.opened&since=2026-06-21T00:00:00Z"
```

## Idempotency

Every event has a stable `id`. Consumers must be idempotent (use the `id` as a dedup key). The audit ledger enforces uniqueness on `(tenant_id, id)`.

## Related

- [Auditability](/concepts/auditability/)
- [Observability](/concepts/observability/)
- [HTTP API](/reference/api/)
- [Audit codes](/reference/audit-codes/)
