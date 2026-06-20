# `@fora/mcp-databricks` — Forge AI Databricks MCP Server

Priority-2 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes eight tools over MCP/stdio: `list_jobs`, `get_job`, `run_job`, `get_run`, `cancel_run`, `list_clusters`, `get_cluster`, `execute_sql`.

The server is **pinned to a single Databricks workspace** at startup. The model can pass `job_id` and `warehouse_id` as arguments, but they are asserted against the optional server pins (`DATABRICKS_JOB_ID`, `DATABRICKS_WAREHOUSE_ID`) when those env vars are set. This is the safety property that lets the same server template drive all priority-2 migrations.

The token MUST be a **service-principal PAT** (starts with `dapi…`). A user PAT would let the agent act as the operator, which defeats the audit trail. Service principals also support least-privilege grants (e.g. `CAN_RESTART` on a single cluster, `CAN_USE` on a single warehouse, no Unity Catalog grants for the read-only path).

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/databricks
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-databricks.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/databricks
npm pack          # produces fora-mcp-databricks-0.1.0.tgz
npm install -g ./fora-mcp-databricks-0.1.0.tgz
```

After global install, `fora-mcp-databricks` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "databricks": {
      "command": "fora-mcp-databricks",
      "env": {
        "DATABRICKS_TOKEN": "${DATABRICKS_TOKEN}",
        "DATABRICKS_WORKSPACE_URL": "https://dbc-12345.cloud.databricks.com",
        "DATABRICKS_WAREHOUSE_ID": "warehouse-abc"
      }
    }
  }
}
```

The server reads both required env vars on startup. If either is missing, it exits with a non-zero status and a clear message naming the offending variable. The optional `DATABRICKS_JOB_ID` further pins a single job.

---

## Authentication

The server supports a **Databricks Cloud PAT** (Personal Access Token) issued for a **service principal**. OAuth client credentials are a v1.1 follow-up (tracked separately from this issue).

### Service-principal PAT (simplest for dev)

1. In the Databricks Cloud console, navigate to your service principal (or create one at the customer boundary — one SP per customer, one PAT per SP).
2. **Generate a token** for the service principal. Copy it into `DATABRICKS_TOKEN`.
3. Set `DATABRICKS_WORKSPACE_URL` to the workspace URL (e.g. `https://dbc-12345.cloud.databricks.com`, no trailing slash).

### Least-privilege grants (recommended for production)

| Action | Grant on the service principal |
| --- | --- |
| `list_jobs`, `get_job` | `CAN_VIEW` on the **Jobs** scope, OR `CAN_MANAGE_RUN` for the specific jobs you want to call |
| `run_job`, `get_run` | `CAN_MANAGE_RUN` on the specific job(s) you want to run |
| `cancel_run` | `CAN_MANAGE_RUN` on the parent job |
| `list_clusters`, `get_cluster` | `CAN_ATTACH_TO` on the cluster, OR cluster-level `CAN_RESTART` |
| `execute_sql` (read-only) | `CAN_USE` on the SQL warehouse, no Unity Catalog grants needed |
| `execute_sql` (DML/DDL — strongly discouraged) | `MODIFY` on the relevant catalog / schema, `CAN_USE` on the warehouse |

> **Why a service principal, not a user token?** A user-scoped token would let a confused or malicious agent prompt act on behalf of the operator, including accessing personal data. A service-principal token is non-repudiable: every audit log row points back to the SP, and the SP's grant set is the only surface the agent can reach.

> **Why the `dapi` prefix warning?** The server prints a stderr warning at startup if the token does not start with `dapi`. This is a belt-and-suspenders check — customers sometimes mint custom-prefix tokens, and we don't want to fail-stop on that. The warning is for operator visibility only; the server still boots.

---

## Tools

All tools are pinned to a single workspace at startup. Three tools mutate workspace state and require an explicit `confirm: true` argument (a Zod literal) so the model can't trigger job runs, cancels, or SQL writes without an explicit ack.

| Tool | Purpose | Required args | Optional args | Mutates? |
| --- | --- | --- | --- | --- |
| `list_jobs` | List jobs in the workspace. | — | `limit`, `offset`, `name` | no |
| `get_job` | Get a single job by id. | `job_id` | — | no |
| `run_job` | Trigger a job run now. | `job_id`, `confirm: true` | `jar_params`, `notebook_params` | **yes** |
| `get_run` | Get a run by id. | `run_id` | — | no |
| `cancel_run` | Cancel an in-flight run. | `run_id`, `confirm: true` | — | **yes** |
| `list_clusters` | List all-purpose and job clusters. | — | `page_size`, `page_token` | no |
| `get_cluster` | Get a single cluster by id. | `cluster_id` | — | no |
| `execute_sql` | Execute a SQL statement against a warehouse. | `sql`, `confirm: true` | `warehouse_id`, `row_limit` | **yes** (DML/DDL) |

### Example payloads

`list_jobs`:

