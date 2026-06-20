---
title: Figma MCP
description: The Figma MCP server — OAuth 2.0, R only. Design link, design-tokens extract.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: mcp-servers/figma/
generator: readme
approval_required: false
---

The **Figma MCP server** is the fifth MCP integration. Read-only — Forge AI reads designs and design tokens, never writes back to Figma.

## Auth

- **Flow:** OAuth 2.0
- **Per-tenant:** yes
- **Scopes:** `file_read`, `file_comments` (no write scopes)
- **Token storage:** AWS Secrets Manager at `fora/prod/<tenant-slug>/figma-api-token`

### Bootstrap

1. Create a Figma OAuth 2.0 app at <https://www.figma.com/developers/>
2. Set the callback URL: `https://<your-forge-host>/oauth/figma/callback`
3. Populate the secrets:

```bash
aws secretsmanager put-secret-value \
  --secret-id fora/prod/acme-corp/figma \
  --secret-string '{"client_id":"...","client_secret":"...","redirect_uri":"https://fora.your-corp.com/oauth/figma/callback"}'
```

## Tools

| Tool | Description | Risk |
| --- | --- | --- |
| `figma.get_file` | Fetch a Figma file's structure | low |
| `figma.get_nodes` | Fetch specific nodes by ID | low |
| `figma.get_styles` | Fetch styles (colour, type, effect) | low |
| `figma.export_tokens` | Export design tokens as JSON | low |
| `figma.get_comments` | Fetch file comments | low |
| `figma.get_screenshot` | Export a frame as PNG | low |

The MCP server does **not** write to Figma. Forge AI reads designs and design tokens only.

## The design-tokens extract

The Architect agent uses `figma.export_tokens` to pull the customer's design tokens into the run. The tokens feed:

- The PR's UI diff (so the Developer agent can match styles).
- The Confluence page (so the Docs page links to the design).
- The audit log (the design is a first-class artefact).

The tokens are exported as a single JSON file in the customer's chosen format (Style Dictionary, Figma Tokens, or a custom format).

## Where to next

- **[SonarQube →](/integrations/sonarqube/)** — the previous MCP server.
- **[AWS →](/integrations/aws/)** — the next page.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>mcp-servers/figma/README.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
