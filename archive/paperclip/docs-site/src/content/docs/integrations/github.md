---
title: GitHub MCP
description: The GitHub MCP server — GitHub App per tenant, PR creation, review request, status sync.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: mcp-servers/github/
generator: readme
approval_required: false
---

The **GitHub MCP server** is the second MCP integration Forge AI ships. It supports PR creation, review request, and status sync. The MCP server lives in `mcp-servers/github/`.

## Auth

- **Flow:** GitHub App (per-tenant)
- **Per-tenant:** yes — each tenant installs its own GitHub App
- **Permissions:** `contents:write`, `pull_requests:write`, `checks:write`, `statuses:write`, `issues:write`
- **Token storage:** AWS Secrets Manager at `fora/prod/<tenant-slug>/github-app`

### Bootstrap

1. Create a GitHub App at <https://github.com/settings/apps/new>
2. Set the homepage URL: `https://<your-forge-host>`
3. Set the callback URL: `https://<your-forge-host>/oauth/github/callback`
4. Set the webhook URL: `https://<your-forge-host>/webhooks/github` (events: `pull_request`, `push`, `check_run`, `check_suite`, `status`)
5. Generate a private key (download the .pem)
6. Populate the secrets:

```bash
aws secretsmanager put-secret-value \
  --secret-id fora/prod/acme-corp/github \
  --secret-string '{"app_id":"123456","client_id":"...","client_secret":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----","webhook_secret":"..."}'
```

7. The Forge console will surface a "Connect GitHub" button for the tenant admin.

## Tools

| Tool | Description | Risk |
| --- | --- | --- |
| `github.search_repos` | Search repos | low |
| `github.get_repo` | Fetch repo metadata | low |
| `github.create_branch` | Create a feature branch | medium |
| `github.create_commit` | Commit files to a branch | medium |
| `github.push` | Push to a remote | medium |
| `github.create_pr` | Open a PR | high — gates the next stage |
| `github.request_review` | Request a review | low |
| `github.merge_pr` | Merge a PR | high — gated by branch protection |
| `github.add_comment` | Comment on a PR or issue | low |
| `github.create_check_run` | Create a CI check run | low |
| `github.update_check_run` | Update a CI check run | low |

## Branch protection

The Developer agent **cannot** push to `main` directly. Branch protection rules:

- `main` requires 1+ reviewer
- `main` requires all CI checks to pass
- `main` requires linear history
- `main` requires signed commits (in v1.1)

A push that violates branch protection is **refused** by GitHub.

## Webhooks

The GitHub MCP server consumes webhooks from GitHub:

- `pull_request` (opened, synchronize, closed, merged)
- `push` (to the staging branch)
- `check_run` (created, completed)
- `check_suite` (created, completed)
- `status` (pending, success, failure)

Webhook events are signed with the `webhook_secret`. The MCP server verifies the signature before processing.

## Tenant isolation

The GitHub MCP server runs as a separate Deployment per tenant. The MCP router enforces:

- A tenant's agent can only see its own repos.
- The agent's token is a tenant-scoped installation token (rotated every 15 min).
- The egress proxy is the only path to `api.github.com`.

## RPS limits

- Default: 10 RPS per tenant
- Configurable per-tool via `MCP_RPS_LIMIT` env
- Circuit breaker: opens on 5 consecutive failures, 30 s cooldown

## Where to next

- **[Jira →](/integrations/jira/)** — the first MCP server.
- **[Confluence →](/integrations/confluence/)** — the next page.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>mcp-servers/github/README.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
