# Template note — which MCP servers `@fora/mcp-github` templates for

This package is the **first concrete MCP server** in the Forge AI priority-1 set. Four more shipped in the same shape — **Jira**, **Confluence**, **AWS**, and **SonarQube** — and the shared structure was designed up front so each could copy it and ship in days, not weeks.

## Servers that copy this template

| Server | Priority | Status | Differences vs. github |
| --- | --- | --- | --- |
| `@fora/mcp-github` | P1 | shipped (this issue) | n/a |
| `@fora/mcp-jira` | P1 | shipped | **Project-pinned** (one level deeper than org-pin): `JIRA_PROJECT_KEY` + email + API token auth against Atlassian Cloud REST v3; `list_issues` / `search_jql` / `get_issue` / `create_issue` / `add_comment` / `transition_issue`; no `pull_request`/`repo` analogues; ADF in/out for description and comments. |
| `@fora/mcp-confluence` | P1 | shipped | Space-pinned (not org-pinned); `page_id` not `repo`; uses Confluence storage format (not GFM); Basic auth header built from email + API token; resolves `CONFLUENCE_SPACE_KEY` to a numeric space id on startup. |
| `@fora/mcp-aws` | P1 | shipped (Forge AI-92) | **Account+region pinned** (two-env, not one): `AWS_ACCOUNT_ID` + `AWS_REGION` + standard AWS SDK credential chain; `STS:GetCallerIdentity` boot check. Read-only v1: `list_stacks` / `get_stack` / `list_stack_resources` / `get_resource` / `list_change_sets` / `get_change_set` / `describe_change_set`. Mutations (`execute_change_set`) deferred to a follow-up. Speaks AWS JSON 1.1; mock server is a single HTTP endpoint that dispatches on `X-Amz-Target`. |
| `@fora/mcp-sonarqube` | P1 | shipped ([Forge AI-89](/Forge AI/issues/Forge AI-89)) | **Project-pinned** (the smallest sensible SonarQube scope): `SONARQUBE_PROJECT_KEY` is required, optional `SONARQUBE_ORG` is asserted on startup (SonarCloud only); built on plain `fetch` against SonarQube REST v1 with form-urlencoded POSTs — no SDK; no GraphQL path (none exists in SonarQube v1). Read tools: `list_projects`, `get_project`, `search_components`, `get_component_measures`, `list_issues`, `get_issue`, `get_quality_gate`, `webhooks_get`. The only write tool is `transition_issue`, which requires `Administer Issues` on the pinned project AND `confirm: true` in the call (Zod literal). Local drift: none — all seven contract points ported verbatim; see `mcp-servers/sonarqube/docs/template-note.md`. |
| `@fora/mcp-azure-devops` | P2 | shipped ([Forge AI-96](/Forge AI/issues/Forge AI-96)) | **Project-pinned** (org + project): `AZURE_DEVOPS_PAT` + `AZURE_DEVOPS_ORG_URL` + `AZURE_DEVOPS_PROJECT`; Basic auth from a project-scoped PAT; built on plain `fetch` against Azure DevOps REST 7.1 — no SDK (the AzDO JS SDK is unmaintained). Tools: `list_projects`, `list_repos`, `list_pipelines`, `run_pipeline`, `get_pipeline_run`, `list_work_items`, `get_work_item`, `create_work_item`, `add_work_item_comment`. **Three mutations require `confirm: true`** (Zod literal): `run_pipeline`, `create_work_item`, `add_work_item_comment`. `list_work_items` is two-step (POST WIQL → batched GET `/_apis/wit/workitems?ids=…`). Mock-backed smoke asserts every HTTP call carries a `Basic` auth header. Local drift: 7 items, all documented in `mcp-servers/azure-devops/docs/template-note.md`. |
| `@fora/mcp-zendesk` | P2 | shipped ([Forge AI-94](/Forge AI/issues/Forge AI-94)) | **Subdomain-pinned**: `ZENDESK_SUBDOMAIN` + `ZENDESK_EMAIL` + `ZENDESK_API_TOKEN`; Basic auth from a Zendesk API token (`base64("{email}/token:{apiToken}")`); built on plain `fetch` against Zendesk REST v2 — no SDK. Tools: `list_tickets`, `get_ticket`, `search_tickets`, `create_ticket`, `update_ticket`, `add_comment`, `list_macros`, `apply_macro`. **Two mutations require `confirm: true`** (Zod literal): `create_ticket`, `update_ticket`. `add_comment` and `apply_macro` are append-only / reviewable in the Zendesk UI and do not require explicit confirmation. The mock-backed smoke asserts every HTTP call carries the exact Basic auth header. Local drift: 7 items, all documented in `mcp-servers/zendesk/docs/template-note.md`. |
| `@fora/mcp-databricks` | P2 | shipped ([Forge AI-95](/Forge AI/issues/Forge AI-95)) | **Workspace-pinned** (with optional single-job / single-warehouse pins): `DATABRICKS_WORKSPACE_URL` (required) + `DATABRICKS_JOB_ID` (optional) + `DATABRICKS_WAREHOUSE_ID` (optional); Bearer auth from a service-principal PAT (`DATABRICKS_TOKEN`, must start with `dapi`); built on plain `fetch` against Databricks Jobs REST 2.1 + SQL Statement Execution — no SDK (none in active maintenance). Tools: `list_jobs`, `get_job`, `run_job`, `get_run`, `cancel_run`, `list_clusters`, `get_cluster`, `execute_sql`. **Three mutations require `confirm: true`** (Zod literal): `run_job`, `cancel_run`, `execute_sql`. The server prints a stderr warning if the token doesn't start with `dapi` so an operator accidentally pasting a user-PAT is loud. Local drift: 7 items, all documented in `mcp-servers/databricks/docs/template-note.md`. |

