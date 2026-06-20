# GitHub MCP (Forge AI-4)

Priority-1 MCP server for the Forge AI SDLC Operating System. Implements the
seven GitHub tools the Ideation Agent needs from the input layer.

## Tools

| Tool                | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `list_repos`        | List repos in an org/user                        |
| `get_pr`            | Fetch a single pull request by repo + number     |
| `list_prs`          | List PRs for a repo, filtered by state           |
| `create_pr_comment` | Post a comment on a PR                           |
| `list_issues`       | List issues for a repo, filtered by state        |
| `create_issue`      | Open a new issue in a repo                       |
| `search_code`       | Code search across the org                       |

## Wire protocol

JSON-RPC 2.0 over stdio, one JSON object per line. This matches the
MCP stdio transport, so the same client that drives this server
(`agents._shared.mcp_client.StdioMcpClient`) would drive a real MCP
server launched via the official SDK with no client-side changes.

## Modes

| Mode    | Trigger                                  | Backend              |
| ------- | ---------------------------------------- | -------------------- |
| `live`  | `GITHUB_MCP_MODE=live` + `GITHUB_TOKEN`  | api.github.com       |
| `sample`| default; or no token                    | in-memory fixtures   |

The smoke test forces `sample`. Production callers should set
`GITHUB_MCP_MODE=live` and provide a `GITHUB_TOKEN` (PAT or GitHub App
installation token) scoped to a single org.

## Install

```
pip install -e .   # when this becomes a package
```

Today, the server runs directly from the repo:

```
python -m agents.github_mcp.server
```

## Auth (live mode)

- Set `GITHUB_TOKEN` to a PAT with `repo` and `read:org` scopes, or to
  a GitHub App installation token.
- Optionally set `GITHUB_MCP_ORG` (default: `fora-labs`).
- Server emits a JSON-RPC `AUTH_MISSING` error (code -32001) when
  credentials are absent in `live` mode.

## Smoke test

```
python -m agents.github_mcp.smoke_test
```

Exercises every tool through the real client transport, asserts sane
response shapes, and prints a one-line summary.

## Reuse as the template

This server is the layout the **Jira MCP (Forge AI-8)** follows. Differences
are limited to:

- The REST client and its endpoint paths.
- The fixture data shape.
- The auth mode (`ATLASSIAN_*` env vars vs `GITHUB_TOKEN`).
- The transition model (Jira has explicit state transitions; GitHub does not).
- Rate-limit handling (Jira: token bucket per request; GitHub: 5000/hr per token).

Everything else (server, transport, schemas, client, smoke test) is
deliberately identical so a future engineer can audit both side by side.
