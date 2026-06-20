# `@fora/mcp-jira` — Forge AI Jira MCP Server

Priority-1 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes six tools over MCP/stdio: `list_issues`, `search_jql`, `get_issue`, `create_issue`, `add_comment`, `transition_issue`.

The server is **pinned to a single Jira project** at startup. The model can pass an `issueIdOrKey`, but the underlying project is asserted against the pin before any call lands. This is the same safety posture as `@fora/mcp-github`'s `GITHUB_ORG` enforcement, scoped one level deeper to a single project.

The package layout, scripts, and entry-point pattern are deliberately identical to `@fora/mcp-github` so the rest of the priority-1 MCP family (Confluence, SonarQube, Figma, AWS, Slack) can copy it.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/jira
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-jira.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/jira
npm pack          # produces fora-mcp-jira-0.1.0.tgz
npm install -g ./fora-mcp-jira-0.1.0.tgz
```

After global install, `fora-mcp-jira` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "jira": {
      "command": "fora-mcp-jira",
      "env": {
        "JIRA_EMAIL": "${JIRA_EMAIL}",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}",
        "JIRA_PROJECT_KEY": "Forge AI",
        "JIRA_BASE_URL": "https://acme.atlassian.net"
      }
    }
  }
}
```

The server reads all four env vars on startup. If any is missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server uses **Atlassian Cloud REST v3** with HTTP Basic auth (`email:api_token`, base64-encoded). It does NOT depend on any Atlassian SDK — just `fetch` plus the `Authorization: Basic …` header.

### 1. Create an API token

1. Sign in to the Atlassian account that owns the project you want pinned.
2. Visit <https://id.atlassian.com/manage-profile/security/api-tokens>.
3. Click **Create API token**, label it (e.g. `fora-mcp`), and copy the value into `JIRA_API_TOKEN`.
4. Set `JIRA_EMAIL` to the email of the account that owns the token.

### 2. Set the project pin and base URL

- `JIRA_PROJECT_KEY` — the short project key you want pinned, e.g. `Forge AI`. The model cannot address any other project.
- `JIRA_BASE_URL` — your site root, e.g. `https://acme.atlassian.net`. The server appends `/rest/api/3` automatically.

### Least-privilege scope

Classic Atlassian API tokens are **account-scoped**, not per-token-scoped — the token inherits every permission the account has. For least privilege, do one of:

- **Recommended for production**: a dedicated service account whose only access is the one project. Grant **Browse Projects**, **Create Issues**, **Edit Issues**, **Add Comments**, **Transition Issues** on the pinned project, and **Project permissions = `Service Desk Team` or `Developers`** (whichever is tighter). Revoke all other project access and global permissions.
- **Better isolation**: switch to **3LO OAuth** with explicit scopes (`READ`, `WRITE`, `DELETE`) per Atlassian OAuth app. The MCP server accepts HTTP Basic today; a follow-up release can switch to OAuth with the same `createClient` shape.
- **Token rotation**: rotate API tokens at least every 90 days. The MCP server does not own the rotation; that is an operations concern.

> **Why project-pinned, not site-pinned?** A user-scoped token would let a confused or malicious agent prompt reach any project the user can see. Project-pinning is a hard security boundary enforced on every call — the JQL scope check, the create-issue payload, and the per-issue scope guard all refuse to act outside the pin.

---

## Tools

All tools operate against the pinned project. The `projectKey` is intentionally NOT a tool input — the server injects it from `JIRA_PROJECT_KEY`.

| Tool | Purpose | Required args | Optional args |
| --- | --- | --- | --- |
| `list_issues` | List recent issues in the pinned project (alias of `search_jql` with `project = <PINNED> ORDER BY updated DESC`). | — | `maxResults`, `startAt` |
| `search_jql` | Search with an explicit JQL query. The query's `project = …` is asserted against the pin. | `jql` | `maxResults`, `startAt`, `fields` |
| `get_issue` | Get one issue by key or ID, including transitions. | `issueIdOrKey` | `fields` |
| `create_issue` | Create an issue in the pinned project. Returns the new key + browse URL. | `summary` | `description`, `issueTypeName`, `labels`, `priority` |
| `add_comment` | Post a plain-text comment on an issue. | `issueIdOrKey`, `body` | — |
| `transition_issue` | Move an issue to a new workflow status by ID or by name. | `issueIdOrKey` | `transitionId` (preferred) or `transitionName` |

### Example payloads

`list_issues`:

```json
{ "maxResults": 20 }
```

`search_jql`:

```json
{
  "jql": "project = Forge AI AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
  "maxResults": 20
}
```

`get_issue`:

```json
{ "issueIdOrKey": "Forge AI-123" }
```

`create_issue`:

```json
{
  "summary": "Wire up the SDLC orchestrator",
  "description": "Connects the master orchestrator to the BA / Architect / Developer / QA agents.\n\n## Acceptance\n- All 7 priority-1 MCP servers green.",
  "issueTypeName": "Task",
  "labels": ["mcp", "priority-1"]
}
```

`add_comment`:

```json
{
  "issueIdOrKey": "Forge AI-123",
  "body": "## QA report\n\nSmoke test passed. Ready for review."
}
```

`transition_issue`:

```json
{
  "issueIdOrKey": "Forge AI-123",
  "transitionName": "Done"
}
```

The server reads the new status back so the caller gets a confirmation payload (`{ id, key, status }`) instead of a silent 204.

---

## Run the smoke test

The smoke test boots a mock Atlassian HTTP server, spawns the MCP server pointed at it, and exercises all 6 tools over stdio. It runs without any real Jira credentials.

```bash
cd mcp-servers/jira
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 6 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid Jira MCP configuration: … JIRA_PROJECT_KEY is required …` | Missing env var | Set `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_BASE_URL` in the MCP client config. |
| `ProjectScopeError: Refusing to act on project 'X' — this server is pinned to 'Y'` | The model tried to address a different project, either via a `project = X` JQL qualifier or by passing an issue key from another project. | Either change `JIRA_PROJECT_KEY` to the right project (requires restart), or scope the JQL to the pinned project (`project = <PINNED> AND …`). |
| `JiraApiError 401` on first call | Bad email / token / base URL combination. | Re-create the API token at <https://id.atlassian.com/manage-profile/security/api-tokens>. Check that `JIRA_BASE_URL` matches the account's site. |
| `JiraApiError 403` on `create_issue` / `add_comment` / `transition_issue` | The token's account lacks the required project permission. | Grant the account the missing permission (Create Issues / Add Comments / Transition Issues) on the pinned project, or switch to an account that has them. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing `dist/` build. |
| `search_jql` returns `isError: true` with "Refusing to act on project" | The JQL `project = X` qualifier pins a different project. | Use `project = <PINNED>` or `project IN (<PINNED>, …)`, or remove the qualifier to let the server auto-scope. |

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` (in `@fora/mcp-github`) for the contract these servers share, and `docs/assumptions-vs-github-mcp.md` (in this package) for the divergences that matter when wiring the agent: rate limits, JQL vs `search_code`, the transition model vs `state`, ADF vs Markdown, and the project-key pin vs `GITHUB_ORG`.
