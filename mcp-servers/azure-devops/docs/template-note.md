# Template note — which MCP servers `@fora/mcp-azure-devops` templates for

This package is the **first P2 MCP server** in the FORA platform and copies the `@fora/mcp-github` template ([FORA-4](https://github.example/FORA-4)). The shared structure was designed up front so P2 servers can ship in days, not weeks, and the agent runtime can treat them uniformly.

## Servers that copy this template

| Server | Priority | Status | Differences vs. github |
| --- | --- | --- | --- |
| `@fora/mcp-github` | P1 | shipped | n/a |
| `@fora/mcp-jira` | P1 | shipped | Project-pinned (one level deeper than org-pin); ADF in/out for description and comments. |
| `@fora/mcp-confluence` | P1 | shipped | Space-pinned; Confluence storage format; Basic auth from email + API token. |
| `@fora/mcp-aws` | P1 | shipped | Account+region pinned; AWS SDK credential chain; JSON 1.1 protocol. |
| `@fora/mcp-sonarqube` | P1 | shipped | Project-pinned; `fetch` against SonarQube REST v1; no SDK. |
| `@fora/mcp-azure-devops` | **P2** | **shipped (this issue)** | **Project-pinned** (org + project); plain `fetch` against AzDO REST 7.1; Basic auth from a project-scoped PAT. Mutation tools (`run_pipeline`, `create_work_item`, `add_work_item_comment`) require `confirm: true` in the call (Zod literal). Two-step list pattern for `list_work_items` (WIQL query → batched `GET /_apis/wit/workitems?ids=…`). Auth-header presence is asserted by the mock-backed smoke. |

Zendesk and Databricks are still P2 and will follow the same template.

## The shared contract

This server implements the seven FORA MCP contract points verbatim:

1. **Single-scope pin on startup.** The server refuses to start without `AZURE_DEVOPS_PAT` + `AZURE_DEVOPS_ORG_URL` + `AZURE_DEVOPS_PROJECT`. The project is the unit of safety — one project per server, one org per server.
2. **Typed client wrapper.** A single `createClient(config)` returns a `Client` interface whose methods take only IDs and primitives, never raw HTTP or raw URLs.
3. **Zod raw shapes as the source of truth.** Each tool definition carries a Zod raw shape (e.g. `{ pipelineId: z.number().int().positive(), confirm: z.literal(true) }`) which is fed to `McpServer.tool()` and also used to validate runtime input. No JSON Schemas, no manual conversion.
4. **Stdout = JSON-RPC, stderr = logs.** No human-readable log lines on stdout — they would corrupt the protocol stream.
5. **Mock-HTTP smoke test.** `test/smoke.mjs` boots a local mock of the upstream HTTP API, spawns the compiled server with `AZURE_DEVOPS_API_BASE_URL` pointed at the mock, drives every tool over the MCP SDK `Client`, and asserts both the returned payload AND that the right HTTP routes were hit.
6. **Clean shutdown on SIGINT/SIGTERM.** An enterprise agent runtime will restart MCP servers; a server that hangs on shutdown blocks that. Signal handlers close the transport and `process.exit(0)`.
7. **No agent-visible env vars beyond the pin and the token.** All knobs the model could legitimately set are exposed as tool arguments with Zod defaults (e.g. `top`, `variables`, `wiql`, `expand`, `fields`). The smoke test override `AZURE_DEVOPS_API_BASE_URL` is the only extra env var, and it is documented as smoke-test-only.

## Contract drift vs. the GitHub template

| # | Where | Drift | Rationale |
| --- | --- | --- | --- |
| 1 | `src/client.ts` | Uses plain `fetch` (no SDK); AzDO has no first-party TypeScript SDK we want to depend on. | The AzDO REST surface we touch is small and stable; `fetch` keeps the dep tree minimal. |
| 2 | `src/client.ts` | Two-step `list_work_items`: `POST /_apis/wit/wiql` → `GET /_apis/wit/workitems?ids=…`. | AzDO's `/wit/workitems` endpoint is batch-by-ID; a list MUST be WIQL-driven. |
| 3 | `src/tools.ts` | Three mutations carry a `confirm: z.literal(true)` Zod arg. | The platform bar for `confirm: true` is: any tool that has a meaningful destructive side-effect on the customer data plane must require explicit intent. The three AzDO mutations qualify; the GitHub mutations did not. |
| 4 | `src/config.ts` | `AZURE_DEVOPS_PAT` is a project-scoped PAT, not a user OAuth token. | AzDO's only auth path for REST is Basic auth from a PAT; we document the project-scoping requirement at deployment time (the REST API does not surface the token's scope). |
| 5 | `src/config.ts` | `api-version=7.1` pinned on every request via the client wrapper. | Matches the FORA-13-style API-version pinning pattern from `@fora/mcp-github`. |
| 6 | `test/mock-azdo.mjs` | Optional project segment stripped from the path before routing. | Lets one mock server handle both org-level (`/_apis/projects`) and project-level (`/forge/_apis/...`) routes, matching the production URL layout. |
| 7 | `test/smoke.mjs` | Asserts `confirm: false` is rejected for a mutation. | The Zod literal is the only thing standing between the model and a real Azure DevOps mutation; the smoke proves it works. |

## Acceptance bar (also the template's)

- All 9 required tools are registered with Zod raw shapes and one-line descriptions.
- `npm run smoke` exits 0 with the same end-of-log `[smoke] done: all 9 tools smoke-tested green`.
- README follows the same sections as the GitHub one: Install, Authentication, Tools, Run the smoke test, Troubleshooting, Reuse.
- This `docs/template-note.md` is updated to list the new server and any contract drift it requires.
- A `request_review` comment on FORA-96 links the smoke transcript and names the manual verification step.

Anything less is a draft.
