# ClickUp MCP — assumptions vs Jira MCP

Both MCP servers follow the same packaging, the same single-tenant pinning pattern, the same Zod-first tool schema, the same JSON-stringified content block, and the same mutation gate (`confirm: z.literal(true)` for every write). The divergences below are the ones that matter when wiring the ClickUp server into a real agent.

> **Pin scope.** `forge-ai/mcp-clickup` is pinned to a single **List** (`CLICKUP_LIST_ID`), one level shallower than `forge-ai/mcp-jira` which is pinned to a single **Project** (`JIRA_PROJECT_KEY`). The same template contract — single scope, server-enforced, model cannot override — applies. A Confluence MCP that follows would pin a single `spaceKey`.

## 1. Rate limits

| | Jira MCP | ClickUp MCP |
|---|---|---|
| **Default budget** | Atlassian Cloud: ~10,000 req/hr per tenant for reads; per-endpoint caps (100–1,000 req/hr) for writes | ClickUp Cloud: ~100 req/min per token for both reads and writes (per workspace) |
| **How the server behaves on 429** | Plain `fetch` — we surface the 429 as a `JiraApiError` and let the agent decide. **No built-in retry.** | Plain `fetch` — we surface the 429 as a `ClickUpApiError` and let the agent decide. **No built-in retry.** |
| **Per-tool cost** | `search/jql` is part of the read bucket; one `transition` consumes one write | `list_tasks` is one read; `create_task` / `update_task` / `set_task_status` / `add_comment` are each one write |
| **Auth-class ceiling** | Atlassian API token (HTTP Basic), 3LO OAuth, or Forge | Personal API token, OAuth 2.0 |

**Implication for the agent layer:** ClickUp's per-minute cap is tighter than Jira's per-hour cap on writes. Add a token-bucket at the orchestrator level (Forge AI-126 broker already does this for AWS; the ClickUp outbound adapter 11.2c.3 should reuse the same pattern) if you fan-out across tasks.

## 2. Query syntax — Search vs JQL

