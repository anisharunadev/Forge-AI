# `@forge-ai/mcp-kiro` — Forge AI Kiro MCP Server

Kiro IDE state MCP server for the Forge AI Enterprise AI SDLC Operating
System. Exposes four read-only tools over MCP/stdio:

- `get_open_files` — files currently open in the Kiro IDE
- `get_current_selection` — file path + line range of the current selection
- `get_active_task_queue` — pending and running tasks in the Kiro task system
- `get_agent_run_history` — recent agent runs (last N)

The server is **pinned to a single Kiro workspace** at startup. The
model can pass tool args (e.g. a history `limit`), but it can never
choose a different workspace. The workspace scope is asserted on
startup with a single liveness call to the daemon.

This server is **read-mostly** by design — it only ever reads IDE
state. We never mutate the editor through this surface.

> **Kiro daemon spec status:** Kiro is an emerging IDE and its
> daemon/socket protocol is not yet a fully documented public surface.
> The server is scaffolded against the assumptions documented in
> `docs/README.md` (Unix socket at `/tmp/kiro.sock` or local HTTP at
> `localhost:<port>`), and the client is abstracted behind a typed
> `Client` interface so the transport can be swapped without touching
> the tool contracts.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/kiro
pnpm install
pnpm run build
```

The compiled entry point is `dist/index.js`. The launcher at
`bin/kiro-mcp.mjs` resolves it for you.

### Pack and install (CI / partner handoff)

```bash
cd mcp-servers/kiro
pnpm pack          # produces forge-ai-mcp-kiro-0.1.0.tgz
pnpm install -g ./forge-ai-mcp-kiro-0.1.0.tgz
```

After global install, `kiro-mcp` is on `PATH`.

### Wire into the orchestrator

In your MCP client config, add:

```jsonc
{
  "mcpServers": {
    "kiro": {
      "command": "kiro-mcp",
      "env": {
        "KIRO_AUTH_TOKEN": "${KIRO_AUTH_TOKEN}",
        "KIRO_WORKSPACE_ID": "your-customer-workspace-id"
      }
    }
  }
}
```

The server reads both env vars on startup. If either is missing, the
process exits with a non-zero status and a clear message naming the
offending variable.

---

## Authentication

The server uses a **bearer token** presented to the Kiro daemon over
its chosen transport (Unix socket or local HTTP). The header is:

```
authorization: Bearer <token>
x-kiro-workspace: <workspace-id>
```

1. Generate or copy a Kiro daemon auth token. Kiro's auth model is
   not yet fully documented; treat the token as you would any other
   IDE-adjacent credential — least privilege, scoped to one workspace.
2. Set `KIRO_AUTH_TOKEN` to that token.
3. Set `KIRO_WORKSPACE_ID` to the workspace id the token is scoped to.

> **Why workspace-pinned, not user-pinned?** A user-scoped token
> would let a confused or malicious agent prompt see whatever the
> user sees — across workspaces, across customers. Workspace-pinning
> is a hard security boundary that the server enforces on every
> request; the model can only see the pinned workspace.

The workspace scope is asserted on startup with a single
`GET /v1/tasks/active` liveness call. If the token cannot see the
workspace, the process exits non-zero before any tool can be called.

### Optional transport knobs

| Env var              | Default          | Purpose                                                       |
| -------------------- | ---------------- | ------------------------------------------------------------- |
| `KIRO_SOCKET_PATH`   | `/tmp/kiro.sock` | Unix socket path for the Kiro daemon.                         |
| `KIRO_HTTP_BASE_URL` | (unset)          | Local HTTP base URL. Takes effect only if no socket is reachable. |
| `KIRO_USER_AGENT`    | `kiro-mcp/0.1.0` | User-Agent header on daemon requests.                         |

These are operational knobs (transport selection, smoke override, UA
string) and are not surfaced to the model.

---

## Tools

All tools are read-only views into the Kiro IDE state. The model never
gets to choose the workspace — the server pins `KIRO_WORKSPACE_ID`
into every request it constructs.

| Tool                    | Purpose                                                                | Required args | Optional args |
| ----------------------- | ---------------------------------------------------------------------- | ------------- | ------------- |
| `get_open_files`        | List files currently open in the Kiro IDE (path, active, dirty, lang). | —             | —             |
| `get_current_selection` | File path + line range of the current selection (or `null`).           | —             | —             |
| `get_active_task_queue` | Pending and running tasks in the Kiro task system.                     | —             | —             |
| `get_agent_run_history` | Most recent N agent runs (status, agent, timestamps, tokens).         | —             | `limit` (1-200, default 25) |

### Example payloads

`get_open_files`:

```json
{}
```

`get_current_selection`:

```json
{}
```

`get_active_task_queue`:

```json
{}
```

`get_agent_run_history`:

```json
{
  "limit": 10
}
```

### Contract drift: empty / null responses

Kiro's spec is still evolving. The client tolerates both the bare
array shape (`OpenFile[]`) and the wrapped shape (`{ files: OpenFile[] }`)
on `get_open_files`, `{ tasks: KiroTask[] }` on `get_active_task_queue`,
and `{ runs: AgentRun[] }` on `get_agent_run_history`. `get_current_selection`
returns `null` when nothing is selected.

---

## Run the tests

Unit tests (4 tests, one per tool, against a typed mock client):

```bash
pnpm run test:unit
```

Integration tests (2 tests, against a mocked Kiro daemon over HTTP):

```bash
pnpm run build
pnpm run test:integration
```

Or both:

```bash
pnpm test
```

Expected output ends with:

```
ℹ tests 6
ℹ pass  6
ℹ fail  0
```

If any assertion fails, the script exits non-zero and prints the
failure. No real Kiro daemon is touched.

---

## Troubleshooting

| Symptom                                                      | Cause                                                                       | Fix                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Server exits with `Invalid Kiro MCP configuration: …`        | Missing one of the required env vars.                                       | Set `KIRO_AUTH_TOKEN` and `KIRO_WORKSPACE_ID` in the MCP client config.                           |
| Server exits with `workspace-scope assertion failed`         | Token cannot see the workspace, or the daemon is unreachable.               | Confirm the workspace id, the token, and that the Kiro daemon is running on `/tmp/kiro.sock`.     |
| `MCP error -32000: Connection closed` on first call          | The child process died at startup.                                          | Check stderr — usually a config error, a missing `dist/` build, or a workspace-scope failure.     |
| `get_open_files` returns an empty list                       | The IDE has no files open, or the daemon's response shape is unexpected.    | Expected when no files are open. If you expected files, check the daemon's response shape.       |
| `get_current_selection` returns `null`                       | Nothing is selected in the editor.                                          | Expected. Select text in the editor to get a non-null selection.                                 |
| `get_agent_run_history(limit=999)` is silently clamped       | The Zod schema caps `limit` at 200.                                         | Pass a smaller `limit`. The cap is intentional; raise it in `src/tools.ts` if you need more.      |

---

## Reuse: the Forge AI MCP server template

This package is a copy of the shared template
(`mcp-servers/figma/docs/template-note.md`) with a Kiro-specific
client. The seven contract points from the template apply verbatim:

1. **Single-scope pin on startup** — `KIRO_WORKSPACE_ID` is required
   and the model cannot override it.
2. **Typed client wrapper** — `createClient(config) → Client`.
3. **Zod raw shapes as the source of truth** — each tool definition
   carries a Zod raw shape and feeds it to `McpServer.tool()`.
4. **Stdout = JSON-RPC, stderr = logs** — no human-readable log
   lines on stdout.
5. **Mock-daemon test harness** — `test/integration.test.ts` boots a
   local HTTP mock and drives the compiled server over the MCP SDK.
6. **Clean shutdown on SIGINT/SIGTERM** — `index.ts` wires both
   signal handlers and closes the transport.
7. **No agent-visible env vars beyond the pin and the auth.**

See `docs/README.md` for the Kiro-specific contract drift.

---

## Kiro-specific contract notes

### No Kiro SDK

Kiro's daemon protocol is not covered by a maintained TypeScript SDK
we want to depend on. The client in `src/client.ts` is hand-rolled
over `fetch` (HTTP) and `net` (Unix socket), with the same typed
`createClient(config) → Client` shape the other Forge AI MCP servers
use. The trade-off: no auto-reconnect, no streaming, no built-in
retries. v0.1.0 does a single request per tool call and surfaces
non-2xx as `KiroApiError`. If we adopt retries later, do it inside
the client so the tools' input/output shape stays stable.

### Read-only

The platform reads IDE state. It never mutates editor content
(no `POST /v1/state/open-files`, no close-tab, no write-to-buffer).
The only intent for the future would be a "leave a hint" tool, and
that would still be a comment/annotation, not an editor mutation.
For now, every tool is a `GET`.

### Workspace-scope startup assertion

The server issues a single `GET /v1/tasks/active` on startup to assert
the token can see the pinned workspace. This adds one round trip to
startup and turns misconfiguration into a process-level failure
rather than a tool-level surprise. If startup latency matters, the
assertion can be moved to first-call (lazy); the trade-off is that a
misconfigured server accepts connections and then fails every call.

### Daemon spec is evolving

Kiro's daemon protocol is still settling. The wire shape, endpoint
paths, and response envelopes documented in `docs/README.md` are our
best current assumptions and may shift. The `Client` interface in
`src/client.ts` is the contract that matters; if the daemon's wire
shape changes, the change is local to that file.
