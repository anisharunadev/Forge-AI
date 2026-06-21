# `forge-ai/mcp-figma` — Forge AI Figma MCP Server

Priority-1 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes six tools over MCP/stdio: `get_file`, `get_file_nodes`, `get_node`, `get_images`, `get_comments`, `post_comment`.

The server is **pinned to a single Figma file and team** at startup. The model can pass node ids, but they are scoped to the pinned file. The team scope is asserted on startup with a single liveness call. This is the safety property: a model can only see what is in the pinned file, and only what the team's token can reach.

This server is **read-mostly**: it can read the file and post comments, but it cannot mutate design content. Design-file mutation is intentionally not supported and is the responsibility of the UX Designer hire.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/figma
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-figma.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/figma
npm pack          # produces fora-mcp-figma-0.1.0.tgz
npm install -g ./fora-mcp-figma-0.1.0.tgz
```

After global install, `fora-mcp-figma` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "figma": {
      "command": "fora-mcp-figma",
      "env": {
        "FIGMA_TOKEN": "${FIGMA_TOKEN}",
        "FIGMA_FILE_KEY": "your-customer-file-key",
        "FIGMA_TEAM_ID": "your-customer-team-id"
      }
    }
  }
}
```

The server reads all three env vars on startup. If any is missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server uses a Figma **Personal Access Token (PAT)** scoped to a single team. This is Figma's documented auth model for the REST v1 API when you are operating as a service.

1. Visit `Settings → Account → Personal access tokens`.
2. **File scope:** name the token after the customer / project for traceability.
3. **Scopes** (least privilege):
   - `File content: Read` — required for `get_file`, `get_file_nodes`, `get_node`, `get_images`
   - `Comments: Read and write` — required for `get_comments` and `post_comment`
   - Do **not** grant `File content: Write` or any edit / branch scopes. The platform reads designs; it does not mutate them.
4. Copy the token into `FIGMA_TOKEN`.
5. Set `FIGMA_FILE_KEY` to the file key (the segment after `/file/` in the Figma URL, or the `key` field in any Figma `meta` tag). Set `FIGMA_TEAM_ID` to the numeric team id the token is scoped to.

> **Why file-pinned, not user-pinned?** A user-scoped token would let a confused or malicious agent prompt see and comment on every Figma file the user has access to — across teams, across customers. File-pinning is a hard security boundary that the server enforces on every URL it constructs; the team scope is the second check that the token's scope matches the customer.

The team scope is asserted on startup with a single `GET /v1/files/{key}` call. If the token cannot see the file, the process exits non-zero before any tool can be called.

---

## Tools

All tools are read or comment-write only. The model never gets to choose the file — the server pins `FIGMA_FILE_KEY` into every URL it constructs.

| Tool | Purpose | Required args | Optional args |
| --- | --- | --- | --- |
| `get_file` | Fetch the full pinned file (document tree, components, styles, version metadata). | — | — |
| `get_file_nodes` | Fetch specific nodes from the pinned file. | `node_ids` (1-50) | `depth` (1-10) |
| `get_node` | Fetch a single node by id. | `node_id` | `depth` (1-10) |
| `get_images` | Render nodes to image URLs (PNG, JPG, SVG, PDF). | `node_ids` (1-50) | `format`, `scale` (0.5-4) |
| `get_comments` | List comments on the pinned file. | — | `as_md` (default true), `after` (cursor) |
| `post_comment` | Post a comment on the pinned file. | `message` | `client_meta` (x, y) |

### Example payloads

`get_file`:

```json
{}
```

`get_file_nodes`:

```json
{
  "node_ids": ["1:2", "1:3"],
  "depth": 2
}
```

`get_node`:

```json
{
  "node_id": "1:3"
}
```

`get_images`:

```json
{
  "node_ids": ["1:2"],
  "format": "png",
  "scale": 2
}
```

`get_comments` (first page):

```json
{
  "as_md": true
}
```

`get_comments` (next page — pass the `next` value from the prior response as `after`):

```json
{
  "after": "cmt_2"
}
```

`post_comment` (anchored to a document coordinate):

```json
{
  "message": "Hero copy needs a CTA above the fold.",
  "client_meta": { "x": 720, "y": 600 }
}
```

