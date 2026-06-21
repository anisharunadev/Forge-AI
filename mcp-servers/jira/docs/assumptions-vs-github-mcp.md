# Jira MCP — assumptions vs GitHub MCP

Both MCP servers follow the same packaging, the same single-tenant pinning pattern, the same Zod-first tool schema, and the same JSON-stringified content block. The divergences below are the ones that matter when wiring this server into a real agent.

> **Pin scope.** `forge-ai/mcp-jira` is pinned to a single **project** (`JIRA_PROJECT_KEY`), one level deeper than `forge-ai/mcp-github` which is pinned to a single **org** (`GITHUB_ORG`). The same template contract — single scope, server-enforced, model cannot override — applies. A Confluence MCP that follows would pin a single `spaceKey`.

## 1. Rate limits

| | GitHub MCP | Jira MCP |
|---|---|---|
| **Default budget** | 5,000 req/hr per PAT for REST; 30 req/min for search | Atlassian Cloud: ~10,000 req/hr per tenant for reads; per-endpoint caps (100–1,000 req/hr) for writes |
| **How the server behaves on 429** | Octokit auto-throttles and retries with backoff | Plain `fetch` — we surface the 429 as a `JiraApiError` and let the agent decide. **No built-in retry.** |
| **Per-tool cost** | `search_code` is rate-limited separately (30/min, requires a `user:` or `org:` qualifier) | `search/jql` is part of the read bucket; one `transition` consumes one write |
| **Auth-class ceiling** | PAT, GitHub App installation token, or GitHub App user token | Atlassian API token (HTTP Basic), 3LO OAuth, or Forge |

**Implication for the agent layer:** if a workflow does N transitions per minute, the Jira server will hit its write cap before the GitHub server hits anything. Add a token-bucket at the orchestrator level if you fan-out across tickets.

## 2. Query syntax — JQL vs `search_code`

| | GitHub MCP | Jira MCP |
|---|---|---|
| **Query language** | GitHub search qualifiers (`repo:`, `org:`, `is:pr`, `author:`, etc.) — passed to `GET /search/code` or `GET /search/issues` | **JQL** (Jira Query Language) — passed to `POST /search/jql` |
| **Where it shows up in tools** | `search_code(q: string)` — single `q` blob | `search_jql(jql: string)` — single `jql` blob (the convenience `list_issues` is just a JQL of `project = <PINNED> ORDER BY updated DESC`) |
| **Auto-scoping** | Server appends ` org:<pinned>` to every `q` so the model can't escape scope | Server checks the JQL's `project = X` / `project IN (...)` qualifier against the pinned project and refuses if it doesn't match. The common prompt-injection cases are caught; a hand-crafted JQL that escapes via subqueries would not be. |
| **Field selection** | Implicit (Octokit returns the standard issue shape) | Explicit `fields` array (default: `summary, status, issuetype, priority, updated`) — to keep responses small |
| **Default order** | Server-defined (best match) | Caller controls via `ORDER BY` in JQL |
| **Pagination** | `per_page` + `page` | `maxResults` + `startAt` |

**Implication for the agent layer:** the model's prompting needs explicit JQL examples (`project = Forge AI AND status = "In Progress" ORDER BY updated DESC`). There is no `is:open` analogue — JQL uses `status != Done` or `statusCategory != Done`.

## 3. Transition model

This is the biggest semantic difference. GitHub's `state` is a free-floating string (`open` / `closed`) that any caller can set. Jira's workflow is **explicitly modeled** per issue type, per project.

| | GitHub MCP | Jira MCP |
|---|---|---|
| **State model** | `state: "open" \| "closed"` on issues and PRs | `status` is per-workflow; transitions are first-class objects with `id` + `name` + `to` |
| **How the model changes state** | Pass `state: "closed"` on update | Call `transition_issue({ issueIdOrKey, transitionId \| transitionName })`; the server reads the issue's current transitions and either uses the explicit ID or looks up by name (case-insensitive) |
| **Conditional transitions** | n/a | Workflow validators can reject a transition (e.g. "requires all sub-tasks done") — the server surfaces this as a 400 `JiraApiError` |
| **Discovery** | `list_issues({ state: "open" })` | `get_issue(...)` includes the issue's `transitions[]` array so the model can plan the next step |
| **Initial status on create** | `state: "open"` (defaulted) | Caller picks `issueTypeName`; the project workflow's initial status is implied |
| **Idempotency** | A PR that's already closed can be re-closed | A transition that's already happened returns 400 (or no-op depending on workflow). Always `get_issue` first. |

**Implication for the agent layer:** the model should call `get_issue` before `transition_issue` whenever the target status is fuzzy. The smoke test demonstrates this — `transition_issue` works by name and reads back the new status, so the agent gets a confirmation payload instead of a silent 204.

## 4. Identity shape

| | GitHub MCP | Jira MCP |
|---|---|---|
| **Project identifier** | `owner/repo` (two strings) | `projectKey` (one short string, e.g. `Forge AI`) — server-pinned, NOT a tool arg |
| **Issue identifier** | `repo` + `number` | `issueIdOrKey` — accepts either a numeric ID or a key like `Forge AI-123` |
| **Server-pinned scope** | `GITHUB_ORG` | `JIRA_PROJECT_KEY` (one level deeper than the org pin) |
| **PRs vs Issues** | Two different objects with overlapping fields | One `Issue` covers both bugs and stories; subtasks are a separate `IssueType` |

## 5. Rich text

| | GitHub MCP | Jira MCP |
|---|---|---|
| **Default for body fields** | GitHub-flavored Markdown string | Atlassian Document Format (ADF) JSON object |
| **How the server handles it** | Passes the string through unchanged | Accepts plain text, converts to a paragraph-only ADF doc (blank lines → paragraph breaks) |
| **Round-trip** | n/a | ADF → plain text in `get_issue` (lossy for tables, code blocks, etc.) |

**Implication:** if an upstream tool emits Markdown and the agent needs to round-trip it, the Jira MCP will lose tables and code blocks. A future iteration could accept a `format: "markdown" | "adf"` discriminator and run a real converter.

## 6. Auth

| | GitHub MCP | Jira MCP |
|---|---|---|
| **Auth style** | `Authorization: Bearer <PAT>` | `Authorization: Basic base64(email:api_token)` |
| **Token rotation** | PAT: manual; GitHub App: automatic via installation tokens | API tokens are manual; OAuth refresh tokens are automatic |
| **Tenant isolation** | Org (one `GITHUB_ORG`) | Project (one `JIRA_PROJECT_KEY`) — one level deeper |
| **Least-privilege knob** | PAT scopes; GitHub App permission set | API token = full account permissions (Atlassian does not expose per-token scopes on classic API tokens). Use 3LO OAuth + scopes if you need finer control, or a dedicated service account scoped to one project |

## 7. What we deliberately kept the same

- **Single-file tool registry** (`tools.ts`) with one Zod raw shape and one MCP definition per tool.
- **Single-scope pinning at boot, no per-call site/project switch.**
- **One `createClient` factory returning `{ client, scope }` so the entry point can log "pinned to …" once.**
- **Plain stderr logging, JSON-RPC on stdout.**
- **Smoke test runs against a mock HTTP server with the same shape; can be re-pointed at the real API by setting env.**
- **Stdio transport, `bin/` launcher, `prepare` build step.**

This means the Confluence MCP, SonarQube MCP, and Figma MCP that follow can copy this folder, swap the auth + REST surface + scope pin, and ship — without anyone rediscovering the layout.
