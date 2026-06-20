# Template note — which MCP servers `@fora/mcp-databricks` templates for

This package is a **priority-2** MCP server in the Forge AI platform and ships in the same shape as the priority-1 set (Jira, GitHub, Confluence, AWS, SonarQube, Figma, Slack/Teams). It is the eighth concrete server to land and the first P2 to ship.

The GitHub MCP server is the canonical template; see [`@fora/mcp-github`'s template note](../github/docs/template-note.md) for the seven shared contract points and the full list of servers that already copy it.

## Local drift from the canonical template

| # | Contract point | Local notes |
| --- | --- | --- |
| 1 | Single-scope pin on startup. | Pinned to `DATABRICKS_WORKSPACE_URL` (required), `DATABRICKS_JOB_ID` (optional, single-job focus), `DATABRICKS_WAREHOUSE_ID` (optional, single-SQL focus). The server refuses to start without `DATABRICKS_WORKSPACE_URL`. |
| 2 | Typed `createClient(config)` wrapper. | Returns a `Client` whose methods take only IDs and primitives. Errors are typed: `JobScopeError`, `WarehouseScopeError`, `ConfirmRequiredError`, `DatabricksApiError`. |
| 3 | Zod raw shapes as the source of truth. | All eight tools use `z.object(...).strict()` parsers; the MCP SDK takes the raw shape. |
| 4 | stdout = JSON-RPC, stderr = logs. | Yes — every operational line (including the `dapi` prefix warning and the boot banner) goes to stderr. |
| 5 | Smoke test = mock HTTP + spawn server + drive via MCP client. | `test/smoke.mjs` boots an in-process mock of the Jobs REST 2.1 + SQL Statement Execution APIs, spawns the compiled server with `DATABRICKS_API_BASE_URL` pointing at the mock, and drives all 8 tools over the MCP SDK `Client`. |
| 6 | Clean shutdown on SIGINT/SIGTERM. | Yes — `src/index.ts` wires both signals through a single `shutdown` helper. |
| 7 | No agent-visible env vars beyond the pin and the token. | The five env vars are: `DATABRICKS_TOKEN` (required), `DATABRICKS_WORKSPACE_URL` (required), `DATABRICKS_JOB_ID` (optional pin), `DATABRICKS_WAREHOUSE_ID` (optional pin), `DATABRICKS_API_BASE_URL` (smoke tests only). No operator knobs the model could legitimately want. `DATABRICKS_USER_AGENT` is supported as a Zod field but is not currently exposed. |

## Auth

The token MUST be a service-principal PAT (starts with `dapi…`). The server prints a stderr warning at startup if the token does not match that prefix. v1.1 will add OAuth client credentials as a follow-up.

## Mutations

Three tools mutate workspace state and require an explicit `confirm: true` argument (a Zod literal):

- `run_job` — triggers a workspace job run.
- `cancel_run` — cancels an in-flight run.
- `execute_sql` — runs a SQL statement against a SQL warehouse. Read-only is recommended; DML/DDL is allowed.

The `confirm: true` literal is checked in the typed `Client` (not just at the MCP boundary) so a future caller that bypasses the MCP layer still cannot trigger mutations without the explicit ack.

## SDK choice

Databricks has no actively-maintained JavaScript SDK. The MCP server uses plain `fetch` against the Jobs REST 2.1 + SQL Statement Execution APIs. This matches the `@fora/mcp-aws` precedent (which also uses plain `fetch` against AWS JSON 1.1) and keeps the dep tree tiny — only `@modelcontextprotocol/sdk` and `zod` are required.

## Servers that copy this template

This package is the ninth concrete MCP server in the Forge AI platform. The list of servers that already copy the canonical template lives in [`@fora/mcp-github`'s template note](../github/docs/template-note.md); the local drift table above is the only thing that's different.