`post_comment` (file-level, no anchor):

```json
{
  "message": "Design looks great. Approving for staging."
}
```

### Contract drift: comments pagination

Figma's REST v1 comments endpoint does **not** paginate by default — the public API returns all comments for a file in a single response. The `after` cursor is still exposed on `get_comments` and threaded through to the request, but the response will only carry a `next` value when the underlying Figma API does. Today this is essentially always undefined; the smoke test exercises the cursor path with a mock that does paginate, so the server's handling is locked in for the day Figma adds real cursor support.

---

## Run the smoke test

The smoke test boots a mock Figma HTTP server, spawns the MCP server pointed at it, and exercises all 6 tools over stdio. It runs without any real Figma credentials.

```bash
cd mcp-servers/figma
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 6 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid Figma MCP configuration: …` | Missing one of the three required env vars. | Set `FIGMA_TOKEN`, `FIGMA_FILE_KEY`, and `FIGMA_TEAM_ID` in the MCP client config. |
| Server exits with `team-scope assertion failed` on startup | The token cannot see the pinned file. | Confirm the file key is correct, the team id matches the token's team, and the token has `File content: Read`. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error, a missing `dist/` build, or a team-scope assertion failure. |
| `get_file` returns a very large response | Figma files can be huge; `get_file` is the full document. | Use `get_file_nodes` with specific ids and `depth: 1` to pull a focused slice. |
| `get_images` returns an `err` field instead of URLs | Figma's renderer rejected the request (e.g. invalid ids, unsupported format). | Confirm the ids are in the `1:2` shape and the format is one of `jpg`, `png`, `svg`, `pdf`. |
| `post_comment` returns 400 from Figma | Figma requires a `client_meta` for some comment types. | Pass `client_meta: { x, y }` to anchor the comment to a document coordinate, or omit to leave a file-level comment. |
| `get_comments` returns all comments in one shot | Figma's REST v1 does not paginate comments by default. | This is expected. The `after` cursor is exposed for forward-compat with future Figma pagination. |
| Operator dashboard sees repeated `get_file` calls during a multi-tool task | The startup liveness call hits the file endpoint. Subsequent tool calls cache nothing. | Expected — Figma's REST API is per-call; no client-side cache is implemented in v0.1.0. |

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` for which MCP servers this package templates (it is itself a copy of `forge-ai/mcp-github` plus a Figma-specific client) and the contract they share.

---

## Figma-specific contract notes

### No Figma SDK

Figma's public REST v1 surface is not covered by a maintained TypeScript SDK we want to depend on. The client in `src/client.ts` is hand-rolled over `fetch`, with the same typed `createClient(config) → Client` shape the other Forge AI MCP servers use. The trade-off: no auto-pagination, no GraphQL client, no built-in retries. v0.1.0 does a single request per tool call and surfaces non-2xx as `FigmaApiError`. If we adopt retries later, do it inside the client so the tools' input/output shape stays stable.

### Design-file mutation is out of scope

The platform reads designs. It never mutates design content (no `POST /v1/files/{key}/components`, no version writes, no branch creation). The only write the server exposes is `post_comment` — agents can leave design feedback, but a human operator decides what to change. The `UX Designer` hire is the one that owns design mutation.

### Team-scope startup assertion

The server issues a single `GET /v1/files/{key}` on startup to assert the token can see the pinned file and that the team scope matches. This adds one round trip to startup and turns misconfiguration into a process-level failure rather than a tool-level surprise. If startup latency matters, the assertion can be moved to first-call (lazy); the trade-off is that a misconfigured server accepts connections and then fails every call.

### Image render URLs are short-lived

`get_images` returns URLs to Figma's render CDN. These are not safe to cache across process restarts and may expire within minutes. The model should re-render when it needs the bytes.

### Comments cursor contract drift

Figma's REST v1 comments endpoint does not currently expose a `cursor` in the response (it returns all comments for a file in a single response). The mock used by `npm run smoke` paginates so the server's `after` handling is locked in. The contract is: `get_comments` accepts an optional `after` string and returns `{ comments, next? }` — the smoke test exercises the round-trip; production will see `next === undefined` on every call until Figma adds real pagination.
