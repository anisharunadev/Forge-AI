---
title: Integrations overview
description: Every MCP server Forge AI ships in v1 — Jira, GitHub, Confluence, SonarQube, Figma, AWS, Slack / Teams.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

Forge AI is **MCP-native**. Every integration is an MCP server, in a per-tenant namespace. The customer owns the credentials, the egress, and the audit trail.

## Priority 1 (v1 GA)

| Tool | MCP server | Auth flow | R/W | Where it lives |
| --- | --- | --- | --- | --- |
| **[Jira](/integrations/jira/)** | In-house (TS) | OAuth 2.0 (3LO) | R/W | `mcp-servers/jira/` |
| **[GitHub](/integrations/github/)** | In-house (TS) | GitHub App (per-tenant) | R/W | `mcp-servers/github/` |
| **[Confluence](/integrations/confluence/)** | In-house (TS) | OAuth 2.0 (3LO) | R/W | `mcp-servers/confluence/` |
| **[SonarQube](/integrations/sonarqube/)** | In-house (TS) | Token per tenant | R | `mcp-servers/sonarqube/` |
| **[Figma](/integrations/figma/)** | In-house (TS) | OAuth 2.0 | R | `mcp-servers/figma/` |
| **[AWS](/integrations/aws/)** | In-house (Py) | Cross-account IAM role | R (scoped) | `mcp-servers/aws/` |
| **[Slack / Teams](/integrations/slack/)** | In-house (TS) | OAuth 2.0 | R/W | `mcp-servers/slack/` |

## Priority 2 (v1.1)

- **Zendesk** — support context into the run
- **Databricks** — data / notebook context
- **Azure DevOps** — Microsoft-shop customers

## Backlog

- GitLab
- Bitbucket
- Linear
- Notion
- Asana
- ClickUp

## The per-tenant namespace

Each tenant gets a dedicated MCP namespace, e.g., `mcp-acme-corp`. The namespace includes:

- **Auth tokens** — OAuth 2.0 apps, GitHub Apps, API tokens (per-tenant)
- **RPS limits** — default 10 RPS, configurable per-tool
- **Circuit breaker** — opens on 5 consecutive failures, 30 s cooldown
- **Egress proxy** — the only path to the tool's API
- **Audit log** — every tool call is captured

A tool call that would cross tenants is **refused**, not warned.

## The auth flow

| Tool | Auth flow | Per-tenant? | Where to get it |
| --- | --- | --- | --- |
| Jira | OAuth 2.0 (3LO) | yes | <https://developer.atlassian.com/> |
| GitHub | GitHub App | yes | <https://github.com/settings/apps/new> |
| Confluence | OAuth 2.0 (3LO) | yes | <https://developer.atlassian.com/> |
| SonarQube | Token | yes | Your SonarQube instance → Account → Security |
| Figma | OAuth 2.0 | yes | <https://www.figma.com/developers/> |
| AWS | Cross-account IAM role | yes | Your AWS account → IAM → Roles |
| Slack | OAuth 2.0 | yes | <https://api.slack.com/apps> |

## The reference MCP repo (roadmap)

The reference MCP server template is open-sourced in 2027 (per [tech-stack.md §10](https://github.com/fora-platform/fora/blob/main/workspace/project/tech-stack.md)). Each customer can fork, not a managed service. The customer owns the credentials, the egress, and the audit trail.

## Where to next

- **[Jira →](/integrations/jira/)** — the first MCP server.
- **[GitHub →](/integrations/github/)** — PR creation, review, status sync.
- Or jump to [Self-host on AWS →](/self-host/aws/) to wire them all up.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code> §10</dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
