---
draft: false
title: HTTP API
description: The Forge AI HTTP API — REST endpoints, WebSocket endpoints, authentication.
---

This page is the HTTP API reference for Forge AI. It covers REST endpoints, WebSocket endpoints, and authentication. For the typed artifact schema, see [OpenAPI reference](/reference/openapi/).

## What is this?

The HTTP surface of the FastAPI backend. The frontend (Next.js 15) consumes this API; external integrations consume subsets of it.

## Base URL

| Environment | URL |
|---|---|
| Local dev | `http://localhost:8000` |
| Staging | `https://api.staging.forge-ai.com` |
| Production | `https://api.forge-ai.com` |

All paths are prefixed with `/api/v1`.

## Authentication

Forge uses Keycloak-issued JWTs. The JWT carries:

| Claim | Meaning |
|---|---|
| `sub` | User ID |
| `tenant_id` | Tenant UUID |
| `project_ids` | List of project UUIDs the user can access |
| `roles` | Realm + client roles |
| `email` | User email (optional) |

The frontend obtains the token via OIDC code flow and sends it as `Authorization: Bearer <token>`.

The backend validates the token via Keycloak's JWKS endpoint, sets `app.tenant_id` and `app.project_id` from the claims, and applies RLS.

## REST endpoints

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Liveness check |

### Commands

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/commands` | List all `forge-*` commands |
| GET | `/api/v1/commands/{forge_cmd}` | Get a specific command |
| POST | `/api/v1/commands/{forge_cmd}/execute` | Execute a command |

### Workflows

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/workflows` | Create a workflow |
| GET | `/api/v1/workflows/{workflow_id}` | Get a workflow |
| GET | `/api/v1/workflows/{workflow_id}/status` | Status of a running workflow |
| POST | `/api/v1/workflows/{workflow_id}/cancel` | Cancel a workflow |

### Artifacts

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/artifacts` | List artifacts |
| GET | `/api/v1/artifacts/{artifact_id}` | Get an artifact |
| POST | `/api/v1/artifacts/{artifact_id}/comment` | Add a comment |
| POST | `/api/v1/artifacts/{artifact_id}/decision` | Submit a review decision |

### Approvals

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/approvals` | List pending approvals for the user |
| GET | `/api/v1/approvals/{approval_id}` | Get approval details |
| POST | `/api/v1/approvals/{approval_id}/decide` | Submit a decision |

### Audit

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/audit` | Query the audit ledger |
| GET | `/api/v1/audit/count` | Count rows matching a filter |
| GET | `/api/v1/audit/export` | Export a tenant-scoped bundle (admin) |

### Knowledge graph

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/kg/cypher` | Run a Cypher query (read-only) |
| POST | `/api/v1/kg/vector-search` | Run a vector similarity query |

### Identity

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/me` | Current user info |
| GET | `/api/v1/tenants` | Tenants the user can access |
| GET | `/api/v1/projects` | Projects the user can access |

## WebSocket endpoints

| Path | Description |
|---|---|
| `/api/v1/terminal/ws` | Terminal Center PTY stream |
| `/api/v1/workflows/{workflow_id}/events` | Workflow event stream |
| `/api/v1/audit/stream` | Audit ledger live tail |

WebSocket auth is via a token in the query string (`?token=<jwt>`).

## Error format

All errors follow:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "trace_id": "string"
  }
}
```

| HTTP status | Meaning |
|---|---|
| 400 | Bad request — invalid args |
| 401 | Unauthenticated |
| 403 | Forbidden — wrong tier, missing role |
| 404 | Not found |
| 409 | Conflict — duplicate, stale state |
| 422 | Unprocessable entity — schema violation |
| 429 | Rate limit or budget exceeded |
| 500 | Server error |
| 503 | Dependency unavailable |

## Rate limits

| Endpoint class | Limit |
|---|---|
| Read endpoints | 1000 req / min / user |
| Write endpoints | 100 req / min / user |
| `commands/*/execute` | 30 req / min / user |
| `audit/export` | 10 req / hour / tenant |

## OpenAPI schema

The full OpenAPI 3 schema is at `/api/v1/openapi.json` (dev/staging only) and is the source for the typed artifact schemas.

## Related

- [OpenAPI reference](/reference/openapi/)
- [MCP servers](/reference/mcp-servers/)
- [forge-* commands](/reference/forge-commands/)
- [Events](/reference/events/)
