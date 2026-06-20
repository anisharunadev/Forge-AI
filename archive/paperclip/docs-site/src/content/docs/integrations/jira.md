---
title: Jira MCP
description: The Jira MCP server — OAuth 2.0, per-tenant namespace, R/W.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: mcp-servers/jira/
generator: readme
approval_required: false
---

The **Jira MCP server** is the first MCP integration Forge AI ships. It's the v1.0 design-partner integration. The MCP server lives in `mcp-servers/jira/`.

## Auth

- **Flow:** OAuth 2.0 (3LO)
- **Per-tenant:** yes — each tenant has its own Jira app installation
- **Scopes:** `read:jira-work`, `read:jira-user`, `write:jira-work`, `manage:jira-project`
- **Token storage:** AWS Secrets Manager at `fora/prod/<tenant-slug>/jira-api-token`

### Bootstrap

1. Create a Jira OAuth 2.0 (3LO) app at <https://developer.atlassian.com/console/myapps/>
2. Set the callback URL: `https://<your-forge-host>/oauth/jira/callback`
3. Set the API scopes listed above
4. Get the **Client ID** and **Client Secret**
5. Populate the secrets:

```bash
aws secretsmanager put-secret-value \
  --secret-id fora/prod/acme-corp/jira \
  --secret-string '{"client_id":"...","client_secret":"...","redirect_uri":"https://fora.your-corp.com/oauth/jira/callback"}'
```

6. The Forge console will surface a "Connect Jira" button for the tenant admin.

## Tools

| Tool | Description | Risk |
| --- | --- | --- |
| `jira.search_issues` | JQL search | low |
| `jira.get_issue` | Fetch one issue | low |
| `jira.create_issue` | Create issue | medium |
| `jira.update_issue` | Update fields | medium |
| `jira.add_comment` | Add a comment | low |
| `jira.create_epic` | Create an Epic (BA stage) | high — gates the next stage |
| `jira.transition_issue` | Move an issue between statuses | high |
| `jira.link_issue` | Link two issues | low |
| `jira.add_attachment` | Upload a file | low |
| `jira.create_project` | Create a project | high — not in v1 |

## Tenant isolation

The Jira MCP server runs as a separate Deployment per tenant. A bug in the router that crosses tenants is a **P0**. The MCP router enforces:

- A tenant's agent can only see its own Jira projects.
- Auth tokens are tenant-scoped.
- The egress proxy is the only path to `*.atlassian.net`.

## RPS limits

- Default: 10 RPS per tenant
- Configurable per-tool via `MCP_RPS_LIMIT` env
- Circuit breaker: opens on 5 consecutive failures, 30 s cooldown

## Where to next

- **[GitHub →](/integrations/github/)** — the next MCP server.
- **[Architecture → Multi-tenancy →](/architecture/multi-tenancy/)** — how isolation works.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>mcp-servers/jira/README.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
