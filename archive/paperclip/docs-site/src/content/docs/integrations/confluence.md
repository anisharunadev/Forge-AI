---
title: Confluence MCP
description: The Confluence MCP server — OAuth 2.0, R/W. Page create, update, link to ADRs.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: mcp-servers/confluence/
generator: readme
approval_required: false
---

The **Confluence MCP server** is the third MCP integration Forge AI ships. The Documentation agent uses it to publish the run's Confluence page. The MCP server lives in `mcp-servers/confluence/`.

## Auth

- **Flow:** OAuth 2.0 (3LO)
- **Per-tenant:** yes
- **Scopes:** `read:confluence-content.summary`, `read:confluence-content.all`, `write:confluence-content`, `read:confluence-space.summary`, `read:confluence-user`
- **Token storage:** AWS Secrets Manager at `fora/prod/<tenant-slug>/confluence-api-token`

### Bootstrap

1. Create a Confluence OAuth 2.0 (3LO) app at <https://developer.atlassian.com/console/myapps/>
2. Set the callback URL: `https://<your-forge-host>/oauth/confluence/callback`
3. Set the API scopes listed above
4. Populate the secrets:

```bash
aws secretsmanager put-secret-value \
  --secret-id fora/prod/acme-corp/confluence \
  --secret-string '{"client_id":"...","client_secret":"...","redirect_uri":"https://fora.your-corp.com/oauth/confluence/callback"}'
```

## Tools

| Tool | Description | Risk |
| --- | --- | --- |
| `confluence.search_pages` | CQL search | low |
| `confluence.get_page` | Fetch a page | low |
| `confluence.create_page` | Create a page (Docs stage) | high — gates the run close |
| `confluence.update_page` | Update a page | medium |
| `confluence.add_comment` | Inline / footer comment | low |
| `confluence.add_label` | Label a page | low |
| `confluence.link_to_adr` | Embed ADR links (Docs stage) | low |
| `confluence.archive_page` | Archive a page | high |

## The Docs-stage contract

The Documentation agent uses Confluence as the **publication surface** for the run's close-out page. The page structure:

1. **Summary** — what changed, why
2. **ADR links** — embeds the relevant ADRs
3. **PR link** — embeds the GitHub PR
4. **QA + Security reports** — links to the QA + Security artefacts
5. **Release notes** — the release-notes block
6. **Customer-relevant context** — derived from `engagements/<slug>/conventions.md`

The page is created in the customer's Confluence space, under the project's section, with a label `fora-run-<run_id>`.

## Tenant isolation

The Confluence MCP server runs as a separate Deployment per tenant. The MCP router enforces:

- A tenant's agent can only see its own Confluence spaces.
- The agent's token is tenant-scoped.
- The egress proxy is the only path to `*.atlassian.net`.

## Where to next

- **[GitHub →](/integrations/github/)** — the previous MCP server.
- **[SonarQube →](/integrations/sonarqube/)** — the next page.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>mcp-servers/confluence/README.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