```json
{ "limit": 50, "name": "nightly" }
```

`get_job`:

```json
{ "job_id": 100 }
```

`run_job`:

```json
{ "job_id": 100, "confirm": true, "jar_params": ["yesterday"] }
```

`execute_sql`:

```json
{
  "sql": "SELECT id, name FROM etl.t_demo LIMIT 2",
  "confirm": true
}
```

---

## Run the smoke test

The smoke test boots a mock Databricks HTTP server, spawns the MCP server pointed at it, and exercises all 8 tools over stdio. It runs without any real Databricks credentials.

```bash
cd mcp-servers/databricks
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 8 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

The smoke test asserts:

- All 8 tools return the expected payload shape.
- The right HTTP routes are hit (`/api/2.1/jobs/list`, `/api/2.0/sql/statements/`, etc.).
- Every request carries `Authorization: Bearer dapi…` (so a future regression that drops the auth header fails loud).
- The `run_job` body carries `job_id` and the requested `jar_params`.
- The `execute_sql` body carries `warehouse_id` (server-pinned) plus `disposition: INLINE` and `format: JSON_ARRAY`.
- The boot banner appears on stderr exactly once (proving the server started cleanly and the transport didn't crash before our first call).

### Live smoke

Live E2E against a real Databricks workspace is out of scope for this issue and follows the [Forge AI-11](https://github.example/Forge AI/projects/3fde3945-9dcb-4c43-95b3-4e4e9db6ffe9/issues/11) pattern (one per server after the smoke is green). A future ticket will wire `npm run smoke:live` against `https://<your-workspace>.cloud.databricks.com`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid Databricks MCP configuration: DATABRICKS_TOKEN is required` | Missing env var | Set `DATABRICKS_TOKEN` and `DATABRICKS_WORKSPACE_URL` in the MCP client config. |
| `JobScopeError: Refusing to act on job_id=200 — this server is pinned to job_id=100` | `DATABRICKS_JOB_ID=100` is set and the call passed a different id. | Either pass the pinned id, or unset the pin (requires restart). |
| `WarehouseScopeError: Refusing to act on warehouse_id='warehouse-xyz' — this server is pinned to warehouse_id='warehouse-abc'` | The `warehouse_id` arg didn't match the server pin. | Same as above. |
| `ConfirmRequiredError: Refusing to call 'run_job' without confirm: true` | A mutating tool was called without `confirm: true`. | Pass `confirm: true` to acknowledge the destructive action. |
| `execute_sql` returns `execute_sql requires a warehouse_id argument or DATABRICKS_WAREHOUSE_ID pin` | No `warehouse_id` was passed and no server pin is set. | Pass `warehouse_id` in the call, or set `DATABRICKS_WAREHOUSE_ID` and restart. |
| Stderr shows `warning: DATABRICKS_TOKEN does not start with 'dapi'` | The token is not a classic Databricks PAT prefix. | Confirm the token is a service-principal PAT (Cloud console → Service Principals → … → Tokens). If intentional, ignore. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing `dist/` build. |
| `DatabricksApiError: … returned 401` | The PAT is invalid, expired, or revoked. | Mint a new SP PAT and rotate `DATABRICKS_TOKEN`. |
| `DatabricksApiError: … returned 403` | The SP doesn't have the required grant on the target resource. | Add the least-privilege grant listed in the Authentication section above. |
| `execute_sql` hangs / never returns | Statement exceeded `wait_timeout: 30s` and the server returned a `PENDING` statement that the synchronous path won't poll. | Re-issue the call with a smaller `row_limit`, or break the statement into a smaller scope. v1.1 will add a `get_sql_statement` follow-up. |

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` for the full list of MCP servers that copy this template and the seven contract points they all share.

---

## v1.1 roadmap (out of scope for this issue)

- **OAuth client-credentials auth.** Replace the PAT with the SP's client-id/secret and an `oauth2` token-mint endpoint. The current `createClient` signature can be extended with an `auth.kind: "pat" | "oauth"` discriminator; the call site shape (Zod raw input) is unchanged.
- **Polling `get_sql_statement` for long-running queries.** v1 uses `disposition: INLINE, wait_timeout: 30s`, which is fine for dashboards / health checks but not for large ETL-style aggregations. v1.1 will add a `get_sql_statement(statement_id)` tool and a `wait: true` flag that polls until `SUCCEEDED` / `FAILED` / timeout.
- **Workflows / Delta Live Tables / jobs-as-code.** Out of scope for v1; tracked separately once a customer pulls a DLT use-case.
- **Notebook reads** (read-only). The platform reads notebooks for context, never edits them. A future `get_notebook` tool can be added without breaking the existing contract.
- **Live smoke harness.** A `test/live-smoke.mjs` mirroring `mcp-servers/github/test/live-smoke.mjs`, gated on `DATABRICKS_LIVE_SMOKE_TOKEN` so it never accidentally runs against a customer workspace.
