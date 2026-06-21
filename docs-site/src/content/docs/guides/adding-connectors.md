---
title: Adding Connectors
description: How to add a new external system as a forge connector.
---

Forge's connector framework wraps external systems (GitHub, Jira, Confluence, Figma, Slack, AWS, SonarQube, Zendesk, ClickUp, Azure DevOps, Databricks, secrets) behind the `forge-*` command surface. This guide shows how to add a new one.

## What is a connector?

A connector is a thin wrapper that:

1. Translates between the external system's data model and Forge's typed artifacts.
2. Implements failure states: `pending`, `live`, `degraded`, `down`.
3. Emits audit rows on every read and write.
4. Authenticates per-tenant using the per-tenant secret.

Connectors live in `mcp-servers/`. Each is a small package that follows the same shape.

## When to add a connector

Add a connector when:

- Your team uses a tool that isn't already covered and the data is needed in the project intelligence graph.
- You need a typed artifact source that doesn't exist (e.g., "support tickets from Zendesk as a typed source").
- You need to act on an external system from a `forge-*` workflow (e.g., "create a Jira ticket when a deploy fails").

Don't add a connector for read-only scraping — that's a job for `forge-intel-scan-*` with a custom source.

## Anatomy of a connector

```text
mcp-servers/<area>-<system>/
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts          # MCP server entrypoint
│   ├── client.ts          # external system client
│   ├── mapping.ts         # external system → typed artifact mapping
│   ├── health.ts          # failure state machine
│   └── auth.ts            # per-tenant auth
└── tests/
    ├── client.test.ts
    ├── mapping.test.ts
    └── health.test.ts
```

## Steps

### 1. Scaffold

Create the directory under `mcp-servers/`. Add a `package.json` with the standard dependencies and a `tsconfig.json` extending the monorepo base.

### 2. Implement the client

`client.ts` wraps the external system's SDK or HTTP API. Two rules:

- All methods take a `tenant_id` and return data scoped to that tenant.
- All errors are typed: `ConnectorError`, `AuthError`, `RateLimitError`, `NotFoundError`.

### 3. Implement the mapping

`mapping.ts` translates between the external data model and Forge's typed artifacts. The mapping must:

- Produce one of the typed artifacts (or none).
- Preserve source IDs for traceability.
- Tag the artifact with `source: <connector-name>` for filtering.

### 4. Implement the health state machine

`health.ts` reports one of:

| State | Meaning |
|---|---|
| `pending` | Auth not configured |
| `live` | Last health check < 60s, all OK |
| `degraded` | Last health check < 60s, partial failure |
| `down` | Last health check failed or auth invalid |

The state is polled every 60s and emitted as a metric.

### 5. Implement auth

`auth.ts` reads the per-tenant secret from Secrets Manager and uses it to authenticate. The connector never sees another tenant's secret.

### 6. Register the connector

Add the connector to `forge-intel-scan-*` so its data flows into the project intelligence graph. The connector appears in the Connector Center UI automatically.

### 7. Add commands

For each `forge-*` command the connector exposes, add an entry to `FORGE_COMMAND_MAP`. Follow the [extension guide](/reference/forge-commands/#how-to-extend).

### 8. Test

Add tests:

- `client.test.ts` — happy path + error paths
- `mapping.test.ts` — fixture-based mapping
- `health.test.ts` — state machine transitions

Plus an integration test that runs the connector end-to-end against a staging tenant.

### 9. Document

Add a page under `docs-site/src/content/docs/` describing the connector, its failure modes, and its commands.

## Failure-mode playbook

| Symptom | Likely cause | Action |
|---|---|---|
| State stuck on `pending` | Secret not configured | Check `forge-env-list` and tenant config |
| State flips to `degraded` repeatedly | Rate limit hit | Back off and increase quota |
| State `down` | Auth invalid or external outage | Rotate secret; check status page |

## Anti-patterns

- **Don't cache secrets.** Read from Secrets Manager on every call (or use the SDK's native credential chain).
- **Don't write to the connector from inside the orchestrator.** Use a `forge-*` command.
- **Don't bypass the audit log.** Every read and write goes through the connector's audit wrapper.
- **Don't hardcode base URLs.** Read from the tenant config.

## Related

- [Project Intelligence commands](/commands/project-intelligence/)
- [forge-* commands — How to extend](/reference/forge-commands/#how-to-extend)
- [Custom agents](/guides/custom-agents/)
