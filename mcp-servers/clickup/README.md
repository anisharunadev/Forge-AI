# `forge-ai/mcp-clickup` — Forge AI ClickUp MCP Server

Priority-1 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes eight tools over MCP/stdio: `list_tasks`, `search_tasks`, `get_task`, `list_comments`, `create_task`, `update_task`, `set_task_status`, `add_comment`.

The server is **pinned to a single List** at startup. The model can pass a `taskId`, but the underlying List is asserted against the pin before any call lands. This is the same safety posture as `forge-ai/mcp-jira`'s `JIRA_PROJECT_KEY` enforcement, scoped one level shallower (a List is roughly a Jira "filter saved search" over a single board column).

The package layout, scripts, and entry-point pattern are deliberately identical to `forge-ai/mcp-jira` and `forge-ai/mcp-github` so the rest of the priority-1 MCP family (Confluence, SonarQube, Figma, AWS, Slack) can copy it.

This package implements **Forge AI-202 sub-task 11.2c.1** — the ClickUp MCP skeleton — and is the foundation for the ClickUp adapter (sub-tasks 11.2c.2 → 11.2c.5: webhook ingest, outbound, comment bridge, divergence job).

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/clickup
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-clickup.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/clickup
npm pack          # produces fora-mcp-clickup-0.1.0.tgz
npm install -g ./fora-mcp-clickup-0.1.0.tgz
```

After global install, `fora-mcp-clickup` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "clickup": {
      "command": "fora-mcp-clickup",
      "env": {
        "CLICKUP_API_TOKEN": "${CLICKUP_API_TOKEN}",
        "CLICKUP_LIST_ID": "${CLICKUP_LIST_ID}",
        "CLICKUP_BASE_URL": "https://api.clickup.com"
      }
    }
  }
}
```

