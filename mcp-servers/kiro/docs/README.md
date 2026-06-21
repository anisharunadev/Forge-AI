# `docs/README.md` — Kiro MCP server notes

This is the Kiro-specific companion to the top-level
`mcp-servers/kiro/README.md`. It documents the assumptions we made
about the Kiro daemon because its protocol is still evolving.

## Why this server exists

Kiro is an emerging IDE; we want Forge agents to be able to read the
editor's state (open files, current selection, task queue, recent
agent runs) so the platform can answer "what is the developer looking
at right now" and "what is the agent system busy with" without the
model having to guess. This is a **read-only** view — we never mutate
the editor through this server.

## Kiro daemon — assumed transport

Kiro's daemon protocol is not yet a published public spec. We
scaffold the client against two plausible transport shapes, picked at
startup:

1. **Unix socket** (default). The Kiro daemon is assumed to listen on
   a Unix domain socket. The conventional path is `/tmp/kiro.sock`,
   overridable with `KIRO_SOCKET_PATH`. The wire is a thin JSON
   envelope:
   ```json
   {
     "method": "GET",
     "path": "/v1/state/open-files",
     "body": null,
     "headers": {
       "authorization": "Bearer <token>",
       "x-kiro-workspace": "<workspace>",
       "user-agent": "kiro-mcp/0.1.0"
     }
   }
   ```
   The daemon is expected to respond with a JSON document, optionally
   wrapped in `{ "result": ... }`. Errors are `{ "error": { "status",
   "message" } }`.

2. **Local HTTP** (fallback). The daemon may also expose a local HTTP
   endpoint (e.g. `http://127.0.0.1:9123`). Wire is plain
   JSON-over-`fetch`; same auth + workspace headers, same paths.

If both are configured, the HTTP base URL wins for the smoke test
because it's easier to mock from Node. In production, the socket is
the default.

If the Kiro team publishes a different wire shape later, the change is
isolated to `src/client.ts` — the tool handlers and Zod schemas do not
move.

## Assumed endpoints

| Method | Path                       | Tool that calls it        |
| ------ | -------------------------- | ------------------------- |
| GET    | `/v1/state/open-files`     | `get_open_files`          |
| GET    | `/v1/state/selection`      | `get_current_selection`   |
| GET    | `/v1/tasks/active`         | `get_active_task_queue`   |
| GET    | `/v1/agents/runs?limit=N`  | `get_agent_run_history`   |

All endpoints scope to a single workspace id carried in the
`X-Kiro-Workspace` header. The MCP server pins the workspace id at
startup; the model never gets to choose a different workspace.

## Startup liveness

The server issues a single `GET /v1/tasks/active` on startup. This is
the cheapest read endpoint we expect to be implemented and is the
same shape the model will use. If the daemon is unreachable, the auth
is wrong, or the workspace id is unknown, the process exits non-zero
with a clear stderr message before any tool can be called.

## Contract drift vs. the Figma template

The shared template (see `mcp-servers/figma/docs/template-note.md`)
holds, with three differences:

1. **Single pin, not two.** Kiro uses one pin: `KIRO_WORKSPACE_ID`.
   Figma has file + team; GitHub has org. Kiro's workspace is the
   smallest unit a customer owns.
2. **Two transports, not one.** Socket is the default; HTTP is the
   fallback. The transport is selected at startup, not per-call.
3. **No public SDK.** The Kiro daemon does not have a TypeScript SDK
   we want to depend on. The client is hand-rolled over `net` and
   `fetch` with the same typed `createClient(config) → Client` shape
   the other Forge AI MCP servers use. If a maintained SDK appears
   later, swap it inside `src/client.ts` and the tools stay put.