| | Jira MCP | ClickUp MCP |
|---|---|---|
| **Query language** | JQL passed to `POST /search/jql` | Plain `query` string; the MCP server does a case-insensitive substring match over name + description within the pinned List |
| **Where it shows up in tools** | `search_jql(jql: string)` — single `jql` blob | `search_tasks(query: string)` — single `query` blob (the convenience `list_tasks` is the unpaged view of the pinned List) |
| **Auto-scoping** | Server checks the JQL's `project = X` / `project IN (...)` qualifier against the pinned project | Server scopes to the pinned List on the HTTP call (no query rewrite needed) |
| **Field selection** | Explicit `fields` array (default: `summary, status, issuetype, priority, updated`) — to keep responses small | Implicit (ClickUp's `/task` endpoint returns the standard task shape; the client trims to the compact `TaskSummary`) |
| **Default order** | Caller controls via `ORDER BY` in JQL | Server-defined (ClickUp's default is `orderindex` then `date_created`) |
| **Pagination** | `maxResults` + `startAt` | `page` + `pageSize` |

**Implication for the agent layer:** ClickUp's search is intentionally weaker than Jira's JQL. If a workflow needs "all tasks in `In Progress` assigned to a given user", prefer `list_tasks({ statuses: ["in progress"] })` over `search_tasks` so the result set is bounded and the response stays small. ClickUp's full-text search endpoint is workspace-scoped and is intentionally NOT exposed — it would breach the List pin.

## 3. Status model

This is the biggest semantic difference.

| | Jira MCP | ClickUp MCP |
|---|---|---|
| **State model** | `status` is per-workflow; transitions are first-class objects with `id` + `name` + `to` | `status` is a free-floating string within a List; status transitions are NOT first-class (ClickUp auto-advances if the List's workflow allows it) |
| **How the model changes state** | Call `transition_issue({ issueIdOrKey, transitionId \| transitionName })` | Call `set_task_status({ taskId, status })` — the server treats it as a plain update |
| **Conditional transitions** | Workflow validators can reject a transition (e.g. "requires all sub-tasks done") — server surfaces this as a 400 `JiraApiError` | List workflow can auto-reject (e.g. "closed statuses cannot reopen") — server surfaces this as a 400 `ClickUpApiError` |
| **Discovery** | `get_issue(...)` includes the issue's `transitions[]` array so the model can plan the next step | `get_task(...)` returns the current `status` + `statusType` (`open` / `custom` / `closed`) so the model can pick the right target name |
| **Initial status on create** | Caller picks `issueTypeName`; the project workflow's initial status is implied | Caller picks `status` (default: `to do`); the List must define it |
| **Idempotency** | A transition that's already happened returns 400 (or no-op depending on workflow). Always `get_issue` first. | `set_task_status` to the current status is a no-op (ClickUp returns 200 with the current state). Safe to retry. |

**Implication for the agent layer:** the model should call `get_task` before `set_task_status` whenever the target status is fuzzy. The smoke test demonstrates this — `set_task_status` reads back the new status, so the agent gets a confirmation payload instead of a silent 204.

## 4. Identity shape

| | Jira MCP | ClickUp MCP |
|---|---|---|
| **Project identifier** | `projectKey` (one short string, e.g. `Forge AI`) — server-pinned, NOT a tool arg | `listId` (numeric string, e.g. `9000`) — server-pinned, NOT a tool arg |
| **Issue identifier** | `issueIdOrKey` — accepts either a numeric ID or a key like `Forge AI-123` | `taskId` — accepts the numeric string id only (ClickUp doesn't expose human-readable keys) |
| **Server-pinned scope** | Project (one `JIRA_PROJECT_KEY`) | List (one `CLICKUP_LIST_ID`) — one level shallower |
| **Subtasks** | Separate `IssueType` | First-class `parent` field on tasks; subtasks live in the same List |

## 5. Rich text

| | Jira MCP | ClickUp MCP |
|---|---|---|
| **Default for body fields** | Atlassian Document Format (ADF) JSON object | Plain text (markdown is rendered but not stored as Markdown; ClickUp converts to its own internal representation) |
| **How the server handles it** | Accepts plain text, converts to a paragraph-only ADF doc (blank lines → paragraph breaks) | Passes the string through unchanged; newlines preserved |
| **Round-trip** | ADF → plain text in `get_issue` (lossy for tables, code blocks, etc.) | Plain text in `get_task` (lossless) |

**Implication:** ClickUp's plain-text model round-trips losslessly. Future iterations could add a `format: "markdown" | "plain"` discriminator and run a real converter for tools that emit markdown.

## 6. Auth

| | Jira MCP | ClickUp MCP |
|---|---|---|
| **Auth style** | `Authorization: Basic base64(email:api_token)` | `Authorization: <personal_access_token>` (no `Bearer` prefix per ClickUp REST v2 docs) |
| **Token rotation** | API tokens: manual; OAuth refresh tokens: automatic | Personal tokens: manual; OAuth refresh tokens: automatic |
| **Tenant isolation** | Project (one `JIRA_PROJECT_KEY`) | List (one `CLICKUP_LIST_ID`) — one level shallower |
| **Least-privilege knob** | API token = full account permissions. Use 3LO OAuth + scopes, or a dedicated service account scoped to one project. | Personal token = full account permissions. Use OAuth 2.0 + scopes, or a dedicated service account scoped to one List (guest on a single Space). |

## 7. Mutations — the `confirm` gate

Both servers gate mutations with `confirm: z.literal(true)`. The orchestrator's broker (Forge AI-126) refuses to forward a write that lacks the literal, so the gate cannot be skipped by a confused or malicious agent prompt. The ClickUp MCP gates four mutations: `create_task`, `update_task`, `set_task_status`, `add_comment`. The Jira MCP gates three: `create_issue`, `add_comment`, `transition_issue`.

## 8. What we deliberately kept the same

- **Single-file tool registry** (`tools.ts`) with one Zod raw shape and one MCP definition per tool.
- **Single-scope pinning at boot, no per-call site/list/project switch.**
- **One `createClient` factory returning `{ client, scope }` so the entry point can log "pinned to …" once.**
- **Plain stderr logging, JSON-RPC on stdout.**
- **Smoke test runs against a mock HTTP server with the same shape; can be re-pointed at the real API by setting env.**
- **Stdio transport, `bin/` launcher, `prepare` build step.**
- **Mutation gating via `confirm: z.literal(true)` on the input shape.**

This means the next MCP server (e.g. Zendesk, Databricks, Azure DevOps) can copy either folder, swap the auth + REST surface + scope pin, and ship — without anyone rediscovering the layout.

## 9. Why a List and not a Space?

A ClickUp Space contains many Folders and Lists; pinning to a Space would let the model reach every List in the Space, which is the same risk as a Workspace-scoped Jira token. Pinning to a List matches the project's day-one scope: one synced backlog (e.g. the Forge AI team's `Sync Plane` List) per tenant. A future iteration can add a `CLICKUP_SPACE_ID` for tenants that want broader scope, with the same scope-check pattern.