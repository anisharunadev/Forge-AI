---
draft: false
title: Audit Codes
description: The error and status codes used in the audit ledger and HTTP API.
---

This page catalogs the codes used in the audit ledger and the HTTP API. Codes are stable across versions; new codes are added, not changed.

## What is this?

The reference for any code that consumes the audit ledger or interprets HTTP API errors. Codes are grouped by category.

## HTTP error codes

| Code | HTTP | Meaning |
|---|---|---|
| `forge.bad_request` | 400 | Invalid args or malformed body |
| `forge.unauthenticated` | 401 | Missing or invalid JWT |
| `forge.forbidden` | 403 | Wrong tier, missing role, or wrong tenant |
| `forge.not_found` | 404 | Resource does not exist |
| `forge.conflict` | 409 | Duplicate or stale state |
| `forge.unprocessable` | 422 | Schema validation failure |
| `forge.rate_limited` | 429 | Rate limit or budget exceeded |
| `forge.internal` | 500 | Server error |
| `forge.unavailable` | 503 | Dependency unavailable |

## Command codes

| Code | Meaning |
|---|---|
| `forge.command.unknown` | The `forge-*` name is not in the map |
| `forge.command.approval_required` | The command requires approval and no approval record exists |
| `forge.command.approval_rejected` | The command was rejected at the HITL gate |
| `forge.command.tenant_mismatch` | The command's tenant doesn't match the JWT's tenant |
| `forge.command.project_mismatch` | The command's project isn't in the user's project_ids |

## Workflow codes

| Code | Meaning |
|---|---|
| `forge.workflow.not_found` | Workflow ID not found |
| `forge.workflow.cancelled` | Workflow was cancelled |
| `forge.workflow.gate_timeout` | A gate was open beyond its budget |
| `forge.workflow.checkpoint_failed` | Checkpoint write failed |
| `forge.workflow.resumed` | Workflow resumed from a checkpoint |

## Artifact codes

| Code | Meaning |
|---|---|
| `forge.artifact.not_found` | Artifact ID not found |
| `forge.artifact.schema_invalid` | Artifact failed schema validation |
| `forge.artifact.status_invalid` | Status transition is not allowed |
| `forge.artifact.scoring_failed` | Rubric scoring raised an error |

## Connector codes

| Code | Meaning |
|---|---|
| `forge.connector.not_configured` | Per-tenant secret is missing |
| `forge.connector.auth_failed` | Authentication failed |
| `forge.connector.rate_limited` | Provider rate limit hit |
| `forge.connector.timeout` | Call exceeded timeout |
| `forge.connector.not_found` | External resource not found |
| `forge.connector.down` | Connector health is `down` |

## Audit codes

| Code | Meaning |
|---|---|
| `forge.audit.write_failed` | Audit ledger write failed |
| `forge.audit.anchor_failed` | Daily anchor Lambda failed |
| `forge.audit.chain_broken` | Hash chain verification failed |
| `forge.audit.export_failed` | Audit export failed |

## LiteLLM codes

| Code | Meaning |
|---|---|
| `forge.litellm.no_budget` | Tenant budget envelope exhausted |
| `forge.litellm.model_not_allowed` | Model not in tenant allowlist |
| `forge.litellm.provider_error` | Provider returned an error |
| `forge.litellm.timeout` | Call exceeded timeout |
| `forge.litellm.parse_error` | Response failed to parse |

## Identity codes

| Code | Meaning |
|---|---|
| `forge.identity.token_invalid` | JWT signature invalid |
| `forge.identity.token_expired` | JWT expired |
| `forge.identity.role_missing` | Required role not present |
| `forge.identity.tenant_mismatch` | Tenant in token doesn't match request |

## How codes appear

### In HTTP responses

```json
{
  "error": {
    "code": "forge.command.approval_required",
    "message": "Command forge-deploy-prod requires approval before execution.",
    "trace_id": "7f9c..."
  }
}
```

### In the audit ledger

| Field | Value |
|---|---|
| `event_type` | `command.invoked` / `command.failed` |
| `error_code` | `forge.command.approval_required` (when failed) |
| `error_message` | Human-readable message |

## Related

- [Events](/reference/events/)
- [HTTP API](/reference/api/)
- [Auditability](/concepts/auditability/)
