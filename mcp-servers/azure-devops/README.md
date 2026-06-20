# `@fora/mcp-azure-devops` — Forge AI Azure DevOps MCP Server

Priority-2 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes nine tools over MCP/stdio against Azure DevOps REST 7.1: `list_projects`, `list_repos`, `list_pipelines`, `run_pipeline`, `get_pipeline_run`, `list_work_items`, `get_work_item`, `create_work_item`, `add_work_item_comment`.

The server is **pinned to a single Azure DevOps project** at startup. Three mutation tools (`run_pipeline`, `create_work_item`, `add_work_item_comment`) require `confirm: true` in the call so the model can't quietly mutate state.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/azure-devops
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-azure-devops.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/azure-devops
npm pack          # produces fora-mcp-azure-devops-0.1.0.tgz
npm install -g ./fora-mcp-azure-devops-0.1.0.tgz
```

After global install, `fora-mcp-azure-devops` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "azure-devops": {
      "command": "fora-mcp-azure-devops",
      "env": {
        "AZURE_DEVOPS_PAT": "${AZURE_DEVOPS_PAT}",
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/your-customer-org",
        "AZURE_DEVOPS_PROJECT": "your-customer-project"
      }
    }
  }
}
```

The server reads all three env vars on startup. If any is missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server authenticates with a **project-scoped Personal Access Token (PAT)** sent as Basic auth (`Authorization: Basic base64(":" + pat)`) per the Azure DevOps REST 7.1 contract.

### How to mint a project-scoped PAT (least privilege)

1. Sign in to `https://dev.azure.com/{your-org}` as a user with **Project Collection Administrator** or **Project Administrator** on the target project.
2. Visit `User settings → Personal access tokens → New Token`.
3. **Organisation** = the org the server is pinned to. **Project** = the pinned project (this is the scoping step — keep it pinned to the single project).
4. Set the **expiration** to the shortest window your rotation policy allows.
5. **Scopes** (least privilege):
   - **Project:** Read (covers `list_projects`, `list_repos`, `list_pipelines`, `get_pipeline_run`, `get_work_item`, `list_work_items`)
   - **Build:** Read & execute (covers `run_pipeline`; `read` is not enough to queue a run)
   - **Work Items:** Read, write, & manage (covers `create_work_item` and `add_work_item_comment`; `read` alone is not enough)
6. Copy the token and set `AZURE_DEVOPS_PAT`. Set `AZURE_DEVOPS_ORG_URL` to the org URL and `AZURE_DEVOPS_PROJECT` to the project name.

### Why project-scoped, not org-scoped?

A broad, org-level PAT would let a confused or malicious agent prompt reach into every project in the org. Project-scoped PATs are a hard security boundary that the server enforces on every call. The Azure DevOps REST 7.1 contract exposes `/{org}/_apis/projects` so a model *can* enumerate the org's projects at runtime — we surface that as `list_projects` for transparency, but the server itself only ever talks to the pinned project.

> **Note:** the MCP server does not validate the token's scope server-side (the AzDO REST API does). Pair the project-scoped PAT with a project-scoped resource access policy on the customer side.

---

## Tools

| Tool | Purpose | Required args | Optional args | Mutating |
| --- | --- | --- | --- | --- |
| `list_projects` | List projects in the org this server is pinned to. | — | — | no |
| `list_repos` | List Git repos in the pinned project. | — | `top` | no |
| `list_pipelines` | List pipelines in the pinned project. | — | `top` | no |
| `run_pipeline` | Queue a new pipeline run. | `pipelineId`, `confirm: true` | `variables` | **yes** |
| `get_pipeline_run` | Fetch a single pipeline run. | `pipelineId`, `runId` | — | no |
| `list_work_items` | List work items via a WIQL query (default: `SELECT [System.Id] FROM WorkItems`). | — | `wiql`, `top` | no |
| `get_work_item` | Fetch one work item by ID. | `id` | `expand` | no |
| `create_work_item` | Create a work item. | `type`, `title`, `confirm: true` | `description`, `fields` | **yes** |
| `add_work_item_comment` | Add a comment to a work item. | `id`, `text`, `confirm: true` | — | **yes** |

### Example payloads

`list_repos`:

```json
{ "top": 10 }
```

`run_pipeline`:

```json
{
  "pipelineId": 12,
  "variables": { "BRANCH": { "value": "main" } },
  "confirm": true
}
```

`create_work_item`:

```json
{
  "type": "Task",
  "title": "Smoke: AzDO MCP connected",
  "description": "Created by the Forge AI AzDO MCP smoke test.",
  "fields": { "System.Tags": "smoke; prio-1" },
  "confirm": true
}
```

`add_work_item_comment`:

```json
{
  "id": 101,
  "text": "## QA report\n\nSmoke test passed. Ready for review.",
  "confirm": true
}
```

---

## Run the smoke test

The smoke test boots a mock Azure DevOps HTTP server, spawns the MCP server pointed at it, and exercises all 9 tools over stdio. It runs without any real Azure DevOps credentials.

```bash
cd mcp-servers/azure-devops
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 9 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

The mock asserts:

- All 9 tools return the expected payload shapes.
- Every recorded HTTP call carried a `Basic` auth header.
- The right HTTP routes were hit (`/_apis/projects`, `/_apis/git/repositories`, `/_apis/pipelines`, `POST /_apis/pipelines/{id}/runs`, `POST /_apis/wit/wiql`, `GET /_apis/wit/workitems?ids=…`, `POST /_apis/wit/workitems/$Type`, `POST /_apis/wit/workitems/{id}/comments`).
- `confirm: false` is rejected for mutations (Zod literal `true`).

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid Azure DevOps MCP configuration: AZURE_DEVOPS_PAT is required` | Missing env var | Set `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG_URL`, and `AZURE_DEVOPS_PROJECT` in the MCP client config. |
| `401 Unauthorized` on first call | PAT is wrong, expired, or not project-scoped | Re-mint a project-scoped PAT (see Authentication). |
| `403 Forbidden` on `run_pipeline` | Token's Build scope is `read` only (not `read & execute`) | Re-mint with **Build: Read & execute**. |
| `403 Forbidden` on `create_work_item` | Token's Work Items scope is `read` only | Re-mint with **Work Items: Read, write, & manage**. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing `dist/` build. |
| `create_work_item` returns `404` for `$User Story` | The work item type name must match a process-configured type for the project. | Use the exact type name the project's process exposes (e.g. `Task`, `Bug`, `User Story`, `Feature`). |
| `add_work_item_comment` returns `400` | The comment text starts with a non-printable character or is too long. | The AzDO REST API accepts plain text and a small HTML subset; keep it under the project's `comments` length cap. |

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` for the shared contract (single-scope pin, typed client, Zod raw shapes, stdio=JSON-RPC, mock-backed smoke, clean SIGINT/SIGTERM, no extra env vars) and how `@fora/mcp-azure-devops` deviates from the GitHub template.

This server was copied from `@fora/mcp-github` and adapted for Azure DevOps REST 7.1.