The server reads all three env vars on startup. If any is missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server uses the **ClickUp REST v2** API with a Personal API Token sent in the `Authorization` header verbatim (no `Bearer` prefix per ClickUp's REST v2 docs).

### 1. Create a personal API token

1. Sign in to the ClickUp account that owns the List you want pinned.
2. Visit <https://app.clickup.com/settings/apps> → **Apps** → **API**.
3. Click **Generate** (or **+ Create token** depending on the UI), label it (e.g. `fora-mcp-clickup`), and copy the value into `CLICKUP_API_TOKEN`.

### 2. Set the List pin

- `CLICKUP_LIST_ID` — the numeric List id you want pinned. The model cannot address any other List. Discover it in the ClickUp UI: open the List, then look at the URL — the trailing numeric segment after `/li/` is the List id. The model can pass `taskId` but the underlying List is server-pinned for safety.
- `CLICKUP_BASE_URL` — your site root. The default (`https://api.clickup.com`) works for ClickUp Cloud; self-hosted tenants override it.

### Least-privilege scope

Classic ClickUp personal tokens are **account-scoped**, not per-token-scoped — the token inherits every permission the account has. For least privilege, do one of:

- **Recommended for production**: a dedicated service account whose only access is the one List. Grant **Read**, **Create**, **Edit**, **Comment**, **Status change** on the pinned List, and revoke workspace / space / folder admin rights. The service account should be a guest on a single Space.
- **Better isolation**: switch to **OAuth 2.0** with explicit scopes (`task.read`, `task.write`, `comment.read`, `comment.write`, `status.write`) per ClickUp's OAuth app. The MCP server accepts the personal token today; a follow-up release can switch to OAuth with the same `createClient` shape.
- **Token rotation**: rotate personal tokens at least every 90 days. The MCP server does not own the rotation; that is an operations concern.

> **Why List-pinned, not Workspace-pinned?** A workspace-scoped token would let a confused or malicious agent prompt reach any List in any Space the user can see. List-pinning is a hard security boundary enforced on every call — the `get_task` scope check, the per-task scope guard, and the create-task payload all refuse to act outside the pin.

---

## Tools

All tools operate against the pinned List. The `listId` is intentionally NOT a tool input — the server injects it from `CLICKUP_LIST_ID`. Mutations require `confirm: true` so the broker-side gate (per Forge AI-126) must approve the call.

| Tool | Purpose | Required args | Optional args | Mutation |
| --- | --- | --- | --- | --- |
| `list_tasks` | List tasks in the pinned List (paged). | — | `page`, `pageSize`, `statuses` | no |
| `search_tasks` | Case-insensitive substring search over task name + description. | `query` | `page`, `pageSize` | no |
| `get_task` | Get one task by id, including current status, priority, assignee, due date. | `taskId` | — | no |
| `list_comments` | List comments on a task in chronological order. | `taskId` | — | no |
| `create_task` | Create a new task in the pinned List. Returns the new id + url. | `name`, `confirm: true` | `description`, `status`, `priority`, `dueDate` | **yes** |
| `update_task` | Update fields on an existing task. Only provided fields are touched. | `taskId`, `confirm: true` | `name`, `description`, `priority`, `dueDate` | **yes** |
| `set_task_status` | Move a task to a new status by name. | `taskId`, `status`, `confirm: true` | — | **yes** |
| `add_comment` | Post a plain-text comment on a task. | `taskId`, `body`, `confirm: true` | `notifyAll` | **yes** |

### Example payloads

`list_tasks`:

```json
{ "pageSize": 20 }
```

`list_tasks` with status filter:

```json
{ "statuses": ["in progress", "review"] }
```

`search_tasks`:

```json
{ "query": "wire up the mcp" }
```

`get_task`:

```json
{ "taskId": "9001" }
```

`create_task`:

```json
{
  "name": "Wire up the SDLC orchestrator",
  "description": "Connects the master orchestrator to the BA / Architect / Developer / QA agents.",
  "status": "to do",
  "priority": 3,
  "dueDate": 1719000000000,
  "confirm": true
}
```

`update_task`:

```json
{
  "taskId": "9001",
  "name": "Wire up the SDLC orchestrator (renamed)",
  "priority": 2,
  "confirm": true
}
```

`set_task_status`:

```json
{
  "taskId": "9001",
  "status": "in progress",
  "confirm": true
}
```

`add_comment`:

```json
{
  "taskId": "9001",
  "body": "## QA report\n\nSmoke test passed. Ready for review.",
  "notifyAll": false,
  "confirm": true
}
```

The mutation reads back the new state (`set_task_status` echoes the status, `add_comment` echoes the new id) so the caller gets a confirmation payload instead of a silent 204.

---

## Run the smoke test

The smoke test boots a mock ClickUp REST v2 server, spawns the MCP server pointed at it, and exercises all 8 tools over stdio. It runs without any real ClickUp credentials.

```bash
cd mcp-servers/clickup
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 8 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid ClickUp MCP configuration: … CLICKUP_LIST_ID is required …` | Missing env var | Set `CLICKUP_API_TOKEN` and `CLICKUP_LIST_ID` in the MCP client config. |
| `ListScopeError: Refusing to act on List 'X' — this server is pinned to 'Y'` | The model tried to address a different List. | Either change `CLICKUP_LIST_ID` to the right List (requires restart), or call only against tasks in the pinned List. |
| `ClickUpApiError 401` on first call | Bad token or revoked token. | Re-create the personal API token at <https://app.clickup.com/settings/apps>. |
| `ClickUpApiError 403` on `create_task` / `update_task` / `set_task_status` / `add_comment` | The token's account lacks the required permission on the pinned List. | Grant the account the missing permission on the pinned List, or switch to an account that has it. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing `dist/` build. |
| Mutation returns `isError: true` with "Invalid input: expected `true`" | Forgot to pass `confirm: true`. | Add `confirm: true` to the tool arguments. Read tools do not require this. |

---

## Forge AI Sync-Plane context

This MCP server is the platform-facing surface for the ClickUp adapter chain:

- **11.2c.1 — MCP skeleton (this package).** Provides the typed tools over MCP/stdio, mock-backed smoke green.
- **11.2c.2 — webhook ingest.** Wires ClickUp's webhook events (signed per ClickUp docs) into the Sync Plane's `Resolver` as inbound `SyncEvent`s.
- **11.2c.3 — outbound.** Consumes `ResolutionOutcome` from the Sync Plane and calls `create_task` / `update_task` / `set_task_status` to write back to ClickUp.
- **11.2c.4 — comment bridge.** Maps `comment.body` events bidirectionally with idempotency on ClickUp comment ids.
- **11.2c.5 — divergence job.** Reads `DivergenceQueue.list()` and surfaces parked ClickUp events in the workbench.

The ClickUp ownership defaults live in `forge/sync-plane/src/ownership.ts`:

- `issue.title`, `issue.body`, `comment.body` — Tier-2, HLC LWW across all writers including ClickUp.
- `issue.status` — `creator` mode with `translated_mirror_state` so the creating platform owns the canonical status; ClickUp mirrors state as a translated status name.
- `clickup.assignee` (single owner: clickup, `read_only_on_remote`).

See `docs/assumptions-vs-jira-mcp.md` (in this package) for divergences from the Jira MCP that matter when wiring the agent.

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` (in `forge-ai/mcp-github`) for the contract these servers share, and `docs/assumptions-vs-jira-mcp.md` (in this package) for the divergences that matter when wiring the agent: rate limits, search syntax, status vs transition model, List pin vs project pin.