No MCP servers are outstanding.

## The shared contract

Every Forge AI MCP server has these properties. They are **not negotiable per-server** — that is what lets the orchestrator and agent runtime treat them uniformly.

1. **Single-scope pin on startup.** The server refuses to start without a pin env var (`GITHUB_ORG`, `JIRA_PROJECT_KEY`, `CONFLUENCE_SPACE_KEY`). The model can pass an ID, but it is asserted against the pin before any call lands. This is the safety property that lets us hand a customer a token and trust the agent won't escape into another customer's data.
2. **Typed client wrapper.** A single `createClient(config)` returns a `Client` interface whose methods take only IDs and primitives, never raw HTTP. Easier to mock, easier to audit, easier to swap to a different HTTP client later.
3. **Zod raw shapes as the source of truth.** Each tool definition carries a Zod raw shape (`{ owner: z.string(), repo: z.string(), ... }`) which is fed to `McpServer.tool()` and also used to validate runtime input. No JSON Schemas, no manual conversion.
4. **Stdout = JSON-RPC, stderr = logs.** No human-readable log lines on stdout — they would corrupt the protocol stream. Everything operational goes to stderr.
5. **Smoke test pattern: mock HTTP + spawn server + drive via MCP client.** Each server ships a `test/smoke.mjs` that:
   - boots a local mock of the upstream HTTP API,
   - spawns the compiled server with `GITHUB_API_BASE_URL` (or equivalent) pointed at the mock,
   - drives every tool over the MCP SDK `Client`,
   - asserts both the returned payload AND that the right HTTP routes were hit.
   This is the template's definition of "done" for an MCP server. If the smoke isn't green, the server isn't done.
6. **Clean shutdown on SIGINT/SIGTERM.** An enterprise agent runtime will restart MCP servers; a server that hangs on shutdown blocks that. Always wire signal handlers that close the transport and `process.exit(0)`.
7. **No agent-visible env vars beyond the pin and the token.** If a server needs a config knob the model could legitimately set, expose it as a tool argument with a Zod default. Do not invent new env vars the operator has to know about.

## How Jira and Confluence should copy this

A Jira MCP server should be able to ship with the same files, renamed:

```
mcp-servers/jira/
├── package.json            # @fora/mcp-jira
├── tsconfig.json
├── bin/fora-mcp-jira.mjs
├── src/
│   ├── config.ts           # JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN + JIRA_PROJECT_KEY
│   ├── client.ts            # createClient → Atlassian REST v3 wrapper
│   ├── tools.ts             # list_issues, get_issue, create_issue, add_comment, transition_issue, search_jql
│   └── index.ts
├── test/
│   ├── mock-atlassian.mjs   # mirrors /rest/api/3/issue, /rest/api/3/search, etc.
│   └── smoke.mjs
└── docs/template-note.md    # points back to this file
```

Confluence is the same, with `space_id`/`page_id` in place of `org`/`repo`.

When Jira is built, copy `src/tools.ts` first, then `config.ts`, then `client.ts`, then the smoke test. The orchestrator agent will pick the right toolset for the task at runtime — it doesn't need to know which underlying MCP server is providing them, only the tool names.

## Acceptance bar (also the template's)

A new MCP server is done when:

- All required tools are registered with Zod raw shapes and a one-line description per tool.
- `npm run smoke` exits 0 with the same end-of-log `[smoke] done: all N tools smoke-tested green`.
- README follows the same sections as this one: Install, Authentication, Tools, Run the smoke test, Troubleshooting, Reuse.
- `docs/template-note.md` is updated to list the new server and any contract drift it requires.
- A `request_review` comment on the implementation issue links the smoke transcript and lists the manual verification step (e.g. "with a real GitHub token, `list_repos` against the test org returns 2 repos").

Anything less is a draft.
