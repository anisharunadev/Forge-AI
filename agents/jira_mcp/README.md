# Jira MCP (FORA-8)

Priority-1 MCP server for the FORA SDLC Operating System. Reuses the
GitHub MCP layout: same JSON-RPC 2.0 stdio transport, same
sample/live mode split, same client class.

## Tools

| Tool               | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `list_projects`    | List projects visible to the caller           |
| `list_issues`      | Search issues by JQL (POST /search)           |
| `get_issue`        | Fetch a single issue by key                   |
| `create_issue`     | Open a new issue                              |
| `update_issue`     | Update issue fields                           |
| `add_comment`      | Add a comment to an issue                     |
| `transition_issue` | Move an issue through its workflow by name    |

## Wire protocol

JSON-RPC 2.0 over stdio, identical to the GitHub MCP. The shared
client (`agents._shared.mcp_client.StdioMcpClient`) drives both.

## Modes

| Mode    | Trigger                                                | Backend       |
| ------- | ------------------------------------------------------ | ------------- |
| `live`  | `JIRA_MCP_MODE=live` + `ATLASSIAN_EMAIL` + `ATLASSIAN_TOKEN` | api.atlassian.com |
| `sample`| default; or missing credentials                        | in-memory fixtures |

## Auth (live mode)

- `ATLASSIAN_EMAIL` — Atlassian account email.
- `ATLASSIAN_TOKEN` — Atlassian API token (NOT a password).
- `ATLASSIAN_SITE` (optional) — defaults to `fora.atlassian.net`.

The server returns `AUTH_MISSING` (code -32001) when credentials are
absent in `live` mode.

## Smoke test

```
python -m agents.jira_mcp.smoke_test
```

## Differences from the GitHub MCP

These are the only places the two servers intentionally diverge. They
are tracked here so a reviewer can audit both side by side.

1. **Auth model.** GitHub uses `GITHUB_TOKEN` (PAT or installation
   token). Jira uses Basic auth over an Atlassian API token; we send
   `Authorization: Basic base64(email:token)`.
2. **Endpoint shape.** GitHub has a single `https://api.github.com`
   origin. Jira's REST API is hosted under
   `https://<site>.atlassian.net/rest/api/3` (legacy) or
   `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3` (Oauth). The
   server uses the site-relative form by default and lets the operator
   swap to the cloudId form via env var if needed.
3. **Search.** GitHub's `search_code` takes a query string; Jira's
   `list_issues` takes **JQL** and is POSTed (long JQLs overflow URLs).
4. **State model.** GitHub PRs and issues have `open`/`closed` (no
   workflow). Jira issues go through a per-project workflow with named
   transitions; the server resolves a transition name to its numeric id
   before applying it, and the sample fixture enforces a sane default
   workflow.
5. **Rate limits.** GitHub: 5000 req/hr per token. Jira: per-request
   token bucket; the platform returns 429 with a `Retry-After`. The
   server surfaces 429s as `RATE_LIMITED` (-32002); callers should
   back off. GitHub has no equivalent code path yet.
6. **Rich text.** Jira stores descriptions and comments as ADF (Atlassian
   Document Format) JSON. The server wraps plain text into the smallest
   valid ADF doc on the way in.
7. **Permissions model.** Jira enforces project-level permissions per
   call (Browse, Create, Transition). The server surfaces upstream 401/403
   as `AUTH_MISSING` and other upstream errors as `UPSTREAM_ERROR`
   (-32003). GitHub's auth model is per-repo and org-wide.
